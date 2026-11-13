//! The watcher: a thread that, with Agents and its own switch on, will start work on Ready items
//! by itself. In this task it only NOTICES: each pass it works out why it would wait, which item
//! it would start and what its own links are doing, and keeps that in memory for
//! `watcher_status`. It starts, stops and types nothing, runs no command and writes to no
//! organisation database. Plan:
//! docs/superpowers/plans/2026-11-13-agent-orchestrator-3-watcher-lead.md (Task 7).
//!
//! Nothing needs to survive a restart yet, so `watcher.json` is not written.

pub mod budget;
pub mod events;
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
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use store::{open_ask, open_watcher_links, ready_items, ReadyItem, WatcherLink};
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
    Budget(Budget),
    /// The number of workers running (the cap is in the settings).
    Cap(usize),
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
            Paused::Budget(_) => "budget",
            Paused::Cap(_) => "cap",
            Paused::Nothing => "nothing",
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
    /// Open watcher links (the fuller count of running workers comes with a later task).
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

/// The watcher's own open links in every organisation (not in a mode), with the organisation's
/// database. An organisation that cannot be read is logged and counts as none.
fn links_of(d: &Deps) -> Vec<(PathBuf, WatcherLink)> {
    let mut out = Vec::new();
    for (org, db) in org_dbs(d.app_dir) {
        if !db.exists() || in_mode(&db) {
            continue;
        }
        let _shared = crate::org_shared();
        match open_watcher_links(&db, &org) {
            Ok(links) => out.extend(links.into_iter().map(|l| (db.clone(), l))),
            Err(e) => log::warn!("[watcher] organisation {org}: {e}"),
        }
    }
    out
}

/// The first Ready item across the organisations agent access allows.
fn first_ready(d: &Deps) -> Option<(String, ReadyItem)> {
    let access = read_access(d.app_dir);
    if !access.enabled {
        return None;
    }
    let mut best: Option<(String, ReadyItem)> = None;
    for (org, db) in org_dbs(d.app_dir) {
        if !db.exists() || in_mode(&db) || access.orgs.get(&org) != Some(&true) {
            continue;
        }
        let _shared = crate::org_shared();
        match ready_items(&db) {
            Ok(items) => {
                if let Some(first) = items.into_iter().next() {
                    if best.as_ref().map_or(true, |(_, b)| store::order(&first, b).is_lt()) {
                        best = Some((org, first));
                    }
                }
            }
            Err(e) => log::warn!("[watcher] organisation {org}: {e}"),
        }
    }
    best
}

/// Reads and decides; touches no lock and writes nothing. `locked` is what the thread last found.
pub fn outlook(d: &Deps, locked: bool) -> Outlook {
    // First, before any file is read.
    if d.demo {
        return Outlook { paused: Some(Paused::Demo), running: 0, cap: 0, would_start: None };
    }
    let (s, g) = settings_and_gate(d, locked);
    let cap = s.worker_cap;
    if g.is_some() {
        return Outlook { paused: g, running: 0, cap, would_start: None };
    }
    let running = links_of(d).len();
    // Read only: in the dev build `limits_dir` is the installed app's folder.
    let rule = budget::budget(limits::load(d.limits_dir, d.now), d.now);
    if rule != Budget::Ok {
        return Outlook { paused: Some(Paused::Budget(rule)), running, cap, would_start: None };
    }
    if running >= cap as usize {
        return Outlook { paused: Some(Paused::Cap(running)), running, cap, would_start: None };
    }
    match first_ready(d) {
        Some(item) => Outlook { paused: None, running, cap, would_start: Some(item) },
        None => Outlook { paused: Some(Paused::Nothing), running, cap, would_start: None },
    }
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
}

#[derive(Clone, Debug, PartialEq)]
pub struct Report {
    pub outlook: Outlook,
    pub noticed: Vec<Noticed>,
}

static LOCKED: AtomicBool = AtomicBool::new(false);
static LAST_NOTICED: Mutex<Vec<Noticed>> = Mutex::new(Vec::new());

/// One pass. In the demo build it returns before any file is read.
pub fn tick(d: &Deps, mem: &mut Memory) -> Report {
    if d.demo {
        return Report { outlook: outlook(d, false), noticed: vec![] };
    }
    // The lock is taken only once the switches and modes allow the watcher, and let go when they
    // do not, so a paused copy never keeps another copy out.
    let locked = if settings_and_gate(d, false).1.is_some() {
        mem.lock = None;
        false
    } else {
        if mem.lock.is_none() {
            mem.lock = acquire_lock(d.app_dir);
        }
        mem.lock.is_none()
    };
    LOCKED.store(locked, Ordering::Relaxed);
    let outlook = outlook(d, locked);
    let watching = matches!(outlook.paused, None | Some(Paused::Budget(_) | Paused::Cap(_) | Paused::Nothing));
    let noticed = if watching { notice_links(d, mem) } else { vec![] };
    if !watching {
        mem.seen.clear();
    }
    Report { outlook, noticed }
}

