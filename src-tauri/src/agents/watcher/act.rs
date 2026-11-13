//! What the watcher does about a worker that stopped on its own: stuck on a connection error
//! (asked to continue, at most three times), waiting at a prompt, idle without a result or a
//! question (a Decide entry for the owner), and old (asked to wrap up, stopped 30 minutes later).
//! `Gone` and `Finished` are `check`'s. Only watcher links are looked at (`WatcherLink`); nothing
//! is ever deleted. Plan: docs/superpowers/plans/2026-11-13-agent-orchestrator-3-watcher-lead.md
//! (Task 11).
//!
//! A pass does at most one thing per link. A resume spends the plan's usage again, so it waits for
//! `Budget::Ok` like a start; the entries cost nothing and are not gated by it. The decision is
//! written (counter, `wrap_asked_at`) before the message is typed, so a failed send still counts.

use super::budget::Budget;
use super::events::{notice, stuck_in, Event, STUCK_IDLE_MS};
use super::start::Env;
use super::store::{self, Counter, LinkEntry, NewCheck, WatcherLink};
use super::{Deps, Memory};
use crate::agents::actions;
use crate::agents::model::{Agent, Group};
use std::path::{Path, PathBuf};

/// A worker is asked to continue this many times; after that the owner decides.
pub const MAX_RESUMES: i64 = 3;
/// A worker asked to continue is not asked again for this long.
pub const RESUME_RETRY_MS: i64 = 5 * 60_000;
/// After the wrap-up request, a worker still idle this long is stopped.
pub const WRAP_WAIT_MS: i64 = 30 * 60_000;

pub const CONTINUE: &str = "Continue where you stopped.";
pub const WRAP_UP: &str = "Write your result with report_result now, then stop.";
pub const STUCK_ENTRY: &str = "Stuck after three restarts";
pub const NO_RESULT_OR_QUESTION: &str = store::IDLE_ENTRY;
pub const WRAP_FAILED: &str = "Could not ask the worker to wrap up";
pub const WAITING: &str = "Waiting at a prompt";
pub const WRAPPED_UP: &str = "Wrapped up after a day";
pub const WRAP_STOPPED: &str = "Stopped after a day without a result";

pub(super) fn since_of(mem: &Memory, link: &WatcherLink, agent: &Agent, now: i64) -> i64 {
    match mem.seen.get(&(link.org.clone(), link.id)) {
        Some((g, t)) if *g == agent.group => *t,
        _ => now,
    }
}

fn warn(link: &WatcherLink, what: &str, e: &str) {
    log::warn!("[watcher] link {} of organisation {}: {what}: {e}", link.id, link.org);
}

/// Handles the stopped links among `links`; true when something was written or typed. The caller
/// has the lock, the gate is open and `env` is given.
pub fn step(env: &Env, d: &Deps, mem: &mut Memory, budget: &Budget, links: &[(PathBuf, WatcherLink)]) -> bool {
    let same = |k: &(String, i64), l: &WatcherLink| k.0 == l.org && k.1 == l.id;
    mem.noted.retain(|(org, id, _, _)| links.iter().any(|(_, l)| same(&(org.clone(), *id), l)));
    mem.resumed_at.retain(|k, _| links.iter().any(|(_, l)| same(k, l)));
    // A list too old to be trusted says nothing about what the agents are doing.
    let trusted = d.listed_at.is_some_and(|t| t > mem.started && d.now - t <= super::check::LIST_MAX_AGE_MS);
    if !trusted {
        return false;
    }
    let mut changed = false;
    for (db, link) in links {
        // The owner's Check entry (or a check running) is waiting.
        if link.check_state.is_some() {
            continue;
        }
        let Some(agent) = super::check::find_agent(d.agents, link) else { continue };
        // The wait of an entry ended by itself: close it, and do nothing else for this link now.
        if agent.status != "waiting" {
            let open = {
                let _shared = crate::org_shared();
                store::open_prompt(db, link.id)
            };
            if let Ok(Some(_)) = open {
                let _shared = crate::org_shared();
                match store::close_prompt(db, link.id) {
                    Ok(()) => changed = true,
                    Err(e) => warn(link, "could not close the prompt entry", &e),
                }
                continue;
            }
        }
        // Already handed to the owner after the restarts: never resumed again (it may still be
        // wrapped up when old).
        let given_up = link.resumes >= MAX_RESUMES && {
            let _shared = crate::org_shared();
            matches!(store::link_outcome(db, link.id), Ok(Some(o)) if o == "stuck")
        };
        let since = since_of(mem, link, agent, d.now);
        // The transcript is read only for an idle agent that has been idle for a while.
        let stuck = !given_up
            && agent.group == Group::Idle
            && d.now - since >= STUCK_IDLE_MS
            && (env.transcript_tail)(&agent.session_id).is_some_and(|t| stuck_in(&t));
        let ask = {
            let _shared = crate::org_shared();
            store::open_ask(db, link.id)
        }
        .unwrap_or_else(|e| {
            warn(link, "could not read the questions", &e);
            None
        });
        let seen = WatcherLink { seen_since: Some(since), ..link.clone() };
        let Some(event) = notice(&seen, Some(agent), stuck, ask, d.now, d.listed_at) else { continue };
        changed |= match event {
            Event::Stuck => resume(env, d, mem, budget, db, link, agent),
            Event::AtPrompt { since } => {
                let title = agent.waiting_for.as_deref().map(str::trim).filter(|t| !t.is_empty()).unwrap_or(WAITING);
                let body = &format!("{WAITING}: {title}. Open the agent to answer it.");
                note(mem, db, link, "prompt", since, LinkEntry { lead_state: Some("prompt"), title, body, ..entry(link) })
            }
            Event::IdleNoResult { since } => {
                let body = format!(
                    "{NO_RESULT_OR_QUESTION}. The worker is idle: it did not call report_result and did not ask a question. \
                     Type an instruction into it from here, or open it."
                );
                let body = body.as_str();
                note(mem, db, link, "idle", since, LinkEntry { title: NO_RESULT_OR_QUESTION, body, ..entry(link) })
            }
            Event::Old => old(env, d, db, link, agent),
            // The question is the owner's; a finished or gone worker is `check`'s.
            Event::Asked { .. } | Event::Finished { .. } | Event::Gone => false,
        };
    }
    changed
}

fn entry(link: &WatcherLink) -> LinkEntry<'static> {
    LinkEntry {
        kind: link.kind,
        item_id: link.item_id,
        link_id: link.id,
        lead_state: None,
        title: "",
        body: "",
        outcome: None,
    }
}

