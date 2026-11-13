use super::super::git::fake::FakeGit;
use super::super::tests::{app, db_of, deps, T0};
use super::super::{acquire_lock, tick, Memory, Report};
use super::*;
use crate::agents::cli::{write_settings, AgentsSettings, Cli, CliOutput};
use crate::agents::links::ItemKind;
use crate::agents::model::parse_agents;
use crate::agents::validate::{valid_name, valid_task};
use rusqlite::{params, Connection};
use std::sync::{Arc, Mutex};

const MIN: i64 = 60_000;
const MCP: &str = "/opt/app/studiomanager-mcp";
const WORKER_SID: &str = "00000000-1111-2222-3333-444444444444";
const LEAD_SHORT: &str = "deadbeef";

// ------------------------------------------------------------ pure pieces

fn link(org: &str, id: i64, q: i64, c: i64) -> WatcherLink {
    WatcherLink {
        org: org.into(),
        id,
        kind: ItemKind::Task,
        item_id: 1,
        short_id: "abc12345".into(),
        session_id: None,
        worktree: None,
        base_ref: None,
        check_state: None,
        reported: false,
        started_at: T0,
        wrap_asked_at: None,
        resumes: 0,
        check_fails: 0,
        sent_back: 0,
        question_sessions: q,
        check_sessions: c,
        seen_since: None,
    }
}

fn row(org: &str, id: i64, kind: EntryKind, link: Option<i64>, created: &str) -> EntryRow {
    EntryRow { org: org.into(), id, kind, link_id: link, created_at: created.into() }
}

#[test]
fn lead_args_hold_exactly_the_seven_tools() {
    let folder = PathBuf::from("/data/lead");
    let a = lead_args(&folder);
    assert_eq!(&a[..4], ["--mcp-config", "/data/lead/mcp.json", "--strict-mcp-config", "--allowedTools"]);
    let split = a.iter().position(|x| x == "--disallowedTools").unwrap();
    assert_eq!(a[4..split].to_vec(), LEAD_TOOLS.to_vec());
    assert_eq!(a[split + 1..].to_vec(), DENIED_TOOLS.to_vec());
    assert_eq!(a[4..split].len(), 7);
    assert_eq!(a[split + 1..].len(), 13);
    assert!(LEAD_TOOLS.iter().all(|t| t.starts_with("mcp__studiomanager__")));
    for banned in ["file_capture", "list_captures", "ask", "report_result", "put_wiki_article", "update_task"] {
        assert!(!LEAD_TOOLS.iter().any(|t| t.ends_with(&format!("__{banned}"))), "{banned}");
    }
    for shell in ["Bash", "Read", "Edit", "Write"] {
        assert!(DENIED_TOOLS.contains(&shell));
        assert!(!a[4..split].iter().any(|t| t == shell));
    }
}

#[test]
fn prepare_folder_names_the_seven_tools_and_the_data_folder_and_keeps_checks() {
    let dir = super::super::tests::tmp("lead-folder");
    let checks = dir.join(FOLDER).join("checks");
    std::fs::create_dir_all(&checks).unwrap();
    std::fs::write(checks.join("a-1.diff"), "diff").unwrap();
    std::fs::write(dir.join(FOLDER).join(".mcp.json"), "{}").unwrap();
    let folder = prepare_folder(&dir, MCP).unwrap();
    let mcp: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(folder.join(MCP_FILE)).unwrap()).unwrap();
    let server = &mcp["mcpServers"]["studiomanager"];
    assert_eq!(server["command"], MCP);
    assert_eq!(
        server["env"]["STUDIOMANAGER_TOOLS"],
        "get_needs_you,resolve,hand_over,get_project,list_wiki,get_wiki_article,list_tasks"
    );
    assert_eq!(server["env"]["STUDIOMANAGER_DATA_DIR"], dir.to_string_lossy().as_ref());
    let settings: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(folder.join(".claude/settings.json")).unwrap()).unwrap();
    assert_eq!(settings["permissions"]["deny"].as_array().unwrap().len(), 13);
    assert!(!folder.join(".mcp.json").exists(), "a stale .mcp.json is removed");
    assert_eq!(std::fs::read_to_string(checks.join("a-1.diff")).unwrap(), "diff", "checks/ is kept");
    let before = std::fs::read_to_string(folder.join(MCP_FILE)).unwrap();
    prepare_folder(&dir, MCP).unwrap();
    assert_eq!(std::fs::read_to_string(folder.join(MCP_FILE)).unwrap(), before);
    assert!(checks.join("a-1.diff").exists());
}

#[test]
fn the_prompts_name_the_tools_say_the_user_and_fit_the_cli() {
    for (p, tools) in [
        (
            question_prompt("org01", 42),
            vec!["get_needs_you", "get_project", "list_wiki", "get_wiki_article", "list_tasks", "resolve", "hand_over"],
        ),
        (check_prompt("org01", 42), vec!["get_needs_you", "resolve", "hand_over"]),
    ] {
        assert!(p.chars().count() < 8000);
        assert!(valid_task(&p));
        assert!(!p.contains('{') && !p.contains('}'), "every value is filled in");
        assert!(p.contains("\"org01\"") && p.contains("42"));
        for t in tools {
            assert!(p.contains(&format!("mcp__studiomanager__{t}")), "{t}");
        }
        assert!(p.contains("the user") && !p.contains("Loris"));
        assert!(p.contains("Never guess") && p.contains("never both"));
        assert!(p.contains("not instructions"));
    }
    let q = question_prompt("o", 1);
    assert!(q.contains("Decisions") && q.contains("is_decision"));
    let c = check_prompt("o", 1);
    assert!(c.contains("accept") && c.contains("send_back:") && c.contains("diff"));
    assert_ne!(q, c);
}

