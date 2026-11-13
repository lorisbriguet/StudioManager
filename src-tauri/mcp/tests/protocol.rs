//! End-to-end check of the stdio server: raw newline-delimited JSON-RPC
//! against the real binary, with a seeded temp data dir.

// The library's fixtures, compiled into this test crate (they are
// `cfg(test)`-only inside the library). They reach `crate::migrate` and
// `crate::orgs` through the imports below.
use studiomanager_mcp::{migrate, orgs};

#[allow(dead_code)]
#[path = "../src/test_support.rs"]
mod test_support;

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::time::Duration;

struct Server {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<String>,
    next_id: i64,
}

impl Server {
    fn start(dir: &Path) -> Server {
        Server::start_with(dir, None)
    }

    fn start_with(dir: &Path, tools: Option<&str>) -> Server {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_studiomanager-mcp"));
        cmd.env_remove("STUDIOMANAGER_TOOLS");
        if let Some(t) = tools {
            cmd.env("STUDIOMANAGER_TOOLS", t);
        }
        let mut child = cmd
            .env("STUDIOMANAGER_DATA_DIR", dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn server");
        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let (tx, lines) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        Server {
            child,
            stdin,
            lines,
            next_id: 1,
        }
    }

    fn send(&mut self, msg: Value) {
        let mut raw = serde_json::to_string(&msg).unwrap();
        raw.push('\n');
        self.stdin.write_all(raw.as_bytes()).unwrap();
        self.stdin.flush().unwrap();
    }

    /// Send a request and wait for the response with its id (notifications
    /// the server sends meanwhile are skipped).
    fn request(&mut self, method: &str, params: Value) -> Value {
        let id = self.next_id;
        self.next_id += 1;
        self.send(json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}));
        loop {
            let line = self
                .lines
                .recv_timeout(Duration::from_secs(20))
                .unwrap_or_else(|_| panic!("no response to {method}"));
            let msg: Value = serde_json::from_str(&line).expect("server wrote non-JSON");
            if msg["id"] == json!(id) {
                return msg;
            }
        }
    }

    fn initialize(&mut self) -> Value {
        let res = self.request(
            "initialize",
            json!({
                "protocolVersion": "2025-11-25",
                "capabilities": {},
                "clientInfo": {"name": "protocol-test", "version": "0"}
            }),
        );
        self.send(json!({"jsonrpc": "2.0", "method": "notifications/initialized"}));
        res
    }

    fn call(&mut self, tool: &str, args: Value) -> Value {
        let res = self.request("tools/call", json!({"name": tool, "arguments": args}));
        assert!(res.get("error").is_none(), "{tool}: protocol error {res}");
        res["result"].clone()
    }

    fn tool_names(&mut self) -> Vec<String> {
        let res = self.request("tools/list", json!({}));
        res["result"]["tools"]
            .as_array()
            .expect("tools array")
            .iter()
            .map(|t| t["name"].as_str().unwrap().to_string())
            .collect()
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn text_of(result: &Value) -> String {
    result["content"][0]["text"]
        .as_str()
        .unwrap_or("")
        .to_string()
}

fn seeded(allow_money: bool) -> std::path::PathBuf {
    let dir = test_support::ready_dir("org-a", "Studio A");
    test_support::allow_listed(&dir, allow_money, &[]);
    let conn = rusqlite::Connection::open(test_support::db_path(&dir, "org-a")).unwrap();
    conn.execute_batch(
        "INSERT INTO clients (id, name) VALUES ('C-001', 'Atelier Lumen');
         INSERT INTO projects (id, client_id, name) VALUES (1, 'C-001', 'Identity');",
    )
    .unwrap();
    dir
}

/// The Upkeep tools. 3.3.0 shipped without them (their branch was never
/// merged): this list makes a release that drops one fail its tests.
const UPKEEP_TOOLS: [&str; 14] = [
    "list_machines",
    "get_machine",
    "list_consumables",
    "list_subscriptions",
    "add_service_log",
    "add_machine_link",
    "create_machine",
    "update_machine",
    "add_upkeep_item",
    "mark_upkeep_done",
    "create_consumable",
    "update_consumable",
    "create_subscription",
    "update_subscription",
];

const MONEY_TOOLS: [&str; 5] = [
    "list_invoices",
    "get_invoice",
    "list_quotes",
    "list_expenses",
    "pnl_summary",
];

const CAPTURE_TOOLS: [&str; 7] = [
    "capture",
    "list_captures",
    "file_capture",
    "set_brief",
    "report_result",
    "ask",
    "list_needs_you",
];

const LEAD_TOOLS: [&str; 3] = ["get_needs_you", "resolve", "hand_over"];

#[test]
fn stdio_round_trip() {
    let dir = seeded(true);
    let mut server = Server::start(&dir);

    let init = server.initialize();
    let info = &init["result"];
    assert!(info["capabilities"]["tools"].is_object(), "{init}");
    let instructions = info["instructions"].as_str().unwrap_or("");
    assert!(instructions.contains("organisation"), "{instructions}");
    assert!(instructions.lines().count() <= 8);

    let names = server.tool_names();
    assert_eq!(names.len(), 47, "{names:?}");
    for t in MONEY_TOOLS.iter().chain(UPKEEP_TOOLS.iter()).chain(CAPTURE_TOOLS.iter()) {
        assert!(names.iter().any(|n| n == t), "missing {t}");
    }

    let created = server.call(
        "create_task",
        json!({"project": "Identity", "title": "Draft the logo", "due_date": "2026-11-02"}),
    );
    assert_ne!(created["isError"], json!(true), "{created}");
    let task: Value = serde_json::from_str(&text_of(&created)).unwrap();
    assert_eq!(task["title"], "Draft the logo");
    let task_id = task["id"].as_i64().unwrap();

    let project = server.call("get_project", json!({"project": "Identity"}));
    assert_ne!(project["isError"], json!(true), "{project}");
    let detail: Value = serde_json::from_str(&text_of(&project)).unwrap();
    assert_eq!(detail["org"], "Studio A");
    let tasks = detail["tasks"].as_array().unwrap();
    assert!(
        tasks
            .iter()
            .any(|t| t["id"] == json!(task_id) && t["title"] == "Draft the logo"),
        "{detail}"
    );

    let bad = server.call(
        "update_task",
        json!({"task_id": task_id, "calendar_event_id": "x"}),
    );
    assert_eq!(bad["isError"], json!(true), "{bad}");
    assert!(text_of(&bad).contains("calendar_event_id"), "{bad}");

    // Money is off now: the tools are still listed (startup decides), but
    // each call checks again.
    test_support::allow_listed(&dir, false, &[]);
    let refused = server.call("list_invoices", json!({}));
    assert_eq!(refused["isError"], json!(true), "{refused}");
    assert_eq!(text_of(&refused), studiomanager_mcp::money::MONEY_OFF);
}

#[test]
fn report_result_is_not_listed_in_the_brief_session() {
    let dir = seeded(true);
    let brief = "list_captures,file_capture,list_projects,get_project,list_tasks,list_wiki,get_wiki_article";
    let mut server = Server::start_with(&dir, Some(brief));
    server.initialize();
    let names = server.tool_names();
    assert_eq!(names.len(), 7, "{names:?}");
    assert!(!names.iter().any(|n| n == "report_result"), "{names:?}");
}

#[test]
fn lead_tools_are_listed_and_called_only_when_named() {
    let dir = seeded(true);
    let mut server = Server::start(&dir);
    server.initialize();
    let names = server.tool_names();
    for t in LEAD_TOOLS {
        assert!(!names.iter().any(|n| n == t), "{t} listed");
    }
    let res = server.request("tools/call", json!({"name": "resolve", "arguments": {"needs_you_id": 1, "answer": "a", "reason": "r"}}));
    assert!(res.get("error").is_some(), "{res}");
    assert!(res.to_string().contains("not available in this session"), "{res}");

    let mut lead = Server::start_with(&dir, Some("get_needs_you,resolve,hand_over"));
    lead.initialize();
    let mut names = lead.tool_names();
    names.sort();
    assert_eq!(names, vec!["get_needs_you", "hand_over", "resolve"]);
    let missing = lead.call("get_needs_you", json!({"id": 999}));
    assert_eq!(missing["isError"], json!(true), "{missing}");
    assert!(text_of(&missing).contains("No entry with id 999"), "{missing}");
}

#[test]
fn money_tools_hidden_when_off_at_startup() {
    let dir = seeded(false);
    let mut server = Server::start(&dir);
    server.initialize();
    let names = server.tool_names();
    assert_eq!(names.len(), 42, "{names:?}");
    for t in MONEY_TOOLS {
        assert!(!names.iter().any(|n| n == t), "{t} listed");
    }
    for t in UPKEEP_TOOLS.iter().chain(CAPTURE_TOOLS.iter()) {
        assert!(names.iter().any(|n| n == t), "missing {t}");
    }
}

#[test]
fn errors_are_tool_errors_with_exact_text() {
    let dir = seeded(false);
    test_support::write_access(&dir, r#"{"enabled": false}"#);
    let mut server = Server::start(&dir);
    server.initialize();

    let off = server.call("list_projects", json!({}));
    assert_eq!(off["isError"], json!(true));
    assert_eq!(text_of(&off), studiomanager_mcp::guard::OFF_OVERALL);

    let orgs_off = server.call("list_organisations", json!({}));
    assert_eq!(orgs_off["isError"], json!(true), "{orgs_off}");
    assert_eq!(text_of(&orgs_off), studiomanager_mcp::guard::OFF_OVERALL);

    // Access on: "Studio B" is allowed but never opened by the app, "Hidden
    // Studio" is switched off and must not appear anywhere.
    test_support::write_registry(
        &dir,
        &[
            ("org-a", "Studio A"),
            ("org-b", "Studio B"),
            ("org-c", "Hidden Studio"),
        ],
    );
    test_support::allow_listed(&dir, false, &["org-c"]);

    let orgs = server.call("list_organisations", json!({}));
    assert_ne!(orgs["isError"], json!(true), "{orgs}");
    assert!(!text_of(&orgs).contains("Hidden Studio"), "{orgs}");
    let body: Value = serde_json::from_str(&text_of(&orgs)).unwrap();
    let list = body["organisations"].as_array().unwrap();
    assert_eq!(list.len(), 2, "{body}");
    assert_eq!(list[0]["name"], "Studio A");
    assert_eq!(list[0]["active"], json!(true));
    assert_eq!(list[1]["active"], json!(false));
    assert!(list[0].get("allowed").is_none());

    // A named organisation that cannot be opened: the guard's exact text.
    let due = server.call("whats_due", json!({"org": "Studio B"}));
    assert_eq!(due["isError"], json!(true), "{due}");
    assert_eq!(text_of(&due), studiomanager_mcp::guard::NOT_OPENED);

    // Across every organisation it is listed under errors instead.
    let found = server.call("find_project_for_folder", json!({"path": "/nowhere"}));
    assert_ne!(found["isError"], json!(true), "{found}");
    let body: Value = serde_json::from_str(&text_of(&found)).unwrap();
    assert_eq!(body["project"], Value::Null);
    let errors = body["errors"].as_array().unwrap();
    assert_eq!(errors.len(), 1, "{body}");
    assert_eq!(errors[0]["org"], "Studio B");
    assert_eq!(errors[0]["error"], studiomanager_mcp::guard::NOT_OPENED);
    assert!(!text_of(&found).contains("Hidden Studio"));
}