/// One entry per wait: written once for a (link, kind, start of the wait), so one the owner
/// dismissed is not written again while the same wait goes on. The database is asked too, so a
/// restart never writes a second open entry.
fn note(mem: &mut Memory, db: &Path, link: &WatcherLink, kind: &'static str, since: i64, e: LinkEntry) -> bool {
    let key = (link.org.clone(), link.id, kind, since);
    if mem.noted.contains(&key) {
        return false;
    }
    let written = {
        let _shared = crate::org_shared();
        store::add_link_entry(db, &e)
    };
    match written {
        Ok(id) => {
            mem.noted.insert(key);
            id.is_some()
        }
        Err(err) => {
            warn(link, "could not write the entry", &err);
            false
        }
    }
}

/// A worker stopped on a connection error: asked to continue, at most `MAX_RESUMES` times.
fn resume(env: &Env, d: &Deps, mem: &mut Memory, budget: &Budget, db: &Path, link: &WatcherLink, agent: &Agent) -> bool {
    if link.resumes >= MAX_RESUMES {
        let body = format!(
            "{STUCK_ENTRY}. The worker stopped on a connection error and was asked to continue three times. \
             Type an instruction into it from here, or open it."
        );
        let body = body.as_str();
        let written = {
            let _shared = crate::org_shared();
            store::add_link_entry(db, &LinkEntry { title: STUCK_ENTRY, body, outcome: Some("stuck"), ..entry(link) })
        };
        return match written {
            Ok(id) => id.is_some(),
            Err(e) => {
                warn(link, "could not write the entry", &e);
                false
            }
        };
    }
    // A resume makes the worker spend usage again: the budget rule of a start. Over it, nothing is
    // counted and the link waits.
    if *budget != Budget::Ok {
        return false;
    }
    let key = (link.org.clone(), link.id);
    if mem.resumed_at.get(&key).is_some_and(|t| d.now - t < RESUME_RETRY_MS) {
        return false;
    }
    // Counted first: a failed send still counts.
    let n = {
        let _shared = crate::org_shared();
        store::bump(db, link.id, Counter::Resumes)
    };
    let n = match n {
        Ok(n) => n,
        Err(e) => {
            warn(link, "could not count the restart", &e);
            return false;
        }
    };
    mem.resumed_at.insert(key, d.now);
    let sent = if agent.pid.is_some() {
        (env.send)(agent, CONTINUE)
    } else {
        // Not running: start the session again on Opus with the worker's own arguments (the hook,
        // edits without a prompt, the dev server), the link follows the copy, then type into it.
        (env.cli)().and_then(|cli| {
            let hook = super::start::hook_settings(d.app_dir, env.mcp_path, env.dev)?;
            let extra = super::start::worker_args(env.dev, d.app_dir, env.mcp_path, &hook)?;
            let new_id = actions::resume_with(&*cli, &actions::home_dir(), agent, "opus", &extra)?;
            // Recorded before anything is typed: the old agent's "done" must not close the link.
            {
                let _shared = crate::org_shared();
                store::follow_copy(db, link.id, &new_id)?;
            }
            (env.send)(&Agent { short_id: Some(new_id), pid: None, ..agent.clone() }, CONTINUE)
        })
    };
    if let Err(e) = sent {
        warn(link, "could not restart the worker", &e);
        return true;
    }
    let text = format!("Restarted after a connection error ({n} of {MAX_RESUMES})");
    let reason = "The worker stopped on a connection error, so it was asked to continue.";
    let _shared = crate::org_shared();
    if let Err(e) = store::record_alone(db, link.kind, link.item_id, Some(link.id), &text, reason) {
        warn(link, "could not record the restart", &e);
    }
    true
}

/// A worker idle for a day: asked once to report; 30 minutes later still idle and with no new
/// result it is stopped (never deleted) and the owner gets a Check entry. A result reported after
/// the request is `check`'s: nothing here.
fn old(env: &Env, d: &Deps, db: &Path, link: &WatcherLink, agent: &Agent) -> bool {
    // A reported result is handed in: `check` handles it (`notice` says Finished once the agent is
    // idle), never a wrap-up.
    if link.reported {
        return false;
    }
    let Some(asked) = link.wrap_asked_at else {
        // Decided first: `wrap_asked_at` is set before the message is typed.
        let decided = {
            let _shared = crate::org_shared();
            store::ask_wrap_up(db, link.id, d.now)
        };
        if let Err(e) = decided {
            warn(link, "could not decide to ask for a result", &e);
            return false;
        }
        match (env.send)(agent, WRAP_UP) {
            Ok(()) => {
                let reason = "The worker had been idle for a day, so it was asked to write its result and stop.";
                let _shared = crate::org_shared();
                if let Err(e) = store::record_alone(db, link.kind, link.item_id, Some(link.id), "Asked to wrap up after a day", reason) {
                    warn(link, "could not record the request", &e);
                }
            }
            Err(e) => {
                warn(link, "could not type the request", &e);
                // Not asked: the worker is left alone and the owner is told.
                let body = format!("{WRAP_FAILED}. The worker has been idle for a day and the request could not be typed into it: {e}");
                let written = {
                    let _shared = crate::org_shared();
                    store::add_link_entry(db, &LinkEntry { title: WRAP_FAILED, body: &body, outcome: Some("wrap_failed"), ..entry(link) })
                };
                if let Err(e) = written {
                    warn(link, "could not write the entry", &e);
                }
            }
        }
        return true;
    };
    if d.now - asked < WRAP_WAIT_MS {
        return false;
    }
    let failed = {
        let _shared = crate::org_shared();
        store::link_outcome(db, link.id)
    };
    if matches!(failed, Ok(Some(o)) if o == "wrap_failed") {
        return false;
    }
    let short = agent.short_id.as_deref().unwrap_or(&link.short_id);
    let stopped = (env.cli)().and_then(|cli| actions::stop(&*cli, &actions::home_dir(), short));
    if let Err(e) = stopped {
        warn(link, "could not stop the worker", &e);
        return false;
    }
    let _shared = crate::org_shared();
    let facts = match store::item_facts(db, link.kind, link.item_id) {
        Ok(f) => f,
        Err(e) => {
            // The agent is stopped; `check` writes "Ended without a result" when it lists as done.
            warn(link, "could not read the item", &e);
            return true;
        }
    };
    let check = NewCheck {
        kind: link.kind,
        item_id: link.item_id,
        link_id: link.id,
        title: WRAPPED_UP.to_string(),
        body: "The worker was asked to report its result and did not. It was stopped.".to_string(),
        check_passed: None,
        check_output: None,
        change_lines: None,
        touches: None,
        check_state: None,
        close: Some("wrapped_up"),
    };
    let check = NewCheck { body: format!("{}\n\n{}", check.body, facts.result).trim().to_string(), ..check };
    if let Err(e) = store::add_check(db, &check) {
        warn(link, "could not write the Check entry", &e);
        return true;
    }
    let reason = "The worker did not report a result 30 minutes after it was asked to, so it was stopped.";
    if let Err(e) = store::record_alone(db, link.kind, link.item_id, Some(link.id), WRAP_STOPPED, reason) {
        warn(link, "could not record the stop", &e);
    }
    true
}

