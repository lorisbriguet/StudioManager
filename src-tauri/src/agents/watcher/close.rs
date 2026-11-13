//! Ends the link of a worker whose work was checked and decided, so the cap counts it no more. A
//! watcher link is open while the worker is "running"; without this an accepted task would keep
//! its place for ever and the cap would fill up. The UI accept flow is unchanged: it answers the
//! entry, and this step sees the answer on the next pass. A link whose change the lead merged alone
//! is ended by `lead::accept` itself (outcome `merged`), which also stops its worker.
//!
//! A link is closed only when all of these hold: the agent list is fresh, the check is done
//! (`check_state` passed, failed, none or error), no entry of the link is open and no answer of the
//! lead is waiting to be carried out (a send back clears `check_state`, so it never matches). A
//! worker still listed and not done is stopped first, never deleted; when the stop fails the link
//! stays open. Plan: docs/superpowers/plans/2026-11-13-agent-orchestrator-3-watcher-lead.md.

use super::check::find_agent;
use super::start::Env;
use super::store::{self, WatcherLink};
use super::{Deps, Memory};
use crate::agents::actions;
use crate::agents::model::Group;
use std::path::PathBuf;

/// The `outcome` of a link closed after its check was decided.
pub const OUTCOME: &str = "result";

/// Closes the decided links among `links`; true when one was closed. The caller has the lock and the
/// gate is open.
pub fn step(env: &Env, d: &Deps, mem: &mut Memory, links: &[(PathBuf, WatcherLink)]) -> bool {
    // A list too old to be trusted says nothing about what the agents are doing.
    let trusted = d.listed_at.is_some_and(|t| t > mem.started && d.now - t <= super::check::LIST_MAX_AGE_MS);
    if !trusted {
        return false;
    }
    let mut changed = false;
    for (db, link) in links {
        if !matches!(link.check_state.as_deref(), Some("passed" | "failed" | "none" | "error")) {
            continue;
        }
        let left = {
            let _shared = crate::org_shared();
            store::has_open_work(db, link.id)
        };
        // A failed read counts as "something is left": nothing is closed on a guess.
        if left.unwrap_or(true) {
            continue;
        }
        if let Some(agent) = find_agent(d.agents, link) {
            if agent.group != Group::Done {
                let stopped = (env.cli)().and_then(|cli| actions::stop(&*cli, &actions::home_dir(), &link.short_id));
                if let Err(e) = stopped {
                    log::warn!("[watcher] link {} of organisation {}: could not stop the worker: {e}", link.id, link.org);
                    continue;
                }
            }
        }
        let ended = {
            let _shared = crate::org_shared();
            store::end_link(db, link.id, OUTCOME)
        };
        match ended {
            // False when a Send back cleared the check meanwhile: the link stays open, and the
            // worker stopped above is resumed by the next passes like any worker with no process.
            Ok(was_open) => changed |= was_open,
            Err(e) => log::warn!("[watcher] link {} of organisation {}: could not end the link: {e}", link.id, link.org),
        }
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::super::git::fake::FakeGit;
    use super::super::tests::{app, db_of, deps, T0};
    use super::super::{tick, Memory, Report};
    use crate::agents::cli::{write_settings, AgentsSettings, Cli, CliOutput};
    use crate::agents::model::{parse_agents, Agent};
    use rusqlite::Connection;
    use std::path::Path;
    use std::sync::{Arc, Mutex};

    const MIN: i64 = 60_000;

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
    fn reply(code: i32, stdout: &str) -> CliOutput {
        CliOutput { code, stdout: stdout.into(), stderr: String::new() }
    }

    struct Fx {
        dir: std::path::PathBuf,
        db: std::path::PathBuf,
        folder: String,
        cli: Arc<FakeCli>,
    }

    /// One organisation with a Ready task "Poster tool" (id 1) and `links` running tasks (ids 101..)
    /// each with a watcher link (id n, short id `abc1234n`), cap `cap`.
    fn fx(name: &str, cap: u32, links: i64, replies: Vec<CliOutput>) -> Fx {
        let dir = app(&format!("close-{name}"), &["a"]);
        let db = db_of(&dir, "a");
        let folder = format!("{}/repo", dir.to_string_lossy());
        let c = Connection::open(&db).unwrap();
        c.execute("UPDATE projects SET folder_path = ?1", [&folder]).unwrap();
        c.execute("INSERT INTO tasks (id, project_id, title, stage) VALUES (1, 1, 'Poster tool', 'briefed')", []).unwrap();
        for n in 1..=links {
            c.execute(
                &format!("INSERT INTO tasks (id, project_id, title, stage) VALUES ({}, 1, 'Running {n}', 'to_check')", 100 + n),
                [],
            )
            .unwrap();
            c.execute(
                "INSERT INTO task_agents (task_id, short_id, name, started_by, check_state) VALUES (?1, ?2, 'sm-w-task', 'watcher', 'passed')",
                rusqlite::params![100 + n, format!("abc1234{n}")],
            )
            .unwrap();
        }
        write_settings(&dir, &AgentsSettings { worker_cap: cap, ..super::super::tests::on() }).unwrap();
        Fx { dir, db, folder, cli: Arc::new(FakeCli { calls: Mutex::new(vec![]), replies: Mutex::new(replies.into_iter().rev().collect()) }) }
    }

    /// Makes "Poster tool" Ready: the item a free place would be used for.
    fn ready(f: &Fx) {
        Connection::open(&f.db).unwrap().execute("UPDATE tasks SET stage = 'ready' WHERE id = 1", []).unwrap();
    }

    /// The check entry of link `n`: `status`, who decided, `lead_state`, `delivered_at` set or not.
    fn entry(f: &Fx, n: i64, status: &str, by: Option<&str>, lead_state: Option<&str>, delivered: bool) {
        Connection::open(&f.db)
            .unwrap()
            .execute(
                "INSERT INTO needs_you (kind, task_id, link_id, title, status, decided_by, lead_state, delivered_at)
                 VALUES ('check', ?1, ?2, 'Done', ?3, ?4, ?5, CASE WHEN ?6 = 1 THEN datetime('now') ELSE NULL END)",
                rusqlite::params![100 + n, n, status, by, lead_state, delivered as i64],
            )
            .unwrap();
    }

    fn worker(n: i64, state: &str) -> String {
        let (status, state) = if state == "done" { ("idle", r#","state":"done""#) } else { ("busy", "") };
        format!(
            r#"{{"sessionId":"s{n}","id":"abc1234{n}","name":"sm-w-task-{}","cwd":"/x","kind":"bg","status":"{status}"{state}}}"#,
            100 + n
        )
    }

    fn list(workers: &[String]) -> Vec<Agent> {
        parse_agents(&format!("[{}]", workers.join(","))).unwrap()
    }

    fn go(f: &Fx, agents: &[Agent], mem: &mut Memory, minutes: i64, listed_minutes_ago: i64) -> Report {
        let now = T0 + minutes * MIN;
        std::fs::write(
            f.dir.join("limits.json"),
            format!(
                r#"{{"savedAt":{},"rate_limits":{{"five_hour":{{"used_percentage":10,"resets_at":{}}},
                   "seven_day":{{"used_percentage":10,"resets_at":{}}}}}}}"#,
                now / 1000,
                (now + 3_600_000) / 1000,
                (now + 302_400_000) / 1000
            ),
        )
        .unwrap();
        let mut d = deps(&f.dir, agents);
        d.now = now;
        d.listed_at = Some(now - listed_minutes_ago * MIN);
        mem.loaded = true;
        if mem.started == 0 {
            mem.started = T0 - 30 * MIN;
        }
        let get_cli = || Ok(Box::new(Shared(f.cli.clone())) as Box<dyn Cli>);
        let trusted = || vec![f.folder.clone()];
        let git = FakeGit::repo();
        let send = |_: &Agent, _: &str| -> Result<(), String> { panic!("closing a link types nothing") };
        let path = || "/usr/bin:/bin".to_string();
        let env = super::super::start::Env {
            git: &git,
            cli: &get_cli,
            trusted: &trusted,
            dev: false,
            mcp_path: "/x",
            send: &send,
            path_env: &path,
            transcript_tail: &|_: &str| None,
        };
        tick(&d, mem, Some(&env))
    }

    fn calls(f: &Fx) -> Vec<Vec<String>> {
        f.cli.calls.lock().unwrap().clone()
    }

    fn ended(f: &Fx, n: i64) -> bool {
        Connection::open(&f.db).unwrap().query_row("SELECT ended_at IS NOT NULL FROM task_agents WHERE id = ?1", [n], |r| r.get(0)).unwrap()
    }

    fn outcome(f: &Fx, n: i64) -> Option<String> {
        Connection::open(&f.db).unwrap().query_row("SELECT outcome FROM task_agents WHERE id = ?1", [n], |r| r.get(0)).unwrap()
    }

    #[test]
    fn two_accepted_tasks_end_their_links_and_the_next_pass_has_room_for_a_third() {
        let f = fx("cap", 2, 2, vec![reply(0, "backgrounded · 0a1b2c3d\n")]);
        ready(&f);
        entry(&f, 1, "answered", Some("user"), None, false);
        entry(&f, 2, "dismissed", Some("user"), None, false);
        let agents = list(&[worker(1, "done"), worker(2, "done")]);
        let mut mem = Memory::default();
        let r = go(&f, &agents, &mut mem, 1, 1);
        assert!(ended(&f, 1) && ended(&f, 2), "both links ended");
        assert_eq!(outcome(&f, 1).as_deref(), Some("result"));
        assert!(calls(&f).is_empty(), "nothing started this pass (full when it began) and nothing stopped (done already)");
        assert!(r.outlook.running < 2);
        go(&f, &agents, &mut mem, 2, 1);
        assert_eq!(calls(&f).len(), 1, "the third task starts");
        assert_eq!(calls(&f)[0][0], "--bg");
    }

    #[test]
    fn a_listed_worker_that_is_not_done_is_stopped_first_and_never_deleted() {
        let f = fx("stop", 2, 1, vec![reply(0, "stopped abc12341\n")]);
        entry(&f, 1, "answered", Some("user"), None, false);
        go(&f, &list(&[worker(1, "busy")]), &mut Memory::default(), 1, 1);
        assert_eq!(calls(&f), vec![vec!["stop".to_string(), "abc12341".to_string()]]);
        assert!(ended(&f, 1));
    }

    #[test]
    fn a_stop_that_fails_leaves_the_link_open() {
        let f = fx("stopfail", 2, 1, vec![reply(1, "")]);
        entry(&f, 1, "answered", Some("user"), None, false);
        go(&f, &list(&[worker(1, "busy")]), &mut Memory::default(), 1, 1);
        assert!(!ended(&f, 1));
    }

    #[test]
    fn an_entry_still_open_keeps_the_link_open_and_stops_nothing() {
        for (status, by, lead, delivered) in [
            ("open", None, Some("waiting"), false),
            // The lead's "would accept", back with the owner.
            ("open", None, Some("done"), false),
            // The lead's answer not carried out yet (a send back that needs the link).
            ("answered", Some("lead"), Some("done"), false),
        ] {
            let f = fx("open", 2, 1, vec![]);
            entry(&f, 1, status, by, lead, delivered);
            go(&f, &list(&[worker(1, "busy")]), &mut Memory::default(), 1, 1);
            assert!(!ended(&f, 1), "{status} {by:?} {lead:?}");
            assert!(calls(&f).is_empty(), "nothing stopped");
        }
    }

    #[test]
    fn a_send_back_keeps_the_link_open() {
        let f = fx("sendback", 2, 1, vec![]);
        entry(&f, 1, "answered", Some("user"), None, true);
        Connection::open(&f.db).unwrap().execute("UPDATE task_agents SET check_state = NULL, reported_at = NULL", []).unwrap();
        go(&f, &list(&[worker(1, "busy")]), &mut Memory::default(), 1, 1);
        assert!(!ended(&f, 1));
        assert!(calls(&f).is_empty());
    }

    #[test]
    fn a_list_too_old_ends_and_stops_nothing() {
        let f = fx("oldlist", 2, 1, vec![]);
        entry(&f, 1, "answered", Some("user"), None, false);
        go(&f, &list(&[]), &mut Memory::default(), 1, 12);
        assert!(!ended(&f, 1));
        assert!(calls(&f).is_empty());
    }

    #[test]
    fn a_hand_started_link_is_never_ended_here() {
        let f = fx("hand", 2, 1, vec![]);
        entry(&f, 1, "answered", Some("user"), None, false);
        Connection::open(&f.db).unwrap().execute("UPDATE task_agents SET started_by = NULL", []).unwrap();
        go(&f, &list(&[worker(1, "busy")]), &mut Memory::default(), 1, 1);
        assert!(!ended(&f, 1));
        assert!(calls(&f).is_empty());
    }
}
