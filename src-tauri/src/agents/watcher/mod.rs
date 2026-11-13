//! The watcher: a thread that, with Agents and its own switch on, starts work on Ready items by
//! itself. Each pass it works out why it would wait, which item it would start and what its own
//! links are doing; when it holds the lock, the budget and the cap allow and an item can start,
//! `start::step` starts one Opus worker in a git worktree. The last pass's view is kept for
//! `watcher_status`, which spawns no process. Plan:
//! docs/superpowers/plans/2026-11-13-agent-orchestrator-3-watcher-lead.md (Tasks 7 and 8).
//!
//! `watcher.json` holds only a start that timed out (`start::Pending`).

pub mod act;
pub mod budget;
pub mod check;
pub mod events;
pub mod git;
pub mod lead;
pub mod start;
pub mod store;

use super::actions;
use super::briefing::in_mode;
use super::cli::{read_settings, AgentsSettings};
use super::model::{Agent, Group};
use super::usage::limits;
use crate::agent_access::read_access;
use crate::orgs::{org_dir, Registry, DB_FILE};
use budget::Budget;
use events::{notice, Event};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use store::{open_ask, open_could_not_start, open_watcher_links, ready_items, ReadyItem, WatcherLink};
use tauri::{AppHandle, Manager};

pub const LOCK_FILE: &str = "watcher.lock";

/// Why the watcher waits; None from `gate` means it may go on to the budget and the cap.
#[derive(Clone, Debug, PartialEq)]
pub enum Paused {
    Demo,
    Off,
    AgentsOff,
    Mode,
    Locked,
    /// The lock is not (yet) held by this thread, or a start waits to show up in the agent list.
    Starting,
    /// Agent access is off for every organisation.
    AccessOff,
    Budget(Budget),
    /// The number of workers running (the cap is in the settings).
    Cap(usize),
    /// Items are Ready but none can start: the first one's title and why (`no_folder`,
    /// `not_git` or `failed_start`).
    NotStartable { title: String, reason: &'static str },
    Nothing,
}

impl Paused {
    fn key(&self) -> &'static str {
        match self {
            Paused::Demo => "demo",
            Paused::Off => "off",
            Paused::AgentsOff => "agents_off",
            Paused::Mode => "mode",
            Paused::Locked => "locked",
            Paused::Starting => "starting",
            Paused::AccessOff => "access_off",
            Paused::Budget(_) => "budget",
            Paused::Cap(_) => "cap",
            Paused::NotStartable { .. } => "not_startable",
            Paused::Nothing => "nothing",
        }
    }
}

/// Whether this thread holds the watcher lock.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LockState {
    /// Not tried (yet): nothing starts and no "Would start" shows.
    Unknown,
    Held,
    /// Another copy of the app holds it.
    Other,
}

impl LockState {
    fn from_u8(n: u8) -> Self {
        match n {
            1 => LockState::Held,
            2 => LockState::Other,
            _ => LockState::Unknown,
        }
    }
    fn to_u8(self) -> u8 {
        match self {
            LockState::Unknown => 0,
            LockState::Held => 1,
            LockState::Other => 2,
        }
    }
}

/// The cheap reasons, in this order: the demo build, the watcher switch, the Agents switch, any
/// organisation in test or presentation mode (`any_mode`), another copy of the app holding the
/// lock (`locked`).
pub fn gate(demo: bool, s: &AgentsSettings, any_mode: bool, locked: bool) -> Option<Paused> {
    if demo {
        return Some(Paused::Demo);
    }
    if !s.watcher {
        return Some(Paused::Off);
    }
    if !s.enabled {
        return Some(Paused::AgentsOff);
    }
    if any_mode {
        return Some(Paused::Mode);
    }
    locked.then_some(Paused::Locked)
}

/// `flock(LOCK_EX | LOCK_NB)` on `watcher.lock` in the app data folder; the lock lasts as long as
/// the returned file is kept. None when another copy of the app holds it (or it cannot be made).
pub fn acquire_lock(app_dir: &Path) -> Option<std::fs::File> {
    use std::os::fd::AsRawFd;
    let file = std::fs::OpenOptions::new().create(true).truncate(false).write(true).open(app_dir.join(LOCK_FILE)).ok()?;
    // SAFETY: `flock` on a file descriptor this function owns; it reads and writes no memory.
    let got = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0;
    got.then_some(file)
}

pub struct Deps<'a> {
    pub app_dir: &'a Path,
    /// Where `limits.json` is read from (read only): `budget::limits_dir`.
    pub limits_dir: &'a Path,
    pub demo: bool,
    pub now: i64,
    /// The poller's last list, and when it last succeeded.
    pub agents: &'a [Agent],
    pub listed_at: Option<i64>,
}

