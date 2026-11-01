//! The personal morning brief's comments: a small HTTP server on 127.0.0.1:47480 (taken over
//! from AgentBar, retired 2026-10-29). The brief is a local HTML page; select a passage, write a
//! note, Send, and the comment is typed into the morning agent, which answers in its chat.
//!
//!   GET    /brief/<date>/comments
//!   POST   /brief/<date>/comments        {quote, note, section}  -> stored, then sent to the agent
//!   DELETE /brief/<date>/comments/<id>
//!
//! Only once the Agents switch is on (then until StudioManager quits); loopback only. Every request needs the token from `<app dir>/brief-token`, which the page
//! renderer (studio-tools/brief/personal_brief.py) writes into the page. Comments are kept per
//! day in `<app dir>/brief-comments/<date>.json`.

use super::model::{Agent, Kind};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

pub const PORT: u16 = 47480;
const TOKEN_FILE: &str = "brief-token";
const COMMENTS_DIR: &str = "brief-comments";
/// The agent the Start of day routine starts, and the name AgentBar gave it.
const AGENT_NAMES: [&str; 1] = ["personal-sod"];
const MAX_REQUEST: usize = 64 * 1024;
const QUOTE_MAX: usize = 1000;
const NOTE_MAX: usize = 2000;
const SECTION_MAX: usize = 80;

static STORE_LOCK: Mutex<()> = Mutex::new(());
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