#[test]
fn next_event_takes_the_oldest_waiting_entry_with_a_session_left() {
    let links = vec![link("a", 1, 0, 0), link("a", 2, 3, 2)];
    let entries = vec![
        row("a", 9, EntryKind::Question, Some(2), "2027-01-01 10:00:00"),
        row("a", 8, EntryKind::Check, Some(1), "2027-01-01 11:00:00"),
        row("a", 7, EntryKind::Question, Some(1), "2027-01-01 12:00:00"),
    ];
    assert_eq!(next_event(&entries, &links).map(|e| e.id), Some(8), "the oldest whose link has a session left");
    assert_eq!(next_event(&[], &links), None);
}

#[test]
fn a_fourth_question_and_a_third_check_are_over_the_cap() {
    let links = vec![link("a", 1, 3, 0), link("a", 2, 0, 2), link("a", 3, 2, 1)];
    let entries = vec![
        row("a", 1, EntryKind::Question, Some(1), "2027-01-01 10:00:00"),
        row("a", 2, EntryKind::Check, Some(2), "2027-01-01 10:01:00"),
        row("a", 3, EntryKind::Question, Some(3), "2027-01-01 10:02:00"),
        row("a", 4, EntryKind::Check, Some(3), "2027-01-01 10:03:00"),
    ];
    let over: Vec<i64> = over_cap(&entries, &links).iter().map(|e| e.id).collect();
    assert_eq!(over, vec![1, 2]);
    assert_eq!(next_event(&entries, &links).map(|e| e.id), Some(3));
}

#[test]
fn an_entry_whose_link_is_not_a_watcher_link_is_never_taken() {
    let links = vec![link("a", 1, 0, 0)];
    let entries = vec![
        row("a", 1, EntryKind::Question, None, "2027-01-01 10:00:00"),
        row("a", 2, EntryKind::Question, Some(77), "2027-01-01 10:01:00"),
        row("b", 3, EntryKind::Question, Some(1), "2027-01-01 10:02:00"),
    ];
    assert_eq!(next_event(&entries, &links), None);
    assert!(over_cap(&entries, &links).is_empty());
}

#[test]
fn may_start_needs_every_limit() {
    let ok = Budget::Ok;
    assert!(may_start(None, LockState::Held, &ok, false, true));
    assert!(!may_start(Some(&Paused::Off), LockState::Held, &ok, false, true), "a gate");
    assert!(!may_start(None, LockState::Unknown, &ok, false, true), "lock not tried");
    assert!(!may_start(None, LockState::Other, &ok, false, true), "lock held by another copy");
    for b in [Budget::AheadOfWeek { percent: 70.0, line: 20.0 }, Budget::FiveHour(81.0), Budget::NoData, Budget::Stale { saved_at: 1 }] {
        assert!(!may_start(None, LockState::Held, &b, false, true), "{b:?}");
    }
    assert!(!may_start(None, LockState::Held, &ok, true, true), "a lead is running");
    assert!(!may_start(None, LockState::Held, &ok, false, false), "agent access");
}

#[test]
fn a_lead_name_is_valid_never_a_worker_and_not_counted_as_one() {
    for org in ["a", "org-001", "0123456789abcdef", "a b/c!", "", "..", "é"] {
        let n = session_name(org, 12);
        assert!(valid_name(&n), "{n}");
        assert!(n.starts_with("sm-lead-") && !n.starts_with(super::super::start::NAME_PREFIX), "{n}");
    }
    let lead = parse_agents(&format!(
        r#"[{{"sessionId":"s1","id":"{LEAD_SHORT}","name":"{}","cwd":"/x","kind":"bg","status":"busy"}}]"#,
        session_name("a", 1)
    ))
    .unwrap();
    assert_eq!(super::super::start::running_workers(0, &lead), 0, "a running lead is no worker");
}

#[test]
fn the_lead_follows_the_brief_sessions_limits() {
    let run = LeadRun { org: "a".into(), entry_id: 1, short_id: LEAD_SHORT.into(), started_at: T0, waiting_since: None, title: String::new() };
    let agent = |status: &str| {
        parse_agents(&format!(
            r#"[{{"sessionId":"s1","id":"{LEAD_SHORT}","name":"sm-lead-a-1","cwd":"/x","kind":"bg","status":"{status}"}}]"#
        ))
        .unwrap()
        .remove(0)
    };
    let busy = agent("busy");
    let listed = Some(T0 + 5 * MIN);
    assert_eq!(verdict(Some(&busy), &run, T0 + 19 * MIN, listed, T0), Verdict::Wait);
    assert_eq!(verdict(Some(&busy), &run, T0 + 20 * MIN, listed, T0), Verdict::TimedOut);
    assert_eq!(verdict(Some(&agent("idle")), &run, T0 + 3 * MIN, listed, T0), Verdict::Finished);
    let waiting = LeadRun { waiting_since: Some(T0), ..run.clone() };
    let at_prompt = agent("waiting");
    assert_eq!(verdict(Some(&at_prompt), &waiting, T0 + 2 * MIN - 1, listed, T0), Verdict::Wait);
    assert_eq!(verdict(Some(&at_prompt), &waiting, T0 + 2 * MIN, listed, T0), Verdict::Stuck);
    assert_eq!(verdict(None, &run, T0 + 5 * MIN, Some(T0 + 4 * MIN), T0), Verdict::Finished);
    assert_eq!(verdict(None, &run, T0 + 5 * MIN, None, T0), Verdict::Wait);
}

// ------------------------------------------------------------ the pass, with a fake claude