#[cfg(test)]
mod tests {
    use super::super::git::fake::FakeGit;
    use super::super::tests::{app, db_of, deps, T0};
    use super::super::{tick, Memory, Report};
    use super::*;
    use crate::agents::cli::{Cli, CliOutput};
    use crate::agents::model::parse_agents;
    use rusqlite::{params, Connection};
    use std::sync::{Arc, Mutex};

    const SID: &str = "00000000-1111-2222-3333-444444444444";
    const MIN: i64 = 60_000;
    const DAY_AGO: &str = "2027-01-14 08:00:00";
    const NOW: &str = "2027-01-15 08:00:00";
    const ERROR_TAIL: &str = r#"{"type":"user","message":{"content":"go"}}
{"type":"assistant","isApiErrorMessage":true,"error":"server_error","message":{"content":[{"type":"text","text":"API Error: Connection lost mid-response"}]}}
"#;

    struct FakeCli {
        calls: Mutex<Vec<Vec<String>>>,
        replies: Mutex<Vec<CliOutput>>,
    }

    struct Shared(Arc<FakeCli>);

    impl Cli for Shared {
        fn run(&self, a: &[String], _cwd: &Path) -> CliOutput {
            self.0.calls.lock().unwrap().push(a.to_vec());
            self.0.replies.lock().unwrap().pop().expect("unscripted claude call")
        }
    }

    fn reply(stdout: &str) -> CliOutput {
        CliOutput { code: 0, stdout: stdout.into(), stderr: String::new() }
    }

    struct Fx {
        dir: PathBuf,
        db: PathBuf,
        cli: Arc<FakeCli>,
        /// (short id, text, the link's `resumes` at the moment it was typed).
        sent: Mutex<Vec<(Option<String>, String, i64)>>,
        send_result: Mutex<Result<(), String>>,
        tail: Mutex<Option<String>>,
        week_percent: Mutex<u32>,
        /// Runs when the pass reads the world again after the check step (the world changing).
        on_refresh: Mutex<Option<Box<dyn Fn() + Send>>>,
        /// The list the second reading gives (the first list when None).
        refreshed_list: Mutex<Option<String>>,
        dev: Mutex<bool>,
    }

    /// One task "Poster tool" running, with one link (id 1): a watcher's, or a hand-started one.
    fn fx(name: &str, started: &str, by: Option<&str>, replies: Vec<CliOutput>) -> Fx {
        let dir = app(&format!("act-{name}"), &["a"]);
        let db = db_of(&dir, "a");
        let c = Connection::open(&db).unwrap();
        c.execute("INSERT INTO tasks (project_id, title, stage, result) VALUES (1, 'Poster tool', 'running', 'Made the poster tool.')", [])
            .unwrap();
        c.execute(
            "INSERT INTO task_agents (task_id, short_id, name, started_at, started_by)
             VALUES (1, 'abc12345', 'sm-w-task-1', ?1, ?2)",
            params![started, by],
        )
        .unwrap();
        Fx {
            dir,
            db,
            cli: Arc::new(FakeCli { calls: Mutex::new(vec![]), replies: Mutex::new(replies.into_iter().rev().collect()) }),
            sent: Mutex::new(vec![]),
            send_result: Mutex::new(Ok(())),
            tail: Mutex::new(None),
            week_percent: Mutex::new(10),
            on_refresh: Mutex::new(None),
            refreshed_list: Mutex::new(None),
            dev: Mutex::new(false),
        }
    }

    fn watcher(name: &str) -> Fx {
        fx(name, NOW, Some("watcher"), vec![])
    }

