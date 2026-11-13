//! The brief session: the folder it runs in, the flags it starts with, and the scheduler that
//! starts it every 15 minutes at most. Design:
//! docs/superpowers/specs/2026-11-12-agent-orchestrator-design.md, plan Tasks 9 and 10.
//!
//! In a folder Claude Code has not trusted, `claude --bg` ignores the folder's settings and
//! stops at the server-approval prompt, so the server and the tool permissions come as flags;
//! the folder's `.claude/settings.json` only repeats the deny list as a second layer.

use super::actions;
use super::cli::{read_settings, AgentsSettings, Cli};
use super::model::{Agent, Group};
use super::usage::limits;
use super::watcher::budget::{self, Budget};
use crate::agent_access::{read_access, write_atomic, AccessSettings};
use crate::orgs::{org_dir, Organisation, Registry, DB_FILE};
use chrono::{DateTime, Local};
use rusqlite::params_from_iter;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// The folder inside the app data folder, used by brief sessions only.
pub const FOLDER: &str = "briefing";
/// The MCP config passed with `--mcp-config` (never `.mcp.json`: no approval prompt).
pub const MCP_FILE: &str = "mcp.json";

/// The prefix Claude Code gives the server's tools.
const TOOL_PREFIX: &str = "mcp__studiomanager__";

/// The tools a brief session may call: exactly these seven. `file_capture` writes the brief, so
/// `set_brief` is not among them. The server itself lists and allows only these
/// (`STUDIOMANAGER_TOOLS` in `mcp.json`); `--allowedTools` only pre-approves them.
pub const ALLOWED_TOOLS: [&str; 7] = [
    "mcp__studiomanager__list_captures",
    "mcp__studiomanager__file_capture",
    "mcp__studiomanager__list_projects",
    "mcp__studiomanager__get_project",
    "mcp__studiomanager__list_tasks",
    "mcp__studiomanager__list_wiki",
    "mcp__studiomanager__get_wiki_article",
];
/// Everything else a session could reach. (Not `--tools ""`: it removes the tool-search tool
/// too, and the session then cannot reach the MCP tools at all.)
pub const DENIED_TOOLS: [&str; 13] = [
    "Bash",
    "Edit",
    "Write",
    "NotebookEdit",
    "WebFetch",
    "WebSearch",
    "Read",
    "Glob",
    "Grep",
    "Agent",
    "Task",
    "Skill",
    "mcp__claude-in-chrome",
];

/// `ALLOWED_TOOLS` as the server's own names, comma-separated (`STUDIOMANAGER_TOOLS`).
fn server_tool_list() -> String {
    ALLOWED_TOOLS.iter().map(|t| t.trim_start_matches(TOOL_PREFIX)).collect::<Vec<_>>().join(",")
}

fn to_json(v: &serde_json::Value) -> String {
    format!("{}\n", serde_json::to_string_pretty(v).unwrap_or_default())
}

/// Writes `file` unless it already holds `content`.
fn write_if_changed(file: &Path, content: &str) -> Result<(), String> {
    if std::fs::read_to_string(file).is_ok_and(|c| c == content) {
        return Ok(());
    }
    write_atomic(file, content)
}

/// (Re)writes the folder's files and returns its canonical path: `mcp.json` with the
/// StudioManager server, and `.claude/settings.json` with the deny list. A stale `.mcp.json`
/// is removed. Safe to run any number of times.
pub fn prepare_folder(app_dir: &Path, mcp_path: &str) -> Result<PathBuf, String> {
    let folder = app_dir.join(FOLDER);
    let claude = folder.join(".claude");
    std::fs::create_dir_all(&claude)
        .map_err(|e| format!("Failed to create {}: {e}", claude.display()))?;
    let mcp = json!({ "mcpServers": { "studiomanager": {
        "command": mcp_path,
        // The data folder is named, never left to the server to work out: outside an
        // app bundle (a dev build) it would fall back to the installed app's folder.
        "env": {
            "STUDIOMANAGER_TOOLS": server_tool_list(),
            "STUDIOMANAGER_DATA_DIR": app_dir.to_string_lossy()
        }
    } } });
    write_if_changed(&folder.join(MCP_FILE), &to_json(&mcp))?;
    let settings = json!({ "permissions": { "deny": DENIED_TOOLS } });
    write_if_changed(&claude.join("settings.json"), &to_json(&settings))?;
    let stale = folder.join(".mcp.json");
    if stale.exists() {
        std::fs::remove_file(&stale).map_err(|e| format!("Failed to remove {}: {e}", stale.display()))?;
    }
    folder.canonicalize().map_err(|e| format!("Failed to resolve {}: {e}", folder.display()))
}

/// The extra `claude --bg` arguments for a brief session in `folder` (`actions::start_with`).
pub fn briefing_args(folder: &Path) -> Vec<String> {
    let mut a = vec![
        "--mcp-config".to_string(),
        folder.join(MCP_FILE).to_string_lossy().into_owned(),
        "--strict-mcp-config".to_string(),
        "--allowedTools".to_string(),
    ];
    a.extend(ALLOWED_TOOLS.iter().map(|t| t.to_string()));
    a.push("--disallowedTools".to_string());
    a.extend(DENIED_TOOLS.iter().map(|t| t.to_string()));
    a
}

/// The folder, made ready, for the card's trust question. Behind the Agents switch.
#[tauri::command]
pub async fn agents_briefing_folder(
    state: tauri::State<'_, super::AgentsState>,
) -> Result<String, String> {
    super::actions::switched_on(&state)?;
    let app_dir = state.app_dir.clone();
    super::pty::blocking(move || {
        prepare_folder(&app_dir, &crate::agent_access::mcp_path()).map(|p| p.to_string_lossy().into_owned())
    })
    .await
}

// ---------------------------------------------------------------- the scheduler

