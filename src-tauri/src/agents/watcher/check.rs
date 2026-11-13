//! A finished worker: the project's check command runs in its worktree; a failure goes back to
//! the worker once; every other end is a Check entry for the owner (`needs_you`, kind `check`).
//! Nothing here merges, stops or deletes anything, and no model is used: the budget does not gate
//! it. Only watcher links are looked at (`WatcherLink`). Plan:
//! docs/superpowers/plans/2026-11-13-agent-orchestrator-3-watcher-lead.md (Task 10).
//!
//! The check runs on the watcher thread (one at a time, up to `CHECK_TIMEOUT`), through the same
//! `run_command` as the routines, so quitting the app kills its process group.
//!
//! How a second report is noticed: `reported` of a link is `reported_at IS NOT NULL`, which the
//! MCP server's `report_result` sets and never clears. After a failed check is typed back to the
//! worker `reported_at` is cleared, so the worker's next `report_result` writes it again and the
//! link reads as reported once more. Until the worker works again its agent still lists as done:
//! that is not "ended without a result" for `AWAIT_REPORT_MS` (or once it was seen working).

use super::events::{notice, Event};
use super::git::{self, Git};
use super::start::Env;
use super::store::{self, NewCheck, WatcherLink};
use super::{Deps, Memory};
use crate::agent_access::write_atomic;
use crate::agents::briefing::list_is_fresh;
use crate::agents::model::{Agent, Group};
use crate::agents::routines::run::{run_command, TAIL_BYTES};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// A check still running after this is killed and counts as failed.
pub const CHECK_TIMEOUT: Duration = Duration::from_secs(600);
/// What of the output goes to the worker and into the entry (`routines::run::TAIL_BYTES` is the
/// 64 KB `run_command` keeps).
pub const SENT_TAIL: usize = 8 * 1024;
/// The most of a diff that is stored (what `get_needs_you` of the MCP server reads).
pub const DIFF_CAP: usize = 200 * 1024;
/// A list older than this is not trusted to say a worker finished.
pub(super) const LIST_MAX_AGE_MS: i64 = 5 * 60_000;
/// After a failed check was typed back, how long the agent may still list as done before the
/// worker is taken to have ended without a new report.
pub const AWAIT_REPORT_MS: i64 = 5 * 60_000;

/// First line of a stored diff whose beginning `run_command` did not keep.
pub const DIFF_CUT_NOTICE: &str = "[The diff is longer than what was kept: its beginning is missing.]";
/// A cut output can be a few bytes shorter than `TAIL_BYTES` (the cut starts at a character).
const CUT_MARGIN: usize = 4;
pub const NO_RESULT: &str = "Ended without a result";
pub const WORKTREE_GONE: &str = "The worktree is gone";
pub const SENT_BACK: &str = "Sent the failed check back to the worker";

/// A finished check whose entry could not be written yet, per (organisation, link id), with the
/// diff text to store: kept in memory so the command is not run again.
pub type Unwritten = std::collections::HashMap<(String, i64), (NewCheck, Option<String>)>;

#[derive(Clone, Debug, PartialEq)]
pub struct CheckRun {
    pub passed: bool,
    pub timed_out: bool,
    pub tail: String,
    /// Why the command could not be started.
    pub error: Option<String>,
}

/// `/bin/sh -c <command>` in the worktree, with the routines' environment; passed only on exit 0.
pub fn run_check(command: &str, worktree: &str, path_env: &str) -> CheckRun {
    run_check_with(command, worktree, path_env, CHECK_TIMEOUT)
}

fn run_check_with(command: &str, worktree: &str, path_env: &str, timeout: Duration) -> CheckRun {
    let o = run_command("/bin/sh", &["-c".to_string(), command.to_string()], worktree, path_env, timeout);
    CheckRun { passed: o.code == Some(0) && !o.timed_out && o.error.is_none(), timed_out: o.timed_out, tail: o.tail, error: o.error }
}

fn last_bytes(s: &str, n: usize) -> &str {
    if s.len() <= n {
        return s;
    }
    let mut i = s.len() - n;
    while !s.is_char_boundary(i) {
        i += 1;
    }
    &s[i..]
}

fn first_bytes(s: &str, n: usize) -> &str {
    if s.len() <= n {
        return s;
    }
    let mut i = n;
    while !s.is_char_boundary(i) {
        i -= 1;
    }
    &s[..i]
}

/// The last 8 KB of an output as a message `normalise_message` accepts: terminal escape sequences
/// and control characters but new line and tab removed, carriage returns made new lines.
pub fn for_agent(tail: &str) -> String {
    let text = tail.replace("\r\n", "\n").replace('\r', "\n");
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            if chars.peek() == Some(&'[') {
                chars.next();
                for n in chars.by_ref() {
                    if ('@'..='~').contains(&n) {
                        break;
                    }
                }
            }
        } else if !c.is_control() || c == '\n' || c == '\t' {
            out.push(c);
        }
    }
    last_bytes(&out, SENT_TAIL).to_string()
}

#[derive(Clone, Debug, PartialEq)]
pub struct DiffFacts {
    /// Added plus removed lines; None when a binary file changed.
    pub lines: Option<i64>,
    /// False when the numstat or the name-status output was cut: `lines`, `paths` and `deleted`
    /// are then not to be trusted (`lines` is None, the lists are partial).
    pub complete: bool,
    pub paths: Vec<String>,
    pub deleted: Vec<String>,
    /// The diff text, at most `DIFF_CAP` bytes; starts with `DIFF_CUT_NOTICE` when its beginning
    /// was lost.
    pub head: String,
    /// Nothing uncommitted in the worktree.
    pub clean: bool,
}

