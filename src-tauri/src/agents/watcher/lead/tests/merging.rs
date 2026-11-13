//! Merging alone, carried out from the lead's "accept": the fake `git` and `gh` script one
//! worktree and its pull request, and every test checks that nothing but the one `gh pr merge`
//! changes the repository.

use super::super::super::git::fake::out;
use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};

const SHA: &str = "0123456789abcdef0123456789abcdef01234567";
const OTHER_SHA: &str = "fedcba9876543210fedcba9876543210fedcba98";
const PR_URL: &str = "https://github.com/studio-a/poster-tool/pull/12";
const REASON: &str = "Does what the brief asks";

fn view(state: &str, draft: bool, head: &str, base: &str) -> String {
    format!("{{\"state\":\"{state}\",\"isDraft\":{draft},\"headRefOid\":\"{head}\",\"baseRefName\":\"{base}\"}}\n")
}

/// What the fake `git` and `gh` say about one worktree and its pull request.
#[derive(Clone)]
struct Scene {
    origin: &'static str,
    numstat: &'static str,
    names: &'static str,
    /// `git status --porcelain`, from the first read on and from the second read on.
    status_first: &'static str,
    status_later: &'static str,
    view: String,
    /// What `gh pr view` says from the second read on (None: the same).
    view_later: Option<String>,
    merge_code: i32,
    /// What `git rev-parse HEAD` says from the second read on.
    head_later: &'static str,
}

impl Default for Scene {
    fn default() -> Self {
        Scene {
            origin: "https://github.com/studio-a/poster-tool.git\n",
            numstat: "5\t2\tsrc/poster.ts\n",
            names: "M\tsrc/poster.ts\n",
            status_first: "",
            status_later: "",
            view: view("OPEN", false, SHA, "main"),
            view_later: None,
            merge_code: 0,
            head_later: SHA,
        }
    }
}

fn scene_git(s: &Scene) -> FakeGit {
    let heads = Arc::new(AtomicUsize::new(0));
    let statuses = Arc::new(AtomicUsize::new(0));
    let views = Arc::new(AtomicUsize::new(0));
    let g = s.clone();
    let h = s.clone();
    FakeGit::new(move |c| match c {
        "rev-parse HEAD" => {
            let n = heads.fetch_add(1, Ordering::SeqCst);
            out(0, &format!("{}\n", if n == 0 { SHA } else { g.head_later }))
        }
        "remote get-url origin" => out(0, g.origin),
        "merge-base origin/main HEAD" => out(0, "abc123\n"),
        "diff --numstat --no-renames abc123 --" => out(0, g.numstat),
        "diff --name-status --no-renames abc123 --" => out(0, g.names),
        "status --porcelain" => {
            let n = statuses.fetch_add(1, Ordering::SeqCst);
            out(0, if n == 0 { g.status_first } else { g.status_later })
        }
        _ => out(0, ""),
    })
    .with_gh(move |c| {
        if c.starts_with("pr view") {
            let n = views.fetch_add(1, Ordering::SeqCst);
            out(0, if n == 0 { &h.view } else { h.view_later.as_ref().unwrap_or(&h.view) })
        } else if c.starts_with("pr merge") {
            out(h.merge_code, if h.merge_code == 0 { "" } else { "GraphQL: Pull request is not mergeable" })
        } else {
            out(1, "unexpected gh call")
        }
    })
}

impl Fx {
    /// A project that merges alone, a worktree folder, its base and the pull request the worker reported.
    fn merge_setup(&self, check: &str) {
        let wt = self.dir.join("wt");
        std::fs::create_dir_all(&wt).unwrap();
        let c = self.conn();
        c.execute("UPDATE projects SET merge_alone = 1, check_command = ?1", [check]).unwrap();
        c.execute(
            "UPDATE task_agents SET worktree = ?1, base_ref = 'origin/main', pr_url = ?2, branch = 'studio-a/poster-tool' WHERE id = 1",
            params![wt.to_string_lossy(), PR_URL],
        )
        .unwrap();
    }
    fn merges(&self) -> usize {
        self.git.gh_commands().iter().filter(|c| c.starts_with("pr merge")).count()
    }
    fn git_calls(&self) -> usize {
        self.git.calls.lock().unwrap().len()
    }
    fn recommendation(&self, id: i64) -> String {
        self.one(&format!("SELECT COALESCE(recommendation, '') FROM needs_you WHERE id = {id}"))
    }
}