pub const SLOT_MS: i64 = 15 * 60_000;
pub const MAX_TRIES: i64 = 3;
pub const RUN_LIMIT_MS: i64 = 20 * 60_000;
pub const WAITING_LIMIT_MS: i64 = 2 * 60_000;
/// A session just started may not be in the poller's list yet: not "finished" before this.
pub const LISTED_GRACE_MS: i64 = 60_000;
/// At most this many captures go into one session.
const BATCH: i64 = 20;
pub const STATE_FILE: &str = "briefing.json";
/// Files an organisation in test or presentation mode has beside its database (the MCP
/// server's `guard::MODE_FILES`).
pub(crate) const MODE_FILES: [&str; 2] = ["studiomanager_test.db", "studiomanager_presentation.db"];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct BriefRun {
    pub org_id: String,
    pub short_id: String,
    pub capture_ids: Vec<i64>,
    pub started_at: i64,
    pub waiting_since: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct PendingStart {
    pub org_id: String,
    pub name: String,
    pub capture_ids: Vec<i64>,
    pub started_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct LastRun {
    pub finished_at: i64,
    pub ok: bool,
    pub message: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(default)]
pub struct BriefState {
    pub last_start_at: Option<i64>,
    pub current: Option<BriefRun>,
    /// A start that timed out: the session may exist; looked for in the poller's list by name.
    pub pending: Option<PendingStart>,
    pub last: Option<LastRun>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Paused {
    Demo,
    Off,
    AgentsOff,
    AccessOff,
    /// Why the budget rule pauses (never `Budget::Ok`).
    Budget(Budget),
    /// The epoch ms the next slot opens.
    TooSoon(i64),
    Running,
    Nothing,
}

impl Paused {
    fn key(&self) -> &'static str {
        match self {
            Paused::Demo => "demo",
            Paused::Off => "off",
            Paused::AgentsOff => "agents_off",
            Paused::AccessOff => "access_off",
            Paused::Budget(_) => "budget",
            Paused::TooSoon(_) => "too_soon",
            Paused::Running => "running",
            Paused::Nothing => "nothing",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Verdict {
    Wait,
    Finished,
    Stuck,
    TimedOut,
}

pub fn read_state(dir: &Path) -> BriefState {
    std::fs::read_to_string(dir.join(STATE_FILE))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_state(dir: &Path, s: &BriefState) -> Result<(), String> {
    let json = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    write_atomic(&dir.join(STATE_FILE), &format!("{json}\n"))
}

/// Captures a session may take: new, not left in the inbox, tried fewer than `MAX_TRIES`
/// times; oldest first, at most 20. (id, created_at).
pub fn eligible(db: &Path) -> Result<Vec<(i64, String)>, String> {
    let conn = super::capture::open(db)?;
    let mut stmt = conn
        .prepare(&format!(
            "SELECT id, created_at FROM captures
             WHERE status = 'new' AND inbox_reason IS NULL AND brief_tries < {MAX_TRIES}
             ORDER BY created_at, id LIMIT {BATCH}"
        ))
        .map_err(|e| format!("Failed to read captures: {e}"))?;
    let rows = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(|e| format!("Failed to read captures: {e}"))?;
    rows.collect::<Result<_, _>>().map_err(|e| format!("Failed to read captures: {e}"))
}

/// One more try for each of `ids` still waiting (new, not left in the inbox); how many.
pub fn count_try(db: &Path, ids: &[i64]) -> Result<usize, String> {
    if ids.is_empty() {
        return Ok(0);
    }
    let conn = super::capture::open(db)?;
    let marks = vec!["?"; ids.len()].join(", ");
    conn.execute(
        &format!(
            "UPDATE captures SET brief_tries = brief_tries + 1, updated_at = datetime('now')
             WHERE status = 'new' AND inbox_reason IS NULL AND id IN ({marks})"
        ),
        params_from_iter(ids.iter()),
    )
    .map_err(|e| format!("Failed to count the try: {e}"))
}

/// How many of `ids` are still waiting (new, not left in the inbox).
pub fn waiting_count(db: &Path, ids: &[i64]) -> Result<usize, String> {
    if ids.is_empty() {
        return Ok(0);
    }
    let conn = super::capture::open(db)?;
    let marks = vec!["?"; ids.len()].join(", ");
    conn.query_row(
        &format!("SELECT COUNT(*) FROM captures WHERE status = 'new' AND inbox_reason IS NULL AND id IN ({marks})"),
        params_from_iter(ids.iter()),
        |r| r.get::<_, i64>(0),
    )
    .map(|n| n as usize)
    .map_err(|e| format!("Failed to read captures: {e}"))
}

pub(crate) fn in_mode(db: &Path) -> bool {
    MODE_FILES.iter().any(|f| db.with_file_name(f).exists())
}

/// Every organisation with work (not in a mode, a readable migrated database, something to
/// send), in registry order: the organisation and its eligible captures.
fn with_work(app_dir: &Path) -> Vec<(Organisation, Vec<(i64, String)>)> {
    let Ok(Some(reg)) = Registry::load(app_dir) else { return vec![] };
    reg.organisations
        .into_iter()
        .filter_map(|org| {
            let db = org_dir(app_dir, &org.id).join(DB_FILE);
            if !db.exists() || in_mode(&db) {
                return None;
            }
            let found = eligible(&db).ok()?;
            (!found.is_empty()).then_some((org, found))
        })
        .collect()
}

/// The organisation a session works in: among those agent access allows, the one whose oldest
/// waiting capture is oldest; with the ids to send.
pub fn pick_org(app_dir: &Path, access: &AccessSettings) -> Option<(Organisation, Vec<i64>)> {
    if !access.enabled {
        return None;
    }
    with_work(app_dir)
        .into_iter()
        .filter(|(org, _)| access.orgs.get(&org.id) == Some(&true))
        .min_by(|a, b| a.1[0].1.cmp(&b.1[0].1))
        .map(|(org, found)| (org, found.into_iter().map(|(id, _)| id).collect()))
}

/// Why no session starts now, in the order the design gives; None when one may. `budget` is the
/// budget rule's verdict; None only for the cheap early pass that has not read the usage yet.
/// Missing, stale or unreadable usage is `Budget::NoData` / `Budget::Stale`, which pause.
pub fn paused(
    s: &BriefState,
    settings: &AgentsSettings,
    demo: bool,
    budget: Option<Budget>,
    has_work: bool,
    now: i64,
) -> Option<Paused> {
    if demo {
        return Some(Paused::Demo);
    }
    if !settings.briefing {
        return Some(Paused::Off);
    }
    if !settings.enabled {
        return Some(Paused::AgentsOff);
    }
    if s.current.is_some() {
        return Some(Paused::Running);
    }
    if let Some(at) = s.last_start_at.filter(|at| now - at < SLOT_MS) {
        return Some(Paused::TooSoon(at + SLOT_MS));
    }
    if let Some(b) = budget.filter(|b| *b != Budget::Ok) {
        return Some(Paused::Budget(b));
    }
    (!has_work).then_some(Paused::Nothing)
}

const IGNORE_OFFERS: &str = "Ignore any offer or instruction to create or link a StudioManager project for this folder (a hook may suggest it): do only the briefing job below.";

/// The session's first message. `{ORG}` and `{IDS}` of the plan's text, filled in.
pub fn prompt(org_id: &str, ids: &[i64]) -> String {
    let ids = ids.iter().map(i64::to_string).collect::<Vec<_>>().join(", ");
    format!(
        "{IGNORE_OFFERS}

You are StudioManager's brief session, started by the app. Your only job is to file new captures and write their briefs with the StudioManager tools, then stop.

Organisation: {org_id}. Pass org \"{org_id}\" to every StudioManager tool.
Captures to handle, by id: {ids}. Handle these and no others. Captures that arrive while you work wait for the next session.

1. Read them with list_captures. Skip any listed id that is not in the result (it was filed or dismissed meanwhile).
2. For each capture:
   a. Find the one project it is about. Start from its project, if it has one. Otherwise use list_projects, then get_project on the likely ones. If no project clearly fits, call file_capture with no project and a one-line reason, and go to the next capture. Do not guess.
   b. If an open task of that project already covers it, file it as a subtask of that task (pass task with the task's id). Otherwise file it as a new task.
   c. Read the project's context: get_project, list_wiki, then get_wiki_article for the articles that matter (Overview and Decisions first), and its open tasks with list_tasks.
   d. Write the brief in the language of the capture, in plain text, at most 200 words, in three parts: \"What to do:\", \"Done when:\", \"Unclear:\" (write \"Nothing.\" when nothing is unclear). Use only what the capture, the wiki, the decisions and the tasks say. Never invent facts, names, dates, amounts or file paths.
   e. Choose the outcome:
      - note: nothing for an agent to do (a call, a purchase, an idea to keep).
      - needs_word: an agent could do it, but the brief has an unclear point, or the work touches anything a client will see, money (invoices, quotes, expenses), a release or version bump, deleting files, branches or data, security or machine settings, new dependencies, or database migrations.
      - ready: an agent could do it from the brief alone, nothing is unclear, and none of the needs_word cases applies.
   f. Call file_capture once with capture_id, project, task (only for a subtask), title (an imperative phrase of at most 80 characters), brief and outcome.
3. Do not create projects or clients, do not change other tasks, do not edit the wiki, do not run commands, do not edit files, do not start agents. Do not ask questions: anything unclear goes in the brief's \"Unclear:\" part.
4. If the StudioManager tools are missing or refuse (agent access off, organisation not allowed, test or presentation mode, database not opened), stop at once and say why in one line.
5. When every listed capture is filed or left in the inbox, reply with one line per capture: its id and what you did. Then stop."
    )
}

/// `brief-YYYYMMDD-HHMM`.
pub fn session_name(now: DateTime<Local>) -> String {
    now.format("brief-%Y%m%d-%H%M").to_string()
}

/// Whether the poller's list is one to trust about a session started at `since`: a successful
/// list made after `since` and after this scheduler started (a list from before says nothing).
pub fn list_is_fresh(listed_at: Option<i64>, since: i64, scheduler_started: i64) -> bool {
    listed_at.is_some_and(|t| t > since && t > scheduler_started)
}

/// What to do with the running session, from the poller's list. Not listed means it ended (or
/// was removed) only once the poller has really looked after the start (and after this
/// scheduler started); until then it waits, and the run limit still stops it.
pub fn verdict(
    agent: Option<&Agent>,
    run: &BriefRun,
    now: i64,
    listed_at: Option<i64>,
    scheduler_started: i64,
) -> Verdict {
    let Some(agent) = agent else {
        if list_is_fresh(listed_at, run.started_at + LISTED_GRACE_MS, scheduler_started) {
            return Verdict::Finished;
        }
        return if now - run.started_at >= RUN_LIMIT_MS { Verdict::TimedOut } else { Verdict::Wait };
    };
    if now - run.started_at >= RUN_LIMIT_MS {
        return Verdict::TimedOut;
    }
    match agent.group {
        Group::Working => Verdict::Wait,
        Group::Idle | Group::Done => Verdict::Finished,
        Group::NeedsYou => match run.waiting_since {
            Some(since) if now - since >= WAITING_LIMIT_MS => Verdict::Stuck,
            _ => Verdict::Wait,
        },
    }
}

/// What the scheduler decided: why nothing starts, or the work to send.
struct Evaluation {
    paused: Option<Paused>,
    work: Option<(Organisation, Vec<i64>)>,
}

/// Nothing is read before the cheap reasons (demo, switches, running, slot) have been ruled out.
fn evaluate(app_dir: &Path, limits_dir: &Path, s: &BriefState, settings: &AgentsSettings, demo: bool, now: i64) -> Evaluation {
    let early = paused(s, settings, demo, None, true, now);
    if early.is_some() {
        return Evaluation { paused: early, work: None };
    }
    // Read only: in the dev build `limits_dir` is the installed app's folder.
    let rule = budget::budget(limits::load_dated(limits_dir, now), now);
    if let Some(p) = paused(s, settings, demo, Some(rule), true, now) {
        return Evaluation { paused: Some(p), work: None };
    }
    match pick_org(app_dir, &read_access(app_dir)) {
        Some(work) => Evaluation { paused: None, work: Some(work) },
        None => {
            let blocked = !with_work(app_dir).is_empty();
            Evaluation { paused: Some(if blocked { Paused::AccessOff } else { Paused::Nothing }), work: None }
        }
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BriefingStatus {
    /// `demo`, `off`, `agents_off`, `access_off`, `budget`, `too_soon`, `running` or `nothing`;
    /// None when a session may start at the next check.
    pub paused: Option<String>,
    /// With `budget`: the percent the reason is about (the week's, or the 5-hour window's).
    pub percent: Option<f64>,
    /// With `budget`: `ahead_of_week`, `five_hour`, `no_data` or `stale`.
    pub reason: Option<String>,
    /// With `budget` and `ahead_of_week`: where the week's pace line stands, in percent.
    pub line: Option<f64>,
    /// With `budget` and `stale`: how old the last usage reading is, in whole minutes.
    pub minutes_old: Option<i64>,
    /// When the next slot opens, with `too_soon`.
    pub next_at: Option<i64>,
    pub running: bool,
    pub last: Option<LastRun>,
}

fn status_of(
    app_dir: &Path,
    limits_dir: &Path,
    s: &BriefState,
    settings: &AgentsSettings,
    demo: bool,
    now: i64,
) -> BriefingStatus {
    let p = evaluate(app_dir, limits_dir, s, settings, demo, now).paused;
    let why = match &p {
        Some(Paused::Budget(b)) => Some(b),
        _ => None,
    };
    BriefingStatus {
        paused: p.as_ref().map(|p| p.key().to_string()),
        percent: match why {
            Some(Budget::AheadOfWeek { percent, .. }) | Some(Budget::FiveHour(percent)) => Some(*percent),
            _ => None,
        },
        // `Paused::Budget` never holds `Budget::Ok` (`paused` only pauses on the other four).
        reason: why.and_then(|b| match b {
            Budget::AheadOfWeek { .. } => Some("ahead_of_week"),
            Budget::FiveHour(_) => Some("five_hour"),
            Budget::NoData => Some("no_data"),
            Budget::Stale { .. } => Some("stale"),
            Budget::Ok => None,
        })
        .map(String::from),
        line: match why {
            Some(Budget::AheadOfWeek { line, .. }) => Some(*line),
            _ => None,
        },
        minutes_old: match why {
            Some(Budget::Stale { saved_at }) => Some(((now - saved_at) / 60_000).max(0)),
            _ => None,
        },
        next_at: match p {
            Some(Paused::TooSoon(at)) => Some(at),
            _ => None,
        },
        running: s.current.is_some(),
        last: s.last.clone(),
    }
}

/// What one tick works with. `cli` is looked up only when a `claude` call is needed.
pub struct Deps<'a> {
    pub app_dir: &'a Path,
    /// Where `limits.json` is read from (read only): `budget::limits_dir`.
    pub limits_dir: &'a Path,
    pub home: &'a Path,
    pub trusted: &'a [String],
    pub mcp_path: &'a str,
    pub demo: bool,
    pub now: i64,
    /// The poller's last list, and when it last succeeded.
    pub agents: &'a [Agent],
    pub listed_at: Option<i64>,
    /// When this scheduler thread started.
    pub scheduler_started: i64,
    pub cli: &'a dyn Fn() -> Result<Box<dyn Cli>, String>,
    /// Captures changed: the app refreshes.
    pub on_change: &'a dyn Fn(),
}

fn plural(n: usize) -> String {
    if n == 1 { "1 capture was not filed".into() } else { format!("{n} captures were not filed") }
}

/// A start that did not happen (nothing was started, so no try is counted): the failure shows in
/// Settings and the Inbox, and the next slot tries again.
fn fail(d: &Deps, s: &mut BriefState, message: String) {
    s.last = Some(LastRun { finished_at: d.now, ok: false, message: Some(message) });
}

/// The running session has ended or went wrong: stop it and record the result. The tries were
/// counted when it started.
fn settle(d: &Deps, s: &mut BriefState, run: BriefRun, verdict: Verdict) {
    let cli = (d.cli)().ok();
    if let Some(cli) = &cli {
        // "Not running" is fine: it may have ended by itself.
        let _ = actions::stop(cli.as_ref(), d.home, &run.short_id);
    }
    let db = org_dir(d.app_dir, &run.org_id).join(DB_FILE);
    let left = waiting_count(&db, &run.capture_ids);
    let (ok, message, remove) = match (verdict, left) {
        (_, Err(e)) => (false, Some(e), false),
        (Verdict::Finished, Ok(0)) => (true, None, true),
        (Verdict::Finished, Ok(n)) => (false, Some(plural(n)), false),
        (Verdict::Stuck, Ok(_)) => (false, Some("The session was waiting for an answer".into()), false),
        (_, Ok(_)) => (false, Some("The session ran longer than 20 minutes".into()), false),
    };
    if remove {
        if let Some(cli) = &cli {
            // Keeps the list short; a failure leaves a stopped agent behind, nothing worse.
            let _ = actions::delete(cli.as_ref(), d.home, &run.short_id);
        }
    }
    s.last = Some(LastRun { finished_at: d.now, ok, message });
    s.current = None;
    (d.on_change)();
}

/// A session is running for `ids`: one more try for each, so every path is bounded by `MAX_TRIES`.
fn started(d: &Deps, s: &mut BriefState, org_id: String, short_id: String, ids: Vec<i64>, started_at: i64) {
    let db = org_dir(d.app_dir, &org_id).join(DB_FILE);
    if let Err(e) = count_try(&db, &ids) {
        log::warn!("[briefing] could not count the try: {e}");
    }
    s.current = Some(BriefRun { org_id, short_id, capture_ids: ids, started_at, waiting_since: None });
}

fn begin(d: &Deps, s: &mut BriefState, org: Organisation, ids: Vec<i64>) {
    let folder = match prepare_folder(d.app_dir, d.mcp_path) {
        Ok(f) => f,
        Err(e) => {
            s.last_start_at = Some(d.now);
            return fail(d, s, e);
        }
    };
    let name = DateTime::from_timestamp_millis(d.now)
        .map(|t| session_name(t.with_timezone(&Local)))
        .unwrap_or_else(|| "brief".into());
    let result = (d.cli)().and_then(|cli| {
        actions::start_with(
            cli.as_ref(),
            d.trusted,
            &folder.to_string_lossy(),
            &prompt(&org.id, &ids),
            "opus",
            &name,
            &briefing_args(&folder),
        )
    });
    s.last_start_at = Some(d.now);
    match result {
        Ok(short_id) => started(d, s, org.id, short_id, ids, d.now),
        Err(e) if e == actions::START_TIMED_OUT => {
            // The session may exist: no try yet; the next ticks look for it by name.
            s.pending = Some(PendingStart { org_id: org.id, name, capture_ids: ids, started_at: d.now });
            fail(d, s, e);
        }
        Err(e) => fail(d, s, e),
    }
}

/// A start that timed out: adopt the session when the poller lists it; give up once a fresh
/// list lacks it (or after the run limit).
fn resolve_pending(d: &Deps, s: &mut BriefState, p: PendingStart) {
    let found = d.agents.iter().find(|a| a.name == p.name).and_then(|a| a.short_id.clone());
    if let Some(short_id) = found {
        s.pending = None;
        started(d, s, p.org_id, short_id, p.capture_ids, p.started_at);
    } else if list_is_fresh(d.listed_at, p.started_at + LISTED_GRACE_MS, d.scheduler_started)
        || d.now - p.started_at >= RUN_LIMIT_MS
    {
        s.pending = None;
    }
}

/// One scheduler check. Returns whether the state changed (the caller saves it). In the demo
/// build it returns before anything is read. `may_start`: false while the state could not be
/// saved (a session started then would be forgotten after a restart).
pub fn tick(d: &Deps, s: &mut BriefState, may_start: bool) -> bool {
    if d.demo {
        return false;
    }
    let before = s.clone();
    let settings = read_settings(d.app_dir);
    if !settings.enabled {
        // Agents went off: stop the session (best effort), count no try.
        s.pending = None;
        if let Some(run) = s.current.take() {
            if let Ok(cli) = (d.cli)() {
                let _ = actions::stop(cli.as_ref(), d.home, &run.short_id);
            }
            (d.on_change)();
        }
    } else if let Some(run) = s.current.clone() {
        let agent = d.agents.iter().find(|a| a.short_id.as_deref() == Some(run.short_id.as_str()));
        match verdict(agent, &run, d.now, d.listed_at, d.scheduler_started) {
            Verdict::Wait => {
                let waiting = agent.is_some_and(|a| a.group == Group::NeedsYou);
                if let Some(cur) = s.current.as_mut() {
                    cur.waiting_since = match (waiting, cur.waiting_since) {
                        (true, None) => Some(d.now),
                        (true, since) => since,
                        (false, _) => None,
                    };
                }
            }
            v => settle(d, s, run, v),
        }
    } else if let Some(p) = s.pending.clone() {
        resolve_pending(d, s, p);
    } else if may_start {
        if let Some((org, ids)) = evaluate(d.app_dir, d.limits_dir, s, &settings, false, d.now).work {
            begin(d, s, org, ids);
        }
    }
    *s != before
}

/// The scheduler's state, kept in memory: `briefing.json` is read once and saved after each
/// change. While a save fails, no new session starts.
pub struct Scheduler {
    pub state: BriefState,
    unsaved: bool,
}

impl Scheduler {
    pub fn new(state: BriefState) -> Self {
        Scheduler { state, unsaved: false }
    }

    pub fn step(&mut self, d: &Deps, save: &dyn Fn(&BriefState) -> Result<(), String>) {
        if self.unsaved {
            match save(&self.state) {
                Ok(()) => self.unsaved = false,
                Err(e) => log::warn!("[briefing] could not save {STATE_FILE}: {e}"),
            }
        }
        if tick(d, &mut self.state, !self.unsaved) {
            if let Err(e) = save(&self.state) {
                log::warn!("[briefing] could not save {STATE_FILE}: {e}");
                self.unsaved = true;
            }
        }
    }
}

fn check(app: &AppHandle, sched: &mut Option<Scheduler>, scheduler_started: i64) {
    // First, before any file is read.
    if crate::host::is_demo(app) {
        return;
    }
    let state = app.state::<super::AgentsState>();
    let app_dir = state.app_dir.clone();
    let home = actions::home_dir();
    let limits_dir = budget::limits_dir(&app_dir, crate::host::running_dev(), &home);
    let trusted = super::projects::read_trusted(&home);
    let agents = state.cached();
    let get_cli = || -> Result<Box<dyn Cli>, String> {
        state.real_cli().map(|c| Box::new(c) as Box<dyn Cli>).ok_or_else(|| "claude not found".to_string())
    };
    let on_change = || {
        if let Err(e) = app.emit(crate::agent_access::CHANGED_EVENT, ["file_capture"]) {
            log::warn!("[briefing] emit {}: {e}", crate::agent_access::CHANGED_EVENT);
        }
    };
    let sched = sched.get_or_insert_with(|| Scheduler::new(read_state(&app_dir)));
    sched.step(
        &Deps {
            app_dir: &app_dir,
            limits_dir: &limits_dir,
            home: &home,
            trusted: &trusted,
            mcp_path: &crate::agent_access::mcp_path(),
            demo: false,
            now: limits::now_ms(),
            agents: &agents,
            listed_at: state.listed_at(),
            scheduler_started,
            cli: &get_cli,
            on_change: &on_change,
        },
        &|st| write_state(&app_dir, st),
    );
}

/// The scheduler thread: a check every 30 s and right after a wake, as the routines'. The first
/// one waits 30 s so the poller has listed the agents (a session left from before quitting is
/// judged by that list).
pub fn start(app: &AppHandle) {
    use super::routines::schedule::{next_since_check, wall_ms, CHECK_EVERY, SLICE};
    let app = app.clone();
    std::thread::spawn(move || {
        let scheduler_started = limits::now_ms();
        let mut sched: Option<Scheduler> = None;
        let mut last_wall = wall_ms();
        let mut since_check = Duration::ZERO;
        loop {
            if since_check >= CHECK_EVERY {
                if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| check(&app, &mut sched, scheduler_started)))
                    .is_err()
                {
                    log::error!("[briefing] check panicked; continuing");
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

/// Why the brief session waits, and when it runs next, for Settings and the Inbox.
#[tauri::command]
pub async fn briefing_status(
    app: AppHandle,
    state: tauri::State<'_, super::AgentsState>,
) -> Result<BriefingStatus, String> {
    actions::switched_on(&state)?;
    let app_dir = state.app_dir.clone();
    let limits_dir = budget::limits_dir(&app_dir, crate::host::running_dev(), &actions::home_dir());
    super::pty::blocking(move || {
        let demo = crate::host::is_demo(&app);
        Ok(status_of(&app_dir, &limits_dir, &read_state(&app_dir), &read_settings(&app_dir), demo, limits::now_ms()))
    })
    .await
}


#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::PathBuf;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("sm-briefing-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn read(p: &std::path::Path) -> serde_json::Value {
        serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
    }

    #[test]
    fn prepare_folder_writes_the_mcp_file_and_the_deny_list_only() {
        let app = tmp("folder");
        let folder = prepare_folder(&app, "/opt/app/studiomanager-mcp").unwrap();
        assert_eq!(folder, app.join("briefing").canonicalize().unwrap());
        assert_eq!(
            read(&folder.join("mcp.json")),
            json!({ "mcpServers": { "studiomanager": {
                "command": "/opt/app/studiomanager-mcp",
                "env": {
                    "STUDIOMANAGER_TOOLS": "list_captures,file_capture,list_projects,get_project,list_tasks,list_wiki,get_wiki_article",
                    "STUDIOMANAGER_DATA_DIR": app.to_string_lossy()
                }
            } } })
        );
        assert_eq!(
            read(&folder.join(".claude/settings.json")),
            json!({ "permissions": { "deny": ["Bash", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch", "Read", "Glob", "Grep", "Agent", "Task", "Skill", "mcp__claude-in-chrome"] } })
        );
        // No project-level server file: no approval prompt can appear.
        assert!(!folder.join(".mcp.json").exists());
    }

    #[test]
    fn prepare_folder_twice_changes_nothing_and_removes_a_stale_mcp_json() {
        let app = tmp("twice");
        let folder = prepare_folder(&app, "/opt/app/studiomanager-mcp").unwrap();
        std::fs::write(folder.join(".mcp.json"), "{}").unwrap();
        let before = (
            std::fs::read_to_string(folder.join("mcp.json")).unwrap(),
            std::fs::read_to_string(folder.join(".claude/settings.json")).unwrap(),
        );
        let again = prepare_folder(&app, "/opt/app/studiomanager-mcp").unwrap();
        assert_eq!(again, folder);
        let after = (
            std::fs::read_to_string(again.join("mcp.json")).unwrap(),
            std::fs::read_to_string(again.join(".claude/settings.json")).unwrap(),
        );
        assert_eq!(before, after);
        assert!(!folder.join(".mcp.json").exists());
        // A moved app: the path is rewritten.
        prepare_folder(&app, "/elsewhere/studiomanager-mcp").unwrap();
        assert_eq!(
            read(&folder.join("mcp.json"))["mcpServers"]["studiomanager"]["command"],
            "/elsewhere/studiomanager-mcp"
        );
    }

    fn read_env_tools() -> String {
        let app = tmp("envtools");
        let folder = prepare_folder(&app, "/x").unwrap();
        read(&folder.join("mcp.json"))["mcpServers"]["studiomanager"]["env"]["STUDIOMANAGER_TOOLS"]
            .as_str()
            .unwrap()
            .to_string()
    }

    #[test]
    fn briefing_args_carry_the_server_and_exactly_the_seven_tools() {
        let a = briefing_args(std::path::Path::new("/data/briefing"));
        assert_eq!(&a[..3], ["--mcp-config", "/data/briefing/mcp.json", "--strict-mcp-config"]);
        let allowed_at = a.iter().position(|x| x == "--allowedTools").unwrap();
        let denied_at = a.iter().position(|x| x == "--disallowedTools").unwrap();
        assert!(allowed_at < denied_at);
        assert_eq!(
            a[allowed_at + 1..denied_at],
            [
                "mcp__studiomanager__list_captures",
                "mcp__studiomanager__file_capture",
                "mcp__studiomanager__list_projects",
                "mcp__studiomanager__get_project",
                "mcp__studiomanager__list_tasks",
                "mcp__studiomanager__list_wiki",
                "mcp__studiomanager__get_wiki_article",
            ]
        );
        assert_eq!(a[denied_at + 1..], ["Bash", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch", "Read", "Glob", "Grep", "Agent", "Task", "Skill", "mcp__claude-in-chrome"]);
        // The server's own list and the pre-approved list are the same tools.
        let env = read_env_tools();
        let allowed: Vec<String> = a[allowed_at + 1..denied_at].iter().map(|t| t.replace("mcp__studiomanager__", "")).collect();
        assert_eq!(env, allowed.join(","));
        // Never a lone `--`: `start_with` would refuse it.
        assert!(!a.iter().any(|x| x == "--"));
    }

    // ------------------------------------------------------------ Task 10

    use crate::agents::cli::{write_settings, AgentsSettings, Cli, CliOutput};
    use crate::agents::model::{parse_agents, Agent};
    use crate::orgs::{Organisation, Registry};
    use rusqlite::Connection;
    use std::cell::RefCell;
    use std::path::Path;
    use std::sync::{Arc, Mutex};

    const MIN: i64 = 60_000;
    const T0: i64 = 1_800_000_000_000;

    fn count_of(db: &Path, sql: &str) -> i64 {
        Connection::open(db).unwrap().query_row(sql, [], |r| r.get(0)).unwrap()
    }

    /// An app folder with the given organisations (migrated databases), agent access on for
    /// those in `allowed`, and the Agents and brief switches on.
    fn app(name: &str, orgs: &[&str], allowed: &[&str]) -> PathBuf {
        let dir = tmp(name);
        let reg = Registry {
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
        };
        reg.save(&dir).unwrap();
        for id in orgs {
            let odir = crate::orgs::org_dir(&dir, id);
            std::fs::create_dir_all(&odir).unwrap();
            let conn = Connection::open(odir.join(crate::orgs::DB_FILE)).unwrap();
            for m in crate::migrate::MIGRATIONS {
                conn.execute_batch(m.sql).unwrap();
            }
        }
        let access = crate::agent_access::AccessSettings {
            enabled: true,
            orgs: allowed.iter().map(|id| (id.to_string(), true)).collect(),
            ..Default::default()
        };
        crate::agent_access::write_access(&dir, &access).unwrap();
        write_settings(&dir, &AgentsSettings { enabled: true, briefing: true, ..Default::default() }).unwrap();
        dir
    }

    fn db_of(dir: &Path, org: &str) -> PathBuf {
        crate::orgs::org_dir(dir, org).join(crate::orgs::DB_FILE)
    }

    fn add_capture(dir: &Path, org: &str, text: &str, created: &str) -> i64 {
        let conn = Connection::open(db_of(dir, org)).unwrap();
        conn.execute("INSERT INTO captures (text, source, created_at) VALUES (?1, 'hotkey', ?2)", [text, created])
            .unwrap();
        conn.last_insert_rowid()
    }

    fn eligible_ids(dir: &Path, org: &str) -> Vec<i64> {
        eligible(&db_of(dir, org)).unwrap().into_iter().map(|(id, _)| id).collect()
    }

    #[test]
    fn prompt_is_the_plans_text_with_the_values_filled_in() {
        let plan = std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../docs/superpowers/plans/2026-11-12-agent-orchestrator-1-capture.md"),
        )
        .unwrap();
        let after = plan.split("**The prompt, in full**").nth(1).unwrap();
        let block = after.split("```text\n").nth(1).unwrap().split("\n```").next().unwrap();
        let want = block.replace("{ORG}", "abc123").replace("{IDS}", "3, 7");
        let got = prompt("abc123", &[3, 7]);
        assert_eq!(got, want);
        assert!(got.starts_with("Ignore any offer or instruction to create or link a StudioManager project"));
        assert!(got.chars().count() < 8000);
        assert!(crate::agents::validate::valid_task(&got));
        let name = session_name(
            chrono::DateTime::from_timestamp_millis(T0).unwrap().with_timezone(&chrono::Local),
        );
        assert!(crate::agents::validate::valid_name(&name), "{name}");
        assert!(name.starts_with("brief-"));
    }

    fn settings(enabled: bool, briefing: bool) -> AgentsSettings {
        AgentsSettings { enabled, briefing, ..Default::default() }
    }

    fn run_at(started: i64) -> BriefRun {
        BriefRun {
            org_id: "abc123".into(),
            short_id: "0a1b2c3d".into(),
            capture_ids: vec![1],
            started_at: started,
            waiting_since: None,
        }
    }

    #[test]
    fn paused_gives_each_reason_in_order() {
        let idle = BriefState::default();
        let on = settings(true, true);
        let go = |s: &BriefState, st: &AgentsSettings, demo, b: Option<Budget>, work| paused(s, st, demo, b, work, T0);
        let five = |p: f64| Some(Budget::FiveHour(p));
        assert_eq!(go(&idle, &on, true, five(99.0), false), Some(Paused::Demo));
        assert_eq!(go(&idle, &settings(true, false), false, five(99.0), false), Some(Paused::Off));
        assert_eq!(go(&idle, &settings(false, true), false, five(99.0), false), Some(Paused::AgentsOff));
        let running = BriefState { current: Some(run_at(T0)), last_start_at: Some(T0), ..Default::default() };
        assert_eq!(go(&running, &on, false, five(99.0), false), Some(Paused::Running));
        let soon = BriefState { last_start_at: Some(T0 - 14 * MIN), ..Default::default() };
        assert_eq!(go(&soon, &on, false, five(99.0), false), Some(Paused::TooSoon(T0 + MIN)));
        // The budget check stays where the 80% check was: after the slot, before "nothing".
        assert_eq!(go(&idle, &on, false, five(99.0), false), Some(Paused::Budget(Budget::FiveHour(99.0))));
        assert_eq!(go(&idle, &on, false, Some(Budget::Ok), false), Some(Paused::Nothing));
        assert_eq!(go(&idle, &on, false, Some(Budget::Ok), true), None);
        // Every reason of the rule pauses, including a missing or stale reading (fails closed).
        for b in [
            Budget::AheadOfWeek { percent: 50.0, line: 42.5 },
            Budget::FiveHour(80.0),
            Budget::NoData,
            Budget::Stale { saved_at: T0 - 31 * MIN },
        ] {
            assert_eq!(go(&idle, &on, false, Some(b.clone()), true), Some(Paused::Budget(b)));
        }
        // None is only the early pass that has not read the usage.
        assert_eq!(go(&idle, &on, false, None, true), None);
        // 14 minutes after the last start: too soon; 15: free.
        let at15 = BriefState { last_start_at: Some(T0 - 15 * MIN), ..Default::default() };
        assert_eq!(go(&at15, &on, false, Some(Budget::Ok), true), None);
    }

    #[test]
    fn eligible_leaves_out_filed_dismissed_inbox_and_tried_out() {
        let dir = app("eligible", &["aaa111"], &["aaa111"]);
        let new = add_capture(&dir, "aaa111", "one", "2026-11-01 10:00:00");
        let filed = add_capture(&dir, "aaa111", "two", "2026-11-01 10:01:00");
        let dismissed = add_capture(&dir, "aaa111", "three", "2026-11-01 10:02:00");
        let inbox = add_capture(&dir, "aaa111", "four", "2026-11-01 10:03:00");
        let tried = add_capture(&dir, "aaa111", "five", "2026-11-01 10:04:00");
        let newer = add_capture(&dir, "aaa111", "six", "2026-11-01 10:05:00");
        let conn = Connection::open(db_of(&dir, "aaa111")).unwrap();
        conn.execute("UPDATE captures SET status='filed' WHERE id=?1", [filed]).unwrap();
        conn.execute("UPDATE captures SET status='dismissed' WHERE id=?1", [dismissed]).unwrap();
        conn.execute("UPDATE captures SET inbox_reason='no project' WHERE id=?1", [inbox]).unwrap();
        conn.execute("UPDATE captures SET brief_tries=3 WHERE id=?1", [tried]).unwrap();
        conn.execute("UPDATE captures SET brief_tries=2 WHERE id=?1", [newer]).unwrap();
        let got = eligible(&db_of(&dir, "aaa111")).unwrap();
        assert_eq!(got.iter().map(|(id, _)| *id).collect::<Vec<_>>(), vec![new, newer]);
        assert_eq!(got[0].1, "2026-11-01 10:00:00");
    }

    #[test]
    fn eligible_takes_at_most_twenty_oldest_first() {
        let dir = app("twenty", &["aaa111"], &["aaa111"]);
        for i in 0..25 {
            add_capture(&dir, "aaa111", "x", &format!("2026-11-01 10:{i:02}:00"));
        }
        let got = eligible(&db_of(&dir, "aaa111")).unwrap();
        assert_eq!(got.len(), 20);
        assert_eq!(got[0].0, 1);
    }

    #[test]
    fn pick_org_takes_the_oldest_waiting_allowed_organisation_not_in_a_mode() {
        let dir = app("pick", &["aaa111", "bbb222", "ccc333"], &["aaa111", "bbb222"]);
        add_capture(&dir, "aaa111", "newer", "2026-11-02 09:00:00");
        add_capture(&dir, "bbb222", "older", "2026-11-01 09:00:00");
        // Oldest of all, but agent access doesn't allow it.
        add_capture(&dir, "ccc333", "oldest", "2026-10-01 09:00:00");
        let access = crate::agent_access::read_access(&dir);
        let (org, ids) = pick_org(&dir, &access).unwrap();
        assert_eq!(org.id, "bbb222");
        assert_eq!(ids.len(), 1);
        // A test-mode copy beside bbb222: skipped, aaa111 wins.
        std::fs::write(crate::orgs::org_dir(&dir, "bbb222").join("studiomanager_test.db"), "").unwrap();
        assert_eq!(pick_org(&dir, &access).unwrap().0.id, "aaa111");
        std::fs::write(crate::orgs::org_dir(&dir, "aaa111").join("studiomanager_presentation.db"), "").unwrap();
        assert!(pick_org(&dir, &access).is_none());
        // Agent access off altogether.
        let off = crate::agent_access::AccessSettings { enabled: false, ..access.clone() };
        std::fs::remove_file(crate::orgs::org_dir(&dir, "aaa111").join("studiomanager_presentation.db")).unwrap();
        assert!(pick_org(&dir, &off).is_none());
    }

    fn agent(status: &str) -> Agent {
        let json = format!(
            r#"[{{"sessionId":"00000000-1111-2222-3333-444444444444","id":"0a1b2c3d","name":"brief","cwd":"/x","kind":"bg","status":"{status}"}}]"#
        );
        parse_agents(&json).unwrap().remove(0)
    }

    /// A scheduler that started long before the runs below, and a list made at `at`.
    const SCHED: i64 = T0 - 60 * MIN;

    #[test]
    fn verdict_follows_the_agent_state_and_the_limits() {
        let run = run_at(T0);
        let now = T0 + 5 * MIN;
        let v = |a: Option<&Agent>, r: &BriefRun, now: i64| verdict(a, r, now, Some(now), SCHED);
        assert_eq!(v(Some(&agent("busy")), &run, now), Verdict::Wait);
        assert_eq!(v(Some(&agent("idle")), &run, now), Verdict::Finished);
        assert_eq!(v(None, &run_at(T0 - 5 * MIN), now), Verdict::Finished);
        // A fresh start the poller has not listed yet is not a finished one.
        assert_eq!(v(None, &run, T0 + 10_000), Verdict::Wait);
        let waiting = |since: i64| BriefRun { waiting_since: Some(since), ..run_at(T0) };
        assert_eq!(v(Some(&agent("waiting")), &waiting(now - MIN), now), Verdict::Wait);
        assert_eq!(v(Some(&agent("waiting")), &waiting(now - 3 * MIN), now), Verdict::Stuck);
        // Not yet noticed as waiting: wait (the tick records it).
        assert_eq!(v(Some(&agent("waiting")), &run, now), Verdict::Wait);
        assert_eq!(v(Some(&agent("busy")), &run, T0 + 21 * MIN), Verdict::TimedOut);
        assert_eq!(v(Some(&agent("waiting")), &waiting(T0 + 20 * MIN), T0 + 21 * MIN), Verdict::TimedOut);
    }

    #[test]
    fn not_listed_means_finished_only_after_a_list_newer_than_the_start_and_the_scheduler() {
        let run = run_at(T0);
        let now = T0 + 5 * MIN;
        // No list yet, or one from before the start (or inside the grace): wait.
        assert_eq!(verdict(None, &run, now, None, SCHED), Verdict::Wait);
        assert_eq!(verdict(None, &run, now, Some(T0 - MIN), SCHED), Verdict::Wait);
        assert_eq!(verdict(None, &run, now, Some(T0 + LISTED_GRACE_MS), SCHED), Verdict::Wait);
        assert_eq!(verdict(None, &run, now, Some(T0 + LISTED_GRACE_MS + 1), SCHED), Verdict::Finished);
        // A list from before this scheduler thread started says nothing (an old run, a restart).
        assert_eq!(verdict(None, &run, now, Some(T0 + 2 * MIN), T0 + 3 * MIN), Verdict::Wait);
        assert_eq!(verdict(None, &run, now, Some(T0 + 4 * MIN), T0 + 3 * MIN), Verdict::Finished);
        // Without a trusted list the run limit still stops it.
        assert_eq!(verdict(None, &run, T0 + 20 * MIN, None, SCHED), Verdict::TimedOut);
    }

    #[test]
    fn count_try_counts_only_captures_still_eligible() {
        let dir = app("count", &["aaa111"], &["aaa111"]);
        let a = add_capture(&dir, "aaa111", "a", "2026-11-01 10:00:00");
        let b = add_capture(&dir, "aaa111", "b", "2026-11-01 10:01:00");
        let c = add_capture(&dir, "aaa111", "c", "2026-11-01 10:02:00");
        let conn = Connection::open(db_of(&dir, "aaa111")).unwrap();
        conn.execute("UPDATE captures SET status='filed' WHERE id=?1", [b]).unwrap();
        conn.execute("UPDATE captures SET inbox_reason='why' WHERE id=?1", [c]).unwrap();
        assert_eq!(count_try(&db_of(&dir, "aaa111"), &[a, b, c]).unwrap(), 1);
        assert_eq!(count_of(&db_of(&dir, "aaa111"), "SELECT brief_tries FROM captures WHERE id=1"), 1);
        assert_eq!(count_of(&db_of(&dir, "aaa111"), "SELECT SUM(brief_tries) FROM captures"), 1);
        assert_eq!(count_try(&db_of(&dir, "aaa111"), &[]).unwrap(), 0);
    }

    // A fake `claude`: answers by the first argument and records every call.
    type Call = (Vec<String>, PathBuf);

    #[derive(Clone, Default)]
    struct FakeCli {
        calls: Arc<Mutex<Vec<Call>>>,
        start_error: Arc<Mutex<Option<String>>>,
        start_timeout: Arc<Mutex<bool>>,
    }

    impl Cli for FakeCli {
        fn run(&self, a: &[String], cwd: &Path) -> CliOutput {
            self.calls.lock().unwrap().push((a.to_vec(), cwd.to_path_buf()));
            let ok = |s: &str| CliOutput { code: 0, stdout: s.into(), stderr: String::new() };
            match a[0].as_str() {
                "agents" => ok("[]"),
                "--bg" if *self.start_timeout.lock().unwrap() => {
                    CliOutput { code: -1, stdout: String::new(), stderr: "timed out".into() }
                }
                "--bg" => match self.start_error.lock().unwrap().clone() {
                    Some(e) => CliOutput { code: 1, stdout: String::new(), stderr: e },
                    None => ok("backgrounded · 0a1b2c3d\n"),
                },
                "stop" => ok(&format!("stopped {}\n", a[1])),
                "rm" => ok(&format!("removed {}\n", a[1])),
                other => panic!("unexpected claude call: {other}"),
            }
        }
    }

    impl FakeCli {
        fn starts(&self) -> Vec<Call> {
            self.calls.lock().unwrap().iter().filter(|c| c.0[0] == "--bg").cloned().collect()
        }
        fn verbs(&self) -> Vec<String> {
            self.calls.lock().unwrap().iter().map(|c| c.0[0].clone()).collect()
        }
    }

    /// A `limits.json` as the status line writes it, saved at `now`: the 5-hour window at `five`
    /// percent, the week at `week` percent with half of it gone (the pace line stands at 42.5%).
    fn write_limits_at(dir: &Path, now: i64, five: f64, week: f64) {
        std::fs::create_dir_all(dir).unwrap();
        let (five_reset, week_reset) = ((now + 3_600_000) / 1000, (now + 302_400_000) / 1000);
        std::fs::write(
            dir.join("limits.json"),
            format!(
                r#"{{"savedAt":{},"rate_limits":{{
                  "five_hour":{{"used_percentage":{five},"resets_at":{five_reset}}},
                  "seven_day":{{"used_percentage":{week},"resets_at":{week_reset}}}}}}}"#,
                now / 1000
            ),
        )
        .unwrap();
    }

    struct Harness {
        dir: PathBuf,
        cli: FakeCli,
        changed: RefCell<u32>,
        /// Write a fresh, roomy `limits.json` before each tick (the rule pauses without one).
        fresh_limits: bool,
    }

    impl Harness {
        fn new(name: &str) -> Self {
            Harness { dir: app(name, &["aaa111"], &["aaa111"]), cli: FakeCli::default(), changed: RefCell::new(0), fresh_limits: true }
        }
        fn tick_with(&self, st: &mut BriefState, now: i64, agents: &[Agent], demo: bool) -> bool {
            self.tick_full(st, now, agents, demo, Some(now), true)
        }
        fn tick_full(
            &self,
            st: &mut BriefState,
            now: i64,
            agents: &[Agent],
            demo: bool,
            listed_at: Option<i64>,
            may_start: bool,
        ) -> bool {
            if self.fresh_limits && !demo {
                write_limits_at(&self.dir, now, 10.0, 10.0);
            }
            let dir = self.dir.canonicalize().unwrap_or_else(|_| self.dir.clone());
            let trusted = vec![dir.to_string_lossy().into_owned()];
            let cli = self.cli.clone();
            let get_cli = move || Ok(Box::new(cli.clone()) as Box<dyn Cli>);
            let on_change = || *self.changed.borrow_mut() += 1;
            tick(
                &Deps {
                    app_dir: &self.dir,
                    limits_dir: &self.dir,
                    home: &self.dir,
                    trusted: &trusted,
                    mcp_path: "/opt/app/studiomanager-mcp",
                    demo,
                    now,
                    agents,
                    listed_at,
                    scheduler_started: SCHED,
                    cli: &get_cli,
                    on_change: &on_change,
                },
                st,
                may_start,
            )
        }
        fn tick(&self, st: &mut BriefState, now: i64, agents: &[Agent]) -> bool {
            self.tick_with(st, now, agents, false)
        }
    }

    #[test]
    fn a_tick_starts_one_opus_session_in_the_briefing_folder_with_the_prompt() {
        let h = Harness::new("start");
        let id = add_capture(&h.dir, "aaa111", "call the printer", "2026-11-01 10:00:00");
        let mut st = BriefState::default();
        assert!(h.tick(&mut st, T0, &[]));
        let starts = h.cli.starts();
        assert_eq!(starts.len(), 1);
        let (argv, cwd) = &starts[0];
        let pos = |f: &str| argv.iter().position(|a| a == f).unwrap();
        assert_eq!(argv[pos("--model") + 1], "opus");
        assert!(argv[pos("--name") + 1].starts_with("brief-"));
        assert!(argv.contains(&"--strict-mcp-config".to_string()));
        assert_eq!(argv[argv.len() - 2], "--");
        assert_eq!(argv[argv.len() - 1], prompt("aaa111", &[id]));
        assert_eq!(cwd, &h.dir.join("briefing").canonicalize().unwrap());
        let run = st.current.clone().unwrap();
        assert_eq!((run.org_id.as_str(), run.short_id.as_str(), run.capture_ids), ("aaa111", "0a1b2c3d", vec![id]));
        assert_eq!(st.last_start_at, Some(T0));
        // The folder was made.
        assert!(h.dir.join("briefing/mcp.json").exists());
        // Next tick while it works: nothing more is started.
        h.tick(&mut st, T0 + 30_000, &[agent("busy")]);
        assert_eq!(h.cli.starts().len(), 1);
    }

    #[test]
    fn a_capture_added_during_the_run_waits_for_the_next_slot() {
        let h = Harness::new("during");
        let first = add_capture(&h.dir, "aaa111", "one", "2026-11-01 10:00:00");
        let mut st = BriefState::default();
        h.tick(&mut st, T0, &[]);
        let second = add_capture(&h.dir, "aaa111", "two", "2026-11-01 10:05:00");
        assert_eq!(st.current.as_ref().unwrap().capture_ids, vec![first]);
        // The session files the first and ends.
        Connection::open(db_of(&h.dir, "aaa111"))
            .unwrap()
            .execute("UPDATE captures SET status='filed' WHERE id=?1", [first])
            .unwrap();
        h.tick(&mut st, T0 + 3 * MIN, &[agent("idle")]);
        assert!(st.current.is_none());
        assert!(st.last.as_ref().unwrap().ok);
        // Stopped and deleted.
        assert_eq!(h.cli.verbs(), vec!["--bg", "stop", "rm"]);
        // Too soon: nothing starts at minute 10, the slot opens at 15.
        h.tick(&mut st, T0 + 10 * MIN, &[]);
        assert_eq!(h.cli.starts().len(), 1);
        h.tick(&mut st, T0 + 15 * MIN, &[]);
        assert_eq!(h.cli.starts().len(), 2);
        assert_eq!(st.current.as_ref().unwrap().capture_ids, vec![second]);
        assert!(*h.changed.borrow() >= 1);
    }

    #[test]
    fn a_session_that_ends_without_filing_counts_a_try_and_stays_for_inspection() {
        let h = Harness::new("unfiled");
        let id = add_capture(&h.dir, "aaa111", "one", "2026-11-01 10:00:00");
        let mut st = BriefState::default();
        h.tick(&mut st, T0, &[]);
        h.tick(&mut st, T0 + 4 * MIN, &[agent("idle")]);
        assert_eq!(count_of(&db_of(&h.dir, "aaa111"), &format!("SELECT brief_tries FROM captures WHERE id={id}")), 1);
        assert_eq!(h.cli.verbs(), vec!["--bg", "stop"], "stopped, not deleted");
        let last = st.last.clone().unwrap();
        assert!(!last.ok);
        assert_eq!(last.message.as_deref(), Some("1 capture was not filed"));
        assert!(st.current.is_none());
    }

    #[test]
    fn a_session_waiting_on_an_answer_is_stopped_after_two_minutes() {
        let h = Harness::new("stuck");
        let id = add_capture(&h.dir, "aaa111", "one", "2026-11-01 10:00:00");
        let mut st = BriefState::default();
        h.tick(&mut st, T0, &[]);
        h.tick(&mut st, T0 + MIN, &[agent("waiting")]);
        assert_eq!(st.current.as_ref().unwrap().waiting_since, Some(T0 + MIN));
        h.tick(&mut st, T0 + 2 * MIN, &[agent("waiting")]);
        assert!(st.current.is_some(), "one minute in: still waiting");
        h.tick(&mut st, T0 + 3 * MIN, &[agent("waiting")]);
        assert!(st.current.is_none());
        assert_eq!(h.cli.verbs(), vec!["--bg", "stop"]);
        assert_eq!(count_of(&db_of(&h.dir, "aaa111"), &format!("SELECT brief_tries FROM captures WHERE id={id}")), 1);
        assert!(!st.last.unwrap().ok);
    }

    #[test]
    fn a_session_past_twenty_minutes_is_stopped() {
        let h = Harness::new("timeout");
        add_capture(&h.dir, "aaa111", "one", "2026-11-01 10:00:00");
        let mut st = BriefState::default();
        h.tick(&mut st, T0, &[]);
        h.tick(&mut st, T0 + 19 * MIN, &[agent("busy")]);
        assert!(st.current.is_some());
        h.tick(&mut st, T0 + 20 * MIN, &[agent("busy")]);
        assert!(st.current.is_none());
        assert_eq!(h.cli.verbs(), vec!["--bg", "stop"]);
        assert!(!st.last.unwrap().ok);
    }

    fn tries_of(h: &Harness, id: i64) -> i64 {
        count_of(&db_of(&h.dir, "aaa111"), &format!("SELECT brief_tries FROM captures WHERE id={id}"))
    }

    #[test]
    fn a_start_that_failed_counts_no_try_and_is_shown_as_the_last_failure() {
        let h = Harness::new("fail-nocount");
        let id = add_capture(&h.dir, "aaa111", "one", "2026-11-01 10:00:00");
        *h.cli.start_error.lock().unwrap() = Some("boom".into());
        let mut st = BriefState::default();
        for round in 0..5 {
            h.tick(&mut st, T0 + round * 15 * MIN, &[]);
            assert!(st.current.is_none());
            assert_eq!(st.last.as_ref().unwrap().message.as_deref(), Some("boom"));
            assert_eq!(tries_of(&h, id), 0, "round {round}");
        }
        // Each slot tried again, none was used up.
        assert_eq!(h.cli.starts().len(), 5);
        assert_eq!(eligible_ids(&h.dir, "aaa111"), vec![id]);
    }

    #[test]
    fn a_folder_that_is_not_trusted_counts_no_try() {
        let h = Harness::new("untrusted");
        let id = add_capture(&h.dir, "aaa111", "one", "2026-11-01 10:00:00");
        let mut st = BriefState::default();
        // Same tick as the harness's, with nothing trusted.
        let get_cli = || Ok(Box::new(h.cli.clone()) as Box<dyn Cli>);
        let on_change = || {};
        write_limits_at(&h.dir, T0, 10.0, 10.0);
        tick(
            &Deps {
                app_dir: &h.dir,
                limits_dir: &h.dir,
                home: &h.dir,
                trusted: &[],
                mcp_path: "/x",
                demo: false,
                now: T0,
                agents: &[],
                listed_at: Some(T0),
                scheduler_started: SCHED,
                cli: &get_cli,
                on_change: &on_change,
            },
            &mut st,
            true,
        );
        assert!(h.cli.starts().is_empty());
        assert!(st.last.as_ref().unwrap().message.as_deref().unwrap().starts_with("Folder not trusted"));
        assert_eq!(tries_of(&h, id), 0);
        assert_eq!(st.last_start_at, Some(T0), "waits for the next slot");
    }

    #[test]
    fn a_started_session_counts_its_try_at_once_so_three_unfiled_sessions_end_the_sending() {
        let h = Harness::new("three");
        let id = add_capture(&h.dir, "aaa111", "one", "2026-11-01 10:00:00");
        let mut st = BriefState::default();
        for round in 0..3 {
            assert_eq!(eligible_ids(&h.dir, "aaa111"), vec![id], "round {round}");
            let at = T0 + round * 15 * MIN;
            h.tick(&mut st, at, &[]);
            assert_eq!(tries_of(&h, id), round + 1, "counted right after the start");
            // It never ends by itself: the 20-minute limit stops it (no list says it is gone).
            h.tick_full(&mut st, at + 20 * MIN, &[agent("busy")], false, Some(at + 20 * MIN), true);
            assert!(st.current.is_none());
            assert_eq!(tries_of(&h, id), round + 1, "settling counts nothing more");
        }
        assert_eq!(h.cli.starts().len(), 3);
        assert_eq!(eligible_ids(&h.dir, "aaa111"), Vec::<i64>::new());
        h.tick(&mut st, T0 + 90 * MIN, &[]);
        assert_eq!(h.cli.starts().len(), 3);
    }

    #[test]
    fn a_start_that_timed_out_counts_no_try_until_the_session_is_found_by_name() {
        let h = Harness::new("timeout-adopt");
        let id = add_capture(&h.dir, "aaa111", "one", "2026-11-01 10:00:00");
        *h.cli.start_timeout.lock().unwrap() = true;
        let mut st = BriefState::default();
        h.tick(&mut st, T0, &[]);
        assert!(st.current.is_none());
        let pending = st.pending.clone().unwrap();
        assert!(pending.name.starts_with("brief-"));
        assert_eq!(tries_of(&h, id), 0);
        // The poller's list has no such session yet (and its list is old): keep waiting, start
        // nothing else.
        h.tick_full(&mut st, T0 + 30_000, &[], false, Some(T0), true);
        assert!(st.pending.is_some());
        assert_eq!(h.cli.starts().len(), 1);
        h.tick_full(&mut st, T0 + 20 * MIN, &[], false, Some(T0), true);
        assert!(st.pending.is_none(), "given up after the run limit");
        // Found: adopted as the current run, and its try is counted then.
        let h2 = Harness::new("timeout-adopt2");
        let id2 = add_capture(&h2.dir, "aaa111", "one", "2026-11-01 10:00:00");
        *h2.cli.start_timeout.lock().unwrap() = true;
        let mut st2 = BriefState::default();
        h2.tick(&mut st2, T0, &[]);
        let name = st2.pending.clone().unwrap().name;
        let mut found = agent("busy");
        found.name = name;
        h2.tick(&mut st2, T0 + 40_000, &[found]);
        assert!(st2.pending.is_none());
        let run = st2.current.clone().unwrap();
        assert_eq!((run.short_id.as_str(), run.capture_ids), ("0a1b2c3d", vec![id2]));
        assert_eq!(tries_of(&h2, id2), 1);
    }

    #[test]
    fn a_timed_out_start_a_fresh_list_does_not_show_is_dropped() {
        let h = Harness::new("timeout-gone");
        add_capture(&h.dir, "aaa111", "one", "2026-11-01 10:00:00");
        *h.cli.start_timeout.lock().unwrap() = true;
        let mut st = BriefState::default();
        h.tick(&mut st, T0, &[]);
        assert!(st.pending.is_some());
        h.tick_full(&mut st, T0 + 2 * MIN, &[], false, Some(T0 + 2 * MIN), true);
        assert!(st.pending.is_none());
        assert!(st.current.is_none());
    }

    #[test]
    fn a_stale_list_never_finishes_a_run_but_the_limit_still_stops_it() {
        let h = Harness::new("stale");
        let id = add_capture(&h.dir, "aaa111", "one", "2026-11-01 10:00:00");
        let mut st = BriefState::default();
        h.tick(&mut st, T0, &[]);
        // Not listed, and the last good list is from before the start: it waits.
        h.tick_full(&mut st, T0 + 5 * MIN, &[], false, Some(T0 - MIN), true);
        assert!(st.current.is_some());
        h.tick_full(&mut st, T0 + 6 * MIN, &[], false, None, true);
        assert!(st.current.is_some());
        // A real list after the start without it: finished.
        h.tick_full(&mut st, T0 + 7 * MIN, &[], false, Some(T0 + 7 * MIN), true);
        assert!(st.current.is_none());
        assert_eq!(st.last.as_ref().unwrap().message.as_deref(), Some("1 capture was not filed"));
        assert_eq!(tries_of(&h, id), 1);
        // And with no list at all, 20 minutes stop a run.
        let h = Harness::new("stale2");
        add_capture(&h.dir, "aaa111", "one", "2026-11-01 10:00:00");
        let mut st = BriefState::default();
        h.tick(&mut st, T0, &[]);
        h.tick_full(&mut st, T0 + 20 * MIN, &[], false, None, true);
        assert!(st.current.is_none());
        assert_eq!(st.last.as_ref().unwrap().message.as_deref(), Some("The session ran longer than 20 minutes"));
    }

    #[test]
    fn switching_agents_off_stops_the_run_clears_it_and_counts_no_more_tries() {
        let h = Harness::new("agents-off");
        let id = add_capture(&h.dir, "aaa111", "one", "2026-11-01 10:00:00");
        let mut st = BriefState::default();
        h.tick(&mut st, T0, &[]);
        assert_eq!(tries_of(&h, id), 1);
        write_settings(&h.dir, &AgentsSettings { enabled: false, briefing: false, ..Default::default() }).unwrap();
        assert!(h.tick(&mut st, T0 + MIN, &[agent("busy")]));
        assert!(st.current.is_none());
        assert_eq!(h.cli.verbs(), vec!["--bg", "stop"]);
        assert_eq!(tries_of(&h, id), 1, "no further try");
        // Nothing more happens while it stays off.
        h.tick(&mut st, T0 + 30 * MIN, &[]);
        assert_eq!(h.cli.starts().len(), 1);
    }

    #[test]
    fn no_session_starts_while_the_state_cannot_be_saved() {
        let h = Harness::new("save-fails");
        add_capture(&h.dir, "aaa111", "one", "2026-11-01 10:00:00");
        let saves = RefCell::new(Vec::<BriefState>::new());
        let broken = std::cell::Cell::new(true);
        let save = |s: &BriefState| {
            if broken.get() {
                Err("disk full".to_string())
            } else {
                saves.borrow_mut().push(s.clone());
                Ok(())
            }
        };
        let mut sched = Scheduler::new(BriefState::default());
        let trusted = vec![h.dir.canonicalize().unwrap().to_string_lossy().into_owned()];
        let cli = h.cli.clone();
        let get_cli = move || Ok(Box::new(cli.clone()) as Box<dyn Cli>);
        let on_change = || {};
        let step = |sched: &mut Scheduler, now: i64| {
            write_limits_at(&h.dir, now, 10.0, 10.0);
            sched.step(
                &Deps {
                    app_dir: &h.dir,
                    limits_dir: &h.dir,
                    home: &h.dir,
                    trusted: &trusted,
                    mcp_path: "/x",
                    demo: false,
                    now,
                    agents: &[],
                    listed_at: Some(now),
                    scheduler_started: SCHED,
                    cli: &get_cli,
                    on_change: &on_change,
                },
                &save,
            )
        };
        // The first start works (the state was fine to begin with), but its save fails.
        step(&mut sched, T0);
        assert_eq!(h.cli.starts().len(), 1);
        // It ends unfiled; saving still fails: the next slot starts nothing.
        sched.state.current = None;
        step(&mut sched, T0 + 16 * MIN);
        assert_eq!(h.cli.starts().len(), 1, "no new session while a save fails");
        // Saving works again: the pending state is saved first, then a session may start.
        broken.set(false);
        step(&mut sched, T0 + 32 * MIN);
        assert_eq!(h.cli.starts().len(), 2);
        assert!(!saves.borrow().is_empty());
        assert_eq!(saves.borrow().last().unwrap(), &sched.state);
    }

    #[test]
    fn the_scheduler_keeps_its_state_in_memory() {
        let h = Harness::new("memory");
        add_capture(&h.dir, "aaa111", "one", "2026-11-01 10:00:00");
        let mut st = BriefState::default();
        h.tick(&mut st, T0, &[]);
        let mut sched = Scheduler::new(st.clone());
        write_state(&h.dir, &st).unwrap();
        // The file is gone or changed on disk: the thread's own copy is what counts.
        std::fs::remove_file(h.dir.join(STATE_FILE)).unwrap();
        let trusted: Vec<String> = vec![];
        let get_cli = || Err("claude not found".to_string());
        let on_change = || {};
        sched.step(
            &Deps {
                app_dir: &h.dir,
                limits_dir: &h.dir,
                home: &h.dir,
                trusted: &trusted,
                mcp_path: "/x",
                demo: false,
                now: T0 + MIN,
                agents: &[agent("busy")],
                listed_at: Some(T0 + MIN),
                scheduler_started: SCHED,
                cli: &get_cli,
                on_change: &on_change,
            },
            &|s| write_state(&h.dir, s),
        );
        assert_eq!(sched.state, st);
        assert!(sched.state.current.is_some());
    }

    #[test]
    fn a_failed_start_waits_a_slot_before_the_next_try() {
        let h = Harness::new("slot");
        add_capture(&h.dir, "aaa111", "one", "2026-11-01 10:00:00");
        *h.cli.start_error.lock().unwrap() = Some("boom".into());
        let mut st = BriefState::default();
        h.tick(&mut st, T0, &[]);
        h.tick(&mut st, T0 + 5 * MIN, &[]);
        assert_eq!(h.cli.starts().len(), 1);
    }

    /// The tick pauses with no capture counted and nothing started; returns the status.
    fn paused_status(h: &Harness, id: i64) -> BriefingStatus {
        let mut st = BriefState::default();
        assert!(!h.tick(&mut st, T0, &[]));
        assert!(h.cli.starts().is_empty());
        assert_eq!(count_of(&db_of(&h.dir, "aaa111"), &format!("SELECT brief_tries FROM captures WHERE id={id}")), 0);
        assert_eq!(st.last_start_at, None);
        status_of(&h.dir, &h.dir, &st, &settings(true, true), false, T0)
    }

    fn budget_harness(name: &str) -> (Harness, i64) {
        let mut h = Harness::new(name);
        h.fresh_limits = false;
        let id = add_capture(&h.dir, "aaa111", "one", "2026-11-01 10:00:00");
        (h, id)
    }

    #[test]
    fn a_budget_pause_starts_nothing_and_counts_no_try() {
        let (h, id) = budget_harness("budget");
        write_limits_at(&h.dir, T0, 85.0, 10.0);
        let status = paused_status(&h, id);
        assert_eq!(status.paused.as_deref(), Some("budget"));
        assert_eq!(status.reason.as_deref(), Some("five_hour"));
        assert_eq!(status.percent, Some(85.0));
        assert_eq!((status.line, status.minutes_old), (None, None));
    }

    #[test]
    fn a_week_ahead_of_its_line_pauses_and_the_status_carries_both_percents() {
        let (h, id) = budget_harness("budget-week");
        write_limits_at(&h.dir, T0, 10.0, 60.0);
        let status = paused_status(&h, id);
        assert_eq!(status.paused.as_deref(), Some("budget"));
        assert_eq!(status.reason.as_deref(), Some("ahead_of_week"));
        assert_eq!((status.percent, status.line), (Some(60.0), Some(42.5)));
        // On the line it runs.
        write_limits_at(&h.dir, T0, 10.0, 42.5);
        let mut st = BriefState::default();
        assert!(h.tick(&mut st, T0, &[]));
    }

    #[test]
    fn no_limits_file_pauses_the_brief_session() {
        let (h, id) = budget_harness("budget-nodata");
        let status = paused_status(&h, id);
        assert_eq!(status.paused.as_deref(), Some("budget"));
        assert_eq!(status.reason.as_deref(), Some("no_data"));
        assert_eq!((status.percent, status.line, status.minutes_old), (None, None, None));
    }

    #[test]
    fn a_stale_limits_file_pauses_the_brief_session() {
        let (h, id) = budget_harness("budget-stale");
        write_limits_at(&h.dir, T0 - 31 * MIN, 10.0, 10.0);
        let status = paused_status(&h, id);
        assert_eq!(status.paused.as_deref(), Some("budget"));
        assert_eq!(status.reason.as_deref(), Some("stale"));
        assert_eq!(status.minutes_old, Some(31));
        // Just inside the limit it runs.
        write_limits_at(&h.dir, T0 - 30 * MIN, 10.0, 10.0);
        let mut st = BriefState::default();
        assert!(h.tick(&mut st, T0, &[]));
    }

    #[test]
    fn a_limits_file_without_a_save_time_pauses_the_brief_session() {
        let (h, id) = budget_harness("budget-nosave");
        // Fresh-looking windows, but no `savedAt`: nothing says how old the reading is.
        let (five, week) = ((T0 + 3_600_000) / 1000, (T0 + 302_400_000) / 1000);
        std::fs::write(
            h.dir.join("limits.json"),
            format!(
                r#"{{"rate_limits":{{"five_hour":{{"used_percentage":10,"resets_at":{five}}},"seven_day":{{"used_percentage":10,"resets_at":{week}}}}}}}"#
            ),
        )
        .unwrap();
        let status = paused_status(&h, id);
        assert_eq!(status.paused.as_deref(), Some("budget"));
        assert_eq!(status.reason.as_deref(), Some("no_data"));
    }

    #[test]
    fn the_scheduler_reads_the_limits_folder_it_is_given() {
        let (h, _) = budget_harness("budget-dir");
        // The app's own folder has a good reading; the limits folder has none: it pauses.
        write_limits_at(&h.dir, T0, 10.0, 10.0);
        let other = std::env::temp_dir().join(format!("sm-briefing-limits-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&other);
        let status = status_of(&h.dir, &other, &BriefState::default(), &settings(true, true), false, T0);
        assert_eq!(status.reason.as_deref(), Some("no_data"));
        assert!(!other.exists(), "reading creates nothing");
    }

    #[test]
    fn nothing_starts_when_agent_access_is_off_and_the_status_says_why() {
        let dir = app("access", &["aaa111"], &[]);
        add_capture(&dir, "aaa111", "one", "2026-11-01 10:00:00");
        let h = Harness { dir, cli: FakeCli::default(), changed: RefCell::new(0), fresh_limits: true };
        let mut st = BriefState::default();
        h.tick(&mut st, T0, &[]);
        assert!(h.cli.starts().is_empty());
        let status = status_of(&h.dir, &h.dir, &st, &settings(true, true), false, T0);
        assert_eq!(status.paused.as_deref(), Some("access_off"));
    }

    #[test]
    fn a_tick_in_the_demo_reads_no_file_and_starts_nothing() {
        let dir = std::env::temp_dir().join(format!("sm-briefing-demo-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let h = Harness { dir: dir.clone(), cli: FakeCli::default(), changed: RefCell::new(0), fresh_limits: true };
        let mut st = BriefState { current: Some(run_at(T0)), ..Default::default() };
        assert!(!h.tick_with(&mut st, T0 + 40 * MIN, &[], true));
        assert!(h.cli.calls.lock().unwrap().is_empty());
        assert!(st.current.is_some());
        assert!(!dir.exists(), "nothing was created or read");
        let status = status_of(&dir, &dir, &st, &settings(false, false), true, T0);
        assert_eq!(status.paused.as_deref(), Some("demo"));
    }

    #[test]
    fn with_the_session_switched_off_nothing_starts() {
        let h = Harness::new("off");
        add_capture(&h.dir, "aaa111", "one", "2026-11-01 10:00:00");
        write_settings(&h.dir, &settings(true, false)).unwrap();
        let mut st = BriefState::default();
        h.tick(&mut st, T0, &[]);
        assert!(h.cli.starts().is_empty());
    }

    #[test]
    fn status_reports_the_next_slot() {
        let dir = app("status", &["aaa111"], &["aaa111"]);
        add_capture(&dir, "aaa111", "one", "2026-11-01 10:00:00");
        let st = BriefState { last_start_at: Some(T0 - 6 * MIN), ..Default::default() };
        write_limits_at(&dir, T0, 10.0, 10.0);
        let s = status_of(&dir, &dir, &st, &settings(true, true), false, T0);
        assert_eq!(s.paused.as_deref(), Some("too_soon"));
        assert_eq!(s.next_at, Some(T0 + 9 * MIN));
        assert!(!s.running);
        let none = status_of(&dir, &dir, &BriefState::default(), &settings(true, true), false, T0);
        assert_eq!(none.paused, None);
    }
}