/// What the worktree changed against `base`: `git merge-base <base> HEAD`, then `--numstat`,
/// `--name-status --no-renames` and the diff itself against it. Argv, never a shell.
pub fn diff_facts(g: &dyn Git, worktree: &str, base: &str) -> Result<DiffFacts, String> {
    if !git::ref_ok(base) {
        return Err("Invalid base branch".to_string());
    }
    let mb = git::git(g, worktree, &["merge-base", base, "HEAD"]);
    let mb_ok = git::succeeded(&mb) && git::ref_ok(mb.tail.trim());
    if !mb_ok {
        return Err(git::first_line(&mb, "git merge-base failed"));
    }
    let mb = mb.tail.trim().to_string();
    // `run_command` keeps only the last `TAIL_BYTES` of an output (a little less after the cut
    // at a character): an output that long may have lost its beginning.
    let run = |a: &[&str], what: &str| -> Result<(String, bool), String> {
        let mut args: Vec<&str> = a.to_vec();
        args.push(&mb);
        args.push("--");
        let o = git::git(g, worktree, &args);
        if git::succeeded(&o) {
            let cut = o.tail.len() + CUT_MARGIN >= TAIL_BYTES;
            Ok((o.tail, cut))
        } else {
            Err(git::first_line(&o, what))
        }
    };
    let (numstat, numstat_cut) = run(&["diff", "--numstat", "--no-renames"], "git diff failed")?;
    let (names, names_cut) = run(&["diff", "--name-status", "--no-renames"], "git diff failed")?;
    let (text, text_cut) = run(&["diff", "--no-ext-diff", "--no-color", "--no-renames"], "git diff failed")?;
    let status = git::git(g, worktree, &["status", "--porcelain"]);
    let complete = !numstat_cut && !names_cut;
    let mut lines = if complete { Some(0i64) } else { None };
    for l in numstat.lines() {
        let mut f = l.split('\t');
        if let (Some(a), Some(d)) = (f.next(), f.next()) {
            lines = match (a.parse::<i64>(), d.parse::<i64>()) {
                (Ok(a), Ok(d)) => lines.map(|n| n + a + d),
                _ => None,
            };
        }
    }
    let (mut paths, mut deleted) = (vec![], vec![]);
    for l in names.lines() {
        if let Some((st, path)) = l.split_once('\t') {
            paths.push(path.to_string());
            if st.trim() == "D" {
                deleted.push(path.to_string());
            }
        }
    }
    let head = if text_cut {
        // Start at the first complete line.
        let rest = text.split_once('\n').map_or("", |(_, r)| r);
        first_bytes(&format!("{DIFF_CUT_NOTICE}\n{rest}"), DIFF_CAP).to_string()
    } else {
        first_bytes(&text, DIFF_CAP).to_string()
    };
    Ok(DiffFacts { lines, paths, deleted, complete, head, clean: git::succeeded(&status) && status.tail.trim().is_empty() })
}

/// `<app data>/lead/checks/<org id>-<entry id>.diff`: the file `get_needs_you` of the MCP server
/// reads.
pub fn diff_path(app_dir: &Path, org: &str, entry: i64) -> PathBuf {
    app_dir.join("lead").join("checks").join(format!("{org}-{entry}.diff"))
}

fn write_diff(app_dir: &Path, org: &str, entry: i64, text: &str) -> Result<(), String> {
    let path = diff_path(app_dir, org, entry);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    }
    write_atomic(&path, first_bytes(text, DIFF_CAP))
}

pub(super) fn find_agent<'a>(agents: &'a [Agent], link: &WatcherLink) -> Option<&'a Agent> {
    agents.iter().find(|a| match &link.session_id {
        Some(s) => &a.session_id == s,
        None => a.short_id.as_deref() == Some(link.short_id.as_str()),
    })
}

fn same_link(key: &(String, i64), l: &WatcherLink) -> bool {
    key.0 == l.org && key.1 == l.id
}

/// Handles the finished links among `links`; true when something was written. At most one check
/// runs per pass. The caller has the lock, the gate is open and `env` is given.
pub fn step(env: &Env, d: &Deps, mem: &mut Memory, links: &[(PathBuf, WatcherLink)]) -> bool {
    mem.misses.retain(|k, _| links.iter().any(|(_, l)| same_link(k, l)));
    mem.awaiting.retain(|k, _| links.iter().any(|(_, l)| same_link(k, l)));
    mem.unwritten.retain(|k, _| links.iter().any(|(_, l)| same_link(k, l)));
    let trusted = d.listed_at.is_some_and(|t| t > mem.started && d.now - t <= LIST_MAX_AGE_MS);
    let mut changed = false;
    for (db, link) in links {
        // Handled: the Check entry exists (a worker's next report starts from a cleared state).
        if matches!(link.check_state.as_deref(), Some("passed" | "failed" | "none" | "error")) {
            continue;
        }
        let key = (link.org.clone(), link.id);
        let agent = find_agent(d.agents, link);
        let after_send_back = link.check_fails >= 1 && !link.reported;
        if after_send_back {
            let seen = mem.awaiting.entry(key.clone()).or_insert((d.now, false));
            seen.1 |= agent.is_some_and(|a| a.group == Group::Working);
        } else {
            mem.awaiting.remove(&key);
        }
        let reported = match notice(link, agent, false, None, d.now, d.listed_at) {
            Some(Event::Finished { reported }) => {
                mem.misses.remove(&key);
                if !trusted {
                    continue;
                }
                if !reported && after_send_back {
                    let (since, worked) = mem.awaiting.get(&key).copied().unwrap_or((d.now, false));
                    if !worked && d.now - since < AWAIT_REPORT_MS {
                        continue;
                    }
                }
                reported
            }
            Some(Event::Gone) => {
                // Gone only after two fresh lists, made at different times, lack the agent.
                if !trusted || !list_is_fresh(d.listed_at, link.started_at, mem.started) {
                    continue;
                }
                match (mem.misses.get(&key).copied(), d.listed_at) {
                    (Some(first), Some(now)) if first != now => {}
                    (None, Some(now)) => {
                        mem.misses.insert(key, now);
                        continue;
                    }
                    _ => continue,
                }
                link.reported
            }
            _ => {
                mem.misses.remove(&key);
                continue;
            }
        };
        let (wrote, ran) = handle(env, d, db, link, agent, reported, &mut mem.unwritten);
        changed |= wrote;
        if ran {
            break;
        }
    }
    changed
}

