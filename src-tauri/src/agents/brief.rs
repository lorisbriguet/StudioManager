//! The personal morning brief's comments: a small HTTP server on 127.0.0.1:47480 (taken over
//! from AgentBar, retired 2026-10-29). The brief is a local HTML page; select a passage, write a
//! note, Send, and the comment is typed into the morning agent, which answers in its chat.
//!
//!   GET    /brief/<date>/comments
//!   POST   /brief/<date>/comments        {quote, note, section}  -> stored, then sent to the agent
//!   DELETE /brief/<date>/comments/<id>
//!   POST   /review/agent                 {id, title, folder, prompt, report?} -> {agent}
//!   GET    /review/status/<report>       -> {findings: {<id>: {status, at, agent?, agent_state?}}}
//!   POST   /review/status/<report>       {id, status}  -> {finding}
//!
//! `/review/agent` is the review report's "Start work with agent" (right-click on a finding): the
//! same start as on a task (Opus, in a folder Claude Code trusts; the agent reads first and asks
//! before changing anything), then the main window opens on the new agent. The report is a local
//! page too; the script that renders it writes the token and each finding's folder into it.
//!
//! `/review/status` keeps where each finding stands (open, in_progress, fixed, accepted) per report
//! in `<app dir>/review-status/<report>.json`, so the page can recount what is left and its scores.
//! Starting an agent with `report` marks an open finding in_progress and remembers the agent; a
//! GET adds that agent's state from the Agents list (working, needs_you, idle, done, or gone).
//!
//! Only once the Agents switch is on (then until StudioManager quits); loopback only. Every request needs the token from `<app dir>/brief-token`, which the page
//! renderer (agent-bar/brief/personal_brief.py) writes into the page. Comments are kept per
//! day in `<app dir>/brief-comments/<date>.json`.

use super::model::{Agent, Kind};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Emitter, Manager};

pub const PORT: u16 = 47480;
const TOKEN_FILE: &str = "brief-token";
const COMMENTS_DIR: &str = "brief-comments";
/// The agent the Start of day routine starts, and the name AgentBar gave it.
const AGENT_NAMES: [&str; 1] = ["personal-sod"];
const MAX_REQUEST: usize = 64 * 1024;
const QUOTE_MAX: usize = 1000;
const NOTE_MAX: usize = 2000;
const SECTION_MAX: usize = 80;
const REVIEW_ID_MAX: usize = 16;
const REVIEW_TITLE_MAX: usize = 200;
const REVIEW_PROMPT_MAX: usize = 6000;
const REVIEW_FOLDER_MAX: usize = 1024;
const REVIEW_DIR: &str = "review-status";
const REVIEW_REPORT_MAX: usize = 80;
/// What a finding can be set to from the page; `in_progress` is also set by starting an agent.
const REVIEW_STATUSES: [&str; 4] = ["open", "in_progress", "fixed", "accepted"];

static STORE_LOCK: Mutex<()> = Mutex::new(());
/// Findings an agent is being started on: a second click while one starts is turned away.
static REVIEW_IN_FLIGHT: Mutex<Vec<String>> = Mutex::new(Vec::new());
/// The server starts once, when the Agents switch is first on, and runs until the app quits.
static STARTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// The token, created on first use (48 hex characters, readable by this user only).
pub fn token(app_dir: &Path) -> std::io::Result<String> {
    let path = app_dir.join(TOKEN_FILE);
    if let Ok(t) = std::fs::read_to_string(&path) {
        let t = t.trim();
        if t.len() >= 32 && t.chars().all(|c| c.is_ascii_hexdigit()) {
            return Ok(t.to_string());
        }
    }
    let mut bytes = [0u8; 24];
    std::fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    let t: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    std::fs::create_dir_all(app_dir)?;
    std::fs::write(&path, &t)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(t)
}

// ---------------------------------------------------------------- HTTP

#[derive(Debug, PartialEq)]
pub struct Request {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Request {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }
}

pub enum Parse {
    Done(Request),
    /// Read more.
    Partial,
    Bad,
}

/// Parses one request; header names lowercased. No chunked bodies (the page never sends them).
pub fn parse(data: &[u8]) -> Parse {
    let Some(end) = data.windows(4).position(|w| w == b"\r\n\r\n") else {
        return if data.len() > MAX_REQUEST { Parse::Bad } else { Parse::Partial };
    };
    let head = String::from_utf8_lossy(&data[..end]);
    let mut lines = head.split("\r\n");
    let first: Vec<&str> = lines.next().unwrap_or("").split(' ').collect();
    if first.len() < 2 {
        return Parse::Bad;
    }
    let headers: Vec<(String, String)> = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string()))
        .collect();
    if headers.iter().any(|(k, v)| k == "transfer-encoding" && v.to_ascii_lowercase().contains("chunked")) {
        return Parse::Bad;
    }
    let len: usize = match headers.iter().find(|(k, _)| k == "content-length") {
        Some((_, v)) => match v.parse() {
            Ok(n) => n,
            Err(_) => return Parse::Bad,
        },
        None => 0,
    };
    if len > MAX_REQUEST {
        return Parse::Bad;
    }
    let body = &data[end + 4..];
    if body.len() < len {
        return Parse::Partial;
    }
    Parse::Done(Request {
        method: first[0].to_string(),
        path: first[1].to_string(),
        headers,
        body: body[..len].to_vec(),
    })
}

