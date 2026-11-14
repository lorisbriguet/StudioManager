//! Hubs: other stores of work (a client's knowledge repository) that StudioManager reads through a
//! connector program. The contract is in docs/hub-connector.md.
//!
//! The commands return what is held in memory at once; a connector runs only on a background
//! thread, one run at a time per (hub, request), and each run ends with `HUBS_CHANGED_EVENT`.
//! No lock is held while a connector runs.

pub mod contract;
pub mod open;
pub mod retry;
pub mod run;
pub mod settings;
pub mod tie;

use self::contract::{clean_text, parse_counts, parse_open, valid_id, Answer, ERROR_CHARS};
use self::retry::{key, may_run, read_tries, write_tries, ErrorKind, Tries, Wait, MAX_AUTO_FAILS, MAX_WAIT_MS};
use self::run::{Connector, RealConnector, Request, RunError, READ_TIMEOUT};
use self::settings::{allow, approved, fingerprint, forget, read_hubs, validate, write_hubs, Hub, HubInput, HubsRead};
use crate::agents::briefing::in_mode;
use crate::agents::cli::read_settings;
use crate::connectors::keychain::{Keychain, SecretStore};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

/// A count read this recently counts as fresh (sidebar, menu bar).
pub const FRESH_MS: i64 = 15 * 60_000;
/// How often the app refreshes every hub's count by itself.
pub const COUNTS_EVERY_MS: i64 = 5 * 60_000;
/// A count older than this is read again when a screen asks for the counts.
const COUNTS_STALE_MS: i64 = 60_000;
/// Emitted when a run ended: the page reads the hubs again.
pub const HUBS_CHANGED_EVENT: &str = "hubs-changed";
/// The error of a save whose connector was not allowed in the native dialog.
pub const NOT_CONFIRMED: &str = "Not saved: the connector was not allowed";
/// The requests this version uses that a hub may decline with `unsupported`.
const OFFERED: [&str; 2] = ["counts", "open"];

/// Why every hub command is refused, checked in this order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(clippy::enum_variant_names)] // the names are the plan's
pub enum Off {
    Demo,
    AgentsOff,
    Mode,
}

impl Off {
    pub fn message(self) -> &'static str {
        match self {
            Off::Demo => "Hubs are not available in the demo.",
            Off::AgentsOff => "Agents is off: turn it on in Settings to use hubs.",
            Off::Mode => "An organisation is in test or presentation mode: hubs are paused.",
        }
    }
}

/// The gate of every hub command: the demo build, then the Agents switch, then any organisation
/// in test or presentation mode. `any_mode` counts an unreadable registry as a mode.
pub fn gate(demo: bool, agents_on: bool, any_mode: bool) -> Option<Off> {
    if demo {
        Some(Off::Demo)
    } else if !agents_on {
        Some(Off::AgentsOff)
    } else if any_mode {
        Some(Off::Mode)
    } else {
        None
    }
}