    fn agent_json(status: &str, state: Option<&str>, pid: bool, waiting: Option<&str>) -> String {
        let state = state.map(|s| format!(r#","state":"{s}""#)).unwrap_or_default();
        let pid = if pid { r#","pid":4242"# } else { "" };
        let waiting = waiting.map(|w| format!(r#","waitingFor":"{w}""#)).unwrap_or_default();
        format!(
            r#"[{{"sessionId":"{SID}","id":"abc12345","name":"sm-w-task-1","cwd":"/x","kind":"bg","status":"{status}"{state}{pid}{waiting}}}]"#
        )
    }

    fn idle() -> String {
        agent_json("idle", None, true, None)
    }

    /// A pass `minutes` after T0 (the link started then), with the list made a minute before it
    /// and fresh limits.
    fn go(f: &Fx, agent: &str, mem: &mut Memory, minutes: i64) -> Report {
        let now = T0 + minutes * MIN;
        let week = *f.week_percent.lock().unwrap();
        std::fs::write(
            f.dir.join("limits.json"),
            format!(
                r#"{{"savedAt":{},"rate_limits":{{"five_hour":{{"used_percentage":10,"resets_at":{}}},
                   "seven_day":{{"used_percentage":{week},"resets_at":{}}}}}}}"#,
                now / 1000,
                (now + 3_600_000) / 1000,
                (now + 302_400_000) / 1000
            ),
        )
        .unwrap();
        let agents = parse_agents(agent).unwrap();
        let refresh = || {
            if let Some(h) = f.on_refresh.lock().unwrap().as_ref() {
                h();
            }
            let again = f.refreshed_list.lock().unwrap().clone().map(|j| parse_agents(&j).unwrap());
            super::super::Fresh { now, agents: again.unwrap_or_else(|| agents.clone()), listed_at: Some(now - MIN) }
        };
        let mut d = deps(&f.dir, &agents);
        d.now = now;
        d.listed_at = Some(now - MIN);
        d.refresh = Some(&refresh);
        mem.loaded = true;
        if mem.started == 0 {
            mem.started = T0;
        }
        let get_cli = || Ok(Box::new(Shared(f.cli.clone())) as Box<dyn Cli>);
        let trusted = Vec::new;
        let git = FakeGit::repo();
        let send = |a: &Agent, text: &str| {
            let resumes: i64 = Connection::open(&f.db)
                .unwrap()
                .query_row("SELECT resumes FROM task_agents WHERE id = 1", [], |r| r.get(0))
                .unwrap();
            f.sent.lock().unwrap().push((a.short_id.clone(), text.to_string(), resumes));
            f.send_result.lock().unwrap().clone()
        };
        let path = || "/usr/bin:/bin".to_string();
        let tail = |_: &str| f.tail.lock().unwrap().clone();
        let env = super::super::start::Env {
            git: &git,
            cli: &get_cli,
            trusted: &trusted,
            dev: *f.dev.lock().unwrap(),
            mcp_path: "/x",
            send: &send,
            path_env: &path,
            transcript_tail: &tail,
        };
        tick(&d, mem, Some(&env))
    }

    fn one<T: rusqlite::types::FromSql>(f: &Fx, sql: &str) -> T {
        Connection::open(&f.db).unwrap().query_row(sql, [], |r| r.get(0)).unwrap()
    }

    fn texts(f: &Fx) -> Vec<String> {
        f.sent.lock().unwrap().iter().map(|s| s.1.clone()).collect()
    }

    fn calls(f: &Fx) -> Vec<Vec<String>> {
        f.cli.calls.lock().unwrap().clone()
    }

    fn alone(f: &Fx) -> Vec<String> {
        let c = Connection::open(&f.db).unwrap();
        let mut st = c.prepare("SELECT title FROM needs_you WHERE kind = 'alone' ORDER BY id").unwrap();
        st.query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect()
    }

    fn decide_count(f: &Fx) -> i64 {
        one(f, "SELECT COUNT(*) FROM needs_you WHERE kind = 'decide'")
    }

    // ------------------------------------------------------------ stuck

    #[test]
    fn resume_at_most_three_times_then_needs_you() {
        let f = watcher("resume3");
        *f.tail.lock().unwrap() = Some(ERROR_TAIL.to_string());
        let mut mem = Memory::default();
        go(&f, &idle(), &mut mem, 0);
        assert!(texts(&f).is_empty(), "the first sight acts on nothing");
        go(&f, &idle(), &mut mem, 3);
        assert_eq!(texts(&f), vec![CONTINUE], "a retry is not made at once");
        go(&f, &idle(), &mut mem, 4);
        assert_eq!(texts(&f).len(), 1);
        go(&f, &idle(), &mut mem, 9);
        go(&f, &idle(), &mut mem, 15);
        assert_eq!(texts(&f), vec![CONTINUE; 3]);
        assert_eq!(one::<i64>(&f, "SELECT resumes FROM task_agents"), 3);
        assert_eq!(
            alone(&f),
            vec![
                "Restarted after a connection error (1 of 3)",
                "Restarted after a connection error (2 of 3)",
                "Restarted after a connection error (3 of 3)"
            ]
        );
        // The fourth time: an entry for the owner, the link stays open, nothing is typed.
        go(&f, &idle(), &mut mem, 21);
        go(&f, &idle(), &mut mem, 27);
        assert_eq!(texts(&f).len(), 3);
        assert_eq!(decide_count(&f), 1);
        let (title, state, link): (String, Option<String>, i64) = Connection::open(&f.db)
            .unwrap()
            .query_row("SELECT title, lead_state, link_id FROM needs_you WHERE kind = 'decide'", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!((title.as_str(), state, link), (STUCK_ENTRY, None, 1));
        assert_eq!(one::<String>(&f, "SELECT outcome FROM task_agents"), "stuck");
        assert_eq!(one::<i64>(&f, "SELECT ended_at IS NULL FROM task_agents"), 1, "kept open");
        // Even a new process never resumes it again, nor writes a second entry.
        mem.lock = None; // the old process is gone and its lock with it
        let mut fresh = Memory::default();
        go(&f, &idle(), &mut fresh, 40);
        go(&f, &idle(), &mut fresh, 50);
        assert_eq!(texts(&f).len(), 3);
        assert_eq!(decide_count(&f), 1);
        assert!(calls(&f).is_empty(), "a listed process is typed into, never restarted");
    }

    #[test]
    fn a_resume_is_counted_before_the_message_and_a_failed_send_still_counts() {
        let f = watcher("counted");
        *f.tail.lock().unwrap() = Some(ERROR_TAIL.to_string());
        *f.send_result.lock().unwrap() = Err("no terminal".into());
        let mut mem = Memory::default();
        go(&f, &idle(), &mut mem, 0);
        go(&f, &idle(), &mut mem, 3);
        let sent = f.sent.lock().unwrap().clone();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].2, 1, "the count was written before the message was typed");
        assert_eq!(one::<i64>(&f, "SELECT resumes FROM task_agents"), 1);
        assert!(alone(&f).is_empty(), "nothing says it was restarted");
    }

    const NEW_SID: &str = "99999999-1111-2222-3333-444444444444";