#[derive(Debug, PartialEq)]
pub struct Response {
    pub status: u16,
    pub body: Value,
}

fn ok(body: Value) -> Response {
    Response { status: 200, body }
}

fn error(status: u16, msg: &str) -> Response {
    Response { status, body: json!({ "error": msg }) }
}

fn encode(r: &Response) -> Vec<u8> {
    let body = r.body.to_string();
    let reason = if r.status == 200 { "OK" } else { "Error" };
    // The brief is opened as a file, so its origin is "null".
    format!(
        "HTTP/1.1 {} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\
         Access-Control-Allow-Origin: null\r\nAccess-Control-Allow-Methods: GET, POST, DELETE, OPTIONS\r\n\
         Access-Control-Allow-Headers: content-type, x-brief-token\r\nAccess-Control-Allow-Private-Network: true\r\n\r\n{body}",
        r.status,
        body.len()
    )
    .into_bytes()
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    let (x, y) = (a.as_bytes(), b.as_bytes());
    x.len() == y.len() && x.iter().zip(y).fold(0u8, |acc, (p, q)| acc | (p ^ q)) == 0
}

fn valid_date(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b.iter().enumerate().all(|(i, c)| if i == 4 || i == 7 { *c == b'-' } else { c.is_ascii_digit() })
}

// ---------------------------------------------------------------- routes

/// What the routes need from the app; a fake in tests.
pub trait Backend {
    fn token(&self) -> &str;
    fn store_dir(&self) -> PathBuf;
    /// Types the text into the morning agent of `date`; Err is the reason shown on the page.
    fn deliver(&self, date: &str, text: &str) -> Result<(), String>;
    fn now_hhmm(&self) -> String;
    fn new_id(&self) -> String;
    /// Starts an Opus background agent in `folder` (which Claude Code must trust) and opens it in
    /// the main window; Ok is its short id, Err the reason shown on the page.
    fn start_agent(&self, folder: &str, task: &str, name: &str) -> Result<String, String>;
    /// Where finding statuses are kept, one JSON file per report.
    fn review_dir(&self) -> PathBuf;
    /// The agents listed now: (short id, group: working, needs_you, idle or done).
    fn agent_groups(&self) -> Vec<(String, String)>;
    /// Local date and time, `2026-11-06 09:40`.
    fn now_stamp(&self) -> String;
}

/// What the agent receives: where the passage is, the passage quoted, then the note.
pub fn message(quote: &str, note: &str, section: &str) -> String {
    let quoted: Vec<String> = quote.split('\n').map(|l| format!("> {l}")).collect();
    let place = if section.is_empty() { String::new() } else { format!(" ({section})") };
    format!("Comment on the morning brief{place}:\n{}\n\n{note}", quoted.join("\n"))
}

fn clip(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

fn comments_file(dir: &Path, date: &str) -> PathBuf {
    dir.join(format!("{date}.json"))
}

fn load(dir: &Path, date: &str) -> Vec<Value> {
    std::fs::read(comments_file(dir, date))
        .ok()
        .and_then(|b| serde_json::from_slice::<Vec<Value>>(&b).ok())
        .unwrap_or_default()
}

fn save(dir: &Path, date: &str, list: &[Value]) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!(".{date}.json.tmp"));
    std::fs::write(&tmp, serde_json::to_vec_pretty(list).unwrap_or_default()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, comments_file(dir, date)).map_err(|e| e.to_string())
}