/// What the watcher would do now.
#[derive(Clone, Debug, PartialEq)]
pub struct Outlook {
    pub paused: Option<Paused>,
    /// `start::running_workers` of the open watcher links and the list, plus a start waiting to
    /// show up.
    pub running: usize,
    pub cap: u32,
    /// (organisation id, item) it would start; only when not paused.
    pub would_start: Option<(String, ReadyItem)>,
}

fn org_dbs(app_dir: &Path) -> Vec<(String, PathBuf)> {
    let Ok(Some(reg)) = Registry::load(app_dir) else { return vec![] };
    reg.organisations.into_iter().map(|o| (o.id.clone(), org_dir(app_dir, &o.id).join(DB_FILE))).collect()
}

/// The settings and the gate; the organisations are listed only when the switches are on.
fn settings_and_gate(d: &Deps, locked: bool) -> (AgentsSettings, Option<Paused>) {
    let s = read_settings(d.app_dir);
    // The switches first: with either off, no organisation is looked at.
    if let Some(p) = gate(false, &s, false, false).filter(|p| matches!(p, Paused::Off | Paused::AgentsOff)) {
        return (s, Some(p));
    }
    let any_mode = org_dbs(d.app_dir).iter().any(|(_, db)| in_mode(db));
    let g = gate(false, &s, any_mode, locked);
    (s, g)
}

/// A Ready item of an organisation agent access allows.
#[derive(Clone, Debug, PartialEq)]
struct Candidate {
    org: String,
    item: ReadyItem,
    /// An open "Could not start" entry: it is skipped while that entry is open.
    failed: bool,
}

/// What one pass read, once: the settings and the gate, the budget, the watcher's own links in
/// every organisation not in a mode, and the Ready items of the allowed ones.
pub struct Pass {
    cap: u32,
    gate: Option<Paused>,
    budget: Budget,
    running: usize,
    /// Agent access allows at least one organisation.
    access: bool,
    /// Across the allowed organisations, in `store::order`, then organisation order.
    candidates: Vec<Candidate>,
    links: Vec<(PathBuf, WatcherLink)>,
}

/// What the pass learned about the world outside the databases.
pub struct Known<'a> {
    pub lock: LockState,
    /// A start that timed out is waiting to show up in the list (it counts as a running worker).
    pub pending: usize,
    /// `git` verdicts so far on "is a work tree", by folder; a folder not here is assumed one.
    pub repos: &'a HashMap<String, bool>,
}

/// Reads the settings, the gate and, when no gate holds, the databases. `lock` is what the thread
/// last found: only `Held` lets anything go on.
fn read_pass(d: &Deps, lock: LockState, pending: usize) -> Pass {
    let (s, g) = settings_and_gate(d, lock != LockState::Held);
    let gate = match (g, lock) {
        (Some(Paused::Locked), LockState::Unknown) => Some(Paused::Starting),
        (g, _) => g,
    };
    let mut pass = Pass {
        cap: s.worker_cap,
        gate,
        budget: Budget::Ok,
        running: 0,
        access: true,
        candidates: vec![],
        links: vec![],
    };
    if pass.gate.is_some() {
        return pass;
    }
    let access = read_access(d.app_dir);
    let mut ranked: Vec<(usize, Candidate)> = Vec::new();
    let mut any_allowed = false;
    for (index, (org, db)) in org_dbs(d.app_dir).into_iter().enumerate() {
        if !db.exists() || in_mode(&db) {
            continue;
        }
        let allowed = access.enabled && access.orgs.get(&org) == Some(&true);
        any_allowed |= allowed;
        let _shared = crate::org_shared();
        match open_watcher_links(&db, &org) {
            Ok(links) => pass.links.extend(links.into_iter().map(|l| (db.clone(), l))),
            Err(e) => log::warn!("[watcher] organisation {org}: {e}"),
        }
        if !allowed {
            continue;
        }
        let failed = open_could_not_start(&db).unwrap_or_else(|e| {
            log::warn!("[watcher] organisation {org}: {e}");
            vec![]
        });
        match ready_items(&db) {
            Ok(items) => ranked.extend(items.into_iter().map(|item| {
                let failed = failed.contains(&(item.kind, item.id));
                (index, Candidate { org: org.clone(), item, failed })
            })),
            Err(e) => log::warn!("[watcher] organisation {org}: {e}"),
        }
    }
    ranked.sort_by(|a, b| store::order(&a.1.item, &b.1.item).then(a.0.cmp(&b.0)));
    pass.candidates = ranked.into_iter().map(|(_, c)| c).collect();
    pass.access = any_allowed;
    pass.running = start::running_workers(pass.links.len(), d.agents) + pending;
    // Read only: in the dev build `limits_dir` is the installed app's folder.
    pass.budget = budget::budget(limits::load_dated(d.limits_dir, d.now), d.now);
    pass
}