fn failure_output(run: &CheckRun) -> String {
    let tail = for_agent(&run.tail);
    if run.timed_out {
        format!("The check took longer than {} minutes and was stopped.\n{tail}", CHECK_TIMEOUT.as_secs() / 60)
    } else {
        tail
    }
}

/// One finished link: (something was written, a check command ran).
fn handle(
    env: &Env,
    d: &Deps,
    db: &Path,
    link: &WatcherLink,
    agent: Option<&Agent>,
    reported: bool,
    unwritten: &mut Unwritten,
) -> (bool, bool) {
    let key = (link.org.clone(), link.id);
    let pending = std::cell::RefCell::new(unwritten);
    // Writes the entry; a failure keeps it (with its diff) so the next pass only retries the
    // write and never runs the command again.
    let write = |c: NewCheck, diff: Option<&str>| -> bool {
        let id = {
            let _shared = crate::org_shared();
            store::add_check(db, &c)
        };
        match id {
            Ok(id) => {
                pending.borrow_mut().remove(&key);
                if let (Some(id), Some(text)) = (id, diff) {
                    if let Err(e) = write_diff(d.app_dir, &link.org, id, text) {
                        log::warn!("[watcher] could not store the diff of entry {id}: {e}");
                    }
                }
                true
            }
            Err(e) => {
                log::warn!("[watcher] could not write the Check entry of link {}: {e}", link.id);
                pending.borrow_mut().insert(key.clone(), (c, diff.map(String::from)));
                false
            }
        }
    };
    let held = pending.borrow().get(&key).cloned();
    if let Some((c, text)) = held {
        return (write(c, text.as_deref()), false);
    }
    let facts = {
        let _shared = crate::org_shared();
        store::item_facts(db, link.kind, link.item_id)
    };
    let facts = match facts {
        Ok(f) => f,
        Err(e) => {
            log::warn!("[watcher] check of link {}: {e}", link.id);
            return (false, false);
        }
    };
    let base = NewCheck {
        kind: link.kind,
        item_id: link.item_id,
        link_id: link.id,
        title: facts.title.clone(),
        body: facts.result.clone(),
        check_passed: None,
        check_output: None,
        change_lines: None,
        touches: None,
        check_state: None,
        close: None,
    };
    if !reported {
        let c = NewCheck {
            title: NO_RESULT.to_string(),
            body: "The worker ended without calling report_result.".to_string(),
            close: Some("no_result"),
            ..base
        };
        return (write(c, None), false);
    }
    let Some(worktree) = link.worktree.as_deref().filter(|w| Path::new(w).is_dir()) else {
        let c = NewCheck {
            title: WORKTREE_GONE.to_string(),
            body: format!("{} The check could not run.", WORKTREE_GONE),
            check_state: Some("error"),
            ..base
        };
        return (write(c, None), false);
    };
    {
        let _shared = crate::org_shared();
        if let Err(e) = store::set_check_state(db, link.id, Some("running")) {
            log::warn!("[watcher] check of link {}: {e}", link.id);
            return (false, false);
        }
    }
    // What the entry says about the change; measured once, for the entry that is written.
    let finish = |passed: Option<bool>, output: Option<String>, state: &'static str| -> bool {
        let diff = link.base_ref.as_deref().map(|b| diff_facts(env.git, worktree, b));
        let (lines, touches, text) = match &diff {
            // Incomplete facts (a cut git output) say nothing about what the change touches.
            Some(Ok(f)) => (f.lines, f.complete.then(|| "[]".to_string()), Some(f.head.clone())),
            Some(Err(e)) => {
                log::warn!("[watcher] could not measure the change of link {}: {e}", link.id);
                (None, None, None)
            }
            None => (None, None, None),
        };
        let c = NewCheck {
            check_passed: passed,
            check_output: output,
            change_lines: lines,
            touches,
            check_state: Some(state),
            ..base.clone()
        };
        write(c, text.as_deref())
    };
    let Some(command) = facts.check_command else {
        return (finish(None, None, "none"), false);
    };
    let run = run_check(&command, worktree, &(env.path_env)());
    if let Some(e) = &run.error {
        return (finish(None, Some(for_agent(e)), "error"), true);
    }
    if run.passed {
        return (finish(Some(true), Some(for_agent(&run.tail)), "passed"), true);
    }
    let output = failure_output(&run);
    if let (0, Some(agent)) = (link.check_fails, agent) {
        // Decided and counted first; typed only after that.
        let decided = {
            let _shared = crate::org_shared();
            store::decide_send_back(db, link.id)
        };
        match decided {
            Err(e) => {
                log::warn!("[watcher] could not decide on link {}: {e}", link.id);
                return (false, true);
            }
            Ok(_) => {
                let message = format!("The check command failed. Fix it, then call report_result again. Output:\n{output}");
                match (env.send)(agent, &message) {
                    Ok(()) => {
                        let _shared = crate::org_shared();
                        // A failure here only leaves the old report: the worker's own report
                        // still writes `reported_at` again, and a second send back is never made.
                                                let reason = "The check command failed, so the worker was asked once to fix it and report again.";
                        if let Err(e) = store::record_alone(db, link.kind, link.item_id, Some(link.id), SENT_BACK, reason) {
                            log::warn!("[watcher] link {}: {e}", link.id);
                        }
                        return (true, true);
                    }
                    Err(e) => log::warn!("[watcher] could not type the failed check into link {}: {e}", link.id),
                }
            }
        }
    }
    (finish(Some(false), Some(output), "failed"), true)
}