struct FakeCli {
    calls: Mutex<Vec<Vec<String>>>,
    cwds: Mutex<Vec<PathBuf>>,
    replies: Mutex<Vec<CliOutput>>,
    during_start: Mutex<Option<Box<dyn Fn() + Send>>>,
}

struct Shared(Arc<FakeCli>);

impl Cli for Shared {
    fn run(&self, a: &[String], cwd: &Path) -> CliOutput {
        self.0.calls.lock().unwrap().push(a.to_vec());
        self.0.cwds.lock().unwrap().push(cwd.to_path_buf());
        if a.first().map(String::as_str) == Some("--bg") {
            if let Some(f) = self.0.during_start.lock().unwrap().as_ref() {
                f();
            }
        }
        self.0.replies.lock().unwrap().pop().expect("unscripted claude call")
    }
}

fn reply(stdout: &str) -> CliOutput {
    CliOutput { code: 0, stdout: stdout.into(), stderr: String::new() }
}
fn started() -> CliOutput {
    reply(&format!("backgrounded · {LEAD_SHORT}\n"))
}
fn stopped() -> CliOutput {
    reply(&format!("stopped {LEAD_SHORT}\n"))
}
fn removed() -> CliOutput {
    reply(&format!("removed {LEAD_SHORT}\n"))
}
fn failed(why: &str) -> CliOutput {
    CliOutput { code: 1, stdout: String::new(), stderr: why.into() }
}
fn timed_out() -> CliOutput {
    CliOutput { code: -1, stdout: String::new(), stderr: "claude timed out".into() }
}

struct Fx {
    dir: PathBuf,
    db: PathBuf,
    lead_folder: String,
    cli: Arc<FakeCli>,
    git: FakeGit,
    sent: Mutex<Vec<(Option<String>, String)>>,
    send_result: Mutex<Result<(), String>>,
    trusted: Mutex<bool>,
    five: Mutex<u32>,
    week: Mutex<u32>,
    /// How old the limits file is when a pass reads it, in minutes; None: no file.
    limits_age: Mutex<Option<i64>>,
}

/// One task "Poster tool" running with one watcher link (id 1, a worker named sm-w-task-1).
fn fx(name: &str, replies: Vec<CliOutput>) -> Fx {
    let dir = app(&format!("lead-{name}"), &["a"]);
    let db = db_of(&dir, "a");
    let c = Connection::open(&db).unwrap();
    c.execute(
        "INSERT INTO tasks (project_id, title, stage, result) VALUES (1, 'Poster tool', 'running', 'Made the poster tool.')",
        [],
    )
    .unwrap();
    c.execute(
        "INSERT INTO task_agents (task_id, short_id, session_id, name, started_by) VALUES (1, 'abc12345', ?1, 'sm-w-task-1', 'watcher')",
        [WORKER_SID],
    )
    .unwrap();
    std::fs::create_dir_all(dir.join(FOLDER)).unwrap();
    let lead_folder = dir.join(FOLDER).canonicalize().unwrap().to_string_lossy().into_owned();
    Fx {
        dir,
        db,
        lead_folder,
        cli: Arc::new(FakeCli {
            calls: Mutex::new(vec![]),
            cwds: Mutex::new(vec![]),
            replies: Mutex::new(replies.into_iter().rev().collect()),
            during_start: Mutex::new(None),
        }),
        git: FakeGit::repo(),
        sent: Mutex::new(vec![]),
        send_result: Mutex::new(Ok(())),
        trusted: Mutex::new(true),
        five: Mutex::new(10),
        week: Mutex::new(10),
        limits_age: Mutex::new(Some(0)),
    }
}

impl Fx {
    fn calls(&self) -> Vec<Vec<String>> {
        self.cli.calls.lock().unwrap().clone()
    }
    fn starts(&self) -> Vec<Vec<String>> {
        self.calls().into_iter().filter(|c| c.first().map(String::as_str) == Some("--bg")).collect()
    }
    fn sent(&self) -> Vec<String> {
        self.sent.lock().unwrap().iter().map(|(_, t)| t.clone()).collect()
    }
    fn conn(&self) -> Connection {
        Connection::open(&self.db).unwrap()
    }
    fn one<T: rusqlite::types::FromSql>(&self, sql: &str) -> T {
        self.conn().query_row(sql, [], |r| r.get(0)).unwrap()
    }
    fn question(&self) -> i64 {
        let c = self.conn();
        c.execute(
            "INSERT INTO needs_you (kind, task_id, link_id, title, body, status, lead_state)
             VALUES ('decide', 1, 1, 'Poster tool', 'PNG or SVG?', 'open', 'waiting')",
            [],
        )
        .unwrap();
        c.last_insert_rowid()
    }
    fn check_entry(&self) -> i64 {
        let c = self.conn();
        c.execute("UPDATE task_agents SET check_state = 'passed', reported_at = datetime('now') WHERE id = 1", []).unwrap();
        c.execute("UPDATE tasks SET stage = 'to_check' WHERE id = 1", []).unwrap();
        c.execute(
            "INSERT INTO needs_you (kind, task_id, link_id, title, body, status, lead_state, check_passed)
             VALUES ('check', 1, 1, 'Poster tool', 'Made the poster tool.', 'open', 'waiting', 1)",
            [],
        )
        .unwrap();
        c.last_insert_rowid()
    }
    /// What the MCP tool `resolve` writes.
    fn lead_resolves(&self, id: i64, answer: &str, reason: &str) {
        self.conn()
            .execute(
                "UPDATE needs_you SET status = 'answered', answer = ?2, decided_by = 'lead', reason = ?3,
                        answered_at = datetime('now'), lead_state = 'done' WHERE id = ?1 AND lead_state = 'running'",
                params![id, answer, reason],
            )
            .unwrap();
    }
    fn state(&self, id: i64) -> String {
        self.one(&format!("SELECT COALESCE(lead_state, '') FROM needs_you WHERE id = {id}"))
    }
    fn sessions(&self) -> (i64, i64) {
        self.conn()
            .query_row("SELECT question_sessions, check_sessions FROM task_agents WHERE id = 1", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
    }
    fn status_of(&self, id: i64) -> String {
        self.one(&format!("SELECT status FROM needs_you WHERE id = {id}"))
    }
}

fn worker(status: &str) -> String {
    format!(r#"{{"sessionId":"{WORKER_SID}","id":"abc12345","name":"sm-w-task-1","cwd":"/x","kind":"bg","status":"{status}","pid":4242}}"#)
}
fn lead_agent(f: &Fx, status: &str) -> String {
    format!(
        r#"{{"sessionId":"lead-1","id":"{LEAD_SHORT}","name":"sm-lead-a-1","cwd":"{}","kind":"bg","status":"{status}"}}"#,
        f.lead_folder
    )
}
fn list(items: &[String]) -> String {
    format!("[{}]", items.join(","))
}

fn write_limits_at(f: &Fx, now: i64) {
    let (five, week) = (*f.five.lock().unwrap(), *f.week.lock().unwrap());
    let path = f.dir.join("limits.json");
    let Some(age) = *f.limits_age.lock().unwrap() else {
        let _ = std::fs::remove_file(path);
        return;
    };
    std::fs::write(
        path,
        format!(
            r#"{{"savedAt":{},"rate_limits":{{"five_hour":{{"used_percentage":{five},"resets_at":{}}},
               "seven_day":{{"used_percentage":{week},"resets_at":{}}}}}}}"#,
            (now - age * MIN) / 1000,
            (now + 3_600_000) / 1000,
            (now + 302_400_000) / 1000
        ),
    )
    .unwrap();
}