pub fn route(b: &dyn Backend, r: &Request) -> Response {
    if r.method == "OPTIONS" {
        return ok(json!({}));
    }
    // A page on another site cannot read the token, but turn it away before it is even checked.
    if let Some(origin) = r.header("origin") {
        if origin != "null" {
            return error(403, "Forbidden");
        }
    }
    match r.header("host") {
        Some(h) if h == format!("127.0.0.1:{PORT}") || h == format!("localhost:{PORT}") => {}
        _ => return error(403, "Forbidden"),
    }
    match r.header("x-brief-token") {
        Some(t) if constant_time_eq(t, b.token()) => {}
        _ => return error(401, "Unauthorized"),
    }
    let parts: Vec<&str> = r.path.split('?').next().unwrap_or("").split('/').filter(|p| !p.is_empty()).collect();
    if parts == ["review", "agent"] {
        return if r.method == "POST" { review_agent(b, &r.body) } else { error(404, "Not found") };
    }
    if parts.len() == 3 && parts[0] == "review" && parts[1] == "status" {
        if !valid_report(parts[2]) {
            return error(404, "Not found");
        }
        return match r.method.as_str() {
            "GET" => review_status_get(b, parts[2]),
            "POST" => review_status_set(b, parts[2], &r.body),
            _ => error(404, "Not found"),
        };
    }
    if parts.len() < 3 || parts[0] != "brief" || parts[2] != "comments" || !valid_date(parts[1]) {
        return error(404, "Not found");
    }
    let date = parts[1];
    let dir = b.store_dir();
    let _guard = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    match (r.method.as_str(), parts.len()) {
        ("GET", 3) => ok(json!({ "comments": load(&dir, date) })),
        ("POST", 3) => {
            let Ok(v) = serde_json::from_slice::<Value>(&r.body) else {
                return error(400, "quote and note are required");
            };
            let s = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
            let (quote, note, section) = (clip(&s("quote"), QUOTE_MAX), clip(s("note").trim(), NOTE_MAX), clip(&s("section"), SECTION_MAX));
            if quote.is_empty() || note.is_empty() {
                return error(400, "quote and note are required");
            }
            let result = b.deliver(date, &message(&quote, &note, &section));
            let mut c = json!({
                "id": b.new_id(), "quote": quote, "note": note, "section": section,
                "at": b.now_hhmm(), "sent": result.is_ok(),
            });
            if let Err(reason) = result {
                c["reason"] = json!(reason);
            }
            let mut list = load(&dir, date);
            list.push(c.clone());
            if let Err(e) = save(&dir, date, &list) {
                log::warn!("[brief] could not save the comment: {e}");
            }
            ok(json!({ "comment": c }))
        }
        ("DELETE", 4) => {
            let mut list = load(&dir, date);
            list.retain(|c| c.get("id").and_then(Value::as_str) != Some(parts[3]));
            match save(&dir, date, &list) {
                Ok(()) => ok(json!({ "ok": true })),
                Err(e) => error(500, &e),
            }
        }
        _ => error(404, "Not found"),
    }
}

// ---------------------------------------------------------------- review findings

/// What the agent is asked first: the finding, then the same rule as on a task (read, report,
/// ask before changing anything).
pub fn review_task(id: &str, title: &str, prompt: &str) -> String {
    format!(
        "Work on finding {id} \"{title}\" from the studio review report.\n\n{prompt}\n\n\
         First check that the finding still holds here (read the code or the notes it names). \
         Then tell me briefly what you found and how you would fix it, and ask me what to do. \
         Don't change anything before I answer."
    )
}

/// `review-d1-backups-skip-activities`: the id, then the title as lowercase ASCII words; at most 64.
pub fn review_name(id: &str, title: &str) -> String {
    let words: String = title
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect();
    let words: Vec<&str> = words.split('-').filter(|w| !w.is_empty()).collect();
    let mut name = format!("review-{}", id.to_ascii_lowercase());
    if !words.is_empty() {
        name = format!("{name}-{}", words.join("-"));
    }
    let name: String = name.chars().take(64).collect();
    name.trim_end_matches('-').to_string()
}

fn valid_review_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= REVIEW_ID_MAX
        && id.starts_with(|c: char| c.is_ascii_alphanumeric())
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// An absolute folder with no `..` (the start also requires Claude Code to trust it).
fn valid_review_folder(f: &str) -> bool {
    f.starts_with('/') && f.len() <= REVIEW_FOLDER_MAX && !f.split('/').any(|p| p == "..") && !f.contains('\0')
}