/// Whether any organisation has a mode file, or the organisations cannot be listed (fails closed).
fn any_mode(app_dir: &Path) -> bool {
    if crate::orgs::Registry::load(app_dir).is_err() {
        return true;
    }
    crate::agents::watcher::org_dbs(app_dir).iter().any(|(_, db)| in_mode(db))
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// What the app holds of one hub, in memory only: nothing of it is stored.
#[derive(Debug, Clone, Default)]
pub struct Held {
    /// The last count and when it was read (epoch ms).
    pub waiting: Option<(u32, i64)>,
    /// The app's own words for why the last run failed.
    pub problem: Option<String>,
    /// Why the last run failed, for the page to word.
    pub problem_kind: Option<ErrorKind>,
    /// Requests the hub answered `unsupported` to.
    pub unsupported: HashSet<&'static str>,
}

/// Managed state: what is held per hub id, and the runs under way. Clones share it.
#[derive(Clone, Default)]
pub struct HubsState {
    cache: Arc<Mutex<HashMap<String, Held>>>,
    busy: Arc<Mutex<HashSet<(String, &'static str)>>>,
    /// The retry counters: the working copy, read from `hubs-state.json` the first time they are
    /// needed and written through after each change. A failed write loosens no cap.
    tries: Arc<Mutex<Option<HashMap<String, Tries>>>>,
}

/// Removes the (hub, request) from the busy set however the run ends.
struct BusyGuard {
    busy: Arc<Mutex<HashSet<(String, &'static str)>>>,
    key: (String, &'static str),
}

impl Drop for BusyGuard {
    fn drop(&mut self) {
        lock(&self.busy).remove(&self.key);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubView {
    pub id: String,
    pub name: String,
    pub colour: String,
    pub folder: String,
    pub program: String,
    pub args: Vec<String>,
    pub approved: bool,
    pub waiting: Option<u32>,
    pub fresh: bool,
    pub checked_at: Option<i64>,
    pub problem: Option<String>,
    pub problem_kind: Option<&'static str>,
    pub next_try_at: Option<i64>,
    pub paused: bool,
    pub busy: bool,
    pub offers: Vec<&'static str>,
}

/// Everything the commands need, so tests can stand in for the Keychain, the connector and the
/// clock.
#[derive(Clone)]
pub struct Deps {
    pub app_dir: PathBuf,
    pub demo: bool,
    pub store: Arc<dyn SecretStore>,
    pub connector: Arc<dyn Connector>,
    /// The login shell's `PATH`; asked only when a connector is about to run.
    pub path_env: Arc<dyn Fn() -> String + Send + Sync>,
    /// Called when a run ended.
    pub notify: Arc<dyn Fn() + Send + Sync>,
    pub now: Arc<dyn Fn() -> i64 + Send + Sync>,
}

/// One edit of `hubs.json` at a time (save and remove), dialog included.
static EDIT_LOCK: Mutex<()> = Mutex::new(());
/// One read-modify-write of the Keychain fingerprints at a time.
static APPROVAL_LOCK: Mutex<()> = Mutex::new(());

/// Checks the gate, reading as little as possible: the demo first, then the switch, then the
/// organisations.
fn gate_now(d: &Deps) -> Result<(), String> {
    let off = |o: Option<Off>| o.map_or(Ok(()), |o| Err(o.message().to_string()));
    off(gate(d.demo, false, false).filter(|o| *o == Off::Demo))?;
    let on = read_settings(&d.app_dir).enabled;
    off(gate(false, on, false).filter(|o| *o == Off::AgentsOff))?;
    off(gate(false, true, any_mode(&d.app_dir)))
}

/// The saved hubs; an unreadable file is an error, never "no hubs".
fn load_hubs(d: &Deps) -> Result<Vec<Hub>, String> {
    match read_hubs(&d.app_dir, d.demo) {
        HubsRead::Absent => Ok(vec![]),
        HubsRead::Hubs(h) => Ok(h),
        HubsRead::Unreadable(e) => Err(e),
    }
}

fn find_hub(d: &Deps, id: &str) -> Result<Hub, String> {
    load_hubs(d)?.into_iter().find(|h| h.id == id).ok_or_else(|| "No such hub.".to_string())
}

/// The app's own words for a failed run. The one piece of connector text is the cleaned, capped
/// first line of its stderr, shown as plain text.
fn problem_text(e: &RunError) -> String {
    match e {
        RunError::NotStarted(_) => "The connector could not be started.".into(),
        RunError::TimedOut => format!("The connector timed out after {} seconds.", READ_TIMEOUT.as_secs()),
        RunError::TooLarge => "The connector answered with more than 1 MiB.".into(),
        RunError::Exit { code, line } => {
            let mut s = match code {
                Some(c) => format!("The connector stopped with an error (code {c})."),
                None => "The connector was stopped before it answered.".to_string(),
            };
            let line = clean_text(line, ERROR_CHARS);
            if !line.is_empty() {
                s.push(' ');
                s.push_str(&line);
            }
            s
        }
    }
}

const BAD_ANSWER: &str = "The connector answered something that is not the contract.";
const NEEDS_ALLOWING: &str = "Needs allowing: save the hub again to allow its connector.";

/// Runs `f` on the counters in memory (read from the file the first time). Never held while a
/// connector runs.
fn with_tries<R>(d: &Deps, st: &HubsState, f: impl FnOnce(&mut HashMap<String, Tries>) -> R) -> R {
    let mut guard = lock(&st.tries);
    f(guard.get_or_insert_with(|| read_tries(&d.app_dir)))
}

/// Writes the counters through to the file; a failure is logged and the memory stays the authority.
fn keep_tries(d: &Deps, all: &HashMap<String, Tries>) {
    if let Err(e) = write_tries(&d.app_dir, all) {
        log::warn!("[hubs] could not keep the retry counters: {e}");
    }
}

fn view(d: &Deps, st: &HubsState, h: &Hub, tries: &HashMap<String, Tries>) -> HubView {
    let now = (d.now)();
    let held = lock(&st.cache).get(&h.id).cloned().unwrap_or_default();
    let ok = approved(&*d.store, h);
    let t = tries.get(&key(&h.id, "counts")).cloned().unwrap_or_default();
    let paused = t.fails >= MAX_AUTO_FAILS;
    let ahead = t.next_try_at - now;
    let busy = lock(&st.busy).iter().any(|(id, _)| *id == h.id);
    let problem = if ok { held.problem.clone() } else { Some(NEEDS_ALLOWING.into()) };
    let problem_kind = if ok { held.problem_kind } else { Some(ErrorKind::NotApproved) }.filter(|_| problem.is_some());
    HubView {
        id: h.id.clone(),
        name: h.name.clone(),
        colour: h.colour.clone(),
        folder: h.folder.clone(),
        program: h.program.clone(),
        args: h.args.clone(),
        approved: ok,
        waiting: held.waiting.map(|(n, _)| n),
        // A hub whose last run failed adds nothing: the last number stays for its line only.
        fresh: problem.is_none() && held.waiting.is_some_and(|(_, at)| (0..FRESH_MS).contains(&(now - at))),
        checked_at: held.waiting.map(|(_, at)| at),
        problem_kind: problem_kind.map(ErrorKind::label),
        problem,
        next_try_at: Some(t.next_try_at).filter(|_| !paused && ahead > 0 && ahead <= MAX_WAIT_MS),
        paused,
        busy,
        offers: OFFERED.iter().copied().filter(|r| !held.unsupported.contains(r)).collect(),
    }
}

fn views(d: &Deps, st: &HubsState, hubs: &[Hub]) -> Vec<HubView> {
    let tries = with_tries(d, st, |t| t.clone());
    hubs.iter().map(|h| view(d, st, h, &tries)).collect()
}

enum Start {
    Started,
    Busy,
    NotApproved,
    Wait(Wait),
}

/// Starts a background counts run for `hub` unless one is under way, the connector is not
/// allowed, or the retry rules say wait. Returns at once.
fn start_counts(d: &Deps, st: &HubsState, hub: &Hub, by_hand: bool) -> Start {
    if !approved(&*d.store, hub) {
        return Start::NotApproved;
    }
    let busy_key = (hub.id.clone(), "counts");
    {
        // The busy set is held over the check, so two callers cannot both pass the gap rule.
        let mut busy = lock(&st.busy);
        if busy.contains(&busy_key) {
            return Start::Busy;
        }
        let t = with_tries(d, st, |all| all.get(&key(&hub.id, "counts")).cloned().unwrap_or_default());
        if let Err(w) = may_run(&t, (d.now)(), by_hand) {
            return Start::Wait(w);
        }
        busy.insert(busy_key.clone());
    }
    let guard = BusyGuard { busy: st.busy.clone(), key: busy_key };
    let (d, st, hub) = (d.clone(), st.clone(), hub.clone());
    std::thread::spawn(move || {
        {
            let _guard = guard;
            let path_env = (d.path_env)();
            let result = d.connector.run(&hub, &Request::Counts, &path_env);
            finish_counts(&d, &st, &hub, result);
        }
        (d.notify)();
    });
    Start::Started
}

enum Outcome {
    Count(u32),
    Unsupported,
    Fail(ErrorKind, String),
}

fn finish_counts(d: &Deps, st: &HubsState, hub: &Hub, result: Result<Vec<u8>, RunError>) {
    let outcome = match result {
        Ok(bytes) => match parse_counts(&bytes) {
            Ok(Answer::Ok(c)) => Outcome::Count(c.waiting),
            Ok(Answer::Unsupported) => Outcome::Unsupported,
            Ok(Answer::Failed(m)) => Outcome::Fail(ErrorKind::Failed, format!("The hub reported an error: {}", clean_text(&m, ERROR_CHARS))),
            Err(_) => Outcome::Fail(ErrorKind::BadAnswer, BAD_ANSWER.into()),
        },
        Err(e) => Outcome::Fail(e.kind(), problem_text(&e)),
    };
    // A hub removed or changed while the run was under way keeps nothing of it.
    if !load_hubs(d).is_ok_and(|hubs| hubs.contains(hub)) {
        return;
    }
    let now = (d.now)();
    {
        let mut cache = lock(&st.cache);
        let held = cache.entry(hub.id.clone()).or_default();
        match &outcome {
            Outcome::Count(n) => {
                held.waiting = Some((*n, now));
                held.problem = None;
                held.problem_kind = None;
                held.unsupported.remove("counts");
            }
            Outcome::Unsupported => {
                held.waiting = None;
                held.problem = None;
                held.problem_kind = None;
                held.unsupported.insert("counts");
            }
            Outcome::Fail(kind, text) => {
                held.problem = Some(text.clone());
                held.problem_kind = Some(*kind);
            }
        }
    }
    with_tries(d, st, |all| {
        let tries = all.entry(key(&hub.id, "counts")).or_default();
        match outcome {
            Outcome::Count(_) | Outcome::Unsupported => retry::after_success(tries, now),
            Outcome::Fail(kind, _) => retry::after_failure(tries, kind, now),
        }
        keep_tries(d, all);
    });
}

/// Starts a counts run for each approved hub whose count is older than a minute.
fn refresh_counts(d: &Deps, st: &HubsState, hubs: &[Hub]) {
    let now = (d.now)();
    for h in hubs {
        let (stale, declined) = {
            let cache = lock(&st.cache);
            let held = cache.get(&h.id);
            (
                held.and_then(|h| h.waiting).map_or(true, |(_, at)| now - at > COUNTS_STALE_MS || now < at),
                held.is_some_and(|h| h.unsupported.contains("counts")),
            )
        };
        if stale && !declined {
            let _ = start_counts(d, st, h, false);
        }
    }
}

/// Forgets what is held and counted for a hub.
fn drop_data(d: &Deps, st: &HubsState, id: &str) {
    lock(&st.cache).remove(id);
    with_tries(d, st, |all| {
        let prefix = format!("{id}/");
        let before = all.len();
        all.retain(|k, _| !k.starts_with(&prefix));
        if all.len() != before {
            keep_tries(d, all);
        }
    });
}

pub fn list(d: &Deps, st: &HubsState) -> Result<Vec<HubView>, String> {
    gate_now(d)?;
    Ok(views(d, st, &load_hubs(d)?))
}

pub fn counts(d: &Deps, st: &HubsState) -> Result<Vec<HubView>, String> {
    gate_now(d)?;
    let hubs = load_hubs(d)?;
    refresh_counts(d, st, &hubs);
    Ok(views(d, st, &hubs))
}

pub fn refresh(d: &Deps, st: &HubsState, id: &str) -> Result<HubView, String> {
    gate_now(d)?;
    let hub = find_hub(d, id)?;
    // Trying again by hand asks a hub that declined `counts` once more.
    // The mark is kept when the try is refused (the gap, a run under way, not allowed).
    let had = lock(&st.cache).entry(hub.id.clone()).or_default().unsupported.remove("counts");
    let started = start_counts(d, st, &hub, true);
    if had && !matches!(started, Start::Started) {
        lock(&st.cache).entry(hub.id.clone()).or_default().unsupported.insert("counts");
    }
    match started {
        Start::Started | Start::Busy => {}
        Start::NotApproved => return Err(NEEDS_ALLOWING.into()),
        Start::Wait(Wait::Gap(ms)) => return Err(format!("Wait {} seconds before trying again.", ms / 1000 + 1)),
        Start::Wait(_) => return Err("The hub cannot be tried again yet.".into()),
    }
    let tries = with_tries(d, st, |t| t.clone());
    Ok(view(d, st, &hub, &tries))
}

/// The text of the dialog that asks whether to allow a connector: program, each argument and the
/// folder in full, as plain text.
pub fn confirm_text(h: &Hub, projects: usize) -> String {
    use crate::agents::routines::shown;
    let mut out = String::from("This connector will run a program on your Mac whenever the app asks the hub, without asking again.");
    out.push_str(&format!("\n\n\u{201C}{}\u{201D}\nProgram: {}\n", shown(&h.name), shown(&h.program)));
    if h.args.is_empty() {
        out.push_str("Arguments: none\n");
    } else {
        out.push_str("Arguments:\n");
        for a in &h.args {
            out.push_str(&format!("    {}\n", shown(a)));
        }
    }
    out.push_str(&format!("Working folder: {}\n", shown(&h.folder)));
    out.push_str(&match projects {
        0 => "Projects in this folder: none".to_string(),
        1 => "Projects in this folder: 1. It will be marked as a hub's and never merged alone.".to_string(),
        n => format!("Projects in this folder: {n}. They will be marked as a hub's and never merged alone."),
    });
    out.push_str("\n\nAllow only connectors you set up yourself.");
    out
}

/// A native dialog (out of the webview's reach), as `routines::confirm_commands` shows one.
/// Blocks until answered: call it on a blocking thread.
fn confirm_connector(app: &AppHandle, h: &Hub, projects: usize) -> bool {
    app.dialog()
        .message(confirm_text(h, projects))
        .title("Allow this connector?")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom("Allow".into(), "Cancel".into()))
        .blocking_show()
}

/// `confirm` is asked only when the connector's fingerprint is not approved yet.
pub fn save(d: &Deps, st: &HubsState, input: HubInput, confirm: &dyn Fn(&Hub, usize) -> bool) -> Result<HubView, String> {
    gate_now(d)?;
    // Held through the dialog, so two saves do not interleave.
    let _edit = lock(&EDIT_LOCK);
    let existing = load_hubs(d)?;
    let hub = validate(input, &existing)?;
    let old = existing.iter().find(|h| h.id == hub.id).cloned();
    // The fingerprint holds the folder, so a new folder is a new fingerprint: the dialog shows
    // whenever the folder changes (unless an identical connector in that folder is allowed).
    if !approved(&*d.store, &hub) {
        let projects = tie::count_hub_projects(&d.app_dir, &hub.folder)?;
        if !confirm(&hub, projects) {
            return Err(NOT_CONFIRMED.into());
        }
    }
    // A folder that changes frees nothing: the old folder's projects are marked too.
    if let Some(old) = old.as_ref().filter(|o| o.folder != hub.folder) {
        tie::mark_hub_projects(&d.app_dir, &old.folder)?;
    }
    tie::mark_hub_projects(&d.app_dir, &hub.folder)?;
    let mut hubs = existing;
    match hubs.iter_mut().find(|h| h.id == hub.id) {
        Some(slot) => *slot = hub.clone(),
        None => hubs.push(hub.clone()),
    }
    write_hubs(&d.app_dir, &hubs)?;
    // A failed `allow` or `forget` is reported after the held data is dropped, never instead.
    let mut failure: Option<String> = None;
    {
        let _a = lock(&APPROVAL_LOCK);
        if let Err(e) = allow(&*d.store, &hub) {
            failure = Some(format!("Saved, but the connector could not be allowed: {e}"));
        }
        if let Some(old) = old.as_ref().filter(|o| fingerprint(o) != fingerprint(&hub)) {
            // Another hub with the same connector keeps its approval.
            if !hubs.iter().any(|h| fingerprint(h) == fingerprint(old)) {
                if let Err(e) = forget(&*d.store, old) {
                    failure.get_or_insert(e);
                }
            }
        }
    }
    if old.as_ref().is_some_and(|o| fingerprint(o) != fingerprint(&hub)) {
        drop_data(d, st, &hub.id);
    }
    if let Some(e) = failure {
        return Err(e);
    }
    let tries = with_tries(d, st, |t| t.clone());
    Ok(view(d, st, &hub, &tries))
}

pub fn remove(d: &Deps, st: &HubsState, id: &str) -> Result<(), String> {
    gate_now(d)?;
    let _edit = lock(&EDIT_LOCK);
    let hubs = load_hubs(d)?;
    let hub = hubs.iter().find(|h| h.id == id).cloned().ok_or_else(|| "No such hub.".to_string())?;
    // Its projects are marked first: removing the hub never frees them to be merged alone.
    tie::mark_hub_projects(&d.app_dir, &hub.folder)?;
    let rest: Vec<Hub> = hubs.into_iter().filter(|h| h.id != id).collect();
    write_hubs(&d.app_dir, &rest)?;
    let forgotten = {
        let _a = lock(&APPROVAL_LOCK);
        if rest.iter().any(|h| fingerprint(h) == fingerprint(&hub)) {
            Ok(())
        } else {
            forget(&*d.store, &hub)
        }
    };
    drop_data(d, st, id);
    forgotten
}

/// Whether the hub listed `item` (an event or a question). This version asks for neither, so
/// nothing is listed; the task that adds events and questions reads their ids here.
fn listed(_held: &Held, _item: &str) -> bool {
    false
}

/// Asks the hub where to open it (or one of its items), checks the answer and opens it with
/// `opener`. Not retried: a failure is the error.
pub fn open_in_hub(
    d: &Deps,
    st: &HubsState,
    id: &str,
    item: Option<String>,
    opener: &dyn Fn(&open::Opener) -> Result<(), String>,
) -> Result<(), String> {
    gate_now(d)?;
    let hub = find_hub(d, id)?;
    if !approved(&*d.store, &hub) {
        return Err(NEEDS_ALLOWING.into());
    }
    if let Some(i) = &item {
        let known = lock(&st.cache).get(&hub.id).is_some_and(|h| listed(h, i));
        if !valid_id(i) || !known {
            return Err("That item is not listed by the hub.".into());
        }
    }
    let busy_key = (hub.id.clone(), "open");
    if !lock(&st.busy).insert(busy_key.clone()) {
        return Err("The hub is already being opened.".into());
    }
    let _guard = BusyGuard { busy: st.busy.clone(), key: busy_key };
    let path_env = (d.path_env)();
    let bytes = d.connector.run(&hub, &Request::Open { id: item }, &path_env).map_err(|e| problem_text(&e))?;
    match parse_open(&bytes) {
        Ok(Answer::Ok(target)) => opener(&open::check_target(&target, Path::new(&hub.folder))?),
        Ok(Answer::Unsupported) => Err("This hub does not offer to open its items.".into()),
        Ok(Answer::Failed(m)) => Err(format!("The hub reported an error: {}", clean_text(&m, ERROR_CHARS))),
        Err(_) => Err(BAD_ANSWER.into()),
    }
}

fn deps(app: &AppHandle, state: &crate::agents::AgentsState, demo: bool) -> Deps {
    let login = state.login_cache();
    let emitter = app.clone();
    Deps {
        app_dir: state.app_dir.clone(),
        demo,
        store: Arc::new(Keychain),
        connector: Arc::new(RealConnector),
        path_env: Arc::new(move || crate::agents::pty::cached_login_env(&login).path.clone()),
        notify: Arc::new(move || {
            let _ = emitter.emit(HUBS_CHANGED_EVENT, ());
        }),
        now: Arc::new(crate::agents::routines::run::now_ms),
    }
}

#[tauri::command]
pub async fn hubs_list(
    app: AppHandle,
    state: tauri::State<'_, crate::agents::AgentsState>,
    hubs: tauri::State<'_, HubsState>,
) -> Result<Vec<HubView>, String> {
    let d = deps(&app, &state, crate::host::is_demo(&app));
    let st = hubs.inner().clone();
    crate::agents::pty::blocking(move || list(&d, &st)).await
}

#[tauri::command]
pub async fn hubs_save(
    app: AppHandle,
    state: tauri::State<'_, crate::agents::AgentsState>,
    hubs: tauri::State<'_, HubsState>,
    hub: HubInput,
) -> Result<HubView, String> {
    let d = deps(&app, &state, crate::host::is_demo(&app));
    let st = hubs.inner().clone();
    crate::agents::pty::blocking(move || save(&d, &st, hub, &|h, n| confirm_connector(&app, h, n))).await
}

#[tauri::command]
pub async fn hubs_remove(
    app: AppHandle,
    state: tauri::State<'_, crate::agents::AgentsState>,
    hubs: tauri::State<'_, HubsState>,
    id: String,
) -> Result<(), String> {
    let d = deps(&app, &state, crate::host::is_demo(&app));
    let st = hubs.inner().clone();
    crate::agents::pty::blocking(move || remove(&d, &st, &id)).await
}

#[tauri::command]
pub async fn hubs_counts(
    app: AppHandle,
    state: tauri::State<'_, crate::agents::AgentsState>,
    hubs: tauri::State<'_, HubsState>,
) -> Result<Vec<HubView>, String> {
    let d = deps(&app, &state, crate::host::is_demo(&app));
    let st = hubs.inner().clone();
    crate::agents::pty::blocking(move || counts(&d, &st)).await
}

#[tauri::command]
pub async fn hubs_refresh(
    app: AppHandle,
    state: tauri::State<'_, crate::agents::AgentsState>,
    hubs: tauri::State<'_, HubsState>,
    id: String,
) -> Result<HubView, String> {
    let d = deps(&app, &state, crate::host::is_demo(&app));
    let st = hubs.inner().clone();
    crate::agents::pty::blocking(move || refresh(&d, &st, &id)).await
}

#[tauri::command]
pub async fn hubs_open(
    app: AppHandle,
    state: tauri::State<'_, crate::agents::AgentsState>,
    hubs: tauri::State<'_, HubsState>,
    id: String,
    item: Option<String>,
) -> Result<(), String> {
    let d = deps(&app, &state, crate::host::is_demo(&app));
    let st = hubs.inner().clone();
    crate::agents::pty::blocking(move || open_in_hub(&d, &st, &id, item, &open::open)).await
}

/// Refreshes every hub's count every 5 minutes. Nothing runs in the demo build, while Agents is
/// off or in a mode (the same gate as the commands). A plain thread: it never keeps the app from
/// quitting.
pub fn start(app: &AppHandle) {
    if crate::host::is_demo(app) {
        return;
    }
    let app = app.clone();
    let spawned = std::thread::Builder::new().name("hubs-counts".into()).spawn(move || {
        std::thread::sleep(Duration::from_secs(30));
        loop {
            tick(&app);
            std::thread::sleep(Duration::from_millis(COUNTS_EVERY_MS as u64));
        }
    });
    if let Err(e) = spawned {
        log::warn!("[hubs] the counts refresh did not start: {e}");
    }
}

fn tick(app: &AppHandle) {
    let (Some(agents), Some(hubs)) = (app.try_state::<crate::agents::AgentsState>(), app.try_state::<HubsState>()) else { return };
    let d = deps(app, &agents, crate::host::is_demo(app));
    if gate_now(&d).is_err() {
        return;
    }
    if let Ok(list) = load_hubs(&d) {
        refresh_counts(&d, &hubs, &list);
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    fn rust_files(dir: &Path, out: &mut Vec<std::path::PathBuf>) {
        for entry in std::fs::read_dir(dir).unwrap().flatten() {
            let p = entry.path();
            if p.is_dir() {
                rust_files(&p, out);
            } else if p.extension().is_some_and(|e| e == "rs") {
                out.push(p);
            }
        }
    }

    /// A hub's connector is a program that only answers: nothing here starts a model session or
    /// an agent. The needles are built in pieces so this file does not contain them.
    #[test]
    fn hubs_start_no_session() {
        let needles = [
            ["start_with", "("].concat(),
            ["actions::", "start"].concat(),
            ["real_", "cli"].concat(),
            ["\"cl", "aude\""].concat(),
        ];
        let mut files = Vec::new();
        rust_files(&Path::new(env!("CARGO_MANIFEST_DIR")).join("src/agents/hubs"), &mut files);
        assert!(files.len() >= 3);
        for f in files {
            let text = std::fs::read_to_string(&f).unwrap();
            for n in &needles {
                assert!(!text.contains(n.as_str()), "{} contains {n}", f.display());
            }
        }
    }
}

#[cfg(test)]
mod command_tests {
    use super::*;
    use crate::connectors::keychain::MemoryStore;
    use std::sync::atomic::{AtomicI64, AtomicUsize, Ordering};
    use std::sync::Condvar;
    use std::time::Instant;

    const T0: i64 = 1_000_000_000_000;
    const MIN: i64 = 60_000;

    /// A connector that answers from a queue (or the last answer), counts its calls, and can be
    /// held until released.
    struct Fake {
        calls: AtomicUsize,
        answer: Mutex<Result<Vec<u8>, RunError>>,
        held: Mutex<bool>,
        released: Condvar,
    }

    impl Fake {
        fn new(first: Result<Vec<u8>, RunError>) -> Arc<Self> {
            Arc::new(Fake { calls: AtomicUsize::new(0), answer: Mutex::new(first), held: Mutex::new(false), released: Condvar::new() })
        }
        fn set(&self, a: Result<Vec<u8>, RunError>) {
            *self.answer.lock().unwrap() = a;
        }
        fn hold(&self) {
            *self.held.lock().unwrap() = true;
        }
        fn release(&self) {
            *self.held.lock().unwrap() = false;
            self.released.notify_all();
        }
        fn calls(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
    }

    impl Connector for Fake {
        fn run(&self, _hub: &Hub, _req: &Request, _path_env: &str) -> Result<Vec<u8>, RunError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let mut held = self.held.lock().unwrap();
            while *held {
                held = self.released.wait(held).unwrap();
            }
            drop(held);
            self.answer.lock().unwrap().clone()
        }
    }

    fn count(n: u32) -> Result<Vec<u8>, RunError> {
        Ok(format!("{{\"version\":1,\"waiting\":{n}}}").into_bytes())
    }

    struct Env {
        d: Deps,
        st: HubsState,
        fake: Arc<Fake>,
        now: Arc<AtomicI64>,
        store: Arc<MemoryStore>,
        dir: PathBuf,
        changes: Arc<AtomicUsize>,
    }

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sm-hubcmd-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    fn env(name: &str, demo: bool, first: Result<Vec<u8>, RunError>) -> Env {
        let dir = tmp(name);
        std::fs::write(dir.join("agents.json"), "{\"enabled\":true}").unwrap();
        let fake = Fake::new(first);
        let now = Arc::new(AtomicI64::new(T0));
        let store = Arc::new(MemoryStore(Default::default()));
        let changes = Arc::new(AtomicUsize::new(0));
        let (n, c) = (now.clone(), changes.clone());
        let d = Deps {
            app_dir: dir.clone(),
            demo,
            store: store.clone(),
            connector: fake.clone(),
            path_env: Arc::new(|| "/usr/bin:/bin".into()),
            notify: Arc::new(move || {
                c.fetch_add(1, Ordering::SeqCst);
            }),
            now: Arc::new(move || n.load(Ordering::SeqCst)),
        };
        Env { d, st: HubsState::default(), fake, now, store, dir, changes }
    }

    fn hub_in(e: &Env, name: &str) -> Hub {
        let folder = e.dir.join(format!("hub-{name}"));
        std::fs::create_dir_all(&folder).unwrap();
        Hub {
            id: "h0000000a".into(),
            name: "Demo hub".into(),
            colour: "purple".into(),
            folder: folder.to_string_lossy().into_owned(),
            program: "/bin/sh".into(),
            args: vec!["connector.sh".into()],
        }
    }

    /// Saves a hub straight into the file, approved or not.
    fn add_hub(e: &Env, name: &str, allowed: bool) -> Hub {
        let h = hub_in(e, name);
        write_hubs(&e.dir, std::slice::from_ref(&h)).unwrap();
        if allowed {
            allow(&*e.d.store, &h).unwrap();
        }
        h
    }

    fn wait_idle(e: &Env) {
        let start = Instant::now();
        while !lock(&e.st.busy).is_empty() {
            assert!(start.elapsed() < Duration::from_secs(5), "a run never ended");
            std::thread::sleep(Duration::from_millis(5));
        }
        // The event follows the end of the run.
        let start = Instant::now();
        while e.changes.load(Ordering::SeqCst) == 0 {
            assert!(start.elapsed() < Duration::from_secs(5), "no change event");
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn gate_order_demo_agents_mode() {
        assert_eq!(gate(true, false, true), Some(Off::Demo));
        assert_eq!(gate(false, false, true), Some(Off::AgentsOff));
        assert_eq!(gate(false, true, true), Some(Off::Mode));
        assert_eq!(gate(false, true, false), None);
    }

    #[test]
    fn demo_reads_no_file_and_runs_nothing() {
        let e = env("demo", true, count(1));
        add_hub(&e, "demo", true);
        // Unreadable, so any attempt to open it would fail the test through the error text.
        std::fs::remove_file(e.dir.join("hubs.json")).unwrap();
        std::fs::create_dir(e.dir.join("hubs.json")).unwrap();
        assert_eq!(list(&e.d, &e.st).unwrap_err(), Off::Demo.message());
        assert_eq!(counts(&e.d, &e.st).unwrap_err(), Off::Demo.message());
        assert_eq!(refresh(&e.d, &e.st, "h0000000a").unwrap_err(), Off::Demo.message());
        assert_eq!(remove(&e.d, &e.st, "h0000000a").unwrap_err(), Off::Demo.message());
        assert_eq!(open_in_hub(&e.d, &e.st, "h0000000a", None, &|_| Ok(())).unwrap_err(), Off::Demo.message());
        let input = HubInput { id: None, name: "x".into(), colour: "blue".into(), folder: "/tmp".into(), program: "/bin/sh".into(), args: vec![] };
        assert_eq!(save(&e.d, &e.st, input, &|_, _| true).unwrap_err(), Off::Demo.message());
        assert_eq!(e.fake.calls(), 0);
    }

    #[test]
    fn agents_off_refuses_every_command() {
        let e = env("off", false, count(1));
        add_hub(&e, "off", true);
        std::fs::write(e.dir.join("agents.json"), "{\"enabled\":false}").unwrap();
        assert_eq!(counts(&e.d, &e.st).unwrap_err(), Off::AgentsOff.message());
        assert_eq!(e.fake.calls(), 0);
    }

    fn one_org(dir: &Path) -> PathBuf {
        let reg = crate::orgs::Registry {
            version: 1,
            active_id: "a1".into(),
            organisations: vec![crate::orgs::Organisation { id: "a1".into(), name: "Studio A".into(), created_at: "2026-01-01".into(), prefs: None }],
        };
        reg.save(dir).unwrap();
        let org = crate::orgs::org_dir(dir, "a1");
        std::fs::create_dir_all(&org).unwrap();
        org.join(crate::orgs::DB_FILE)
    }

    #[test]
    fn mode_stops_every_run() {
        let e = env("mode", false, count(1));
        add_hub(&e, "mode", true);
        let db = one_org(&e.dir);
        std::fs::write(db.with_file_name("studiomanager_test.db"), "").unwrap();
        assert_eq!(counts(&e.d, &e.st).unwrap_err(), Off::Mode.message());
        assert_eq!(refresh(&e.d, &e.st, "h0000000a").unwrap_err(), Off::Mode.message());
        assert_eq!(e.fake.calls(), 0);
        // Without the mode file the same call runs.
        std::fs::remove_file(db.with_file_name("studiomanager_test.db")).unwrap();
        counts(&e.d, &e.st).unwrap();
        wait_idle(&e);
        assert_eq!(e.fake.calls(), 1);
    }

    #[test]
    fn unreadable_registry_counts_as_a_mode() {
        let e = env("registry", false, count(1));
        add_hub(&e, "registry", true);
        std::fs::write(e.dir.join(crate::orgs::REGISTRY_FILE), "garbled").unwrap();
        assert_eq!(counts(&e.d, &e.st).unwrap_err(), Off::Mode.message());
        assert_eq!(e.fake.calls(), 0);
    }

    #[test]
    fn unapproved_hub_never_runs() {
        let e = env("unapproved", false, count(1));
        add_hub(&e, "unapproved", false);
        let views = counts(&e.d, &e.st).unwrap();
        assert!(!views[0].approved);
        assert!(views[0].problem.as_deref().unwrap().contains("allow"), "{:?}", views[0].problem);
        assert!(refresh(&e.d, &e.st, "h0000000a").unwrap_err().contains("allow"));
        assert!(open_in_hub(&e.d, &e.st, "h0000000a", None, &|_| Ok(())).unwrap_err().contains("allow"));
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(e.fake.calls(), 0);
    }

    #[test]
    fn counts_return_at_once_while_a_run_is_slow() {
        let e = env("slow", false, count(4));
        add_hub(&e, "slow", true);
        e.fake.hold();
        // The fake stays blocked until released: a call that waited for the run would never
        // answer, so the answer itself is the proof (no time bound that a loaded machine breaks).
        let answered = |e: &Env| {
            let (d, st) = (e.d.clone(), e.st.clone());
            let (tx, rx) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let _ = tx.send(counts(&d, &st));
            });
            let r = rx.recv_timeout(Duration::from_secs(5));
            if r.is_err() {
                e.fake.release();
            }
            r.expect("counts waited for the slow run").unwrap()
        };
        let views = answered(&e);
        assert!(views[0].busy);
        assert_eq!(views[0].waiting, None);
        // A second call during the run answers too.
        assert!(answered(&e)[0].busy);
        assert_eq!(e.fake.calls(), 1);
        e.fake.release();
        wait_idle(&e);
        let v = list(&e.d, &e.st).unwrap().remove(0);
        assert_eq!((v.waiting, v.busy, v.fresh, v.problem), (Some(4), false, true, None));
    }

    #[test]
    fn one_run_at_a_time() {
        let e = env("one", false, count(2));
        add_hub(&e, "one", true);
        e.fake.hold();
        counts(&e.d, &e.st).unwrap();
        counts(&e.d, &e.st).unwrap();
        refresh(&e.d, &e.st, "h0000000a").unwrap();
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(e.fake.calls(), 1);
        e.fake.release();
        wait_idle(&e);
        assert_eq!(e.fake.calls(), 1);
    }

    #[test]
    fn failure_keeps_the_last_count_but_not_fresh() {
        let e = env("failure", false, count(7));
        add_hub(&e, "failure", true);
        counts(&e.d, &e.st).unwrap();
        wait_idle(&e);
        assert!(list(&e.d, &e.st).unwrap()[0].fresh);
        e.fake.set(Err(RunError::TimedOut));
        e.fake.release();
        // Two minutes later: the count is stale (over a minute) but under 15 minutes old, and the
        // run fails. The number stays for the line; it is not fresh any more at once.
        e.now.fetch_add(2 * MIN, Ordering::SeqCst);
        e.changes.store(0, Ordering::SeqCst);
        counts(&e.d, &e.st).unwrap();
        wait_idle(&e);
        let v = list(&e.d, &e.st).unwrap().remove(0);
        assert_eq!(v.waiting, Some(7));
        assert!(!v.fresh);
        assert_eq!(v.problem_kind, Some("timedOut"));
        assert!(v.problem.as_deref().unwrap().contains("timed out after 10 seconds"), "{:?}", v.problem);
        assert!(v.next_try_at.is_some());
        let state = std::fs::read_to_string(e.dir.join("hubs-state.json")).unwrap();
        assert!(!state.contains("timed out"), "the file holds a kind, not text: {state}");
    }

    #[test]
    fn connector_text_is_cleaned_and_capped() {
        let line = format!("\u{7}Boom {}", "x".repeat(500));
        let e = env("stderr", false, Err(RunError::Exit { code: Some(1), line }));
        add_hub(&e, "stderr", true);
        counts(&e.d, &e.st).unwrap();
        wait_idle(&e);
        let p = list(&e.d, &e.st).unwrap().remove(0).problem.unwrap();
        assert!(p.contains("code 1") && p.contains("Boom") && !p.contains('\u{7}'), "{p}");
        assert!(p.chars().count() < 260, "{}", p.chars().count());
    }

    #[test]
    fn garbage_is_a_bad_answer_not_text() {
        let e = env("garbage", false, Ok(b"Traceback: secret".to_vec()));
        add_hub(&e, "garbage", true);
        counts(&e.d, &e.st).unwrap();
        wait_idle(&e);
        let p = list(&e.d, &e.st).unwrap().remove(0).problem.unwrap();
        assert_eq!(p, BAD_ANSWER);
    }

    #[test]
    fn unsupported_hides_the_feature() {
        let e = env("unsupported", false, Ok(b"{\"version\":1,\"error\":\"unsupported\"}".to_vec()));
        add_hub(&e, "unsupported", true);
        assert_eq!(counts(&e.d, &e.st).unwrap()[0].offers, vec!["counts", "open"]);
        wait_idle(&e);
        let v = list(&e.d, &e.st).unwrap().remove(0);
        assert_eq!(v.offers, vec!["open"]);
        assert_eq!((v.waiting, v.problem), (None, None));
        // Later refreshes by the timer do not ask again.
        e.now.fetch_add(10 * MIN, Ordering::SeqCst);
        counts(&e.d, &e.st).unwrap();
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(e.fake.calls(), 1);
    }

    #[test]
    fn the_retry_rules_hold_over_the_commands() {
        let e = env("retry", false, Err(RunError::TooLarge));
        add_hub(&e, "retry", true);
        counts(&e.d, &e.st).unwrap();
        wait_idle(&e);
        // The next automatic try waits a minute; by hand waits only the 30 second gap.
        e.now.fetch_add(31_000, Ordering::SeqCst);
        counts(&e.d, &e.st).unwrap();
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(e.fake.calls(), 1);
        assert!(refresh(&e.d, &e.st, "h0000000a").is_ok());
        wait_idle(&e);
        assert_eq!(e.fake.calls(), 2);
        assert!(refresh(&e.d, &e.st, "h0000000a").unwrap_err().contains("Wait"));
    }

    #[test]
    fn open_item_not_listed_is_refused() {
        let e = env("item", false, Ok(b"{\"version\":1,\"url\":\"https://example.com\"}".to_vec()));
        add_hub(&e, "item", true);
        for item in ["q1", "../x", "-r", ""] {
            let err = open_in_hub(&e.d, &e.st, "h0000000a", Some(item.into()), &|_| panic!("opened")).unwrap_err();
            assert!(err.contains("not listed"), "{err}");
        }
        assert_eq!(e.fake.calls(), 0);
    }

    #[test]
    fn open_checks_the_answer_before_opening() {
        let e = env("open", false, Ok(b"{\"version\":1,\"url\":\"https://example.com/x\"}".to_vec()));
        add_hub(&e, "open", true);
        let seen = Mutex::new(vec![]);
        open_in_hub(&e.d, &e.st, "h0000000a", None, &|o| {
            seen.lock().unwrap().push(o.clone());
            Ok(())
        })
        .unwrap();
        assert_eq!(*seen.lock().unwrap(), vec![open::Opener::Url("https://example.com/x".into())]);
        e.fake.set(Ok(b"{\"version\":1,\"url\":\"file:///etc/passwd\"}".to_vec()));
        let err = open_in_hub(&e.d, &e.st, "h0000000a", None, &|_| panic!("opened")).unwrap_err();
        assert!(err.contains("not opened"), "{err}");
        // A refusal is not recorded as a failure of the hub.
        assert!(read_tries(&e.dir).is_empty());
    }

    fn input(e: &Env, name: &str) -> HubInput {
        let folder = e.dir.join(format!("hub-{name}"));
        std::fs::create_dir_all(&folder).unwrap();
        HubInput {
            id: None,
            name: "Demo hub".into(),
            colour: "purple".into(),
            folder: folder.to_string_lossy().into_owned(),
            program: "/bin/sh".into(),
            args: vec!["connector.sh".into()],
        }
    }

    #[test]
    fn save_cancelled_writes_nothing() {
        let e = env("cancel", false, count(1));
        let err = save(&e.d, &e.st, input(&e, "cancel"), &|_, _| false).unwrap_err();
        assert_eq!(err, NOT_CONFIRMED);
        assert!(!e.dir.join("hubs.json").exists());
        assert!(e.store.0.lock().unwrap().is_empty());
    }

    #[test]
    fn save_allows_once_and_remove_forgets() {
        let e = env("save", false, count(1));
        let asked = AtomicUsize::new(0);
        let v = save(&e.d, &e.st, input(&e, "save"), &|h, n| {
            asked.fetch_add(1, Ordering::SeqCst);
            let text = confirm_text(h, n);
            assert!(text.contains("/bin/sh") && text.contains("connector.sh") && text.contains(&h.folder), "{text}");
            assert!(text.contains("Projects in this folder: none"), "{text}");
            true
        })
        .unwrap();
        assert!(v.approved);
        // Edit prefills from the view.
        assert_eq!((v.program.as_str(), v.args.clone()), ("/bin/sh", vec!["connector.sh".to_string()]));
        assert_eq!(asked.load(Ordering::SeqCst), 1);
        assert_eq!(list(&e.d, &e.st).unwrap().len(), 1);
        // Saving it again, unchanged, does not ask.
        let again = HubInput { id: Some(v.id.clone()), ..input(&e, "save") };
        save(&e.d, &e.st, again, &|_, _| panic!("asked again")).unwrap();
        // Changing an argument asks again and forgets the old fingerprint.
        let old = read_hubs_now(&e).remove(0);
        let changed = HubInput { id: Some(v.id.clone()), args: vec!["other.sh".into()], ..input(&e, "save") };
        save(&e.d, &e.st, changed, &|_, _| true).unwrap();
        assert!(!approved(&*e.d.store, &old));
        let now_hub = read_hubs_now(&e).remove(0);
        assert!(approved(&*e.d.store, &now_hub));
        remove(&e.d, &e.st, &v.id).unwrap();
        assert!(list(&e.d, &e.st).unwrap().is_empty());
        assert!(!approved(&*e.d.store, &now_hub));
        assert!(remove(&e.d, &e.st, &v.id).is_err());
    }

    fn read_hubs_now(e: &Env) -> Vec<Hub> {
        load_hubs(&e.d).unwrap()
    }

    #[test]
    fn removing_a_hub_drops_what_is_held() {
        let e = env("drop", false, count(3));
        let h = add_hub(&e, "drop", true);
        counts(&e.d, &e.st).unwrap();
        wait_idle(&e);
        assert!(lock(&e.st.cache).contains_key(&h.id));
        remove(&e.d, &e.st, &h.id).unwrap();
        assert!(!lock(&e.st.cache).contains_key(&h.id));
        assert!(read_tries(&e.dir).is_empty());
    }

    #[test]
    fn two_runs_ending_together_lose_no_counter() {
        let e = env("tries", false, count(1));
        let a = add_hub(&e, "tries-a", true);
        let b = Hub { id: "h0000000b".into(), name: "Other hub".into(), ..hub_in(&e, "tries-b") };
        write_hubs(&e.dir, &[a.clone(), b.clone()]).unwrap();
        allow(&*e.d.store, &b).unwrap();
        e.fake.hold();
        counts(&e.d, &e.st).unwrap();
        e.fake.release();
        let start = Instant::now();
        while !lock(&e.st.busy).is_empty() {
            assert!(start.elapsed() < Duration::from_secs(5));
            std::thread::sleep(Duration::from_millis(5));
        }
        let tries = read_tries(&e.dir);
        assert!(tries.contains_key(&key(&a.id, "counts")) && tries.contains_key(&key(&b.id, "counts")), "{tries:?}");
    }

    /// An organisation whose `projects` table holds the given `(folder, merge_alone)` rows.
    fn org_with_projects(e: &Env, rows: &[(&str, i64)]) -> PathBuf {
        let db = one_org(&e.dir);
        let c = rusqlite::Connection::open(&db).unwrap();
        c.execute_batch("CREATE TABLE projects (id INTEGER PRIMARY KEY, folder_path TEXT, merge_alone INTEGER NOT NULL DEFAULT 0, hub_project INTEGER NOT NULL DEFAULT 0);").unwrap();
        for (f, alone) in rows {
            c.execute("INSERT INTO projects (folder_path, merge_alone) VALUES (?1, ?2)", rusqlite::params![f, alone]).unwrap();
        }
        db
    }

    fn project_flags(db: &Path) -> Vec<(i64, i64)> {
        let c = rusqlite::Connection::open(db).unwrap();
        let mut s = c.prepare("SELECT hub_project, merge_alone FROM projects ORDER BY id").unwrap();
        let rows = s.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(|r| r.unwrap()).collect();
        rows
    }

    #[test]
    fn the_dialog_says_how_many_projects_will_be_marked() {
        let e = env("dialogcount", false, count(1));
        let inp = input(&e, "dialogcount");
        let db = org_with_projects(&e, &[(&format!("{}/p1", inp.folder), 1), ("/elsewhere", 1)]);
        let seen = Mutex::new(String::new());
        save(&e.d, &e.st, inp, &|h, n| {
            *seen.lock().unwrap() = confirm_text(h, n);
            true
        })
        .unwrap();
        let text = seen.lock().unwrap().clone();
        assert!(text.contains("Projects in this folder: 1."), "{text}");
        assert_eq!(project_flags(&db), vec![(1, 0), (0, 1)]);
    }

    #[test]
    fn changing_the_folder_marks_the_old_folders_projects_and_asks_again() {
        let e = env("oldfolder", false, count(1));
        let db = org_with_projects(&e, &[]);
        let a = input(&e, "old-a");
        let first = save(&e.d, &e.st, a.clone(), &|_, _| true).unwrap();
        // A project made in the old folder after the first save, free to merge alone.
        let c = rusqlite::Connection::open(&db).unwrap();
        c.execute("INSERT INTO projects (folder_path, merge_alone) VALUES (?1, 1)", [format!("{}/late", a.folder)]).unwrap();
        drop(c);
        assert_eq!(project_flags(&db), vec![(0, 1)]);
        let b = input(&e, "old-b");
        let asked = AtomicUsize::new(0);
        let edit = HubInput { id: Some(first.id.clone()), ..b.clone() };
        save(&e.d, &e.st, edit, &|_, _| {
            asked.fetch_add(1, Ordering::SeqCst);
            true
        })
        .unwrap();
        // A new folder is a new fingerprint: the dialog showed.
        assert_eq!(asked.load(Ordering::SeqCst), 1);
        // The old folder is no longer listed, so only the mark protects the project: hub_project
        // is read by the merge's facts, and merging alone is off.
        assert_eq!(project_flags(&db), vec![(1, 0)]);
        assert_eq!(tie::in_any_hub(&e.dir, Some(&format!("{}/late", a.folder)), false), Ok(false));
    }

    #[test]
    fn a_failing_state_file_does_not_loosen_the_backoff() {
        let e = env("nostate", false, Err(RunError::TooLarge));
        add_hub(&e, "nostate", true);
        // The state file cannot be written (or read): it is a folder.
        std::fs::create_dir(e.dir.join(retry::STATE_FILE)).unwrap();
        counts(&e.d, &e.st).unwrap();
        wait_idle(&e);
        assert_eq!(e.fake.calls(), 1);
        // 31 seconds on: past the gap, inside the one-minute backoff.
        e.now.fetch_add(31_000, Ordering::SeqCst);
        counts(&e.d, &e.st).unwrap();
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(e.fake.calls(), 1);
        assert!(e.dir.join(retry::STATE_FILE).is_dir());
        assert!(list(&e.d, &e.st).unwrap()[0].next_try_at.is_some());
    }

    /// A store whose writes can be made to fail.
    struct Flaky {
        inner: MemoryStore,
        fail: std::sync::atomic::AtomicBool,
    }

    impl SecretStore for Flaky {
        fn get(&self, account: &str) -> Result<Option<String>, String> {
            self.inner.get(account)
        }
        fn set(&self, account: &str, secret: &str) -> Result<(), String> {
            if self.fail.load(Ordering::SeqCst) {
                return Err("the Keychain refused".into());
            }
            self.inner.set(account, secret)
        }
        fn delete(&self, account: &str) -> Result<(), String> {
            self.inner.delete(account)
        }
    }

    fn flaky_env(name: &str) -> (Env, Arc<Flaky>, Hub) {
        let mut e = env(name, false, count(3));
        let store = Arc::new(Flaky { inner: MemoryStore(Default::default()), fail: Default::default() });
        e.d.store = store.clone();
        let v = save(&e.d, &e.st, input(&e, name), &|_, _| true).unwrap();
        counts(&e.d, &e.st).unwrap();
        wait_idle(&e);
        assert!(lock(&e.st.cache).contains_key(&v.id));
        assert!(!read_tries(&e.dir).is_empty());
        let hub = read_hubs_now(&e).remove(0);
        (e, store, hub)
    }

    #[test]
    fn a_failed_allow_or_forget_still_drops_what_is_held() {
        // Save with a changed connector while the Keychain refuses writes.
        let (e, store, hub) = flaky_env("flaky-save");
        store.fail.store(true, Ordering::SeqCst);
        let changed = HubInput { id: Some(hub.id.clone()), args: vec!["other.sh".into()], ..input(&e, "flaky-save") };
        assert!(save(&e.d, &e.st, changed, &|_, _| true).is_err());
        assert!(!lock(&e.st.cache).contains_key(&hub.id));
        assert!(read_tries(&e.dir).is_empty());
        // Remove while the Keychain refuses writes.
        let (e, store, hub) = flaky_env("flaky-remove");
        store.fail.store(true, Ordering::SeqCst);
        assert!(remove(&e.d, &e.st, &hub.id).is_err());
        assert!(!lock(&e.st.cache).contains_key(&hub.id));
        assert!(read_tries(&e.dir).is_empty());
    }

    #[test]
    fn a_refused_hand_try_keeps_the_unsupported_mark() {
        let e = env("keepmark", false, Ok(b"{\"version\":1,\"error\":\"unsupported\"}".to_vec()));
        add_hub(&e, "keepmark", true);
        counts(&e.d, &e.st).unwrap();
        wait_idle(&e);
        assert_eq!(list(&e.d, &e.st).unwrap()[0].offers, vec!["open"]);
        // Right after the run, the gap refuses the try: the hub still declines `counts`.
        assert!(refresh(&e.d, &e.st, "h0000000a").unwrap_err().contains("Wait"));
        assert_eq!(list(&e.d, &e.st).unwrap()[0].offers, vec!["open"]);
        // Past the gap a hand try asks again.
        e.now.fetch_add(31_000, Ordering::SeqCst);
        refresh(&e.d, &e.st, "h0000000a").unwrap();
        wait_idle(&e);
        assert_eq!(e.fake.calls(), 2);
    }

    #[test]
    fn the_page_constants_match_rust() {
        let ts = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../src/lib/hubs.ts")).unwrap();
        let value = |name: &str| -> String {
            let line = ts.lines().find(|l| l.contains(&format!("export const {name} "))).unwrap_or_else(|| panic!("{name} missing"));
            line[line.find('=').unwrap() + 1..].trim().trim_end_matches(';').trim().trim_matches('"').to_string()
        };
        assert_eq!(value("HUB_NOT_CONFIRMED"), NOT_CONFIRMED);
        assert_eq!(value("HUB_MAX_FAILS"), MAX_AUTO_FAILS.to_string());
    }
}