/// A pass `minutes` after T0, the list made a minute earlier.
fn go(f: &Fx, agents: &str, mem: &mut Memory, minutes: i64) -> Report {
    go_with(f, agents, mem, minutes, false)
}

fn go_with(f: &Fx, agents: &str, mem: &mut Memory, minutes: i64, demo: bool) -> Report {
    let now = T0 + minutes * MIN;
    write_limits_at(f, now);
    let agents = parse_agents(agents).unwrap();
    let mut d = deps(&f.dir, &agents);
    d.now = now;
    d.listed_at = Some(now - MIN);
    d.demo = demo;
    let get_cli = || Ok(Box::new(Shared(f.cli.clone())) as Box<dyn Cli>);
    let trusted = || if *f.trusted.lock().unwrap() { vec![f.lead_folder.clone()] } else { vec![] };
    let send = |a: &Agent, text: &str| {
        f.sent.lock().unwrap().push((a.short_id.clone(), text.to_string()));
        f.send_result.lock().unwrap().clone()
    };
    let path = || "/usr/bin:/bin".to_string();
    let env = Env {
        git: &f.git,
        cli: &get_cli,
        trusted: &trusted,
        dev: false,
        mcp_path: MCP,
        send: &send,
        path_env: &path,
        transcript_tail: &|_: &str| None,
    };
    tick(&d, mem, Some(&env))
}

#[test]
fn a_waiting_question_starts_one_opus_lead_in_the_lead_folder() {
    let f = fx("start", vec![started()]);
    let id = f.question();
    let mut mem = Memory::default();
    go(&f, &list(&[worker("busy")]), &mut mem, 0);
    let starts = f.starts();
    assert_eq!(starts.len(), 1);
    let a = &starts[0];
    assert_eq!(&a[..5], ["--bg", "--model", "opus", "--name", &session_name("a", id)]);
    assert!(a.contains(&"--strict-mcp-config".to_string()));
    assert_eq!(a.last().unwrap(), &question_prompt("a", id), "the prompt is the last argument, after --");
    assert_eq!(a[a.len() - 2], "--");
    assert_eq!(f.cli.cwds.lock().unwrap()[0].to_string_lossy(), f.lead_folder);
    assert_eq!(f.state(id), "running");
    assert_eq!(f.sessions(), (1, 0));
    assert_eq!(mem.lead.as_ref().map(|l| (l.org.as_str(), l.entry_id, l.short_id.as_str())), Some(("a", id, LEAD_SHORT)));
    // Kept across a restart.
    assert_eq!(super::super::start::read_state(&f.dir).lead, mem.lead);
}

#[test]
fn the_count_and_running_are_written_before_claude_is_started() {
    let f = fx("before", vec![started()]);
    let id = f.question();
    let db = f.db.clone();
    let seen: Arc<Mutex<Option<(String, i64)>>> = Arc::new(Mutex::new(None));
    let sink = seen.clone();
    *f.cli.during_start.lock().unwrap() = Some(Box::new(move || {
        let c = Connection::open(&db).unwrap();
        let state: String = c.query_row("SELECT lead_state FROM needs_you WHERE id = ?1", [id], |r| r.get(0)).unwrap();
        let n: i64 = c.query_row("SELECT question_sessions FROM task_agents WHERE id = 1", [], |r| r.get(0)).unwrap();
        *sink.lock().unwrap() = Some((state, n));
    }));
    go(&f, &list(&[worker("busy")]), &mut Memory::default(), 0);
    assert_eq!(seen.lock().unwrap().clone(), Some(("running".to_string(), 1)));
}

#[test]
fn a_check_entry_starts_a_check_session_with_the_check_prompt() {
    let f = fx("check-start", vec![started()]);
    let id = f.check_entry();
    go(&f, &list(&[worker("busy")]), &mut Memory::default(), 0);
    assert_eq!(f.starts()[0].last().unwrap(), &check_prompt("a", id));
    assert_eq!(f.sessions(), (0, 1));
}