fn review_agent(b: &dyn Backend, body: &[u8]) -> Response {
    const REQUIRED: &str = "id, title, folder and prompt are required";
    let Ok(v) = serde_json::from_slice::<Value>(body) else {
        return error(400, REQUIRED);
    };
    let s = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").trim().to_string();
    let (id, title, folder, prompt, report) = (s("id"), s("title"), s("folder"), s("prompt"), s("report"));
    if !valid_review_id(&id) {
        return error(400, "Invalid finding id");
    }
    if title.is_empty() || prompt.is_empty() {
        return error(400, REQUIRED);
    }
    if !valid_review_folder(&folder) {
        return error(400, "Invalid folder");
    }
    if !report.is_empty() && !valid_report(&report) {
        return error(400, "Invalid report name");
    }
    let title = clip(&title.replace(['\n', '\r'], " "), REVIEW_TITLE_MAX);
    let prompt = clip(&prompt, REVIEW_PROMPT_MAX);
    {
        let mut busy = REVIEW_IN_FLIGHT.lock().unwrap_or_else(|e| e.into_inner());
        if busy.contains(&id) {
            return error(409, "An agent is already starting on this finding");
        }
        busy.push(id.clone());
    }
    let result = b.start_agent(&folder, &review_task(&id, &title, &prompt), &review_name(&id, &title));
    REVIEW_IN_FLIGHT.lock().unwrap_or_else(|e| e.into_inner()).retain(|x| x != &id);
    match result {
        Ok(agent) => {
            if !report.is_empty() {
                let dir = b.review_dir();
                let _guard = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
                let mut all = review_load(&dir, &report);
                let mut entry = all.get(&id).cloned().unwrap_or_else(|| json!({ "status": "open" }));
                if matches!(entry["status"].as_str(), Some("open") | None) {
                    entry["status"] = json!("in_progress");
                    entry["at"] = json!(b.now_stamp());
                }
                entry["agent"] = json!(agent);
                entry["agent_at"] = json!(b.now_stamp());
                all.insert(id, entry);
                if let Err(e) = review_save(&dir, &report, &all) {
                    log::warn!("[review] could not save the status: {e}");
                }
            }
            ok(json!({ "agent": agent }))
        }
        Err(reason) => error(502, &reason),
    }
}

/// A report's file name without `.json`: letters, digits, `.`, `_` and `-`, not starting with `.`.
fn valid_report(r: &str) -> bool {
    !r.is_empty()
        && r.len() <= REVIEW_REPORT_MAX
        && !r.starts_with('.')
        && r.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

fn review_file(dir: &Path, report: &str) -> PathBuf {
    dir.join(format!("{report}.json"))
}

fn review_load(dir: &Path, report: &str) -> serde_json::Map<String, Value> {
    std::fs::read(review_file(dir, report))
        .ok()
        .and_then(|b| serde_json::from_slice::<serde_json::Map<String, Value>>(&b).ok())
        .unwrap_or_default()
}

fn review_save(dir: &Path, report: &str, all: &serde_json::Map<String, Value>) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!(".{report}.json.tmp"));
    std::fs::write(&tmp, serde_json::to_vec_pretty(all).unwrap_or_default()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, review_file(dir, report)).map_err(|e| e.to_string())
}

fn review_status_get(b: &dyn Backend, report: &str) -> Response {
    let mut all = {
        let _guard = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        review_load(&b.review_dir(), report)
    };
    if all.values().any(|e| e.get("agent").is_some()) {
        let groups = b.agent_groups();
        for e in all.values_mut() {
            if let Some(a) = e.get("agent").and_then(Value::as_str).map(str::to_string) {
                let g = groups.iter().find(|(id, _)| *id == a).map(|(_, g)| g.as_str()).unwrap_or("gone");
                e["agent_state"] = json!(g);
            }
        }
    }
    ok(json!({ "findings": all }))
}

fn review_status_set(b: &dyn Backend, report: &str, body: &[u8]) -> Response {
    let Ok(v) = serde_json::from_slice::<Value>(body) else {
        return error(400, "id and status are required");
    };
    let s = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").trim().to_string();
    let (id, status) = (s("id"), s("status"));
    if !valid_review_id(&id) {
        return error(400, "Invalid finding id");
    }
    if !REVIEW_STATUSES.contains(&status.as_str()) {
        return error(400, "Status must be open, in_progress, fixed or accepted");
    }
    let dir = b.review_dir();
    let _guard = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut all = review_load(&dir, report);
    let mut entry = all.get(&id).cloned().unwrap_or_else(|| json!({}));
    entry["status"] = json!(status);
    entry["at"] = json!(b.now_stamp());
    all.insert(id, entry.clone());
    match review_save(&dir, report, &all) {
        Ok(()) => ok(json!({ "finding": entry })),
        Err(e) => error(500, &e),
    }
}

/// The morning agent for `date`: a background agent with the routine's name, started that day
/// (local time). The newest if there are several.
pub fn pick_agent<'a>(agents: &'a [Agent], date: &str) -> Option<&'a Agent> {
    agents
        .iter()
        .filter(|a| a.kind == Kind::Background && AGENT_NAMES.contains(&a.name.as_str()))
        .filter(|a| started_on(a.started_at) == date)
        .max_by_key(|a| a.started_at)
}

fn started_on(ms: i64) -> String {
    use chrono::TimeZone;
    chrono::Local.timestamp_millis_opt(ms).single().map(|d| d.format("%Y-%m-%d").to_string()).unwrap_or_default()
}

// ---------------------------------------------------------------- the server

struct AppBackend {
    app: tauri::AppHandle,
    token: String,
    dir: PathBuf,
}