/// Why a Ready item cannot start, or None when it can. A folder `git` has not been asked about is
/// assumed to be a work tree (the thread asks; the status reader does not).
fn startable(c: &Candidate, repos: &HashMap<String, bool>) -> Option<&'static str> {
    if c.failed {
        return Some("failed_start");
    }
    match c.item.folder.as_deref().filter(|f| !f.trim().is_empty()) {
        None => Some("no_folder"),
        Some(f) if repos.get(f) == Some(&false) => Some("not_git"),
        Some(_) => None,
    }
}

/// The first startable candidate: what `start::step` starts and what the status names.
fn pick<'a>(pass: &'a Pass, repos: &HashMap<String, bool>) -> Option<&'a Candidate> {
    pass.candidates.iter().find(|c| startable(c, repos).is_none())
}

/// Asks `git` about the folders of the candidates, in order, until one is a work tree. Only the
/// thread calls it.
fn fill_repos(pass: &Pass, g: &dyn git::Git, repos: &mut HashMap<String, bool>) {
    for c in pass.candidates.iter().filter(|c| !c.failed) {
        let Some(f) = c.item.folder.as_deref().filter(|f| !f.trim().is_empty()) else { continue };
        let is = *repos.entry(f.to_string()).or_insert_with(|| git::is_repo(g, f));
        if is {
            break;
        }
    }
}

/// Decides from what the pass read; reads nothing and writes nothing.
fn outlook_of(pass: &Pass, k: &Known) -> Outlook {
    let (cap, running) = (pass.cap, pass.running);
    let wait = |p: Paused| Outlook { paused: Some(p), running, cap, would_start: None };
    if let Some(g) = &pass.gate {
        return Outlook { paused: Some(g.clone()), running: 0, cap, would_start: None };
    }
    if !pass.access {
        return wait(Paused::AccessOff);
    }
    if pass.budget != Budget::Ok {
        return wait(Paused::Budget(pass.budget.clone()));
    }
    if running >= cap as usize {
        return wait(Paused::Cap(running));
    }
    if k.pending > 0 {
        return wait(Paused::Starting);
    }
    match (pick(pass, k.repos), pass.candidates.first()) {
        (Some(c), _) => Outlook { paused: None, running, cap, would_start: Some((c.org.clone(), c.item.clone())) },
        (None, Some(first)) => {
            let reason = startable(first, k.repos).unwrap_or("failed_start");
            wait(Paused::NotStartable { title: first.item.title.clone(), reason })
        }
        (None, None) => wait(Paused::Nothing),
    }
}

/// Reads and decides; touches no lock, spawns no process and writes nothing.
pub fn outlook(d: &Deps, k: &Known) -> Outlook {
    // First, before any file is read.
    if d.demo {
        return Outlook { paused: Some(Paused::Demo), running: 0, cap: 0, would_start: None };
    }
    outlook_of(&read_pass(d, k.lock, k.pending), k)
}

/// What one pass noticed about one watcher link.
#[derive(Clone, Debug, PartialEq)]
pub struct Noticed {
    pub org: String,
    pub link_id: i64,
    pub event: Event,
}