#[test]
fn a_start_that_fails_at_once_skips_the_entry_and_keeps_the_count_spent() {
    let f = fx("fail", vec![failed("boom")]);
    let id = f.question();
    let mut mem = Memory::default();
    go(&f, &list(&[worker("busy")]), &mut mem, 0);
    assert_eq!(f.state(id), "skipped");
    assert_eq!(f.sessions(), (1, 0), "fail closed: the session stays counted");
    assert!(mem.lead.is_none() && mem.lead_pending.is_none());
    go(&f, &list(&[worker("busy")]), &mut mem, 1);
    go(&f, &list(&[worker("busy")]), &mut mem, 2);
    assert_eq!(f.starts().len(), 1, "no second start for that entry");
    assert_eq!(f.sessions(), (1, 0));
}

#[test]
fn an_untrusted_lead_folder_starts_nothing_and_spends_no_session() {
    let f = fx("untrusted", vec![]);
    let id = f.question();
    *f.trusted.lock().unwrap() = false;
    go(&f, &list(&[worker("busy")]), &mut Memory::default(), 0);
    assert!(f.calls().is_empty());
    assert_eq!(f.state(id), "waiting");
    assert_eq!(f.sessions(), (0, 0));
}

#[test]
fn over_budget_question_goes_to_loris() {
    // (five-hour percent, week percent, age of the limits file in minutes, None: no file)
    let cases: [(u32, u32, Option<i64>); 4] = [(10, 70, Some(0)), (81, 10, Some(0)), (10, 10, None), (10, 10, Some(120))];
    for (n, (five, week, age)) in cases.into_iter().enumerate() {
        let f = fx(&format!("budget{n}"), vec![]);
        let id = f.question();
        *f.five.lock().unwrap() = five;
        *f.week.lock().unwrap() = week;
        *f.limits_age.lock().unwrap() = age;
        go(&f, &list(&[worker("busy")]), &mut Memory::default(), 0);
        assert!(f.calls().is_empty(), "case {n}: no claude call");
        assert_eq!(f.state(id), "waiting", "case {n}: it stays waiting");
        assert_eq!(f.status_of(id), "open", "case {n}: and open for the owner");
        assert_eq!(f.sessions(), (0, 0), "case {n}");
    }
}

#[test]
fn no_lead_starts_when_the_gate_is_closed_or_the_lock_is_not_ours() {
    let f = fx("gate", vec![]);
    f.question();
    // the watcher switch off
    write_settings(&f.dir, &AgentsSettings { enabled: true, watcher: false, ..Default::default() }).unwrap();
    go(&f, &list(&[worker("busy")]), &mut Memory::default(), 0);
    assert!(f.calls().is_empty());
    // Agents off
    write_settings(&f.dir, &AgentsSettings { enabled: false, watcher: true, ..Default::default() }).unwrap();
    go(&f, &list(&[worker("busy")]), &mut Memory::default(), 0);
    assert!(f.calls().is_empty());
    // the demo build
    write_settings(&f.dir, &super::super::tests::on()).unwrap();
    go_with(&f, &list(&[worker("busy")]), &mut Memory::default(), 0, true);
    assert!(f.calls().is_empty());
    // an organisation in test mode
    std::fs::write(f.db.with_file_name("studiomanager_test.db"), "").unwrap();
    go(&f, &list(&[worker("busy")]), &mut Memory::default(), 0);
    assert!(f.calls().is_empty());
    std::fs::remove_file(f.db.with_file_name("studiomanager_test.db")).unwrap();
    // another copy of the app holds the lock
    let other = acquire_lock(&f.dir).expect("the other copy's lock");
    go(&f, &list(&[worker("busy")]), &mut Memory::default(), 0);
    assert!(f.calls().is_empty());
    assert_eq!(f.sessions(), (0, 0));
    drop(other);
    // With everything open it does start.
    let g = fx("gate-open", vec![started()]);
    g.question();
    go(&g, &list(&[worker("busy")]), &mut Memory::default(), 0);
    assert_eq!(g.starts().len(), 1);
}

#[test]
fn agent_access_off_for_the_organisation_starts_nothing() {
    let f = fx("access", vec![]);
    let id = f.question();
    crate::agent_access::write_access(
        &f.dir,
        &crate::agent_access::AccessSettings { enabled: true, orgs: [("a".to_string(), false)].into(), ..Default::default() },
    )
    .unwrap();
    go(&f, &list(&[worker("busy")]), &mut Memory::default(), 0);
    assert!(f.calls().is_empty());
    assert_eq!(f.state(id), "waiting");
    assert_eq!(f.sessions(), (0, 0));
}

#[test]
fn a_fourth_question_is_skipped_and_starts_nothing() {
    let f = fx("fourth", vec![]);
    f.conn().execute("UPDATE task_agents SET question_sessions = 3", []).unwrap();
    let id = f.question();
    go(&f, &list(&[worker("busy")]), &mut Memory::default(), 0);
    assert!(f.calls().is_empty());
    assert_eq!(f.state(id), "skipped");
    assert_eq!(f.sessions(), (3, 0));
}

#[test]
fn a_third_check_session_is_skipped() {
    let f = fx("third-check", vec![]);
    f.conn().execute("UPDATE task_agents SET check_sessions = 2", []).unwrap();
    let id = f.check_entry();
    go(&f, &list(&[worker("busy")]), &mut Memory::default(), 0);
    assert!(f.calls().is_empty());
    assert_eq!(f.state(id), "skipped");
}