impl Backend for AppBackend {
    fn token(&self) -> &str {
        &self.token
    }
    fn store_dir(&self) -> PathBuf {
        self.dir.join(COMMENTS_DIR)
    }
    fn deliver(&self, date: &str, text: &str) -> Result<(), String> {
        let state = self.app.try_state::<super::AgentsState>().ok_or("StudioManager is starting")?;
        let login = super::actions::ready(&state)?;
        let cli = super::actions::cli(&login)?;
        let agents = super::actions::fetch_agents(&cli)?;
        let agent = pick_agent(&agents, date).ok_or_else(|| format!("No morning agent running for {date}"))?;
        super::pty::send_message(&state.hub, agent, text)
    }
    fn now_hhmm(&self) -> String {
        chrono::Local::now().format("%H:%M").to_string()
    }
    fn new_id(&self) -> String {
        let mut b = [0u8; 4];
        let _ = std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut b));
        b.iter().map(|x| format!("{x:02x}")).collect()
    }
    fn start_agent(&self, folder: &str, task: &str, name: &str) -> Result<String, String> {
        let state = self.app.try_state::<super::AgentsState>().ok_or("StudioManager is starting")?;
        let login = super::actions::ready(&state)?;
        let cli = super::actions::cli(&login)?;
        let trusted = super::projects::read_trusted(&super::actions::home_dir());
        let short_id = super::actions::start(&cli, &trusted, folder, task, "opus", name)?;
        // Like "Start work with agent" on a task: open the new agent on the Agents page.
        let app = self.app.clone();
        let path = format!("/agents?started={short_id}");
        let _ = self.app.run_on_main_thread(move || {
            crate::menubar::show_main(&app);
            let _ = app.emit_to("main", crate::menubar::NAVIGATE_EVENT, json!({ "path": path }));
        });
        Ok(short_id)
    }
    fn review_dir(&self) -> PathBuf {
        self.dir.join(REVIEW_DIR)
    }
    fn agent_groups(&self) -> Vec<(String, String)> {
        use super::model::Group;
        let Some(state) = self.app.try_state::<super::AgentsState>() else { return vec![] };
        state
            .cached()
            .into_iter()
            .filter_map(|a| {
                let g = match a.group {
                    Group::Working => "working",
                    Group::NeedsYou => "needs_you",
                    Group::Idle => "idle",
                    Group::Done => "done",
                };
                Some((a.short_id?, g.to_string()))
            })
            .collect()
    }
    fn now_stamp(&self) -> String {
        chrono::Local::now().format("%Y-%m-%d %H:%M").to_string()
    }
}

fn serve(b: &dyn Backend, mut s: TcpStream) {
    let _ = s.set_read_timeout(Some(Duration::from_secs(5)));
    let mut buf = Vec::new();
    let mut chunk = [0u8; 8192];
    let req = loop {
        match s.read(&mut chunk) {
            Ok(0) | Err(_) => return,
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
        }
        match parse(&buf) {
            Parse::Done(r) => break r,
            Parse::Partial => continue,
            Parse::Bad => return,
        }
    };
    let _ = s.write_all(&encode(&route(b, &req)));
}