#[cfg(test)]
mod tests {
    use super::super::git::fake::{out, FakeGit};
    use super::super::tests::{app, db_of, deps, T0};
    use super::super::{tick, Memory, Report};
    use super::*;
    use crate::agents::cli::{write_settings, AgentsSettings, Cli};
    use crate::agents::model::parse_agents;
    use crate::agents::links::ItemKind;
    use rusqlite::Connection;
    use std::sync::Mutex;

    const DONE: &str = r#"[{"sessionId":"00000000-1111-2222-3333-444444444444","id":"abc12345","name":"sm-w-task-1","cwd":"/x","kind":"bg","status":"idle","state":"done"}]"#;
    const WORKING: &str = r#"[{"sessionId":"00000000-1111-2222-3333-444444444444","id":"abc12345","name":"sm-w-task-1","cwd":"/x","kind":"bg","status":"busy"}]"#;
    const MIN: i64 = 60_000;

    struct Fx {
        dir: PathBuf,
        db: PathBuf,
        wt: String,
        git: FakeGit,
        sent: Mutex<Vec<String>>,
        send_result: Mutex<Result<(), String>>,
    }

    fn numstat_git(numstat: &'static str, diff: String) -> FakeGit {
        FakeGit::new(move |c| match c {
            "merge-base origin/main HEAD" => out(0, "abc123\n"),
            "diff --numstat --no-renames abc123 --" => out(0, numstat),
            "diff --name-status --no-renames abc123 --" => out(0, "M\ta.txt\nD\tb.txt\n"),
            "diff --no-ext-diff --no-color --no-renames abc123 --" => out(0, &diff),
            _ => out(0, ""),
        })
    }

    /// An app folder with one task "Poster tool" (id 1, running, with a reported result), a
    /// worktree folder, and one open watcher link (id 1) that reported.
    fn fx(name: &str, check: Option<&str>) -> Fx {
        let dir = app(&format!("check-{name}"), &["a"]);
        let db = db_of(&dir, "a");
        let wt = dir.join("worktree");
        std::fs::create_dir_all(&wt).unwrap();
        let c = Connection::open(&db).unwrap();
        c.execute("UPDATE projects SET check_command = ?1", [check]).unwrap();
        c.execute("INSERT INTO tasks (project_id, title, stage, result) VALUES (1, 'Poster tool', 'running', 'Made the poster tool.')", [])
            .unwrap();
        c.execute(
            "INSERT INTO task_agents (task_id, short_id, name, started_at, started_by, worktree, base_ref, reported_at)
             VALUES (1, 'abc12345', 'sm-w-task-1', '2027-01-15 08:00:00', 'watcher', ?1, 'origin/main', datetime('now'))",
            [wt.to_string_lossy().to_string()],
        )
        .unwrap();
        Fx {
            dir,
            db,
            wt: wt.to_string_lossy().to_string(),
            git: numstat_git("10\t2\ta.txt\n3\t0\tb.txt\n", "diff --git a/a.txt b/a.txt\n+x\n".to_string()),
            sent: Mutex::new(vec![]),
            send_result: Mutex::new(Ok(())),
        }
    }

    /// A pass `minutes` after the link started, with the list made one minute before it.
    fn go(f: &Fx, agents_json: &str, mem: &mut Memory, minutes: i64) -> Report {
        let agents = parse_agents(agents_json).unwrap();
        let mut d = deps(&f.dir, &agents);
        d.now = T0 + minutes * MIN;
        d.listed_at = Some(d.now - MIN);
        run(f, &d, mem)
    }

    fn run(f: &Fx, d: &Deps, mem: &mut Memory) -> Report {
        mem.loaded = true;
        if mem.started == 0 {
            mem.started = T0;
        }
        let get_cli = || Err::<Box<dyn Cli>, String>("no claude in this test".into());
        let trusted = Vec::new;
        let send = |_: &Agent, text: &str| {
            f.sent.lock().unwrap().push(text.to_string());
            f.send_result.lock().unwrap().clone()
        };
        let path = || "/usr/bin:/bin".to_string();
        let env = Env { git: &f.git, cli: &get_cli, trusted: &trusted, dev: false, mcp_path: "/x", send: &send, path_env: &path, transcript_tail: &|_: &str| None };
        tick(d, mem, Some(&env))
    }

    fn one<T: rusqlite::types::FromSql>(db: &Path, sql: &str) -> T {
        Connection::open(db).unwrap().query_row(sql, [], |r| r.get(0)).unwrap()
    }

    fn entries(f: &Fx) -> i64 {
        one(&f.db, "SELECT COUNT(*) FROM needs_you WHERE kind = 'check'")
    }

    // ------------------------------------------------------------ the pieces

    #[test]
    fn a_check_passes_and_fails_by_exit_code() {
        let d = std::env::temp_dir().to_string_lossy().to_string();
        assert!(run_check("true", &d, "/usr/bin:/bin").passed);
        let r = run_check("echo broken >&2; false", &d, "/usr/bin:/bin");
        assert!(!r.passed && !r.timed_out);
        assert!(r.tail.contains("broken"));
        let missing = run_check("true", "/nonexistent-folder/x", "/usr/bin:/bin");
        assert!(!missing.passed && missing.error.is_some());
    }

    #[test]
    fn a_check_that_takes_too_long_is_stopped() {
        let d = std::env::temp_dir().to_string_lossy().to_string();
        let t = std::time::Instant::now();
        let r = run_check_with("sleep 5", &d, "/usr/bin:/bin", Duration::from_millis(300));
        assert!(!r.passed && r.timed_out);
        assert!(t.elapsed() < Duration::from_secs(4));
    }