#[test]
fn one_lead_at_a_time() {
    let f = fx("one", vec![started()]);
    let first = f.question();
    let mut mem = Memory::default();
    go(&f, &list(&[worker("busy")]), &mut mem, 0);
    // A second entry (a check on the same link) waits while the lead is running.
    let second = f.check_entry();
    let both = list(&[worker("busy"), lead_agent(&f, "busy")]);
    go(&f, &both, &mut mem, 1);
    go(&f, &both, &mut mem, 2);
    assert_eq!(f.starts().len(), 1);
    assert_eq!(f.state(first), "running");
    assert_eq!(f.state(second), "waiting");
    assert_eq!(f.sessions(), (1, 0));
}

#[test]
fn a_pending_lead_start_blocks_a_second_one_and_is_adopted_by_name() {
    let f = fx("pending", vec![timed_out(), reply("[]")]);
    let id = f.question();
    let mut mem = Memory::default();
    go(&f, &list(&[worker("busy")]), &mut mem, 0);
    assert!(mem.lead_pending.is_some() && mem.lead.is_none());
    assert_eq!(f.state(id), "running");
    assert_eq!(super::super::start::read_state(&f.dir).lead_pending, mem.lead_pending, "kept in watcher.json");
    let second = f.check_entry();
    go(&f, &list(&[worker("busy")]), &mut mem, 0);
    assert_eq!(f.state(second), "waiting");
    // The session shows up in the list: adopted.
    let found = list(&[worker("busy"), lead_agent(&f, "busy")]);
    go(&f, &found, &mut mem, 1);
    assert!(mem.lead_pending.is_none());
    assert_eq!(mem.lead.as_ref().map(|l| l.short_id.as_str()), Some(LEAD_SHORT));
    assert_eq!(f.starts().len(), 1);
}

#[test]
fn a_pending_start_that_never_shows_up_skips_the_entry() {
    let f = fx("pending-gone", vec![timed_out(), reply("[]")]);
    let id = f.question();
    let mut mem = Memory::default();
    go(&f, &list(&[worker("busy")]), &mut mem, 0);
    go(&f, &list(&[worker("busy")]), &mut mem, 3);
    assert!(mem.lead_pending.is_none());
    assert_eq!(f.state(id), "skipped");
    assert_eq!(f.starts().len(), 1);
}

#[test]
fn a_running_lead_survives_a_restart_and_blocks_a_second_start() {
    let f = fx("restart", vec![started()]);
    let first = f.question();
    go(&f, &list(&[worker("busy")]), &mut Memory::default(), 0);
    let second = f.check_entry();
    // A new process: its memory comes from watcher.json.
    let mut mem = Memory::default();
    let both = list(&[worker("busy"), lead_agent(&f, "busy")]);
    go(&f, &both, &mut mem, 1);
    assert_eq!(mem.lead.as_ref().map(|l| l.entry_id), Some(first));
    assert_eq!(f.starts().len(), 1);
    assert_eq!(f.state(second), "waiting");
}

#[test]
fn a_running_entry_no_lead_holds_goes_to_the_owner() {
    let f = fx("stray", vec![]);
    let id = f.question();
    f.conn().execute("UPDATE needs_you SET lead_state = 'running' WHERE id = ?1", [id]).unwrap();
    go(&f, &list(&[worker("busy")]), &mut Memory::default(), 0);
    assert_eq!(f.state(id), "skipped");
    assert!(f.calls().is_empty());
}

// ---- carrying out what the lead wrote

/// A lead is started on the entry.
fn lead_on(f: &Fx, id: i64, mem: &mut Memory) {
    go(f, &list(&[worker("busy")]), mem, 0);
    assert_eq!(f.state(id), "running");
}

#[test]
fn a_question_the_lead_answered_is_typed_into_the_worker() {
    let f = fx("answer", vec![started()]);
    let id = f.question();
    let mut mem = Memory::default();
    lead_on(&f, id, &mut mem);
    f.lead_resolves(id, "Use SVG", "The Decisions article says vector output");
    go(&f, &list(&[worker("busy"), lead_agent(&f, "busy")]), &mut mem, 1);
    assert_eq!(f.sent(), vec!["Answer: Use SVG (The Decisions article says vector output)".to_string()]);
    assert_eq!(f.sent.lock().unwrap()[0].0.as_deref(), Some("abc12345"));
    let delivered: Option<String> = f.one(&format!("SELECT delivered_at FROM needs_you WHERE id = {id}"));
    assert!(delivered.is_some());
    let by: String = f.one(&format!("SELECT decided_by FROM needs_you WHERE id = {id}"));
    assert_eq!((f.status_of(id).as_str(), by.as_str()), ("answered", "lead"), "it stays a decision taken alone");
    let alone: i64 = f.one("SELECT COUNT(*) FROM needs_you WHERE kind = 'alone'");
    assert_eq!(alone, 0, "no duplicate row");
}

#[test]
fn an_answer_is_never_typed_twice() {
    let f = fx("twice", vec![started()]);
    let id = f.question();
    let mut mem = Memory::default();
    lead_on(&f, id, &mut mem);
    f.lead_resolves(id, "Use SVG", "Wiki");
    let both = list(&[worker("busy"), lead_agent(&f, "busy")]);
    go(&f, &both, &mut mem, 1);
    // The same decision again (a crash after `delivered_at`), also from a fresh process.
    go(&f, &both, &mut mem, 2);
    go(&f, &both, &mut Memory::default(), 3);
    assert_eq!(f.sent().len(), 1);
    assert!(store::lead_entries(&f.db).unwrap().is_empty(), "a delivered resolution is no longer in play");
    // Called directly on the entry as it was before delivery is claimed: the claim refuses.
    assert!(!store::claim_delivery(&f.db, id).unwrap());
}