/// What each open watcher link needs attention for. Stuck is not read yet (it needs the
/// transcript, a later task), so it is always false here.
fn notice_links(d: &Deps, mem: &mut Memory) -> Vec<Noticed> {
    let links = links_of(d);
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
        let ask = open_ask(&db, link.id).unwrap_or_else(|e| {
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
    /// `demo`, `off`, `agents_off`, `mode`, `locked`, `budget`, `cap` or `nothing`; None when it
    /// would start something.
    pub paused: Option<String>,
    /// With `budget`: `ahead_of_week`, `five_hour`, `no_data` or `stale`.
    pub budget: Option<String>,
    pub percent: Option<f64>,
    pub line: Option<f64>,
    pub minutes_old: Option<i64>,
    pub running: usize,
    pub cap: u32,
    pub would_start: Option<String>,
    /// The lead session (a later task).
    pub lead: Option<String>,
}

pub fn status_of(o: &Outlook, now: i64) -> WatcherStatus {
    let why = match &o.paused {
        Some(Paused::Budget(b)) => Some(b),
        _ => None,
    };
    WatcherStatus {
        paused: o.paused.as_ref().map(|p| p.key().to_string()),
        budget: why.map(|b| {
            match b {
                Budget::AheadOfWeek { .. } => "ahead_of_week",
                Budget::FiveHour(_) => "five_hour",
                Budget::NoData | Budget::Ok => "no_data",
                Budget::Stale { .. } => "stale",
            }
            .to_string()
        }),
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
        Ok(status_of(&outlook(&d, LOCKED.load(Ordering::Relaxed)), now))
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

    const T0: i64 = 1_800_000_000_000;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("sm-watcher-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn on() -> AgentsSettings {
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
    fn app(name: &str, orgs: &[&str]) -> PathBuf {
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

    fn write_limits(dir: &Path) {
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

    fn db_of(dir: &Path, org: &str) -> PathBuf {
        org_dir(dir, org).join(DB_FILE)
    }

    fn add_ready(db: &Path, title: &str, priority: &str) {
        Connection::open(db)
            .unwrap()
            .execute(
                "INSERT INTO tasks (project_id, title, priority, stage) VALUES (1, ?1, ?2, 'ready')",
                params![title, priority],
            )
            .unwrap();
    }

    fn deps<'a>(dir: &'a Path, agents: &'a [Agent]) -> Deps<'a> {
        Deps { app_dir: dir, limits_dir: dir, demo: false, now: T0, agents, listed_at: Some(T0), }
    }

    #[test]
    fn the_demo_build_reads_no_file_and_takes_no_lock() {
        let dir = std::env::temp_dir().join(format!("sm-watcher-demo-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut mem = Memory::default();
        let r = tick(&Deps { demo: true, ..deps(&dir, &[]) }, &mut mem);
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
        let r = tick(&deps(&dir, &[]), &mut mem);
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
        assert_eq!(tick(&deps(&dir, &[]), &mut mem).outlook.paused, Some(Paused::Nothing));
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
        let r = tick(&deps(&dir, &[]), &mut mem);
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
        let r = tick(&deps(&dir, &[]), &mut mem);
        assert!(matches!(r.outlook.paused, Some(Paused::Budget(Budget::AheadOfWeek { .. }))));
        let st = status_of(&r.outlook, T0);
        assert_eq!((st.paused.as_deref(), st.budget.as_deref()), (Some("budget"), Some("ahead_of_week")));
        assert_eq!(st.would_start, None);
        // A mode file in any organisation pauses it, and the lock is let go.
        write_limits(&dir);
        std::fs::write(org_dir(&dir, "a").join("studiomanager_test.db"), "").unwrap();
        let r = tick(&deps(&dir, &[]), &mut mem);
        assert_eq!(r.outlook.paused, Some(Paused::Mode));
        assert!(mem.lock.is_none());
    }

    #[test]
    fn a_second_copy_is_paused_as_locked() {
        let dir = app("second", &["a"]);
        let other = acquire_lock(&dir).unwrap();
        let mut mem = Memory::default();
        assert_eq!(tick(&deps(&dir, &[]), &mut mem).outlook.paused, Some(Paused::Locked));
        drop(other);
        assert_eq!(tick(&deps(&dir, &[]), &mut mem).outlook.paused, Some(Paused::Nothing));
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
        let r = tick(&deps(&dir, &[]), &mut mem);
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
        c.execute("INSERT INTO needs_you (kind, task_id, link_id, title) VALUES ('decide', 1, 1, 'Which size?')", []).unwrap();
        let agents = crate::agents::model::parse_agents(
            r#"[{"sessionId":"s1","id":"abc12345","name":"work","cwd":"/x","kind":"bg","status":"busy"},
                {"sessionId":"s2","id":"def67890","name":"work","cwd":"/x","kind":"bg","status":"idle","state":"done"}]"#,
        )
        .unwrap();
        let mut mem = Memory::default();
        let r = tick(&deps(&dir, &agents), &mut mem);
        assert_eq!(r.noticed, vec![Noticed { org: "a".into(), link_id: 1, event: Event::Asked { entry: 1 } }]);
        assert_eq!(r.outlook.running, 1);
    }
}