    #[test]
    fn for_agent_keeps_the_end_and_removes_control_characters() {
        let s = for_agent("\x1b[31mred\x1b[0m\ttab\r\nline\x07\x08end");
        assert!(!s.contains('\x1b'));
        assert_eq!(s, "red\ttab\nlineend");
        assert!(crate::agents::validate::normalise_message(&s).is_some());
        let long = format!("{}{}", "a".repeat(20_000), "é".repeat(10));
        let cut = for_agent(&long);
        assert!(cut.len() <= SENT_TAIL && cut.ends_with("éééééééééé"));
    }

    // ------------------------------------------------------------ the flow

    #[test]
    fn a_passing_check_writes_one_check_entry_the_ui_reads() {
        let f = fx("pass", Some("true"));
        let mut mem = Memory::default();
        go(&f, DONE, &mut mem, 10);
        let db = &f.db;
        assert_eq!(entries(&f), 1);
        let row: (String, String, i64, Option<i64>, String, String, String) = Connection::open(db)
            .unwrap()
            .query_row(
                "SELECT title, body, check_passed, change_lines, touches, lead_state, status FROM needs_you",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
            )
            .unwrap();
        assert_eq!(row, ("Poster tool".into(), "Made the poster tool.".into(), 1, Some(15), "[]".into(), "waiting".into(), "open".into()));
        assert_eq!(one::<String>(db, "SELECT check_state FROM task_agents"), "passed");
        assert_eq!(one::<String>(db, "SELECT stage FROM tasks WHERE id = 1"), "to_check");
        assert_eq!(one::<i64>(db, "SELECT link_id FROM needs_you"), 1);
        assert!(f.sent.lock().unwrap().is_empty());
    }

    #[test]
    fn the_diff_file_is_where_the_mcp_server_reads_it() {
        let f = fx("diffpath", Some("true"));
        go(&f, DONE, &mut Memory::default(), 10);
        let id: i64 = one(&f.db, "SELECT id FROM needs_you");
        // `get_needs_you`: <data dir>/lead/checks/<org id>-<entry id>.diff
        let expected = f.dir.join("lead").join("checks").join(format!("a-{id}.diff"));
        assert_eq!(diff_path(&f.dir, "a", id), expected);
        assert_eq!(std::fs::read_to_string(expected).unwrap(), "diff --git a/a.txt b/a.txt\n+x\n");
    }

    #[test]
    fn a_small_diff_is_stored_whole_and_a_long_one_is_capped_with_a_notice() {
        let mut f = fx("diffcap", Some("true"));
        f.git = numstat_git("1\t0\ta.txt\n", "é".repeat(100_000));
        go(&f, DONE, &mut Memory::default(), 10);
        let id: i64 = one(&f.db, "SELECT id FROM needs_you");
        let text = std::fs::read_to_string(diff_path(&f.dir, "a", id)).unwrap();
        assert!(text.len() <= DIFF_CAP && text.starts_with(DIFF_CUT_NOTICE));
        let lines = "x".repeat(9) + "\n";
        let g = numstat_git("1\t0\ta.txt\n", lines.repeat(30_000));
        let facts = diff_facts(&g, &f.wt, "origin/main").unwrap();
        assert!(facts.head.len() <= DIFF_CAP && facts.head.starts_with(DIFF_CUT_NOTICE));
        let body: Vec<&str> = facts.head.lines().skip(1).collect();
        assert!(body[..body.len() - 1].iter().all(|l| *l == "xxxxxxxxx"), "complete lines follow the notice");
    }

    #[test]
    fn an_over_64_kb_diff_is_stored_with_the_notice_and_a_small_one_without() {
        let big = "+added line of the change\n".repeat(4_000);
        assert!(big.len() > TAIL_BYTES);
        let tail = &big[big.len() - TAIL_BYTES..];
        let g = numstat_git("1\t0\ta.txt\n", tail.to_string());
        let facts = diff_facts(&g, "/x", "origin/main").unwrap();
        let (first, rest) = facts.head.split_once('\n').unwrap();
        assert_eq!(first, DIFF_CUT_NOTICE);
        assert!(rest.lines().all(|l| l == "+added line of the change"), "continues from a complete line");
        assert!(facts.complete && facts.lines == Some(1));
        let small = numstat_git("1\t0\ta.txt\n", "+x\n".to_string());
        assert_eq!(diff_facts(&small, "/x", "origin/main").unwrap().head, "+x\n");
    }

    #[test]
    fn a_cut_numstat_gives_no_lines_and_no_touches() {
        // Over 64 KB, and a cut in the middle of a line that parses as a smaller number.
        let long = "12\t3\tsome/path/to/a/file.txt\n".repeat(3_000);
        let cut = long[long.len() - TAIL_BYTES..].to_string();
        let g = FakeGit::new(move |c| match c {
            "merge-base origin/main HEAD" => out(0, "abc123\n"),
            "diff --numstat --no-renames abc123 --" => out(0, &format!("3\t4\tx\n{cut}")),
            _ => out(0, ""),
        });
        let facts = diff_facts(&g, "/x", "origin/main").unwrap();
        assert_eq!((facts.lines, facts.complete), (None, false));
        let mut f = fx("cutnumstat", Some("true"));
        let tail = "23\t4\tx\n".repeat(10_000);
        let tail = tail[tail.len() - TAIL_BYTES..].to_string();
        f.git = FakeGit::new(move |c| match c {
            "merge-base origin/main HEAD" => out(0, "abc123\n"),
            "diff --numstat --no-renames abc123 --" => out(0, &tail),
            _ => out(0, "M\ta.txt\n"),
        });
        go(&f, DONE, &mut Memory::default(), 10);
        assert_eq!(entries(&f), 1);
        assert_eq!(one::<Option<i64>>(&f.db, "SELECT change_lines FROM needs_you"), None);
        assert_eq!(one::<Option<String>>(&f.db, "SELECT touches FROM needs_you"), None);
        assert_eq!(one::<i64>(&f.db, "SELECT check_passed FROM needs_you"), 1);
    }