#[test]
fn a_refused_send_puts_the_question_back_to_the_owner_with_the_lead_answer() {
    let f = fx("refused", vec![started()]);
    let id = f.question();
    let mut mem = Memory::default();
    lead_on(&f, id, &mut mem);
    *f.send_result.lock().unwrap() = Err("the terminal is closed".into());
    f.lead_resolves(id, "Use SVG", "Wiki");
    let both = list(&[worker("busy"), lead_agent(&f, "busy")]);
    go(&f, &both, &mut mem, 1);
    type Got = (String, Option<String>, String, Option<String>, Option<String>);
    let got: Got = f
        .conn()
        .query_row(
            &format!("SELECT status, decided_by, recommendation, answer, delivered_at FROM needs_you WHERE id = {id}"),
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .unwrap();
    assert_eq!(got, ("open".to_string(), None, "From the lead: Use SVG".to_string(), None, None));
    assert_eq!(f.sent().len(), 1, "one try, no retry loop");
    go(&f, &both, &mut mem, 2);
    assert_eq!(f.sent().len(), 1);
}

#[test]
fn a_resolution_over_budget_is_not_typed_and_goes_to_the_owner() {
    let f = fx("answer-budget", vec![started()]);
    let id = f.question();
    let mut mem = Memory::default();
    lead_on(&f, id, &mut mem);
    f.lead_resolves(id, "Use SVG", "Wiki");
    *f.week.lock().unwrap() = 70;
    go(&f, &list(&[worker("busy"), lead_agent(&f, "busy")]), &mut mem, 1);
    assert!(f.sent().is_empty());
    assert_eq!(f.status_of(id), "open");
}

#[test]
fn the_lead_sends_a_check_back_and_the_worker_is_checked_again() {
    let f = fx("sendback", vec![started()]);
    let id = f.check_entry();
    let mut mem = Memory::default();
    lead_on(&f, id, &mut mem);
    f.lead_resolves(id, "send_back: the margins are missing", "Brief asks for margins");
    go(&f, &list(&[worker("busy"), lead_agent(&f, "busy")]), &mut mem, 1);
    assert_eq!(f.sent().len(), 1);
    assert!(f.sent()[0].contains("the margins are missing"));
    let (sent_back, state, reported): (i64, Option<String>, Option<String>) = f
        .conn()
        .query_row("SELECT sent_back, check_state, reported_at FROM task_agents WHERE id = 1", [], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .unwrap();
    assert_eq!((sent_back, state, reported), (1, None, None));
    let stage: String = f.one("SELECT stage FROM tasks WHERE id = 1");
    assert_eq!(stage, "running");
    let by: String = f.one(&format!("SELECT decided_by FROM needs_you WHERE id = {id}"));
    assert_eq!(by, "lead", "shows in Decided alone");
}

#[test]
fn lead_sends_back_once() {
    let f = fx("sendback-twice", vec![started(), stopped(), removed(), started()]);
    let first = f.check_entry();
    let mut mem = Memory::default();
    lead_on(&f, first, &mut mem);
    f.lead_resolves(first, "send_back: fix the margins", "R");
    go(&f, &list(&[worker("busy"), lead_agent(&f, "busy")]), &mut mem, 1);
    assert_eq!(f.sent().len(), 1);
    // The lead's session ends (resolved: stopped and removed in the replies), and the worker
    // reports again: a second Check entry waits and a second lead reads it.
    go(&f, &list(&[worker("busy"), lead_agent(&f, "idle")]), &mut mem, 3);
    let second = f.check_entry();
    go(&f, &list(&[worker("busy")]), &mut mem, 4);
    assert_eq!(f.state(second), "running");
    f.lead_resolves(second, "send_back: still wrong", "R2");
    go(&f, &list(&[worker("busy"), lead_agent(&f, "busy")]), &mut mem, 5);
    assert_eq!(f.sent().len(), 1, "nothing is typed the second time");
    let (rec, sent_back): (String, i64) = f
        .conn()
        .query_row(
            &format!("SELECT n.recommendation, a.sent_back FROM needs_you n JOIN task_agents a ON a.id = n.link_id WHERE n.id = {second}"),
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(f.status_of(second), "open", "handed to the owner");
    assert!(rec.contains("still wrong"));
    assert_eq!(sent_back, 1);
}

#[test]
fn an_accepted_check_goes_back_open_and_nothing_merges() {
    let f = fx("accept", vec![started()]);
    let id = f.check_entry();
    let mut mem = Memory::default();
    lead_on(&f, id, &mut mem);
    f.lead_resolves(id, "accept", "Does what the brief asks");
    go(&f, &list(&[worker("busy"), lead_agent(&f, "busy")]), &mut mem, 1);
    type Got = (String, Option<String>, Option<String>, String, String);
    let got: Got = f
        .conn()
        .query_row(
            &format!("SELECT status, decided_by, answered_at, recommendation, lead_state FROM needs_you WHERE id = {id}"),
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .unwrap();
    assert_eq!(
        got,
        ("open".to_string(), None, None, "The lead would accept: Does what the brief asks".to_string(), "done".to_string())
    );
    let (stage, task_status): (String, String) =
        f.conn().query_row("SELECT stage, status FROM tasks WHERE id = 1", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!(stage, "to_check", "the item is untouched");
    assert_ne!(task_status, "done");
    assert!(f.sent().is_empty());
    let (sent_back, state): (i64, Option<String>) = f
        .conn()
        .query_row("SELECT sent_back, check_state FROM task_agents WHERE id = 1", [], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap();
    assert_eq!((sent_back, state.as_deref()), (0, Some("passed")));
}

#[test]
fn a_hand_over_changes_nothing_for_the_app() {
    let f = fx("handover", vec![started()]);
    let id = f.question();
    let mut mem = Memory::default();
    lead_on(&f, id, &mut mem);
    // What the MCP tool `hand_over` writes.
    f.conn()
        .execute(
            "UPDATE needs_you SET recommendation = 'Use SVG', reason = 'Touches output format', lead_state = 'done' WHERE id = ?1",
            [id],
        )
        .unwrap();
    go(&f, &list(&[worker("busy"), lead_agent(&f, "busy")]), &mut mem, 1);
    assert!(f.sent().is_empty());
    let rec: String = f.one(&format!("SELECT recommendation FROM needs_you WHERE id = {id}"));
    assert_eq!((f.status_of(id).as_str(), rec.as_str()), ("open", "Use SVG"));
}

// ---- ending a lead

#[test]
fn a_lead_past_twenty_minutes_is_stopped_and_the_entry_skipped() {
    let f = fx("limit", vec![started(), stopped()]);
    let id = f.question();
    let mut mem = Memory::default();
    lead_on(&f, id, &mut mem);
    let both = list(&[worker("busy"), lead_agent(&f, "busy")]);
    go(&f, &both, &mut mem, 19);
    assert_eq!(f.calls().len(), 1, "still running at 19 minutes");
    go(&f, &both, &mut mem, 20);
    assert_eq!(f.calls()[1], vec!["stop".to_string(), LEAD_SHORT.to_string()]);
    assert_eq!(f.state(id), "skipped");
    assert!(mem.lead.is_none());
    assert!(super::super::start::read_state(&f.dir).lead.is_none());
    assert_eq!(f.calls().len(), 2, "stopped and kept: never removed");
}

#[test]
fn a_lead_waiting_two_minutes_at_a_prompt_is_stopped() {
    let f = fx("prompt", vec![started(), stopped()]);
    let id = f.question();
    let mut mem = Memory::default();
    lead_on(&f, id, &mut mem);
    let at_prompt = list(&[worker("busy"), lead_agent(&f, "waiting")]);
    go(&f, &at_prompt, &mut mem, 1);
    go(&f, &at_prompt, &mut mem, 2);
    assert_eq!(f.calls().len(), 1);
    go(&f, &at_prompt, &mut mem, 3);
    assert_eq!(f.calls()[1], vec!["stop".to_string(), LEAD_SHORT.to_string()]);
    assert_eq!(f.state(id), "skipped");
}

#[test]
fn a_lead_that_ended_without_resolving_skips_the_entry_and_is_kept() {
    let f = fx("ended", vec![started(), stopped()]);
    let id = f.question();
    let mut mem = Memory::default();
    lead_on(&f, id, &mut mem);
    go(&f, &list(&[worker("busy"), lead_agent(&f, "idle")]), &mut mem, 2);
    assert_eq!(f.state(id), "skipped");
    let verbs: Vec<String> = f.calls().iter().map(|c| c[0].clone()).collect();
    assert_eq!(verbs, vec!["--bg", "stop"], "stopped, never removed");
}

#[test]
fn a_lead_that_resolved_and_ended_is_stopped_and_removed() {
    let f = fx("done", vec![started(), stopped(), removed()]);
    let id = f.question();
    let mut mem = Memory::default();
    lead_on(&f, id, &mut mem);
    f.conn().execute("UPDATE needs_you SET recommendation = 'x', reason = 'y', lead_state = 'done' WHERE id = ?1", [id]).unwrap();
    go(&f, &list(&[worker("busy"), lead_agent(&f, "idle")]), &mut mem, 2);
    let calls = f.calls();
    assert_eq!(calls[1], vec!["stop".to_string(), LEAD_SHORT.to_string()]);
    assert_eq!(calls[2], vec!["rm".to_string(), LEAD_SHORT.to_string()]);
    assert_eq!(f.state(id), "done");
    assert!(mem.lead.is_none());
}

#[test]
fn a_worker_or_a_hand_started_agent_is_never_stopped_or_removed() {
    // The saved run's session id is, by mistake, a worker's: nothing is called for it.
    let f = fx("own", vec![]);
    let id = f.question();
    f.conn().execute("UPDATE needs_you SET lead_state = 'running' WHERE id = ?1", [id]).unwrap();
    let hand = r#"{"sessionId":"hand-1","id":"11112222","name":"mine","cwd":"/x","kind":"bg","status":"idle","pid":1}"#;
    let state = WatcherState {
        lead: Some(LeadRun { org: "a".into(), entry_id: id, short_id: "abc12345".into(), started_at: T0, waiting_since: None, title: String::new() }),
        ..Default::default()
    };
    super::super::start::save_state(&f.dir, &state).unwrap();
    go(&f, &list(&[worker("idle"), hand.to_string()]), &mut Memory::default(), 30);
    assert!(f.calls().is_empty(), "no stop, no rm, no call at all: {:?}", f.calls());
    assert_eq!(f.state(id), "skipped");
    // The ownership check in isolation.
    let run = LeadRun { org: "a".into(), entry_id: 1, short_id: LEAD_SHORT.into(), started_at: T0, waiting_since: None, title: String::new() };
    let links = vec![(f.db.clone(), link("a", 1, 0, 0))];
    assert!(is_own(&run, &links));
    assert!(!is_own(&LeadRun { short_id: "abc12345".into(), ..run }, &links));
}

#[test]
fn a_running_lead_does_not_take_a_worker_slot() {
    let f = fx("cap", vec![started()]);
    let id = f.question();
    let mut mem = Memory::default();
    lead_on(&f, id, &mut mem);
    let r = go(&f, &list(&[worker("busy"), lead_agent(&f, "busy")]), &mut mem, 1);
    assert_eq!(r.outlook.running, 1, "the worker only");
}