/// Starts the server on its own thread, once; logs and gives up if the port is taken.
/// Called at launch when Agents is on, and when the Agents switch is turned on.
pub fn start(app: &tauri::AppHandle) {
    if STARTED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let dir = crate::app_data_dir(app).unwrap_or_default();
    let token = match token(&dir) {
        Ok(t) => t,
        Err(e) => {
            log::warn!("[brief] no token, comments server not started: {e}");
            return;
        }
    };
    let listener = match TcpListener::bind(("127.0.0.1", PORT)) {
        Ok(l) => l,
        Err(e) => {
            log::warn!("[brief] comments server not started on port {PORT}: {e}");
            return;
        }
    };
    let backend = std::sync::Arc::new(AppBackend { app: app.clone(), token, dir });
    let spawned = std::thread::Builder::new().name("brief-comments".into()).spawn(move || {
        for stream in listener.incoming().flatten() {
            let b = backend.clone();
            // Sending to the agent can take a few seconds: one thread per request.
            let _ = std::thread::Builder::new().name("brief-request".into()).spawn(move || serve(b.as_ref(), stream));
        }
    });
    if let Err(e) = spawned {
        log::warn!("[brief] could not start the comments server: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct Fake {
        dir: PathBuf,
        result: Result<(), String>,
        sent: RefCell<Vec<(String, String)>>,
    }

    impl Backend for Fake {
        fn token(&self) -> &str {
            "abc123abc123abc123abc123abc123ab"
        }
        fn store_dir(&self) -> PathBuf {
            self.dir.clone()
        }
        fn deliver(&self, date: &str, text: &str) -> Result<(), String> {
            self.sent.borrow_mut().push((date.into(), text.into()));
            self.result.clone()
        }
        fn now_hhmm(&self) -> String {
            "08:15".into()
        }
        fn new_id(&self) -> String {
            format!("id{}", self.sent.borrow().len())
        }
        fn start_agent(&self, folder: &str, task: &str, name: &str) -> Result<String, String> {
            self.sent.borrow_mut().push((format!("{folder} {name}"), task.into()));
            self.result.clone().map(|_| "abcd1234".to_string())
        }
        fn review_dir(&self) -> PathBuf {
            self.dir.join("review")
        }
        fn agent_groups(&self) -> Vec<(String, String)> {
            vec![("abcd1234".into(), "needs_you".into())]
        }
        fn now_stamp(&self) -> String {
            "2026-11-06 09:40".into()
        }
    }

    fn fake(name: &str, result: Result<(), String>) -> Fake {
        let dir = std::env::temp_dir().join(format!("sm-brief-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        Fake { dir, result, sent: RefCell::new(vec![]) }
    }

    fn req(method: &str, path: &str, token: Option<&str>, body: &str) -> Request {
        let mut headers = vec![("host".into(), format!("127.0.0.1:{PORT}")), ("origin".into(), "null".into())];
        if let Some(t) = token {
            headers.push(("x-brief-token".into(), t.into()));
        }
        Request { method: method.into(), path: path.into(), headers, body: body.as_bytes().to_vec() }
    }

    const T: Option<&str> = Some("abc123abc123abc123abc123abc123ab");

    #[test]
    fn post_sends_the_comment_to_the_agent_and_stores_it() {
        let b = fake("post", Ok(()));
        let r = route(&b, &req("POST", "/brief/2026-11-01/comments", T, r#"{"quote":"Line one\nline two","note":" look deeper ","section":"Reading: X"}"#));
        assert_eq!(r.status, 200);
        assert_eq!(r.body["comment"]["sent"], true);
        assert_eq!(r.body["comment"]["note"], "look deeper");
        assert_eq!(
            b.sent.borrow()[0],
            ("2026-11-01".into(), "Comment on the morning brief (Reading: X):\n> Line one\n> line two\n\nlook deeper".into())
        );
        let list = route(&b, &req("GET", "/brief/2026-11-01/comments", T, ""));
        assert_eq!(list.body["comments"].as_array().unwrap().len(), 1);
        let id = r.body["comment"]["id"].as_str().unwrap().to_string();
        assert_eq!(route(&b, &req("DELETE", &format!("/brief/2026-11-01/comments/{id}"), T, "")).status, 200);
        assert!(route(&b, &req("GET", "/brief/2026-11-01/comments", T, "")).body["comments"].as_array().unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&b.dir);
    }

    #[test]
    fn a_failed_send_is_kept_with_its_reason() {
        let b = fake("fail", Err("No morning agent running for 2026-11-01".into()));
        let r = route(&b, &req("POST", "/brief/2026-11-01/comments", T, r#"{"quote":"q","note":"n"}"#));
        assert_eq!(r.body["comment"]["sent"], false);
        assert_eq!(r.body["comment"]["reason"], "No morning agent running for 2026-11-01");
        let _ = std::fs::remove_dir_all(&b.dir);
    }

    #[test]
    fn refuses_without_the_token_from_another_site_or_host() {
        let b = fake("auth", Ok(()));
        assert_eq!(route(&b, &req("GET", "/brief/2026-11-01/comments", None, "")).status, 401);
        assert_eq!(route(&b, &req("GET", "/brief/2026-11-01/comments", Some("wrong"), "")).status, 401);
        let mut r = req("GET", "/brief/2026-11-01/comments", T, "");
        r.headers[1].1 = "https://evil.example".into();
        assert_eq!(route(&b, &r).status, 403);
        let mut r = req("GET", "/brief/2026-11-01/comments", T, "");
        r.headers[0].1 = "evil.example:47480".into();
        assert_eq!(route(&b, &r).status, 403);
        // the preflight carries no token
        assert_eq!(route(&b, &req("OPTIONS", "/brief/2026-11-01/comments", None, "")).status, 200);
        assert!(b.sent.borrow().is_empty());
    }

    #[test]
    fn rejects_bad_paths_and_empty_notes() {
        let b = fake("bad", Ok(()));
        assert_eq!(route(&b, &req("GET", "/brief/../../etc/comments", T, "")).status, 404);
        assert_eq!(route(&b, &req("GET", "/brief/2026-1-01/comments", T, "")).status, 404);
        assert_eq!(route(&b, &req("POST", "/brief/2026-11-01/comments", T, r#"{"quote":"q","note":"  "}"#)).status, 400);
        assert_eq!(route(&b, &req("POST", "/brief/2026-11-01/comments", T, "not json")).status, 400);
        assert!(b.sent.borrow().is_empty());
    }

    #[test]
    fn review_agent_starts_on_the_finding_in_its_folder() {
        let b = fake("review", Ok(()));
        let body = r#"{"id":"D1","title":"Backups skip activities, and a restore loses them","folder":"/Users/x/StudioManager","prompt":"Evidence: backup.ts:59"}"#;
        let r = route(&b, &req("POST", "/review/agent", T, body));
        assert_eq!(r.status, 200, "{:?}", r.body);
        assert_eq!(r.body["agent"], "abcd1234");
        let (target, task) = b.sent.borrow()[0].clone();
        assert_eq!(target, "/Users/x/StudioManager review-d1-backups-skip-activities-and-a-restore-loses-them");
        assert!(task.starts_with("Work on finding D1 \"Backups skip activities, and a restore loses them\""), "{task}");
        assert!(task.contains("Evidence: backup.ts:59"));
        assert!(task.ends_with("Don't change anything before I answer."));
        assert!(!REVIEW_IN_FLIGHT.lock().unwrap().contains(&"D1".to_string()), "released after the start");
    }

    #[test]
    fn review_agent_reports_why_the_start_failed() {
        let b = fake("review-fail", Err("Folder not trusted: open it once with Claude Code first".into()));
        let body = r#"{"id":"N-R2","title":"t","folder":"/a/b","prompt":"p"}"#;
        let r = route(&b, &req("POST", "/review/agent", T, body));
        assert_eq!(r.status, 502);
        assert_eq!(r.body["error"], "Folder not trusted: open it once with Claude Code first");
    }

    #[test]
    fn review_agent_needs_the_token_and_valid_fields() {
        let b = fake("review-bad", Ok(()));
        let good = r#"{"id":"X9","title":"t","folder":"/a/b","prompt":"p"}"#;
        assert_eq!(route(&b, &req("POST", "/review/agent", None, good)).status, 401);
        assert_eq!(route(&b, &req("GET", "/review/agent", T, "")).status, 404);
        for body in [
            r#"{"id":"","title":"t","folder":"/a/b","prompt":"p"}"#,
            r#"{"id":"-rf","title":"t","folder":"/a/b","prompt":"p"}"#,
            r#"{"id":"D1 x","title":"t","folder":"/a/b","prompt":"p"}"#,
            r#"{"id":"D1","title":"t","folder":"relative/b","prompt":"p"}"#,
            r#"{"id":"D1","title":"t","folder":"/a/../etc","prompt":"p"}"#,
            r#"{"id":"D1","title":"t","folder":"/a/b","prompt":"   "}"#,
            "not json",
        ] {
            assert_eq!(route(&b, &req("POST", "/review/agent", T, body)).status, 400, "{body}");
        }
        assert!(b.sent.borrow().is_empty());
    }

    #[test]
    fn review_status_is_kept_per_report_and_shows_the_agent_state() {
        let b = fake("status", Ok(()));
        let path = "/review/status/2026-11-05-studio-review";
        assert_eq!(route(&b, &req("GET", path, T, "")).body, json!({ "findings": {} }));

        let start = r#"{"id":"D7","title":"t","folder":"/a/b","prompt":"p","report":"2026-11-05-studio-review"}"#;
        assert_eq!(route(&b, &req("POST", "/review/agent", T, start)).status, 200);
        let got = route(&b, &req("GET", path, T, "")).body;
        assert_eq!(got["findings"]["D7"]["status"], "in_progress");
        assert_eq!(got["findings"]["D7"]["agent"], "abcd1234");
        assert_eq!(got["findings"]["D7"]["agent_state"], "needs_you");

        let r = route(&b, &req("POST", path, T, r#"{"id":"D7","status":"fixed"}"#));
        assert_eq!(r.status, 200);
        assert_eq!(r.body["finding"]["status"], "fixed");
        assert_eq!(r.body["finding"]["agent"], "abcd1234", "the agent is kept");
        // another agent on a fixed finding leaves it fixed
        assert_eq!(route(&b, &req("POST", "/review/agent", T, start)).status, 200);
        assert_eq!(route(&b, &req("GET", path, T, "")).body["findings"]["D7"]["status"], "fixed");
        assert_eq!(route(&b, &req("POST", path, T, r#"{"id":"N-S2","status":"accepted"}"#)).status, 200);
        let got = route(&b, &req("GET", path, T, "")).body;
        assert_eq!(got["findings"]["N-S2"]["status"], "accepted");
        assert!(got["findings"]["N-S2"].get("agent_state").is_none());
        // other reports are separate
        let other = route(&b, &req("GET", "/review/status/other-report", T, "")).body;
        assert_eq!(other, json!({ "findings": {} }));
        let _ = std::fs::remove_dir_all(&b.dir);
    }

    #[test]
    fn review_status_refuses_bad_input() {
        let b = fake("status-bad", Ok(()));
        let path = "/review/status/r1";
        assert_eq!(route(&b, &req("GET", path, None, "")).status, 401);
        for bad in ["/review/status/..", "/review/status/.hidden", "/review/status/a%2Fb", "/review/status/a b"] {
            assert_eq!(route(&b, &req("GET", bad, T, "")).status, 404, "{bad}");
        }
        assert_eq!(route(&b, &req("POST", path, T, r#"{"id":"D1","status":"done"}"#)).status, 400);
        assert_eq!(route(&b, &req("POST", path, T, r#"{"id":"../x","status":"fixed"}"#)).status, 400);
        assert_eq!(route(&b, &req("POST", path, T, "nope")).status, 400);
        assert_eq!(route(&b, &req("DELETE", path, T, "")).status, 404);
        let bad_report = r#"{"id":"D1","title":"t","folder":"/a/b","prompt":"p","report":"../x"}"#;
        assert_eq!(route(&b, &req("POST", "/review/agent", T, bad_report)).status, 400);
        assert!(!b.dir.join("review").exists());
    }

    #[test]
    fn review_names_are_valid_agent_names() {
        assert_eq!(review_name("N-S2", "Unbound 1.22: Critical CVEs!"), "review-n-s2-unbound-1-22-critical-cves");
        assert_eq!(review_name("D1", "   "), "review-d1");
        let long = review_name("D19", &"word ".repeat(40));
        assert!(long.len() <= 64 && !long.ends_with('-'));
        for n in [review_name("A1", "été ça"), long] {
            assert!(crate::agents::validate::valid_name(&n), "{n}");
        }
    }

    #[test]
    fn parses_a_request_once_the_body_is_in() {
        let raw = b"POST /brief/2026-11-01/comments HTTP/1.1\r\nHost: 127.0.0.1:47480\r\nContent-Length: 4\r\nX-Brief-Token: t\r\n\r\n{\"a\"";
        assert!(matches!(parse(&raw[..raw.len() - 2]), Parse::Partial));
        let Parse::Done(r) = parse(raw) else { panic!() };
        assert_eq!(r.method, "POST");
        assert_eq!(r.header("x-brief-token"), Some("t"));
        assert_eq!(r.body, b"{\"a\"");
        assert!(matches!(parse(b"GET / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n"), Parse::Bad));
        assert!(matches!(parse(b"GET / HTTP/1.1\r\nContent-Length: 999999999\r\n\r\n"), Parse::Bad));
    }

    #[test]
    fn picks_the_morning_agent_started_that_day() {
        let list = r#"[
            {"sessionId":"00000000-0000-4000-8000-000000000001","id":"a1","name":"personal-sod","kind":"background","status":"idle","startedAt":START1,"cwd":"/b"},
            {"sessionId":"00000000-0000-4000-8000-000000000002","id":"a2","name":"personal-sod","kind":"background","status":"idle","startedAt":START2,"cwd":"/b"},
            {"sessionId":"00000000-0000-4000-8000-000000000003","id":"a3","name":"other","kind":"background","status":"idle","startedAt":START2,"cwd":"/b"}
        ]"#;
        use chrono::TimeZone;
        let at = |m: u32, d: u32| chrono::Local.with_ymd_and_hms(2026, m, d, 8, 0, 0).unwrap().timestamp_millis();
        let json = list.replace("START1", &at(10, 31).to_string()).replace("START2", &at(11, 1).to_string());
        let agents = crate::agents::model::parse_agents(&json).unwrap();
        let id = |date: &str| pick_agent(&agents, date).and_then(|a| a.short_id.clone());
        assert_eq!(id("2026-11-01").as_deref(), Some("a2"));
        assert_eq!(id("2026-10-31").as_deref(), Some("a1"));
        assert_eq!(id("2026-10-30"), None);
    }

    #[test]
    fn answers_over_a_real_socket_with_cors_headers() {
        let l = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let addr = l.local_addr().unwrap();
        let b = fake("socket", Ok(()));
        let body = r#"{"quote":"q","note":"n"}"#;
        let mut c = TcpStream::connect(addr).unwrap();
        write!(
            c,
            "POST /brief/2026-11-01/comments HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nOrigin: null\r\nX-Brief-Token: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
            T.unwrap(),
            body.len()
        )
        .unwrap();
        let (s, _) = l.accept().unwrap();
        serve(&b, s);
        let mut out = String::new();
        c.read_to_string(&mut out).unwrap();
        assert!(out.starts_with("HTTP/1.1 200 OK\r\n"), "{out}");
        assert!(out.contains("Access-Control-Allow-Origin: null\r\n"));
        assert!(out.contains(r#""sent":true"#));
        assert_eq!(b.sent.borrow().len(), 1);
        let _ = std::fs::remove_dir_all(&b.dir);
    }

    #[test]
    fn token_is_created_once_and_kept() {
        let dir = std::env::temp_dir().join(format!("sm-brief-token-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let a = token(&dir).unwrap();
        assert_eq!(a.len(), 48);
        assert_eq!(token(&dir).unwrap(), a);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