#[derive(Default)]
pub struct Memory {
    /// The lock, kept while the watcher is on and not paused by a switch or a mode.
    pub lock: Option<std::fs::File>,
    /// Per (organisation, link id): the group the agent was last seen in and since when.
    seen: HashMap<(String, i64), (Group, i64)>,
    /// `watcher.json` is read on the first pass.
    loaded: bool,
    /// When this watcher began (the first pass).
    started: i64,
    /// A start that timed out (also in `watcher.json`).
    pending: Option<start::Pending>,
    /// `git` verdicts of this pass.
    repos: HashMap<String, bool>,
    /// Items whose entry could not be written: skipped for this process.
    skip: start::Skip,
    /// Per (organisation, link id): the time of the list that first lacked a finished-looking
    /// worker's agent (two lists made at different times must lack it before the watcher acts).
    misses: HashMap<(String, i64), i64>,
    /// Per link whose failed check was sent back: when the watcher first saw it waiting for the
    /// worker's next report, and whether the agent was seen working since.
    awaiting: HashMap<(String, i64), (i64, bool)>,
    /// Finished checks whose entry could not be written (`check::Unwritten`).
    unwritten: check::Unwritten,
    /// Per (organisation, link id, `prompt` or `idle`, start of the wait): an entry written for
    /// that wait, so one the owner dismissed is not written again while the wait goes on.
    noted: HashSet<(String, i64, &'static str, i64)>,
    /// Per link: when a stuck worker was last asked to continue.
    resumed_at: HashMap<(String, i64), i64>,
    /// The running lead session and a lead start that timed out (also in `watcher.json`).
    lead: Option<lead::LeadRun>,
    lead_pending: Option<lead::LeadPending>,
    /// `watcher.json` could not be saved: no lead starts until it can.
    lead_dirty: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Report {
    pub outlook: Outlook,
    pub noticed: Vec<Noticed>,
}

/// What the last pass found, for `watcher_status`, which spawns no process.
static LOCK: AtomicU8 = AtomicU8::new(0);
static PENDING: AtomicBool = AtomicBool::new(false);
static REPOS: Mutex<Vec<(String, bool)>> = Mutex::new(Vec::new());
static LAST_NOTICED: Mutex<Vec<Noticed>> = Mutex::new(Vec::new());
/// The entry the lead session is on (its title), for `watcher_status`.
static LEAD: Mutex<Option<String>> = Mutex::new(None);

fn remember(lock: LockState, mem: &Memory) {
    LOCK.store(lock.to_u8(), Ordering::Relaxed);
    PENDING.store(mem.pending.is_some(), Ordering::Relaxed);
    if let Ok(mut l) = LEAD.lock() {
        *l = mem.lead.as_ref().map(|r| r.title.clone()).or_else(|| mem.lead_pending.as_ref().map(|p| p.title.clone()));
    }
    if let Ok(mut r) = REPOS.lock() {
        *r = mem.repos.iter().map(|(k, v)| (k.clone(), *v)).collect();
    }
}

fn save_pending(d: &Deps, mem: &Memory) {
    if let Err(e) = start::save_pending(d.app_dir, &mem.pending) {
        log::warn!("[watcher] could not save the pending start: {e}");
    }
}

/// `read_pass` with this process's skipped items marked as failed.
fn fresh(d: &Deps, lock: LockState, mem: &Memory) -> Pass {
    let mut pass = read_pass(d, lock, usize::from(mem.pending.is_some()));
    for c in &mut pass.candidates {
        let key = (c.org.clone(), git::kind_word(c.item.kind), c.item.id);
        c.failed |= mem.skip.contains(&key);
    }
    pass
}

/// One pass. In the demo build it returns before any file is read. Without `env` nothing is
/// started (the pass only looks). Something starts only when this thread holds the lock.
pub fn tick(d: &Deps, mem: &mut Memory, env: Option<&start::Env>) -> Report {
    if d.demo {
        return Report { outlook: outlook(d, &Known { lock: LockState::Unknown, pending: 0, repos: &mem.repos }), noticed: vec![] };
    }
    if !mem.loaded {
        mem.loaded = true;
        mem.started = d.now;
        let saved = start::read_state(d.app_dir);
        mem.pending = saved.pending;
        mem.lead = saved.lead;
        mem.lead_pending = saved.lead_pending;
    }
    // The lock is taken only once the switches and modes allow the watcher, and let go when they
    // do not, so a paused copy never keeps another copy out.
    let lock = if settings_and_gate(d, false).1.is_some() {
        mem.lock = None;
        LockState::Unknown
    } else {
        if mem.lock.is_none() {
            mem.lock = acquire_lock(d.app_dir);
        }
        if mem.lock.is_some() {
            LockState::Held
        } else {
            LockState::Other
        }
    };
    let mut pass = fresh(d, lock, mem);
    mem.repos.clear();
    if lock == LockState::Held && pass.gate.is_none() {
        if let Some(env) = env {
            let before = mem.pending.clone();
            if start::resolve_pending(d, &mut mem.pending, mem.started, &mut mem.skip) {
                // The adopted link or the entry of a lost start changes what may start.
                pass = fresh(d, lock, mem);
            }
            // No process at all unless a start is allowed: a pass paused by the budget or the cap
            // asks `git` nothing.
            let room = pass.access && start::may_start(None, &pass.budget, pass.running, pass.cap);
            if mem.pending.is_none() && room {
                fill_repos(&pass, env.git, &mut mem.repos);
                if start::step(env, d, &pass, &mem.repos, &mut mem.pending, &mut mem.skip) != start::Step::Idle {
                    pass = fresh(d, lock, mem);
                }
            }
            if mem.pending != before {
                save_pending(d, mem);
            }
            // A finished worker's check: not gated by the budget (no model is used).
            if check::step(env, d, mem, &pass.links) {
                pass = fresh(d, lock, mem);
            }
            // Stuck, at a prompt, idle or old: resume, an entry for the owner, or wrap up.
            if act::step(env, d, mem, &pass.budget, &pass.links) {
                pass = fresh(d, lock, mem);
            }
            // A short lead session for one waiting entry, and what the lead wrote carried out.
            if lead::step(env, d, mem, &pass) {
                pass = fresh(d, lock, mem);
            }
        }
    }
    remember(lock, mem);
    let outlook = outlook_of(&pass, &Known { lock, pending: usize::from(mem.pending.is_some()), repos: &mem.repos });
    let watching = !matches!(
        outlook.paused,
        Some(Paused::Demo | Paused::Off | Paused::AgentsOff | Paused::Mode | Paused::Locked)
    );
    let noticed = if watching { notice_links(d, mem, pass.links) } else { vec![] };
    if !watching {
        mem.seen.clear();
    }
    Report { outlook, noticed }
}

/// What each open watcher link needs attention for. Stuck is false here: it needs the transcript,
/// which only `act::step` reads (the "would act on" lines are a view, not the decision).
fn notice_links(d: &Deps, mem: &mut Memory, links: Vec<(PathBuf, WatcherLink)>) -> Vec<Noticed> {
    mem.seen.retain(|(org, id), _| links.iter().any(|(_, l)| l.org == *org && l.id == *id));
    let mut out = Vec::new();
    for (db, mut link) in links {
        let agent = d.agents.iter().find(|a| match &link.session_id {
            Some(s) => &a.session_id == s,
            None => a.short_id.as_deref() == Some(link.short_id.as_str()),
        });
        let key = (link.org.clone(), link.id);
        match agent.map(|a| a.group) {
            Some(g @ (Group::NeedsYou | Group::Idle)) => {
                let since = match mem.seen.get(&key) {
                    Some((seen, t)) if *seen == g => *t,
                    _ => d.now,
                };
                mem.seen.insert(key, (g, since));
                link.seen_since = Some(since);
            }
            _ => {
                mem.seen.remove(&key);
            }
        }
        let ask = {
            let _shared = crate::org_shared();
            open_ask(&db, link.id)
        }
        .unwrap_or_else(|e| {
            log::warn!("[watcher] organisation {}: {e}", link.org);
            None
        });
        if let Some(event) = notice(&link, agent, false, ask, d.now, d.listed_at) {
            out.push(Noticed { org: link.org.clone(), link_id: link.id, event });
        }
    }
    out
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WatcherStatus {
    /// `demo`, `off`, `agents_off`, `mode`, `locked`, `starting`, `access_off`, `budget`, `cap`,
    /// `not_startable` or `nothing`; None when it would start something.
    pub paused: Option<String>,
    /// With `not_startable`: `no_folder`, `not_git` or `failed_start`, and the first item's title.
    pub reason: Option<String>,
    pub blocked_item: Option<String>,
    /// With `budget`: `ahead_of_week`, `five_hour`, `no_data` or `stale`.
    pub budget: Option<String>,
    pub percent: Option<f64>,
    pub line: Option<f64>,
    pub minutes_old: Option<i64>,
    pub running: usize,
    pub cap: u32,
    pub would_start: Option<String>,
    /// The lead session: the title of the entry it is on.
    pub lead: Option<String>,
}

pub fn status_of(o: &Outlook, now: i64) -> WatcherStatus {
    let why = match &o.paused {
        Some(Paused::Budget(b)) => Some(b),
        _ => None,
    };
    WatcherStatus {
        paused: o.paused.as_ref().map(|p| p.key().to_string()),
        reason: match &o.paused {
            Some(Paused::NotStartable { reason, .. }) => Some(reason.to_string()),
            _ => None,
        },
        blocked_item: match &o.paused {
            Some(Paused::NotStartable { title, .. }) => Some(title.clone()),
            _ => None,
        },
        budget: why
            .and_then(|b| match b {
                Budget::AheadOfWeek { .. } => Some("ahead_of_week"),
                Budget::FiveHour(_) => Some("five_hour"),
                Budget::NoData => Some("no_data"),
                Budget::Stale { .. } => Some("stale"),
                Budget::Ok => None,
            })
            .map(String::from),
        percent: match why {
            Some(Budget::AheadOfWeek { percent, .. }) | Some(Budget::FiveHour(percent)) => Some(*percent),
            _ => None,
        },
        line: match why {
            Some(Budget::AheadOfWeek { line, .. }) => Some(*line),
            _ => None,
        },
        minutes_old: match why {
            Some(Budget::Stale { saved_at }) => Some(((now - saved_at) / 60_000).max(0)),
            _ => None,
        },
        running: o.running,
        cap: o.cap,
        would_start: o.would_start.as_ref().map(|(_, i)| i.title.clone()),
        lead: None,
    }
}

fn check(app: &AppHandle, mem: &mut Memory) {
    // First, before any file is read.
    if crate::host::is_demo(app) {
        return;
    }
    let state = app.state::<super::AgentsState>();
    let app_dir = state.app_dir.clone();
    let limits_dir = budget::limits_dir(&app_dir, crate::host::running_dev(), &actions::home_dir());
    let login = state.login_cache();
    let real_git = git::RealGit { login: login.clone() };
    let get_cli = || actions::cli(&login).map(|c| Box::new(c) as Box<dyn super::cli::Cli>);
    // The same list `agents_start` checks a folder against.
    let trusted = || super::projects::read_trusted(&actions::home_dir());
    let mcp_path = crate::agent_access::mcp_path();
    // The same path `agents_send` types a message through.
    let send = |agent: &Agent, text: &str| super::pty::send_message(&state.hub, agent, text);
    // The login shell's `PATH`, resolved only when a check is about to run.
    let path_env = || super::pty::cached_login_env(&login).path.clone();
    let claude_dir = actions::home_dir().join(".claude");
    let transcript_tail = |session_id: &str| super::transcript::tail_text(&claude_dir, session_id, events::TAIL_BYTES);
    let env = start::Env {
        git: &real_git,
        cli: &get_cli,
        trusted: &trusted,
        dev: crate::host::running_dev(),
        mcp_path: &mcp_path,
        send: &send,
        path_env: &path_env,
        transcript_tail: &transcript_tail,
    };
    let report = tick(
        &Deps {
            app_dir: &app_dir,
            limits_dir: &limits_dir,
            demo: false,
            now: limits::now_ms(),
            agents: &state.cached(),
            listed_at: state.listed_at(),
        },
        mem,
        Some(&env),
    );
    if let Ok(mut last) = LAST_NOTICED.lock() {
        if *last != report.noticed {
            for n in &report.noticed {
                log::info!("[watcher] would act on link {} of organisation {}: {:?}", n.link_id, n.org, n.event);
            }
            *last = report.noticed;
        }
    }
}

/// The watcher thread: a pass every 30 s and right after a wake, the first after 30 s so the
/// poller has listed the agents (as the link tracker's).
pub fn start(app: &AppHandle) {
    use super::routines::schedule::{next_since_check, wall_ms, CHECK_EVERY, SLICE};
    let app = app.clone();
    std::thread::spawn(move || {
        let mut mem = Memory::default();
        let mut last_wall = wall_ms();
        let mut since_check = Duration::ZERO;
        loop {
            if since_check >= CHECK_EVERY {
                if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| check(&app, &mut mem))).is_err() {
                    log::error!("[watcher] check panicked; continuing");
                }
                since_check = Duration::ZERO;
            }
            std::thread::sleep(SLICE);
            let wall = wall_ms();
            since_check = next_since_check(since_check, last_wall, wall);
            last_wall = wall;
        }
    });
}

/// Why the watcher waits or what it would start, for the Needs you tab. Demo-gated like the
/// other Agents commands: the demo build reads nothing.
#[tauri::command]
pub async fn watcher_status(
    app: AppHandle,
    state: tauri::State<'_, super::AgentsState>,
) -> Result<WatcherStatus, String> {
    let app_dir = state.app_dir.clone();
    let limits_dir = budget::limits_dir(&app_dir, crate::host::running_dev(), &actions::home_dir());
    let agents = state.cached();
    let listed_at = state.listed_at();
    super::pty::blocking(move || {
        let demo = crate::host::is_demo(&app);
        let now = limits::now_ms();
        let d = Deps { app_dir: &app_dir, limits_dir: &limits_dir, demo, now, agents: &agents, listed_at };
        // What the thread last found: no process is spawned here.
        let repos: HashMap<String, bool> = REPOS.lock().map(|r| r.iter().cloned().collect()).unwrap_or_default();
        let known = Known {
            lock: LockState::from_u8(LOCK.load(Ordering::Relaxed)),
            pending: usize::from(PENDING.load(Ordering::Relaxed)),
            repos: &repos,
        };
        let mut status = status_of(&outlook(&d, &known), now);
        status.lead = LEAD.lock().ok().and_then(|l| l.clone());
        Ok(status)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::cli::{write_settings, AgentsSettings};
    use crate::agent_access::{write_access, AccessSettings};
    use crate::orgs::Organisation;
    use rusqlite::{params, Connection};

    pub(super) const T0: i64 = 1_800_000_000_000;

    pub(super) fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("sm-watcher-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    pub(super) fn on() -> AgentsSettings {
        AgentsSettings { enabled: true, watcher: true, ..Default::default() }
    }

    #[test]
    fn gate_order_demo_off_mode_lock() {
        let s = on();
        assert_eq!(gate(true, &AgentsSettings::default(), true, true), Some(Paused::Demo));
        let no_watcher = AgentsSettings { watcher: false, ..on() };
        assert_eq!(gate(false, &no_watcher, true, true), Some(Paused::Off));
        let no_agents = AgentsSettings { enabled: false, ..on() };
        assert_eq!(gate(false, &no_agents, true, true), Some(Paused::AgentsOff));
        assert_eq!(gate(false, &s, true, true), Some(Paused::Mode));
        assert_eq!(gate(false, &s, false, true), Some(Paused::Locked));
        assert_eq!(gate(false, &s, false, false), None);
    }

    #[test]
    fn second_lock_is_refused() {
        let dir = tmp("lock");
        let first = acquire_lock(&dir).expect("the first lock");
        assert!(acquire_lock(&dir).is_none(), "a second copy is refused");
        drop(first);
        assert!(acquire_lock(&dir).is_some(), "free again once dropped");
    }

    /// An app folder: one organisation per id, migrated, with a project; Agents and the watcher on.
    pub(super) fn app(name: &str, orgs: &[&str]) -> PathBuf {
        let dir = tmp(name);
        Registry {
            version: 1,
            active_id: orgs[0].to_string(),
            organisations: orgs
                .iter()
                .map(|id| Organisation {
                    id: id.to_string(),
                    name: format!("Studio {id}"),
                    created_at: "2026-01-01T00:00:00Z".into(),
                    prefs: None,
                })
                .collect(),
        }
        .save(&dir)
        .unwrap();
        for id in orgs {
            let odir = org_dir(&dir, id);
            std::fs::create_dir_all(&odir).unwrap();
            let conn = Connection::open(odir.join(DB_FILE)).unwrap();
            for m in crate::migrate::MIGRATIONS {
                conn.execute_batch(m.sql).unwrap();
            }
            conn.execute_batch(
                "INSERT INTO clients (id, name) VALUES ('c1', 'Studio A');
                 INSERT INTO projects (id, client_id, name, folder_path) VALUES (1, 'c1', 'Poster tool', '/tmp/poster');",
            )
            .unwrap();
        }
        write_settings(&dir, &on()).unwrap();
        write_access(
            &dir,
            &AccessSettings { enabled: true, orgs: orgs.iter().map(|o| (o.to_string(), true)).collect(), ..Default::default() },
        )
        .unwrap();
        write_limits(&dir);
        dir
    }

    pub(super) fn write_limits(dir: &Path) {
        let (five_reset, week_reset) = ((T0 + 3_600_000) / 1000, (T0 + 302_400_000) / 1000);
        std::fs::write(
            dir.join("limits.json"),
            format!(
                r#"{{"savedAt":{},"rate_limits":{{
                  "five_hour":{{"used_percentage":10,"resets_at":{five_reset}}},
                  "seven_day":{{"used_percentage":10,"resets_at":{week_reset}}}}}}}"#,
                T0 / 1000
            ),
        )
        .unwrap();
    }

    pub(super) fn db_of(dir: &Path, org: &str) -> PathBuf {
        org_dir(dir, org).join(DB_FILE)
    }

    pub(super) fn add_ready(db: &Path, title: &str, priority: &str) {
        Connection::open(db)
            .unwrap()
            .execute(
                "INSERT INTO tasks (project_id, title, priority, stage) VALUES (1, ?1, ?2, 'ready')",
                params![title, priority],
            )
            .unwrap();
    }

    pub(super) fn deps<'a>(dir: &'a Path, agents: &'a [Agent]) -> Deps<'a> {
        Deps { app_dir: dir, limits_dir: dir, demo: false, now: T0, agents, listed_at: Some(T0), }
    }

    #[test]
    fn the_demo_build_reads_no_file_and_takes_no_lock() {
        let dir = std::env::temp_dir().join(format!("sm-watcher-demo-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut mem = Memory::default();
        let r = tick(&Deps { demo: true, ..deps(&dir, &[]) }, &mut mem, None);
        assert_eq!(r.outlook.paused, Some(Paused::Demo));
        assert!(mem.lock.is_none());
        assert!(!dir.exists(), "nothing was created or read");
        assert_eq!(status_of(&r.outlook, T0).paused.as_deref(), Some("demo"));
    }

    #[test]
    fn it_would_start_the_first_ready_item_and_changes_nothing() {
        let dir = app("would", &["a"]);
        let db = db_of(&dir, "a");
        add_ready(&db, "Contact sheet export", "low");
        add_ready(&db, "Poster tool", "high");
        let before = std::fs::read(&db).unwrap();
        let mut mem = Memory::default();
        let r = tick(&deps(&dir, &[]), &mut mem, None);
        assert_eq!(r.outlook.paused, None);
        assert_eq!(r.outlook.would_start.as_ref().map(|(o, i)| (o.as_str(), i.title.as_str())), Some(("a", "Poster tool")));
        let st = status_of(&r.outlook, T0);
        assert_eq!(st.would_start.as_deref(), Some("Poster tool"));
        assert_eq!(st.cap, 3);
        assert!(mem.lock.is_some(), "it holds the lock while it is on");
        assert_eq!(std::fs::read(&db).unwrap(), before, "the database is untouched");
        assert!(!dir.join("watcher.json").exists(), "nothing is persisted yet");
        let stage: String = Connection::open(&db)
            .unwrap()
            .query_row("SELECT stage FROM tasks WHERE title = 'Poster tool'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(stage, "ready");
    }

    #[test]
    fn it_says_why_it_waits() {
        let dir = app("why", &["a"]);
        let db = db_of(&dir, "a");
        // Nothing ready.
        let mut mem = Memory::default();
        assert_eq!(tick(&deps(&dir, &[]), &mut mem, None).outlook.paused, Some(Paused::Nothing));
        add_ready(&db, "Poster tool", "medium");
        // Cap: one watcher link open and a cap of 1.
        write_settings(&dir, &AgentsSettings { worker_cap: 1, ..on() }).unwrap();
        let c = Connection::open(&db).unwrap();
        c.execute("INSERT INTO tasks (project_id, title, stage) VALUES (1, 'Running one', 'running')", []).unwrap();
        c.execute(
            "INSERT INTO task_agents (task_id, short_id, name, started_at, started_by)
             VALUES (2, 'abc12345', 'work', '2027-01-15 08:00:00', 'watcher')",
            [],
        )
        .unwrap();
        let r = tick(&deps(&dir, &[]), &mut mem, None);
        assert_eq!(r.outlook.paused, Some(Paused::Cap(1)));
        assert_eq!(r.outlook.running, 1);
        assert_eq!(status_of(&r.outlook, T0).paused.as_deref(), Some("cap"));
        write_settings(&dir, &on()).unwrap();
        // Budget: the week is ahead of its pace.
        let week_reset = (T0 + 302_400_000) / 1000;
        std::fs::write(
            dir.join("limits.json"),
            format!(
                r#"{{"savedAt":{},"rate_limits":{{"five_hour":{{"used_percentage":10,"resets_at":{}}},
                   "seven_day":{{"used_percentage":70,"resets_at":{week_reset}}}}}}}"#,
                T0 / 1000,
                (T0 + 3_600_000) / 1000
            ),
        )
        .unwrap();
        let r = tick(&deps(&dir, &[]), &mut mem, None);
        assert!(matches!(r.outlook.paused, Some(Paused::Budget(Budget::AheadOfWeek { .. }))));
        let st = status_of(&r.outlook, T0);
        assert_eq!((st.paused.as_deref(), st.budget.as_deref()), (Some("budget"), Some("ahead_of_week")));
        assert_eq!(st.would_start, None);
        // A mode file in any organisation pauses it, and the lock is let go.
        write_limits(&dir);
        std::fs::write(org_dir(&dir, "a").join("studiomanager_test.db"), "").unwrap();
        let r = tick(&deps(&dir, &[]), &mut mem, None);
        assert_eq!(r.outlook.paused, Some(Paused::Mode));
        assert!(mem.lock.is_none());
    }

    #[test]
    fn a_second_copy_is_paused_as_locked() {
        let dir = app("second", &["a"]);
        let other = acquire_lock(&dir).unwrap();
        let mut mem = Memory::default();
        assert_eq!(tick(&deps(&dir, &[]), &mut mem, None).outlook.paused, Some(Paused::Locked));
        drop(other);
        assert_eq!(tick(&deps(&dir, &[]), &mut mem, None).outlook.paused, Some(Paused::Nothing));
    }

    #[test]
    fn it_only_picks_organisations_agent_access_allows() {
        let dir = app("access", &["a", "b"]);
        add_ready(&db_of(&dir, "a"), "Poster tool", "low");
        add_ready(&db_of(&dir, "b"), "Contact sheet export", "high");
        write_access(
            &dir,
            &AccessSettings { enabled: true, orgs: [("a".to_string(), true), ("b".to_string(), false)].into(), ..Default::default() },
        )
        .unwrap();
        let mut mem = Memory::default();
        let r = tick(&deps(&dir, &[]), &mut mem, None);
        assert_eq!(r.outlook.would_start.map(|(o, i)| (o, i.title)), Some(("a".into(), "Poster tool".into())));
    }

    #[test]
    fn it_notices_what_its_links_are_doing_and_a_hand_link_is_left_alone() {
        let dir = app("notices", &["a"]);
        let db = db_of(&dir, "a");
        let c = Connection::open(&db).unwrap();
        c.execute("INSERT INTO tasks (project_id, title, stage) VALUES (1, 'Poster tool', 'running')", []).unwrap();
        c.execute("INSERT INTO tasks (project_id, title, stage) VALUES (1, 'Contact sheet export', 'running')", []).unwrap();
        for (task, short, by) in [(1, "abc12345", Some("watcher")), (2, "def67890", None)] {
            c.execute(
                "INSERT INTO task_agents (task_id, short_id, name, started_at, started_by)
                 VALUES (?1, ?2, 'work', '2027-01-15 08:00:00', ?3)",
                params![task, short, by],
            )
            .unwrap();
        }
        c.execute("INSERT INTO needs_you (kind, task_id, link_id, title, lead_state) VALUES ('decide', 1, 1, 'Which size?', 'waiting')", []).unwrap();
        let agents = crate::agents::model::parse_agents(
            r#"[{"sessionId":"s1","id":"abc12345","name":"work","cwd":"/x","kind":"bg","status":"busy"},
                {"sessionId":"s2","id":"def67890","name":"work","cwd":"/x","kind":"bg","status":"idle","state":"done"}]"#,
        )
        .unwrap();
        let mut mem = Memory::default();
        let r = tick(&deps(&dir, &agents), &mut mem, None);
        assert_eq!(r.noticed, vec![Noticed { org: "a".into(), link_id: 1, event: Event::Asked { entry: 1 } }]);
        assert_eq!(r.outlook.running, 1);
    }
}