    #[test]
    fn a_cut_name_status_makes_the_facts_incomplete() {
        let names = "M\tsome/path/to/a/file.txt\n".repeat(4_000);
        let names = names[names.len() - TAIL_BYTES..].to_string();
        let g = FakeGit::new(move |c| match c {
            "merge-base origin/main HEAD" => out(0, "abc123\n"),
            "diff --name-status --no-renames abc123 --" => out(0, &names),
            "diff --numstat --no-renames abc123 --" => out(0, "1\t0\ta.txt\n"),
            _ => out(0, ""),
        });
        let facts = diff_facts(&g, "/x", "origin/main").unwrap();
        assert_eq!((facts.complete, facts.lines), (false, None));
    }

    #[test]
    fn a_failing_entry_write_does_not_run_the_command_again() {
        let f = fx("nowrite", Some("echo run >> ran.log"));
        let log = Path::new(&f.wt).join("ran.log");
        let c = Connection::open(&f.db).unwrap();
        c.execute_batch("ALTER TABLE needs_you RENAME TO needs_you_away").unwrap();
        let mut mem = Memory::default();
        go(&f, DONE, &mut mem, 10);
        go(&f, DONE, &mut mem, 11);
        go(&f, DONE, &mut mem, 12);
        assert_eq!(std::fs::read_to_string(&log).unwrap().lines().count(), 1);
        c.execute_batch("ALTER TABLE needs_you_away RENAME TO needs_you").unwrap();
        go(&f, DONE, &mut mem, 13);
        go(&f, DONE, &mut mem, 14);
        assert_eq!(std::fs::read_to_string(&log).unwrap().lines().count(), 1, "the command ran once");
        assert_eq!(entries(&f), 1);
        assert_eq!(one::<i64>(&f.db, "SELECT check_passed FROM needs_you"), 1);
        assert_eq!(one::<String>(&f.db, "SELECT check_state FROM task_agents"), "passed");
    }

    #[test]
    fn a_binary_change_has_no_line_count() {
        let mut f = fx("binary", Some("true"));
        f.git = numstat_git("-\t-\tlogo.png\n4\t1\ta.txt\n", "Binary files differ\n".into());
        go(&f, DONE, &mut Memory::default(), 10);
        assert_eq!(one::<Option<i64>>(&f.db, "SELECT change_lines FROM needs_you"), None);
        assert_eq!(one::<String>(&f.db, "SELECT touches FROM needs_you"), "[]");
        let facts = diff_facts(&f.git, &f.wt, "origin/main").unwrap();
        assert_eq!((facts.lines, facts.paths.len(), facts.deleted), (None, 2, vec!["b.txt".to_string()]));
    }

    #[test]
    fn a_failed_diff_still_gives_an_entry_with_no_lines() {
        let mut f = fx("nodiff", Some("true"));
        f.git = FakeGit::new(|_| out(128, "fatal: bad revision"));
        go(&f, DONE, &mut Memory::default(), 10);
        assert_eq!(entries(&f), 1);
        assert_eq!(one::<Option<i64>>(&f.db, "SELECT change_lines FROM needs_you"), None);
        assert_eq!(one::<Option<String>>(&f.db, "SELECT touches FROM needs_you"), None);
        assert_eq!(one::<i64>(&f.db, "SELECT check_passed FROM needs_you"), 1);
    }