/// A project that merges alone, a check entry the lead accepted, the lead still listed.
fn merging(name: &str, scene: &Scene, check: &str) -> (Fx, i64, Memory) {
    let mut f = fx(name, vec![started(), reply("stopped abc12345\n")]);
    f.git = scene_git(scene);
    f.merge_setup(check);
    let id = f.check_entry();
    let mut mem = Memory::default();
    lead_on(&f, id, &mut mem);
    f.lead_resolves(id, "accept", REASON);
    (f, id, mem)
}

fn pass(f: &Fx, mem: &mut Memory, minutes: i64) -> Report {
    go(f, &list(&[worker("busy"), lead_agent(f, "busy")]), mem, minutes)
}

/// No call deletes a branch, a worktree or a file, or changes the repository: `gh` is only asked
/// `pr view` and `pr merge`.
fn assert_safe(f: &Fx) {
    for (program, args) in f.git.calls.lock().unwrap().iter() {
        let words: Vec<&str> = args.split(' ').collect();
        for banned in ["--delete-branch", "--admin", "--auto", "-d", "-D"] {
            assert!(!words.contains(&banned), "{program} {args}");
        }
        for banned in ["worktree remove", "branch -D", "branch -d", "push", "reset", "checkout", "rm"] {
            assert!(!args.starts_with(banned), "{program} {args}");
        }
        if program == "gh" {
            assert!(args.starts_with("pr view ") || args.starts_with("pr merge "), "gh: {args}");
        }
    }
}