    fn after_resume() -> String {
        // The old agent (stopped: done) and the copy, which has its own session and short id.
        format!(
            r#"[{{"sessionId":"{SID}","id":"abc12345","name":"sm-w-task-1","cwd":"/x","kind":"bg","status":"idle","state":"done"}},
                {{"sessionId":"{NEW_SID}","id":"99999999","name":"sm-w-task-1","cwd":"/x","kind":"bg","status":"busy","pid":777}}]"#
        )
    }

    fn resumed_fx(name: &str) -> (Fx, Memory) {
        let f = fx(
            name,
            NOW,
            Some("watcher"),
            vec![reply("stopped abc12345\n"), reply("note: old\nbackgrounded · 99999999\n")],
        );
        *f.tail.lock().unwrap() = Some(ERROR_TAIL.to_string());
        let mut mem = Memory::default();
        let no_process = agent_json("idle", None, false, None);
        go(&f, &no_process, &mut mem, 0);
        go(&f, &no_process, &mut mem, 3);
        (f, mem)
    }

    #[test]
    fn a_process_that_is_not_listed_is_resumed_with_the_workers_own_arguments() {
        let (f, _) = resumed_fx("switch");
        let calls = calls(&f);
        assert_eq!(calls[0], vec!["stop", "abc12345"]);
        let hook = f.dir.join("watcher/hook-settings.json");
        assert!(hook.exists(), "the hook file is made");
        assert_eq!(
            calls[1],
            vec![
                "--resume",
                SID,
                "--bg",
                "--model",
                "opus",
                "--name",
                "sm-w-task-1",
                "--allowedTools",
                "mcp__studiomanager__list_tasks",
                "mcp__studiomanager__get_project",
                "mcp__studiomanager__list_wiki",
                "mcp__studiomanager__get_wiki_article",
                "mcp__studiomanager__ask",
                "mcp__studiomanager__report_result",
                "--settings",
                hook.to_string_lossy().as_ref(),
                "--permission-mode",
                "acceptEdits",
            ],
            "the same arguments as the start: the allowed tools, the hook, edits without a prompt"
        );
        assert_eq!(calls.len(), 2);
        let sent = f.sent.lock().unwrap().clone();
        assert_eq!((sent[0].0.as_deref(), sent[0].1.as_str()), (Some("99999999"), CONTINUE));
        assert!(calls.iter().all(|c| c.first().map(String::as_str) != Some("rm")), "never deleted");
        assert_eq!(alone(&f), vec!["Restarted after a connection error (1 of 3)"]);
        assert_eq!(one::<i64>(&f, "SELECT resumes FROM task_agents"), 1);
    }

    #[test]
    fn the_dev_build_resumes_with_its_own_server_too() {
        let f = fx("switchdev", NOW, Some("watcher"), vec![reply("stopped abc12345\n"), reply("backgrounded · 99999999\n")]);
        *f.dev.lock().unwrap() = true;
        *f.tail.lock().unwrap() = Some(ERROR_TAIL.to_string());
        let mut mem = Memory::default();
        let no_process = agent_json("idle", None, false, None);
        go(&f, &no_process, &mut mem, 0);
        go(&f, &no_process, &mut mem, 3);
        let argv = calls(&f)[1].clone();
        let at = argv.iter().position(|a| a == "--mcp-config").expect("the dev server config");
        assert_eq!(argv[at + 1], f.dir.join("task-agent-mcp.json").to_string_lossy());
        assert!(argv.contains(&"--settings".to_string()) && argv.contains(&"acceptEdits".to_string()));
        assert!(f.dir.join("task-agent-mcp.json").exists());
    }

    #[test]
    fn the_link_follows_the_copy_and_the_old_agent_being_done_does_not_close_it() {
        let (f, mut mem) = resumed_fx("follow");
        assert_eq!(one::<String>(&f, "SELECT short_id FROM task_agents"), "99999999", "the copy is recorded on the link");
        // The next passes: the old agent lists as done, the copy works.
        for m in [4, 5, 9] {
            go(&f, &after_resume(), &mut mem, m);
        }
        assert_eq!(one::<i64>(&f, "SELECT ended_at IS NULL FROM task_agents"), 1, "the link is still open");
        assert!(check_entries(&f).is_empty(), "no \"Ended without a result\"");
        assert_eq!(one::<Option<String>>(&f, "SELECT outcome FROM task_agents"), None);
        // It is tracked and counted: the link carries the copy's session, the cap counts it.
        assert_eq!(one::<String>(&f, "SELECT session_id FROM task_agents"), NEW_SID);
        let r = go(&f, &after_resume(), &mut mem, 10);
        assert_eq!(r.outlook.running, 1);
        assert_eq!(f.sent.lock().unwrap().len(), 1, "nothing more is typed while the copy works");
    }

    #[test]
    fn a_resume_over_the_budget_counts_nothing_and_runs_nothing() {
        let f = fx("switchbudget", NOW, Some("watcher"), vec![]);
        *f.tail.lock().unwrap() = Some(ERROR_TAIL.to_string());
        *f.week_percent.lock().unwrap() = 70;
        let mut mem = Memory::default();
        let no_process = agent_json("idle", None, false, None);
        go(&f, &no_process, &mut mem, 0);
        go(&f, &no_process, &mut mem, 3);
        assert!(calls(&f).is_empty());
        assert_eq!(one::<i64>(&f, "SELECT resumes FROM task_agents"), 0);
    }

    #[test]
    fn over_budget_nothing_is_resumed_and_nothing_is_counted() {
        let f = watcher("budget");
        *f.tail.lock().unwrap() = Some(ERROR_TAIL.to_string());
        *f.week_percent.lock().unwrap() = 70;
        let mut mem = Memory::default();
        go(&f, &idle(), &mut mem, 0);
        go(&f, &idle(), &mut mem, 3);
        go(&f, &idle(), &mut mem, 20);
        assert!(texts(&f).is_empty());
        assert!(calls(&f).is_empty());
        assert_eq!(one::<i64>(&f, "SELECT resumes FROM task_agents"), 0);
        assert!(alone(&f).is_empty());
        // The link simply waits: with the budget back it is resumed.
        *f.week_percent.lock().unwrap() = 10;
        go(&f, &idle(), &mut mem, 21);
        assert_eq!(texts(&f), vec![CONTINUE]);
    }

    #[test]
    fn an_error_that_is_not_a_lost_connection_is_not_resumed() {
        let f = watcher("ratelimit");
        *f.tail.lock().unwrap() = Some(ERROR_TAIL.replace("server_error", "rate_limit"));
        let mut mem = Memory::default();
        go(&f, &idle(), &mut mem, 0);
        go(&f, &idle(), &mut mem, 31);
        assert!(texts(&f).is_empty());
        assert_eq!(one::<i64>(&f, "SELECT resumes FROM task_agents"), 0);
        // It falls to "idle without a result".
        assert_eq!(one::<String>(&f, "SELECT title FROM needs_you WHERE kind = 'decide'"), NO_RESULT_OR_QUESTION);
    }

    // ------------------------------------------------------------ at a prompt and idle

    fn waiting() -> String {
        agent_json("waiting", None, true, Some("Allow the tool to run?"))
    }

    fn prompts(f: &Fx) -> Vec<(String, String)> {
        let c = Connection::open(&f.db).unwrap();
        let mut st = c
            .prepare("SELECT title, status FROM needs_you WHERE kind = 'decide' AND lead_state = 'prompt' AND link_id = 1 ORDER BY id")
            .unwrap();
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(Result::unwrap).collect()
    }

    #[test]
    fn one_prompt_entry_per_wait_and_a_second_wait_a_second_entry() {
        let f = watcher("prompt");
        let mut mem = Memory::default();
        go(&f, &waiting(), &mut mem, 0);
        go(&f, &waiting(), &mut mem, 1);
        assert!(prompts(&f).is_empty(), "not before two minutes");
        go(&f, &waiting(), &mut mem, 3);
        go(&f, &waiting(), &mut mem, 4);
        go(&f, &waiting(), &mut mem, 6);
        assert_eq!(prompts(&f), vec![("Allow the tool to run?".to_string(), "open".to_string())]);
        // The agent went on by itself: the entry of that wait is closed by the app.
        go(&f, &agent_json("busy", None, true, None), &mut mem, 7);
        assert_eq!(prompts(&f), vec![("Allow the tool to run?".to_string(), "dismissed".to_string())]);
        assert_eq!(
            one::<String>(&f, "SELECT reason FROM needs_you WHERE lead_state = 'prompt'"),
            "The agent went on"
        );
        // A second wait: a second entry.
        go(&f, &waiting(), &mut mem, 8);
        go(&f, &waiting(), &mut mem, 11);
        assert_eq!(
            prompts(&f),
            vec![
                ("Allow the tool to run?".to_string(), "dismissed".to_string()),
                ("Allow the tool to run?".to_string(), "open".to_string())
            ]
        );
        assert!(texts(&f).is_empty() && calls(&f).is_empty(), "nothing is typed at a prompt");
    }

    #[test]
    fn a_prompt_the_user_dismissed_is_not_written_again_in_the_same_wait() {
        let f = watcher("dismissed");
        let mut mem = Memory::default();
        go(&f, &waiting(), &mut mem, 0);
        go(&f, &waiting(), &mut mem, 3);
        Connection::open(&f.db).unwrap().execute("UPDATE needs_you SET status = 'dismissed'", []).unwrap();
        go(&f, &waiting(), &mut mem, 4);
        go(&f, &waiting(), &mut mem, 8);
        assert_eq!(prompts(&f).len(), 1);
    }

    fn link_of(f: &Fx) -> WatcherLink {
        store::open_watcher_links(&f.db, "a").unwrap().remove(0)
    }

    #[test]
    fn no_second_open_entry_after_a_restart() {
        let f = watcher("restart");
        let mut mem = Memory::default();
        go(&f, &waiting(), &mut mem, 0);
        go(&f, &waiting(), &mut mem, 3);
        assert_eq!(prompts(&f).len(), 1);
        // A new process remembers nothing of the wait.
        mem.lock = None; // the old process is gone and its lock with it
        let mut fresh = Memory::default();
        go(&f, &waiting(), &mut fresh, 10);
        go(&f, &waiting(), &mut fresh, 14);
        go(&f, &waiting(), &mut fresh, 20);
        assert_eq!(prompts(&f).len(), 1);
        // The same at the store: an open entry with the same lead state is not doubled.
        let e = LinkEntry { title: "x", body: "", lead_state: Some("prompt"), ..entry(&link_of(&f)) };
        assert_eq!(store::add_link_entry(&f.db, &e).unwrap(), None);
    }

    #[test]
    fn idle_without_a_result_is_one_entry_and_a_question_of_the_worker_is_not_one() {
        let f = watcher("idle");
        let mut mem = Memory::default();
        go(&f, &idle(), &mut mem, 0);
        go(&f, &idle(), &mut mem, 29);
        assert_eq!(decide_count(&f), 0);
        go(&f, &idle(), &mut mem, 31);
        go(&f, &idle(), &mut mem, 32);
        let row: (String, Option<String>, i64) = Connection::open(&f.db)
            .unwrap()
            .query_row("SELECT title, lead_state, link_id FROM needs_you WHERE kind = 'decide'", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!(row, (NO_RESULT_OR_QUESTION.to_string(), None, 1));
        // The owner dismisses it: the same idle stretch does not write another.
        Connection::open(&f.db).unwrap().execute("UPDATE needs_you SET status = 'dismissed'", []).unwrap();
        go(&f, &idle(), &mut mem, 40);
        assert_eq!(decide_count(&f), 1);
        assert!(texts(&f).is_empty() && calls(&f).is_empty());
        // A worker that asked a question is not "stopped without a question".
        let g = watcher("idle-asked");
        Connection::open(&g.db)
            .unwrap()
            .execute("INSERT INTO needs_you (kind, task_id, link_id, title, lead_state) VALUES ('decide', 1, 1, 'Which size?', 'waiting')", [])
            .unwrap();
        let mut mem = Memory::default();
        go(&g, &idle(), &mut mem, 0);
        go(&g, &idle(), &mut mem, 40);
        assert_eq!(decide_count(&g), 1);
    }

    // ------------------------------------------------------------ old

    fn wrap_asked(f: &Fx) -> Option<String> {
        one(f, "SELECT wrap_asked_at FROM task_agents")
    }

    #[test]
    fn wrap_up_asks_once_stops_after_thirty_minutes_and_never_removes() {
        let f = fx("wrap", DAY_AGO, Some("watcher"), vec![reply("stopped abc12345\n")]);
        let mut mem = Memory::default();
        go(&f, &idle(), &mut mem, 0);
        assert!(texts(&f).is_empty());
        go(&f, &idle(), &mut mem, 3);
        assert_eq!(texts(&f), vec![WRAP_UP]);
        assert_eq!(wrap_asked(&f).as_deref(), Some("2027-01-15 08:03:00"));
        assert_eq!(f.sent.lock().unwrap()[0].2, 0);
        go(&f, &idle(), &mut mem, 10);
        go(&f, &idle(), &mut mem, 32);
        assert_eq!(texts(&f), vec![WRAP_UP], "asked once");
        assert!(calls(&f).is_empty(), "not stopped before 30 minutes");
        go(&f, &idle(), &mut mem, 34);
        assert_eq!(calls(&f), vec![vec!["stop".to_string(), "abc12345".to_string()]], "stopped, never `rm`");
        let (title, state): (String, String) = Connection::open(&f.db)
            .unwrap()
            .query_row("SELECT title, status FROM needs_you WHERE kind = 'check'", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!((title.as_str(), state.as_str()), (WRAPPED_UP, "open"));
        assert_eq!(one::<String>(&f, "SELECT outcome FROM task_agents"), "wrapped_up");
        assert_eq!(one::<i64>(&f, "SELECT ended_at IS NOT NULL FROM task_agents"), 1);
        assert_eq!(one::<String>(&f, "SELECT stage FROM tasks"), "to_check");
        assert_eq!(alone(&f), vec!["Asked to wrap up after a day", WRAP_STOPPED]);
        go(&f, &idle(), &mut mem, 40);
        assert_eq!(calls(&f).len(), 1);
    }

    fn check_entries(f: &Fx) -> Vec<String> {
        let c = Connection::open(&f.db).unwrap();
        let mut st = c.prepare("SELECT title FROM needs_you WHERE kind = 'check' ORDER BY id").unwrap();
        st.query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect()
    }

    #[test]
    fn a_result_reported_after_the_request_goes_the_check_path_not_the_wrap_up() {
        // Done, or idle for a while: either way the work is handed in; the check runs.
        for state in [agent_json("idle", Some("done"), true, None), idle()] {
            let f = fx("late", DAY_AGO, Some("watcher"), vec![]);
            Connection::open(&f.db)
                .unwrap()
                .execute(
                    "UPDATE task_agents SET wrap_asked_at = '2027-01-15 08:00:00', reported_at = '2027-01-15 08:10:00'",
                    [],
                )
                .unwrap();
            let mut mem = Memory::default();
            go(&f, &state, &mut mem, 0);
            go(&f, &state, &mut mem, 3);
            go(&f, &state, &mut mem, 40);
            assert!(calls(&f).is_empty(), "nothing is stopped");
            assert!(texts(&f).is_empty());
            // The link has no worktree here, which the check path reports.
            assert_eq!(check_entries(&f), vec![super::super::check::WORKTREE_GONE], "one Check entry, from the check path");
            assert_eq!(one::<String>(&f, "SELECT check_state FROM task_agents"), "error");
            assert_ne!(one::<Option<String>>(&f, "SELECT outcome FROM task_agents").as_deref(), Some("wrapped_up"));
            assert!(!alone(&f).iter().any(|t| t == WRAP_STOPPED));
            assert_eq!(one::<String>(&f, "SELECT stage FROM tasks"), "to_check");
        }
    }

    #[test]
    fn a_reported_idle_agent_is_not_finished_again_after_the_send_back_until_it_reports_again() {
        let f = fx("sendback", NOW, Some("watcher"), vec![]);
        // The send back cleared the report and counted the failure.
        Connection::open(&f.db).unwrap().execute("UPDATE task_agents SET check_fails = 1, reported_at = NULL", []).unwrap();
        let mut mem = Memory::default();
        go(&f, &idle(), &mut mem, 0);
        go(&f, &idle(), &mut mem, 3);
        go(&f, &idle(), &mut mem, 4);
        assert!(check_entries(&f).is_empty());
        // It reports again, and goes quiet.
        Connection::open(&f.db).unwrap().execute("UPDATE task_agents SET reported_at = datetime('now')", []).unwrap();
        go(&f, &idle(), &mut mem, 5);
        go(&f, &idle(), &mut mem, 8);
        assert_eq!(check_entries(&f).len(), 1);
    }

    #[test]
    fn a_failed_wrap_up_request_leaves_the_worker_alone_and_tells_the_user() {
        let f = fx("wrapfail", DAY_AGO, Some("watcher"), vec![]);
        *f.send_result.lock().unwrap() = Err("no terminal".into());
        let mut mem = Memory::default();
        go(&f, &idle(), &mut mem, 0);
        go(&f, &idle(), &mut mem, 3);
        go(&f, &idle(), &mut mem, 40);
        go(&f, &idle(), &mut mem, 80);
        assert_eq!(texts(&f), vec![WRAP_UP], "tried once");
        assert!(calls(&f).is_empty(), "never stopped");
        assert!(check_entries(&f).is_empty());
        assert_eq!(one::<String>(&f, "SELECT title FROM needs_you WHERE kind = 'decide'"), WRAP_FAILED);
        assert_eq!(decide_count(&f), 1);
        assert_eq!(one::<i64>(&f, "SELECT ended_at IS NULL FROM task_agents"), 1);
    }

    #[test]
    fn old_fires_behind_an_open_idle_entry_and_closes_it_with_the_check_entry() {
        let f = fx("oldidle", DAY_AGO, Some("watcher"), vec![reply("stopped abc12345\n")]);
        let mut mem = Memory::default();
        go(&f, &idle(), &mut mem, 0);
        go(&f, &idle(), &mut mem, 3);
        // The idle entry is written for a link that started a day ago only when it is not old yet:
        // here the wrap-up comes first, so write the idle entry by hand as an ignored one.
        Connection::open(&f.db)
            .unwrap()
            .execute(
                "INSERT INTO needs_you (kind, task_id, link_id, title, lead_state) VALUES ('decide', 1, 1, ?1, NULL)",
                [NO_RESULT_OR_QUESTION],
            )
            .unwrap();
        go(&f, &idle(), &mut mem, 34);
        assert_eq!(calls(&f).len(), 1, "stopped although the idle entry is open");
        assert_eq!(check_entries(&f), vec![WRAPPED_UP]);
        let rows: Vec<(String, String, Option<String>)> = {
            let c = Connection::open(&f.db).unwrap();
            let mut st = c.prepare("SELECT title, status, reason FROM needs_you WHERE kind = 'decide' ORDER BY id").unwrap();
            st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().map(Result::unwrap).collect()
        };
        assert_eq!(rows.len(), 1);
        assert!(rows.iter().all(|r| r.1 == "dismissed" && r.2.as_deref() == Some("The worker was wrapped up")));
    }

    #[test]
    fn an_open_idle_entry_stays_one_across_passes_and_a_restart_and_is_closed_when_the_worker_finishes() {
        let f = watcher("idleone");
        let mut mem = Memory::default();
        go(&f, &idle(), &mut mem, 0);
        for m in [31, 32, 33, 40] {
            go(&f, &idle(), &mut mem, m);
        }
        mem.lock = None; // the old process is gone and its lock with it
        let mut fresh = Memory::default();
        for m in [50, 55, 90, 95] {
            go(&f, &idle(), &mut fresh, m);
        }
        assert_eq!(decide_count(&f), 1, "exactly one open entry");
        // The worker reports and finishes: the stale idle entry is closed beside the Check entry.
        Connection::open(&f.db).unwrap().execute("UPDATE task_agents SET reported_at = datetime('now')", []).unwrap();
        Connection::open(&f.db)
            .unwrap()
            .execute("INSERT INTO needs_you (kind, task_id, link_id, title, lead_state) VALUES ('decide', 1, 1, 'Allow?', 'prompt')", [])
            .unwrap();
        let done = agent_json("idle", Some("done"), true, None);
        go(&f, &done, &mut fresh, 100);
        assert_eq!(check_entries(&f).len(), 1);
        assert_eq!(
            one::<i64>(
                &f,
                "SELECT COUNT(*) FROM needs_you WHERE kind = 'decide' AND status = 'dismissed' AND reason = 'The worker finished'"
            ),
            2,
            "the idle and the prompt entries are closed beside the Check entry"
        );
    }

    #[test]
    fn open_stuck_and_wrap_failed_entries_are_closed_by_the_app_when_the_work_finishes() {
        let f = watcher("stuckfinish");
        for title in [STUCK_ENTRY, WRAP_FAILED] {
            Connection::open(&f.db)
                .unwrap()
                .execute("INSERT INTO needs_you (kind, task_id, link_id, title, lead_state) VALUES ('decide', 1, 1, ?1, NULL)", [title])
                .unwrap();
        }
        // A question of the worker is not one of the app's entries: it stays.
        Connection::open(&f.db)
            .unwrap()
            .execute("INSERT INTO needs_you (kind, task_id, link_id, title, lead_state) VALUES ('decide', 1, 1, 'Which size?', 'waiting')", [])
            .unwrap();
        Connection::open(&f.db).unwrap().execute("UPDATE task_agents SET reported_at = datetime('now')", []).unwrap();
        let mut mem = Memory::default();
        go(&f, &idle(), &mut mem, 0);
        go(&f, &agent_json("idle", Some("done"), true, None), &mut mem, 3);
        assert_eq!(check_entries(&f).len(), 1);
        let closed: Vec<(String, String, Option<String>, Option<String>)> = {
            let c = Connection::open(&f.db).unwrap();
            let mut st = c
                .prepare("SELECT title, status, decided_by, reason FROM needs_you WHERE kind = 'decide' AND title <> 'Which size?' ORDER BY id")
                .unwrap();
            st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap().map(Result::unwrap).collect()
        };
        assert_eq!(closed.len(), 2);
        for (title, status, by, why) in closed {
            assert_eq!((status.as_str(), by.as_deref(), why.as_deref()), ("dismissed", Some("app"), Some("The worker finished")), "{title}");
        }
        assert_eq!(one::<String>(&f, "SELECT status FROM needs_you WHERE title = 'Which size?'"), "open");
    }

    #[test]
    fn a_stuck_entry_stays_open_and_old_may_still_wrap_the_worker_up() {
        let f = fx("stuckold", DAY_AGO, Some("watcher"), vec![]);
        Connection::open(&f.db)
            .unwrap()
            .execute("UPDATE task_agents SET resumes = 3, outcome = 'stuck'", [])
            .unwrap();
        Connection::open(&f.db)
            .unwrap()
            .execute("INSERT INTO needs_you (kind, task_id, link_id, title, lead_state) VALUES ('decide', 1, 1, ?1, NULL)", [STUCK_ENTRY])
            .unwrap();
        *f.tail.lock().unwrap() = Some(ERROR_TAIL.to_string());
        let mut mem = Memory::default();
        go(&f, &idle(), &mut mem, 0);
        go(&f, &idle(), &mut mem, 3);
        assert_eq!(texts(&f), vec![WRAP_UP], "wrapped up, not resumed");
        assert_eq!(one::<i64>(&f, "SELECT resumes FROM task_agents"), 3);
        assert_eq!(one::<String>(&f, "SELECT status FROM needs_you WHERE title = 'Stuck after three restarts'"), "open");
    }

    // ------------------------------------------------------------ the gate after the check step

    #[test]
    fn a_gate_that_closes_after_the_check_step_stops_the_pass_before_anything_is_typed() {
        let f = watcher("gateclose");
        *f.tail.lock().unwrap() = Some(ERROR_TAIL.to_string());
        let mut mem = Memory::default();
        go(&f, &idle(), &mut mem, 0);
        // The owner puts the app in test mode while the check step runs.
        let mode = f.db.with_file_name("studiomanager_test.db");
        *f.on_refresh.lock().unwrap() = Some(Box::new(move || std::fs::write(&mode, "").unwrap()));
        let r = go(&f, &idle(), &mut mem, 3);
        assert_eq!(r.outlook.paused, Some(super::super::Paused::Mode));
        assert!(texts(&f).is_empty() && calls(&f).is_empty(), "nothing typed, stopped or started");
        assert_eq!(one::<i64>(&f, "SELECT resumes FROM task_agents"), 0, "nothing counted");
        assert_eq!(wrap_asked(&f), None);
        assert_eq!(decide_count(&f), 0);
    }

    #[test]
    fn what_follows_the_check_step_acts_on_the_list_read_again() {
        let f = watcher("freshlist");
        *f.tail.lock().unwrap() = Some(ERROR_TAIL.to_string());
        let mut mem = Memory::default();
        go(&f, &idle(), &mut mem, 0);
        // By then the worker is working again: it is not stuck, so nothing is typed into it.
        *f.refreshed_list.lock().unwrap() = Some(agent_json("busy", None, true, None));
        go(&f, &idle(), &mut mem, 3);
        assert!(texts(&f).is_empty(), "the stale list said idle; the fresh one says busy");
        assert_eq!(one::<i64>(&f, "SELECT resumes FROM task_agents"), 0);
    }

    // ------------------------------------------------------------ the rules

    #[test]
    fn at_most_one_action_per_link_per_pass() {
        // Stuck, idle for a long time and a day old: one action only.
        let f = fx("one", DAY_AGO, Some("watcher"), vec![]);
        *f.tail.lock().unwrap() = Some(ERROR_TAIL.to_string());
        let mut mem = Memory::default();
        go(&f, &idle(), &mut mem, 0);
        go(&f, &idle(), &mut mem, 40);
        assert_eq!(texts(&f), vec![CONTINUE]);
        assert_eq!(wrap_asked(&f), None);
        assert_eq!(decide_count(&f), 0);
        assert_eq!(alone(&f).len(), 1);
    }

    #[test]
    fn a_list_that_is_too_old_acts_on_nothing() {
        let f = watcher("oldlist");
        let mut mem = Memory::default();
        go(&f, &idle(), &mut mem, 0);
        let agents = parse_agents(&idle()).unwrap();
        let mut d = deps(&f.dir, &agents);
        d.now = T0 + 10 * MIN;
        d.listed_at = Some(T0 + MIN);
        let sent = |_: &Agent, _: &str| -> Result<(), String> { panic!("a stale list types nothing") };
        let get_cli = || Err::<Box<dyn Cli>, String>("none".into());
        let trusted = Vec::new;
        let git = FakeGit::repo();
        let path = String::new;
        let tail = |_: &str| Some(ERROR_TAIL.to_string());
        let env = super::super::start::Env {
            git: &git,
            cli: &get_cli,
            trusted: &trusted,
            dev: false,
            mcp_path: "/x",
            send: &sent,
            path_env: &path,
            transcript_tail: &tail,
        };
        tick(&d, &mut mem, Some(&env));
        assert_eq!(one::<i64>(&f, "SELECT resumes FROM task_agents"), 0);
    }

    #[test]
    fn none_of_these_on_a_hand_link() {
        // A link started by hand (started_by null): stuck, waiting, idle for a day. Nothing is
        // typed, nothing is run, no entry is written.
        for agent in [idle(), waiting()] {
            let f = fx("hand", DAY_AGO, None, vec![]);
            *f.tail.lock().unwrap() = Some(ERROR_TAIL.to_string());
            let mut mem = Memory::default();
            for minutes in [0, 3, 40, 80] {
                go(&f, &agent, &mut mem, minutes);
            }
            assert!(texts(&f).is_empty());
            assert!(calls(&f).is_empty());
            assert_eq!(one::<i64>(&f, "SELECT COUNT(*) FROM needs_you"), 0);
            assert_eq!(one::<i64>(&f, "SELECT resumes FROM task_agents"), 0);
            assert_eq!(wrap_asked(&f), None);
        }
        // An agent no link names is left alone as well.
        let f = watcher("unlinked");
        *f.tail.lock().unwrap() = Some(ERROR_TAIL.to_string());
        let other = idle().replace("abc12345", "ffffffff").replace(SID, "11111111-1111-2222-3333-444444444444");
        let mut mem = Memory::default();
        go(&f, &other, &mut mem, 0);
        go(&f, &other, &mut mem, 40);
        assert!(texts(&f).is_empty() && calls(&f).is_empty());
    }
}