    #[test]
    fn the_first_failure_goes_back_to_the_worker_once() {
        let f = fx("sendback", Some("echo lint failed; false"));
        let mut mem = Memory::default();
        go(&f, DONE, &mut mem, 10);
        let sent = f.sent.lock().unwrap().clone();
        assert_eq!(sent.len(), 1);
        assert!(sent[0].starts_with("The check command failed. Fix it, then call report_result again. Output:\n"));
        assert!(sent[0].contains("lint failed"));
        assert_eq!(entries(&f), 0, "no Check entry yet");
        assert_eq!(one::<i64>(&f.db, "SELECT check_fails FROM task_agents"), 1);
        assert_eq!(one::<Option<String>>(&f.db, "SELECT check_state FROM task_agents"), None);
        assert_eq!(one::<i64>(&f.db, "SELECT reported_at IS NULL FROM task_agents"), 1);
        assert_eq!(one::<i64>(&f.db, "SELECT ended_at IS NULL FROM task_agents"), 1, "the link stays");
        assert_eq!(one::<String>(&f.db, "SELECT stage FROM tasks WHERE id = 1"), "running");
        let (kind, status, by, title, reason): (String, String, String, String, String) = Connection::open(&f.db)
            .unwrap()
            .query_row(
                "SELECT kind, status, decided_by, title, reason FROM needs_you WHERE kind = 'alone'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .unwrap();
        assert_eq!((kind.as_str(), status.as_str(), by.as_str(), title.as_str()), ("alone", "answered", "app", SENT_BACK));
        assert!(!reason.is_empty());
        // The agent still lists as done and has not reported again: not "ended without a result".
        go(&f, DONE, &mut mem, 11);
        assert_eq!(one::<i64>(&f.db, "SELECT ended_at IS NULL FROM task_agents"), 1);
        assert_eq!(entries(&f), 0);
        // It works, reports again (the MCP server writes reported_at) and fails again: the owner.
        go(&f, WORKING, &mut mem, 12);
        Connection::open(&f.db).unwrap().execute("UPDATE task_agents SET reported_at = datetime('now')", []).unwrap();
        go(&f, DONE, &mut mem, 13);
        assert_eq!(f.sent.lock().unwrap().len(), 1, "never a second send back");
        assert_eq!(entries(&f), 1);
        assert_eq!(one::<i64>(&f.db, "SELECT check_passed FROM needs_you WHERE kind = 'check'"), 0);
    }

    #[test]
    fn second_check_failure_goes_to_loris() {
        let f = fx("second", Some("echo still broken; false"));
        Connection::open(&f.db).unwrap().execute("UPDATE task_agents SET check_fails = 1", []).unwrap();
        go(&f, DONE, &mut Memory::default(), 10);
        assert!(f.sent.lock().unwrap().is_empty());
        assert_eq!(entries(&f), 1);
        let (passed, output): (i64, String) = Connection::open(&f.db)
            .unwrap()
            .query_row("SELECT check_passed, check_output FROM needs_you", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(passed, 0);
        assert!(output.contains("still broken"));
        assert_eq!(one::<String>(&f.db, "SELECT check_state FROM task_agents"), "failed");
        assert_eq!(one::<i64>(&f.db, "SELECT check_fails FROM task_agents"), 1);
    }

    #[test]
    fn check_fails_survives_reopening_the_database() {
        let f = fx("reopen", Some("false"));
        go(&f, DONE, &mut Memory::default(), 10);
        // A new connection, a new Memory: the counter is in the row.
        assert_eq!(one::<i64>(&f.db, "SELECT check_fails FROM task_agents"), 1);
        assert_eq!(store::bump(&f.db, 1, store::Counter::CheckFails).unwrap(), 2);
        assert_eq!(store::bump(&f.db, 1, store::Counter::SentBack).unwrap(), 1);
    }

    #[test]
    fn bump_happens_before_the_send_and_a_failing_send_gives_the_entry_not_a_second_send() {
        let f = fx("sendfails", Some("echo nope; false"));
        *f.send_result.lock().unwrap() = Err("Answer the open prompt first".into());
        let mut mem = Memory::default();
        go(&f, DONE, &mut mem, 10);
        assert_eq!(f.sent.lock().unwrap().len(), 1, "typing was tried once");
        assert_eq!(one::<i64>(&f.db, "SELECT reported_at IS NULL FROM task_agents"), 1, "cleared with the decision");
        assert_eq!(one::<String>(&f.db, "SELECT check_state FROM task_agents"), "failed");
        assert_eq!(one::<i64>(&f.db, "SELECT check_fails FROM task_agents"), 1);
        assert_eq!(entries(&f), 1);
        assert!(one::<String>(&f.db, "SELECT check_output FROM needs_you").contains("nope"));
        assert_eq!(one::<i64>(&f.db, "SELECT COUNT(*) FROM needs_you WHERE kind = 'alone'"), 0, "nothing was sent");
        for n in 11..15 {
            go(&f, DONE, &mut mem, n);
        }
        assert_eq!(f.sent.lock().unwrap().len(), 1);
        assert_eq!(entries(&f), 1);
    }

    #[test]
    fn a_running_check_found_at_start_runs_again_and_counts_no_failure() {
        let f = fx("running", Some("true"));
        Connection::open(&f.db).unwrap().execute("UPDATE task_agents SET check_state = 'running'", []).unwrap();
        go(&f, DONE, &mut Memory::default(), 10);
        assert_eq!(one::<i64>(&f.db, "SELECT check_fails FROM task_agents"), 0);
        assert_eq!(one::<String>(&f.db, "SELECT check_state FROM task_agents"), "passed");
        assert_eq!(entries(&f), 1);
        assert_eq!(one::<i64>(&f.db, "SELECT check_passed FROM needs_you"), 1);
    }

    #[test]
    fn worktree_gone_gives_a_check_entry_and_no_send_back() {
        let f = fx("gone", Some("false"));
        std::fs::remove_dir_all(&f.wt).unwrap();
        go(&f, DONE, &mut Memory::default(), 10);
        assert!(f.sent.lock().unwrap().is_empty());
        assert_eq!(one::<String>(&f.db, "SELECT title FROM needs_you"), WORKTREE_GONE);
        assert_eq!(one::<Option<i64>>(&f.db, "SELECT check_passed FROM needs_you"), None);
        assert_eq!(one::<i64>(&f.db, "SELECT check_fails FROM task_agents"), 0);
    }

    #[test]
    fn no_check_command_means_no_verdict() {
        let f = fx("nocmd", None);
        go(&f, DONE, &mut Memory::default(), 10);
        assert_eq!(entries(&f), 1);
        assert_eq!(one::<Option<i64>>(&f.db, "SELECT check_passed FROM needs_you"), None);
        assert_eq!(one::<String>(&f.db, "SELECT check_state FROM task_agents"), "none");
        // Blank counts as none.
        let g = fx("blankcmd", Some("   "));
        go(&g, DONE, &mut Memory::default(), 10);
        assert_eq!(one::<Option<i64>>(&g.db, "SELECT check_passed FROM needs_you"), None);
    }

    #[test]
    fn a_worker_that_ended_without_a_result_closes_its_link() {
        let f = fx("noresult", Some("touch ran.txt"));
        Connection::open(&f.db).unwrap().execute("UPDATE task_agents SET reported_at = NULL", []).unwrap();
        go(&f, DONE, &mut Memory::default(), 10);
        assert_eq!(one::<String>(&f.db, "SELECT title FROM needs_you"), NO_RESULT);
        assert_eq!(one::<String>(&f.db, "SELECT outcome FROM task_agents"), "no_result");
        assert_eq!(one::<i64>(&f.db, "SELECT ended_at IS NOT NULL FROM task_agents"), 1);
        assert!(!Path::new(&f.wt).join("ran.txt").exists(), "no check ran");
        assert_eq!(one::<String>(&f.db, "SELECT stage FROM tasks WHERE id = 1"), "to_check");
    }

    #[test]
    fn exactly_one_check_entry_over_ten_passes() {
        let f = fx("ten", Some("true"));
        let mut mem = Memory::default();
        for n in 10..20 {
            go(&f, DONE, &mut mem, n);
        }
        assert_eq!(entries(&f), 1);
        // Even with the state cleared (a crash after the entry), an open entry blocks a second.
        Connection::open(&f.db).unwrap().execute("UPDATE task_agents SET check_state = NULL", []).unwrap();
        go(&f, DONE, &mut mem, 21);
        assert_eq!(entries(&f), 1);
    }

    // ------------------------------------------------------------ who and when

    #[test]
    fn nothing_runs_when_the_gate_is_closed_or_the_lock_is_not_held() {
        let f = fx("gate", Some("touch ran.txt"));
        let marker = Path::new(&f.wt).join("ran.txt");
        // The watcher switch is off.
        write_settings(&f.dir, &AgentsSettings { enabled: true, watcher: false, ..Default::default() }).unwrap();
        let mut mem = Memory::default();
        go(&f, DONE, &mut mem, 10);
        // Another copy of the app holds the lock.
        write_settings(&f.dir, &AgentsSettings { enabled: true, watcher: true, ..Default::default() }).unwrap();
        let other = super::super::acquire_lock(&f.dir).unwrap();
        go(&f, DONE, &mut mem, 11);
        assert!(!marker.exists());
        assert_eq!(entries(&f), 0);
        drop(other);
        // A mode in an organisation.
        std::fs::write(crate::orgs::org_dir(&f.dir, "a").join("studiomanager_test.db"), "").unwrap();
        go(&f, DONE, &mut mem, 12);
        assert!(!marker.exists());
        assert_eq!(entries(&f), 0);
        std::fs::remove_file(crate::orgs::org_dir(&f.dir, "a").join("studiomanager_test.db")).unwrap();
        // Open: it runs.
        go(&f, DONE, &mut mem, 13);
        assert!(marker.exists());
        assert_eq!(entries(&f), 1);
    }

    #[test]
    fn the_budget_does_not_gate_the_check() {
        let f = fx("budget", Some("true"));
        std::fs::remove_file(f.dir.join("limits.json")).unwrap();
        go(&f, DONE, &mut Memory::default(), 10);
        assert_eq!(entries(&f), 1);
    }

    #[test]
    fn a_hand_started_agents_link_is_never_checked_or_typed_into() {
        let f = fx("hand", Some("false"));
        Connection::open(&f.db).unwrap().execute("UPDATE task_agents SET started_by = NULL", []).unwrap();
        let mut mem = Memory::default();
        go(&f, DONE, &mut mem, 10);
        go(&f, DONE, &mut mem, 11);
        assert!(f.sent.lock().unwrap().is_empty());
        assert_eq!(entries(&f), 0);
        assert_eq!(one::<i64>(&f.db, "SELECT check_fails FROM task_agents"), 0);
        assert_eq!(one::<Option<String>>(&f.db, "SELECT check_state FROM task_agents"), None);
    }

    #[test]
    fn a_stale_or_older_list_is_not_trusted_for_finished() {
        let f = fx("stale", Some("true"));
        let agents = parse_agents(DONE).unwrap();
        let mut mem = Memory::default();
        // A list made before this watcher started.
        let mut d = deps(&f.dir, &agents);
        d.now = T0 + 10 * MIN;
        d.listed_at = Some(T0 - MIN);
        run(&f, &d, &mut mem);
        // A list far older than a poller pass.
        d.listed_at = Some(d.now - 30 * MIN);
        run(&f, &d, &mut mem);
        assert_eq!(entries(&f), 0);
        d.listed_at = Some(d.now - MIN);
        run(&f, &d, &mut mem);
        assert_eq!(entries(&f), 1);
    }

    #[test]
    fn an_agent_missing_from_one_fresh_list_is_not_acted_on_from_two_it_is() {
        let f = fx("miss", Some("true"));
        let mut mem = Memory::default();
        go(&f, "[]", &mut mem, 10);
        assert_eq!(entries(&f), 0);
        // The same list again says nothing new.
        let agents = parse_agents("[]").unwrap();
        let mut d = deps(&f.dir, &agents);
        d.now = T0 + 10 * MIN + 5_000;
        d.listed_at = Some(T0 + 9 * MIN);
        run(&f, &d, &mut mem);
        assert_eq!(entries(&f), 0);
        // The agent shows up: the count restarts.
        go(&f, WORKING, &mut mem, 11);
        go(&f, "[]", &mut mem, 12);
        assert_eq!(entries(&f), 0);
        go(&f, "[]", &mut mem, 13);
        assert_eq!(entries(&f), 1);
        assert_eq!(one::<i64>(&f.db, "SELECT check_passed FROM needs_you"), 1);
        assert!(f.sent.lock().unwrap().is_empty(), "no agent to type into");
    }

    #[test]
    fn a_failed_check_of_a_gone_agent_is_not_typed_and_counts_no_failure() {
        let f = fx("gonefail", Some("false"));
        let mut mem = Memory::default();
        go(&f, "[]", &mut mem, 10);
        go(&f, "[]", &mut mem, 11);
        assert!(f.sent.lock().unwrap().is_empty());
        assert_eq!(entries(&f), 1);
        assert_eq!(one::<i64>(&f.db, "SELECT check_passed FROM needs_you"), 0);
    }

    #[test]
    fn add_entry_still_writes_a_decide_entry() {
        let f = fx("decide", None);
        let id = store::add_entry(&f.db, ItemKind::Task, 1, "Could not start: x", "body").unwrap();
        assert_eq!(one::<String>(&f.db, &format!("SELECT kind FROM needs_you WHERE id = {id}")), "decide");
    }
}