/// The entry is open again for the owner with `why`, nothing merged, nothing done.
fn assert_refused(f: &Fx, id: i64, why: &str) {
    let rec = f.recommendation(id);
    assert_eq!(f.status_of(id), "open", "{rec}");
    assert!(
        rec.starts_with("The lead would accept; not merged: ") && rec.contains(why) && rec.ends_with(&format!("The lead's reason: {REASON}")),
        "{rec}"
    );
    let reason: Option<String> = f.one(&format!("SELECT reason FROM needs_you WHERE id = {id}"));
    assert_eq!(reason, None);
    assert_eq!(f.merges(), 0, "{rec}");
    let (stage, status): (String, String) =
        f.conn().query_row("SELECT stage, status FROM tasks WHERE id = 1", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!((stage.as_str(), status.as_str()), ("to_check", "todo"), "{rec}");
    let ended: Option<String> = f.one("SELECT ended_at FROM task_agents WHERE id = 1");
    assert_eq!(ended, None);
    assert_eq!(f.one::<i64>("SELECT COUNT(*) FROM needs_you WHERE kind = 'alone'"), 0);
    assert_safe(f);
}

#[test]
fn merge_alone_off_keeps_todays_text_and_runs_nothing() {
    let (f, id, mut mem) = merging("alone-off", &Scene::default(), "true");
    f.conn().execute("UPDATE projects SET merge_alone = 0", []).unwrap();
    let before = f.git_calls();
    pass(&f, &mut mem, 1);
    assert_eq!(f.recommendation(id), format!("The lead would accept: {REASON}"));
    assert_eq!(f.status_of(id), "open");
    assert_eq!(f.git_calls(), before, "no git and no gh call for this entry");
    assert_safe(&f);
}

#[test]
fn a_hub_project_is_never_merged_alone() {
    let (f, id, mut mem) = merging("hub", &Scene::default(), "true");
    f.conn().execute("UPDATE projects SET hub_project = 1", []).unwrap();
    let before = f.git_calls();
    pass(&f, &mut mem, 1);
    assert_refused(&f, id, "the project belongs to a hub");
    assert_eq!(f.git_calls(), before, "no git and no gh call");
    // A hub with merging alone off is a hub too.
    let (f, id, mut mem) = merging("hub-off", &Scene::default(), "true");
    f.conn().execute("UPDATE projects SET hub_project = 1, merge_alone = 0", []).unwrap();
    pass(&f, &mut mem, 1);
    assert_refused(&f, id, "the project belongs to a hub");
}

/// The item of link 1 is merged: done, link ended, entry still the lead's decision, one `alone` row.
fn assert_merged(f: &Fx, id: i64, table: &str) {
    let (stage, status): (Option<String>, String) =
        f.conn().query_row(&format!("SELECT stage, status FROM {table} WHERE id = 1"), [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!((stage, status.as_str()), (None, "done"));
    let (ended, outcome): (Option<String>, Option<String>) =
        f.conn().query_row("SELECT ended_at, outcome FROM task_agents WHERE id = 1", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert!(ended.is_some());
    assert_eq!(outcome.as_deref(), Some("merged"));
    let (st, by, delivered): (String, String, Option<String>) = f
        .conn()
        .query_row(&format!("SELECT status, decided_by, delivered_at FROM needs_you WHERE id = {id}"), [], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .unwrap();
    assert_eq!((st.as_str(), by.as_str()), ("answered", "lead"));
    assert!(delivered.is_some());
    let rows: Vec<(String, String, String, String)> = {
        let c = f.conn();
        let mut s = c.prepare("SELECT title, COALESCE(reason, ''), status, decided_by FROM needs_you WHERE kind = 'alone'").unwrap();
        let rows = s.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap().map(|r| r.unwrap()).collect();
        rows
    };
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].0, "Merged: check passed, 7 lines");
    let reason = &rows[0].1;
    assert!(reason.contains(REASON) && reason.contains("0123456") && reason.contains(PR_URL) && reason.contains("merging alone"), "{reason}");
    assert!(!reason.contains(SHA), "the short head only: {reason}");
    assert_eq!((rows[0].2.as_str(), rows[0].3.as_str()), ("answered", "app"));
}

#[test]
fn a_small_checked_change_is_merged_once_and_the_item_is_done() {
    let (f, id, mut mem) = merging("happy", &Scene::default(), "true");
    pass(&f, &mut mem, 1);
    assert_eq!(f.merges(), 1);
    let merge = f.git.gh_commands().into_iter().find(|c| c.starts_with("pr merge")).unwrap();
    assert_eq!(merge, format!("pr merge {PR_URL} --squash --match-head-commit {SHA}"));
    assert_merged(&f, id, "tasks");
    let stops = f.calls().iter().filter(|c| c.first().map(String::as_str) == Some("stop") && c.contains(&"abc12345".to_string())).count();
    assert_eq!(stops, 1, "the worker is stopped, once");
    assert!(!f.calls().iter().any(|c| matches!(c.first().map(String::as_str), Some("rm" | "delete" | "remove"))));
    pass(&f, &mut mem, 2);
    go(&f, &list(&[worker("idle")]), &mut Memory::default(), 3);
    assert_eq!(f.merges(), 1, "never a second merge");
    assert_eq!(f.one::<i64>("SELECT COUNT(*) FROM needs_you WHERE kind = 'alone'"), 1);
    assert_safe(&f);
}

#[test]
fn a_subtask_is_merged_and_done_the_same_way() {
    let mut f = fx("happy-sub", vec![started(), reply("stopped abc12345\n")]);
    f.git = scene_git(&Scene::default());
    f.merge_setup("true");
    {
        let c = f.conn();
        c.execute("INSERT INTO subtasks (id, task_id, title, stage) VALUES (1, 1, 'Poster tool: layout', 'to_check')", []).unwrap();
        c.execute("UPDATE tasks SET stage = 'running'", []).unwrap();
        c.execute("UPDATE task_agents SET task_id = NULL, subtask_id = 1, check_state = 'passed', reported_at = datetime('now') WHERE id = 1", [])
            .unwrap();
        c.execute(
            "INSERT INTO needs_you (kind, subtask_id, link_id, title, body, status, lead_state, check_passed)
             VALUES ('check', 1, 1, 'Layout', 'Done.', 'open', 'waiting', 1)",
            [],
        )
        .unwrap();
    }
    let id: i64 = f.one("SELECT id FROM needs_you WHERE kind = 'check'");
    let mut mem = Memory::default();
    lead_on(&f, id, &mut mem);
    f.lead_resolves(id, "accept", REASON);
    pass(&f, &mut mem, 1);
    assert_eq!(f.merges(), 1);
    assert_merged(&f, id, "subtasks");
    let (stage, status): (Option<String>, String) =
        f.conn().query_row("SELECT stage, status FROM tasks WHERE id = 1", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!((stage.as_deref(), status.as_str()), (Some("running"), "todo"), "the parent task is untouched");
    pass(&f, &mut mem, 2);
    assert_eq!(f.merges(), 1);
    assert_safe(&f);
}

#[test]
fn a_due_date_moves_to_today_as_when_done_by_hand() {
    let (f, _id, mut mem) = merging("due", &Scene::default(), "true");
    f.conn().execute("UPDATE tasks SET due_date = '2020-01-01'", []).unwrap();
    pass(&f, &mut mem, 1);
    let due: String = f.one("SELECT due_date FROM tasks WHERE id = 1");
    let today: String = f.one("SELECT date('now', 'localtime')");
    assert_eq!(due, today);
}

struct Case {
    name: &'static str,
    scene: Scene,
    check: &'static str,
    tweak: fn(&Fx),
    why: &'static str,
}

fn plain(name: &'static str, why: &'static str) -> Case {
    Case { name, scene: Scene::default(), check: "true", tweak: |_| {}, why }
}

fn sql(f: &Fx, statement: &str) {
    f.conn().execute(statement, []).unwrap();
}

#[test]
fn every_refusal_leaves_the_entry_open_and_merges_nothing() {
    let s = Scene::default;
    let cases = vec![
        Case { scene: Scene { numstat: "60\t40\tsrc/poster.ts\n", ..s() }, ..plain("hundred", "the change is 100 lines") },
        Case { scene: Scene { numstat: "-\t-\tassets/logo.png\n", ..s() }, ..plain("binary", "the size of the change is not known") },
        Case { scene: Scene { names: "M\tpackage.json\n", ..s() }, ..plain("deps", "it touches: dependencies") },
        Case { scene: Scene { names: "D\tsrc/old.ts\n", ..s() }, ..plain("deleted", "deleting") },
        Case { scene: Scene { names: "M\tsrc/invoice.ts\n", ..s() }, ..plain("money", "money") },
        Case { scene: Scene { status_first: " M src/poster.ts\n", ..s() }, ..plain("dirty", "uncommitted") },
        Case { scene: Scene { view: view("MERGED", false, SHA, "main"), ..s() }, ..plain("merged", "the pull request is merged") },
        Case { scene: Scene { view: view("CLOSED", false, SHA, "main"), ..s() }, ..plain("closed", "the pull request is closed") },
        Case { scene: Scene { view: view("OPEN", true, SHA, "main"), ..s() }, ..plain("draft", "a draft") },
        Case { scene: Scene { view: view("OPEN", false, SHA, "develop"), ..s() }, ..plain("base", "another branch") },
        Case { scene: Scene { view: view("OPEN", false, OTHER_SHA, "main"), ..s() }, ..plain("moved", "other commits") },
        Case { tweak: |f| sql(f, "UPDATE projects SET check_command = NULL"), ..plain("nocmd", "no check command") },
        Case { tweak: |f| sql(f, "UPDATE needs_you SET check_passed = 0"), ..plain("failed", "did not pass") },
        Case { tweak: |f| sql(f, "UPDATE needs_you SET check_passed = NULL"), ..plain("unrun", "did not pass") },
        Case { tweak: |f| sql(f, "UPDATE task_agents SET pr_url = NULL"), ..plain("nourl", "no pull request") },
        Case {
            tweak: |f| sql(f, "UPDATE task_agents SET pr_url = 'https://github.com/studio-b/other-tool/pull/3'"),
            ..plain("otherrepo", "not in this project's repository")
        },
        Case {
            tweak: |f| sql(f, "UPDATE task_agents SET pr_url = 'https://example.com/studio-a/poster-tool/pull/12'"),
            ..plain("badurl", "Not a GitHub pull request url")
        },
        Case { tweak: |f| sql(f, "UPDATE task_agents SET base_ref = 'main'"), ..plain("nobase", "origin") },
        Case { tweak: |f| sql(f, "UPDATE task_agents SET worktree = NULL"), ..plain("nowt", "worktree") },
        Case { tweak: |f| *f.week.lock().unwrap() = 70, ..plain("budget", "usage") },
        Case { check: "false", ..plain("again", "did not pass when run again") },
        Case { scene: Scene { view_later: Some(view("CLOSED", false, SHA, "main")), ..s() }, ..plain("closed-during", "the pull request is closed") },
        Case { scene: Scene { view_later: Some(view("OPEN", true, SHA, "main")), ..s() }, ..plain("draft-during", "a draft") },
        Case { scene: Scene { view_later: Some(view("OPEN", false, SHA, "develop")), ..s() }, ..plain("retargeted-during", "another branch") },
        Case { scene: Scene { head_later: OTHER_SHA, ..s() }, ..plain("headmoved", "changed during the check") },
        // The check itself leaves a file behind: the worktree is no longer clean.
        Case { scene: Scene { status_later: "?? target/\n", ..s() }, ..plain("dirty-after", "changed during the check") },
    ];
    for c in cases {
        let (f, id, mut mem) = merging(&format!("refuse-{}", c.name), &c.scene, c.check);
        (c.tweak)(&f);
        pass(&f, &mut mem, 1);
        assert_refused(&f, id, c.why);
        // A reopened entry is not carried out again.
        let calls = f.git_calls();
        pass(&f, &mut mem, 2);
        assert_eq!(f.git_calls(), calls, "{}", c.name);
    }
}

#[test]
fn a_failed_merge_leaves_the_entry_open_and_is_never_retried() {
    let (f, id, mut mem) = merging("merge-fails", &Scene { merge_code: 1, ..Scene::default() }, "true");
    pass(&f, &mut mem, 1);
    assert_eq!(f.merges(), 1);
    assert_eq!(f.status_of(id), "open");
    let rec = f.recommendation(id);
    assert!(rec.starts_with("The lead would accept; not merged: the merge failed: GraphQL: Pull request is not mergeable"), "{rec}");
    assert!(rec.ends_with(&format!("The lead's reason: {REASON}")), "{rec}");
    let (stage, status): (String, String) =
        f.conn().query_row("SELECT stage, status FROM tasks WHERE id = 1", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!((stage.as_str(), status.as_str()), ("to_check", "todo"));
    assert_eq!(f.one::<Option<String>>("SELECT ended_at FROM task_agents WHERE id = 1"), None);
    assert_eq!(f.one::<i64>("SELECT COUNT(*) FROM needs_you WHERE kind = 'alone'"), 0);
    pass(&f, &mut mem, 2);
    pass(&f, &mut mem, 3);
    assert_eq!(f.merges(), 1, "never retried");
    assert_safe(&f);
}

/// The check command runs while the gate closes (`closes` is a shell command that does it); the
/// entry is untouched and nothing is merged. `reopen` opens the gate again.
fn gate_closes_during_the_check(name: &str, closes: &dyn Fn(&Fx) -> String, reopen: &dyn Fn(&Fx)) {
    let mut f = fx(name, vec![started(), reply("stopped abc12345\n")]);
    f.git = scene_git(&Scene::default());
    f.merge_setup(&closes(&f));
    let id = f.check_entry();
    let mut mem = Memory::default();
    lead_on(&f, id, &mut mem);
    f.lead_resolves(id, "accept", REASON);
    pass(&f, &mut mem, 1);
    assert_eq!(f.merges(), 0);
    let (st, by, delivered): (String, String, Option<String>) = f
        .conn()
        .query_row(&format!("SELECT status, decided_by, delivered_at FROM needs_you WHERE id = {id}"), [], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .unwrap();
    assert_eq!((st.as_str(), by.as_str(), delivered), ("answered", "lead", None), "the entry is as it was");
    assert_eq!(f.state(id), "done");
    assert_eq!(f.one::<Option<String>>("SELECT ended_at FROM task_agents WHERE id = 1"), None);
    // The gate opens again: a later pass looks at the entry again and merges.
    reopen(&f);
    f.conn().execute("UPDATE projects SET check_command = 'true'", []).unwrap();
    pass(&f, &mut mem, 2);
    assert_eq!(f.merges(), 1);
    assert_merged(&f, id, "tasks");
    assert_safe(&f);
}

#[test]
fn a_switch_turned_off_during_the_check_merges_nothing_and_a_later_pass_does() {
    gate_closes_during_the_check(
        "gate-switch",
        &|f| format!("printf x > '{}'", f.dir.join("agents.json").display()),
        &|f| write_settings(&f.dir, &AgentsSettings { worker_cap: 3, ..super::super::super::tests::on() }).unwrap(),
    );
}

#[test]
fn a_mode_switched_on_during_the_check_merges_nothing_and_a_later_pass_does() {
    gate_closes_during_the_check(
        "gate-mode",
        &|f| format!("touch '{}'", db_of(&f.dir, "a").with_file_name("studiomanager_test.db").display()),
        &|f| std::fs::remove_file(db_of(&f.dir, "a").with_file_name("studiomanager_test.db")).unwrap(),
    );
}

#[test]
fn a_demo_build_or_a_mode_at_the_start_makes_no_call_for_an_accepted_check() {
    let (f, id, mut mem) = merging("demo", &Scene::default(), "true");
    let before = f.git_calls();
    go_with(&f, &list(&[worker("busy"), lead_agent(&f, "busy")]), &mut mem, 1, true);
    assert_eq!(f.git_calls(), before);
    assert_eq!((f.status_of(id).as_str(), f.state(id).as_str()), ("answered", "done"));
    let (f, id, mut mem) = merging("mode-start", &Scene::default(), "true");
    let before = f.git_calls();
    std::fs::write(db_of(&f.dir, "a").with_file_name("studiomanager_presentation.db"), "").unwrap();
    pass(&f, &mut mem, 1);
    assert_eq!(f.git_calls(), before);
    assert_eq!(f.status_of(id), "answered");
    assert_eq!(f.merges(), 0);
}

#[test]
fn a_merge_that_cannot_be_recorded_is_handed_to_the_owner_and_never_repeated() {
    let (f, id, mut mem) = merging("unrecorded", &Scene::default(), "true");
    // The write that records the merge fails (the merge is on GitHub by then).
    f.conn()
        .execute_batch("CREATE TRIGGER no_merged BEFORE UPDATE ON task_agents WHEN NEW.outcome = 'merged' BEGIN SELECT RAISE(ABORT, 'locked'); END;")
        .unwrap();
    pass(&f, &mut mem, 1);
    assert_eq!(f.merges(), 1);
    assert_eq!(f.status_of(id), "open");
    assert_eq!(f.recommendation(id), format!("Merged pull request {PR_URL}, but the app could not record it: mark the task done by hand."));
    let status: String = f.one("SELECT status FROM tasks WHERE id = 1");
    assert_eq!(status, "todo", "the whole record was rolled back");
    assert_eq!(f.one::<i64>("SELECT COUNT(*) FROM needs_you WHERE kind = 'alone'"), 0);
    pass(&f, &mut mem, 2);
    pass(&f, &mut mem, 3);
    assert_eq!(f.merges(), 1, "never merged twice");
    assert_safe(&f);
}
