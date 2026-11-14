//! Merging alone, carried out from the lead's "accept": the fake `git` and `gh` script one
//! worktree and its pull request, and every test checks that nothing but the one `gh pr merge`
//! changes the repository.

use super::super::super::git::fake::out;
use super::*;
use crate::agents::routines::run::CommandOutcome;
use std::sync::atomic::{AtomicUsize, Ordering};

const SHA: &str = "0123456789abcdef0123456789abcdef01234567";
const OTHER_SHA: &str = "fedcba9876543210fedcba9876543210fedcba98";
const PR_URL: &str = "https://github.com/studio-a/poster-tool/pull/12";
const REASON: &str = "Does what the brief asks";

fn view(state: &str, draft: bool, head: &str, base: &str) -> String {
    view_of(state, draft, head, base, "MERGEABLE", 5, 2, &["src/poster.ts"], 1)
}

/// `gh pr view` with every field the app asks for.
#[allow(clippy::too_many_arguments)]
fn view_of(state: &str, draft: bool, head: &str, base: &str, mergeable: &str, add: i64, del: i64, files: &[&str], changed: i64) -> String {
    let files: Vec<String> = files.iter().map(|p| format!("{{\"path\":\"{p}\",\"additions\":1,\"deletions\":0}}")).collect();
    format!(
        "{{\"state\":\"{state}\",\"isDraft\":{draft},\"headRefOid\":\"{head}\",\"baseRefName\":\"{base}\",\"mergeable\":\"{mergeable}\",\"additions\":{add},\"deletions\":{del},\"changedFiles\":{changed},\"files\":[{}]}}\n",
        files.join(",")
    )
}

/// What the fake `git` and `gh` say about one worktree and its pull request.
#[derive(Clone)]
struct Scene {
    origin: &'static str,
    numstat: &'static str,
    names: &'static str,
    /// `git diff --raw`: the modes.
    raw: &'static str,
    /// `git status --porcelain`, from the first read on and from the second read on.
    status_first: &'static str,
    status_later: &'static str,
    view: String,
    /// What `gh pr view` says from the second read on (None: the same).
    view_later: Option<String>,
    merge_code: i32,
    /// `gh pr merge` timed out instead of answering `merge_code`.
    merge_timeout: bool,
    /// What `gh pr view` says once `gh pr merge` was called for that url (None: the pull request,
    /// merged); `after_code` is its exit code.
    after_merge: Option<String>,
    after_code: i32,
    /// `git remote get-url origin` in the project folder (None: as everywhere).
    project_origin: Option<&'static str>,
    /// What `git rev-parse HEAD` says from the second read on.
    head_later: &'static str,
    /// Runs when HEAD is read the second time: just after the second check.
    after_check: Option<Hook>,
    /// Runs when `gh pr merge` is called.
    on_merge: Option<Hook>,
}

type Hook = Arc<dyn Fn() + Send + Sync>;
/// The hooks a fixture needs (after the second check, at `gh pr merge`).
type Hooks = (Option<Hook>, Option<Hook>);
/// The `alone` rows seen, and the entry's `delivered_at`, when `gh pr merge` was called.
type Seen = Vec<(Vec<(String, String)>, Option<String>)>;

impl Default for Scene {
    fn default() -> Self {
        Scene {
            origin: "https://github.com/studio-a/poster-tool.git\n",
            numstat: "5\t2\tsrc/poster.ts\n",
            names: "M\tsrc/poster.ts\n",
            raw: ":100644 100644 1111111 2222222 M\tsrc/poster.ts\n",
            status_first: "",
            status_later: "",
            view: view("OPEN", false, SHA, "main"),
            view_later: None,
            merge_code: 0,
            merge_timeout: false,
            after_merge: None,
            after_code: 0,
            project_origin: None,
            head_later: SHA,
            after_check: None,
            on_merge: None,
        }
    }
}

fn scene_git(s: &Scene) -> FakeGit {
    let heads = Arc::new(AtomicUsize::new(0));
    let statuses = Arc::new(AtomicUsize::new(0));
    let views = Arc::new(AtomicUsize::new(0));
    let g = s.clone();
    let h = s.clone();
    let merged: Arc<std::sync::Mutex<Vec<String>>> = Arc::new(std::sync::Mutex::new(vec![]));
    let merged_gh = merged.clone();
    let git = FakeGit::new(move |c| match c {
        "rev-parse HEAD" => {
            let n = heads.fetch_add(1, Ordering::SeqCst);
            if n == 1 {
                if let Some(hook) = &g.after_check {
                    hook();
                }
            }
            out(0, &format!("{}\n", if n == 0 { SHA } else { g.head_later }))
        }
        "remote get-url origin" => out(0, g.origin),
        "merge-base origin/main HEAD" => out(0, "abc123\n"),
        "diff --numstat --no-renames --no-ext-diff --no-textconv --ignore-submodules=none abc123 --" => out(0, g.numstat),
        "diff --name-status --no-renames --no-ext-diff --no-textconv --ignore-submodules=none abc123 --" => out(0, g.names),
        "diff --raw --no-renames --no-ext-diff --no-textconv --ignore-submodules=none abc123 --" => out(0, g.raw),
        "status --porcelain --untracked-files=all --ignore-submodules=none" => {
            let n = statuses.fetch_add(1, Ordering::SeqCst);
            out(0, if n == 0 { g.status_first } else { g.status_later })
        }
        _ => out(0, ""),
    })
    .with_gh(move |c| {
        let url = c.split(' ').nth(2).unwrap_or("").to_string();
        if c.starts_with("pr view") {
            if merged_gh.lock().unwrap().contains(&url) {
                return match &h.after_merge {
                    Some(v) => out(h.after_code, v),
                    None => out(0, &h.view.replace("OPEN", "MERGED")),
                };
            }
            let n = views.fetch_add(1, Ordering::SeqCst);
            out(0, if n == 0 { &h.view } else { h.view_later.as_ref().unwrap_or(&h.view) })
        } else if c.starts_with("pr merge") {
            if let Some(hook) = &h.on_merge {
                hook();
            }
            merged_gh.lock().unwrap().push(url);
            if h.merge_timeout {
                return CommandOutcome { code: None, timed_out: true, tail: String::new(), error: None };
            }
            out(h.merge_code, if h.merge_code == 0 { "" } else { "GraphQL: Pull request is not mergeable" })
        } else {
            out(1, "unexpected gh call")
        }
    });
    match s.project_origin {
        Some(o) => git.with_origin_in("/tmp/poster", o),
        None => git,
    }
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
    /// The `alone` rows: title and reason.
    fn alone_rows(&self) -> Vec<(String, String)> {
        let c = self.conn();
        let mut s = c.prepare("SELECT title, COALESCE(reason, '') FROM needs_you WHERE kind = 'alone' ORDER BY id").unwrap();
        let rows = s.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(|r| r.unwrap()).collect();
        rows
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

/// `merging` with hooks that need the folders of the fixture (they close a gate, flip a switch).
fn merging_hooked(name: &str, make: &dyn Fn(&Fx) -> Hooks) -> (Fx, i64, Memory) {
    let mut f = fx(name, vec![started(), reply("stopped abc12345\n")]);
    let (after_check, on_merge) = make(&f);
    f.git = scene_git(&Scene { after_check, on_merge, ..Scene::default() });
    f.merge_setup("true");
    let id = f.check_entry();
    let mut mem = Memory::default();
    lead_on(&f, id, &mut mem);
    f.lead_resolves(id, "accept", REASON);
    (f, id, mem)
}

/// A hook that runs `statement` on the fixture's database.
fn sql_hook(f: &Fx, statement: &'static str) -> Hook {
    let db = f.db.clone();
    Arc::new(move || {
        Connection::open(&db).unwrap().execute(statement, []).unwrap();
    })
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
fn a_one_line_change_is_listed_as_1_line_not_1_lines() {
    let scene = Scene {
        numstat: "1\t0\tsrc/poster.ts\n",
        view: view_of("OPEN", false, SHA, "main", "MERGEABLE", 1, 0, &["src/poster.ts"], 1),
        ..Scene::default()
    };
    let (f, _id, mut mem) = merging("one-line", &scene, "true");
    pass(&f, &mut mem, 1);
    assert_eq!(f.merges(), 1);
    assert_eq!(f.alone_rows()[0].0, "Merged: check passed, 1 line");
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
        Case {
            scene: Scene { raw: ":000000 120000 0000000 2222222 A\tsrc/poster.ts\n", ..s() },
            ..plain("symlink", "it touches: unusual file")
        },
        Case {
            scene: Scene { raw: ":160000 160000 1111111 2222222 M\tsrc/poster.ts\n", ..s() },
            ..plain("submodule", "it touches: unusual file")
        },
        Case {
            scene: Scene { raw: ":100644 100755 1111111 2222222 M\tsrc/poster.ts\n", ..s() },
            ..plain("modechange", "it touches: unusual file")
        },
        Case { scene: Scene { raw: "garbage\n", ..s() }, ..plain("unparseable-raw", "it touches: unusual file") },
        Case {
            scene: Scene { view: view_of("OPEN", false, SHA, "main", "CONFLICTING", 5, 2, &["src/poster.ts"], 1), ..s() },
            ..plain("conflicting", "cannot be merged cleanly")
        },
        Case {
            scene: Scene { view: view_of("OPEN", false, SHA, "main", "UNKNOWN", 5, 2, &["src/poster.ts"], 1), ..s() },
            ..plain("mergeable-unknown", "has not worked it out yet")
        },
        Case {
            scene: Scene { view: view_of("OPEN", false, SHA, "main", "MERGEABLE", 50, 2, &["src/poster.ts"], 1), ..s() },
            ..plain("github-more-lines", "is not the change that was measured")
        },
        Case {
            scene: Scene { view: view_of("OPEN", false, SHA, "main", "MERGEABLE", 5, 2, &["src/other.ts"], 1), ..s() },
            ..plain("github-other-path", "is not the change that was measured")
        },
        Case {
            scene: Scene { view: view_of("OPEN", false, SHA, "main", "MERGEABLE", 5, 2, &["src/poster.ts"], 3), ..s() },
            ..plain("github-cut-list", "is not the change that was measured")
        },
        Case {
            scene: Scene { view: view_of("OPEN", false, SHA, "main", "MERGEABLE", 5, 2, &["src/poster.ts", "package.json"], 2), ..s() },
            ..plain("github-touches-package-json", "it touches: dependencies")
        },
        Case {
            scene: Scene { names: "M\tbun.lock\n", ..s() },
            ..plain("bun-lock", "it touches: dependencies")
        },
        Case { scene: Scene { names: "M\tsrc/migrations\n", ..s() }, ..plain("file-named-migrations", "it touches: migrations") },
        Case { tweak: |f| sql(f, "UPDATE projects SET folder_path = NULL"), ..plain("nofolder", "no folder") },
        Case {
            scene: Scene { project_origin: Some("https://github.com/studio-b/other-tool.git\n"), ..s() },
            ..plain("project-origin", "not in this project's repository")
        },
        Case {
            tweak: |f| {
                sql(f, "INSERT INTO tasks (id, project_id, title, stage) VALUES (2, 1, 'Other', 'to_check')");
                sql(f, "UPDATE needs_you SET task_id = 2");
            },
            ..plain("other-item", "not for the same item")
        },
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
    let still_open = Some(view("OPEN", false, SHA, "main"));
    let (f, id, mut mem) = merging("merge-fails", &Scene { merge_code: 1, after_merge: still_open, ..Scene::default() }, "true");
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
    // The decision stays listed, as what happened.
    assert_eq!(f.alone_rows().len(), 1);
    assert!(f.alone_rows()[0].0.starts_with("Not merged: the merge failed: GraphQL"), "{:?}", f.alone_rows());
    pass(&f, &mut mem, 2);
    pass(&f, &mut mem, 3);
    assert_eq!(f.merges(), 1, "never retried");
    assert_eq!(f.alone_rows().len(), 1);
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
    // The decision, listed when it was claimed, says what happened.
    assert_eq!(f.alone_rows().iter().map(|r| r.0.as_str()).collect::<Vec<_>>(), vec!["Merged: the app could not record it"]);
    pass(&f, &mut mem, 2);
    pass(&f, &mut mem, 3);
    assert_eq!(f.merges(), 1, "never merged twice");
    assert_safe(&f);
}

// ------------------------------------------------------------ what happens after `gh pr merge`

#[test]
fn a_merge_that_timed_out_but_landed_is_recorded_as_merged() {
    let (f, id, mut mem) = merging("timeout-merged", &Scene { merge_timeout: true, ..Scene::default() }, "true");
    pass(&f, &mut mem, 1);
    assert_eq!(f.merges(), 1);
    assert_merged(&f, id, "tasks");
    pass(&f, &mut mem, 2);
    assert_eq!(f.merges(), 1);
    assert_safe(&f);
}

/// The entry is open for the owner with the "may have happened" text, the item and the link are
/// as they were, the `alone` row says so, and a later pass merges nothing.
fn assert_may_be_merged(f: &Fx, id: i64, mem: &mut Memory) {
    assert_eq!(f.merges(), 1);
    assert_eq!(f.status_of(id), "open");
    assert_eq!(
        f.recommendation(id),
        format!("The lead would accept; the merge may have happened or is queued: look at {PR_URL}. The lead's reason: {REASON}")
    );
    let (stage, status): (String, String) =
        f.conn().query_row("SELECT stage, status FROM tasks WHERE id = 1", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!((stage.as_str(), status.as_str()), ("to_check", "todo"), "the item is not marked done");
    assert_eq!(f.one::<Option<String>>("SELECT ended_at FROM task_agents WHERE id = 1"), None);
    let rows = f.alone_rows();
    assert_eq!(rows.len(), 1, "{rows:?}");
    assert!(rows[0].0.starts_with("May be merged"), "{rows:?}");
    pass(f, mem, 9);
    pass(f, mem, 10);
    assert_eq!(f.merges(), 1, "never retried");
    assert_safe(f);
}

#[test]
fn an_exit_zero_with_the_pull_request_still_open_is_not_marked_merged() {
    // A merge queue answers before it merges.
    let scene = Scene { after_merge: Some(view("OPEN", false, SHA, "main")), ..Scene::default() };
    let (f, id, mut mem) = merging("queued", &scene, "true");
    pass(&f, &mut mem, 1);
    assert_may_be_merged(&f, id, &mut mem);
}

#[test]
fn a_pull_request_that_cannot_be_read_after_the_merge_is_handed_to_the_owner() {
    let scene = Scene { after_merge: Some("GraphQL: something broke
".into()), after_code: 1, ..Scene::default() };
    let (f, id, mut mem) = merging("view-fails-after", &scene, "true");
    pass(&f, &mut mem, 1);
    assert_may_be_merged(&f, id, &mut mem);
    // The same when the merge itself failed and the pull request cannot be read.
    let scene = Scene { merge_code: 1, after_merge: Some("nope
".into()), after_code: 1, ..Scene::default() };
    let (f, id, mut mem) = merging("view-fails-after-2", &scene, "true");
    pass(&f, &mut mem, 1);
    assert_may_be_merged(&f, id, &mut mem);
}

#[test]
fn a_failed_merge_that_did_land_is_recorded_as_merged() {
    // `gh` exits 1 after GitHub merged (a flaky answer): the pull request is merged.
    let (f, id, mut mem) = merging("fail-but-merged", &Scene { merge_code: 1, ..Scene::default() }, "true");
    pass(&f, &mut mem, 1);
    assert_eq!(f.merges(), 1);
    assert_merged(&f, id, "tasks");
}

#[test]
fn the_decision_is_listed_before_the_merge_and_ends_as_what_happened() {
    let seen: Arc<Mutex<Seen>> = Arc::new(Mutex::new(vec![]));
    let at_merge = seen.clone();
    let (f, id, mut mem) = merging_hooked("listed-first", &|f| {
        let db = f.db.clone();
        let at_merge = at_merge.clone();
        let hook: Hook = Arc::new(move || {
            let c = Connection::open(&db).unwrap();
            let mut s = c.prepare("SELECT title, COALESCE(reason, '') FROM needs_you WHERE kind = 'alone'").unwrap();
            let rows = s.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(|r| r.unwrap()).collect();
            let delivered: Option<String> = c.query_row("SELECT delivered_at FROM needs_you WHERE kind = 'check'", [], |r| r.get(0)).unwrap();
            at_merge.lock().unwrap().push((rows, delivered));
        });
        (None, Some(hook))
    });
    pass(&f, &mut mem, 1);
    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 1);
    let (rows, delivered) = &seen[0];
    assert_eq!(rows.len(), 1, "one row when `gh pr merge` is called");
    assert_eq!(rows[0].0, format!("Merging pull request {PR_URL} at 0123456"));
    assert!(rows[0].1.contains(REASON), "{rows:?}");
    assert!(delivered.is_some(), "the delivery is claimed in the same write");
    assert_merged(&f, id, "tasks");
}

// ------------------------------------------------------------ read again after the check

/// The check (just after it) changes something; the entry is back to the owner with `why`.
fn changed_during_the_check(name: &str, hook: &'static str, why: &str) {
    let (f, id, mut mem) = merging_hooked(name, &|f| (Some(sql_hook(f, hook)), None));
    pass(&f, &mut mem, 1);
    assert_refused(&f, id, why);
    pass(&f, &mut mem, 2);
    assert_eq!(f.merges(), 0);
}

#[test]
fn a_switch_flipped_a_hub_ticked_or_a_command_changed_during_the_check_merges_nothing() {
    changed_during_the_check("during-off", "UPDATE projects SET merge_alone = 0", "merging alone was switched off during the check");
    changed_during_the_check("during-hub", "UPDATE projects SET hub_project = 1", "the project belongs to a hub");
    changed_during_the_check("during-cmd", "UPDATE projects SET check_command = 'true; true'", "changed during the check");
    changed_during_the_check(
        "during-url",
        "UPDATE task_agents SET pr_url = 'https://github.com/studio-a/poster-tool/pull/99'",
        "changed during the check",
    );
    changed_during_the_check("during-folder", "UPDATE projects SET folder_path = '/tmp/elsewhere'", "changed during the check");
    changed_during_the_check("during-verdict", "UPDATE needs_you SET check_passed = 0", "the check did not pass");
}

#[test]
fn a_link_that_ends_during_the_check_merges_nothing() {
    let (f, id, mut mem) = merging_hooked("during-link", &|f| (Some(sql_hook(f, "UPDATE task_agents SET ended_at = datetime('now')")), None));
    pass(&f, &mut mem, 1);
    let rec = f.recommendation(id);
    assert_eq!(f.status_of(id), "open", "{rec}");
    assert!(rec.contains("the watcher link ended during the check") && rec.ends_with(&format!("The lead's reason: {REASON}")), "{rec}");
    assert_eq!(f.merges(), 0);
    assert_eq!(f.alone_rows().len(), 0);
    assert_safe(&f);
}

#[test]
fn agent_access_turned_off_during_the_check_merges_nothing_and_writes_nothing() {
    let (f, id, mut mem) = merging_hooked("during-access", &|f| {
        let dir = f.dir.clone();
        let hook: Hook = Arc::new(move || {
            crate::agent_access::write_access(
                &dir,
                &crate::agent_access::AccessSettings { enabled: true, orgs: [("a".to_string(), false)].into(), ..Default::default() },
            )
            .unwrap();
        });
        (Some(hook), None)
    });
    pass(&f, &mut mem, 1);
    assert_eq!(f.merges(), 0);
    let (st, by, delivered): (String, String, Option<String>) = f
        .conn()
        .query_row(&format!("SELECT status, decided_by, delivered_at FROM needs_you WHERE id = {id}"), [], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .unwrap();
    assert_eq!((st.as_str(), by.as_str(), delivered), ("answered", "lead", None), "the entry is as it was");
    assert_eq!(f.alone_rows().len(), 0);
    // Access back on: a later pass looks at the entry again and merges.
    crate::agent_access::write_access(
        &f.dir,
        &crate::agent_access::AccessSettings { enabled: true, orgs: [("a".to_string(), true)].into(), ..Default::default() },
    )
    .unwrap();
    pass(&f, &mut mem, 2);
    assert_eq!(f.merges(), 1);
    assert_merged(&f, id, "tasks");
}

// ------------------------------------------------------------ the project folder's origin

#[test]
fn the_url_is_checked_against_the_origin_of_the_project_folder_and_the_worktree() {
    let (f, id, mut mem) = merging("origins", &Scene::default(), "true");
    pass(&f, &mut mem, 1);
    assert_merged(&f, id, "tasks");
    let folders = f.git.origin_folders();
    assert!(folders.iter().any(|d| d == "/tmp/poster"), "{folders:?}");
    assert!(folders.iter().any(|d| d.ends_with("/wt")), "{folders:?}");
    // A worktree whose config says another repository is refused as before.
    let scene = Scene { origin: "https://github.com/studio-b/other-tool.git
", ..Scene::default() };
    let (f, id, mut mem) = merging("origin-worktree", &scene, "true");
    pass(&f, &mut mem, 1);
    assert_refused(&f, id, "not in this project's repository");
}

// ------------------------------------------------------------ one check at a time

const SECOND_WORKER: &str =
    r#"{"sessionId":"00000000-1111-2222-3333-555555555555","id":"abc22222","name":"sm-w-task-2","cwd":"/x","kind":"bg","status":"busy","pid":4243}"#;

/// A second finished task (id 2, link 2, pull request 13) whose entry the lead accepted, with the
/// stored check verdict `passed`.
fn add_second_accepted(f: &Fx, passed: i64) {
    let wt = f.dir.join("wt");
    let c = f.conn();
    c.execute("INSERT INTO tasks (id, project_id, title, stage, result) VALUES (2, 1, 'Second', 'to_check', 'Done.')", []).unwrap();
    c.execute(
        "INSERT INTO task_agents (id, task_id, short_id, name, started_by, worktree, base_ref, pr_url, check_state, reported_at)
         VALUES (2, 2, 'abc22222', 'sm-w-task-2', 'watcher', ?1, 'origin/main', 'https://github.com/studio-a/poster-tool/pull/13', 'passed', datetime('now'))",
        [wt.to_string_lossy()],
    )
    .unwrap();
    c.execute(
        "INSERT INTO needs_you (kind, task_id, link_id, title, body, status, decided_by, answer, reason, answered_at, lead_state, check_passed)
         VALUES ('check', 2, 2, 'Second', 'Done.', 'answered', 'lead', 'accept', ?1, datetime('now'), 'done', ?2)",
        params![REASON, passed],
    )
    .unwrap();
}

#[test]
fn one_pass_runs_at_most_one_check_and_merges_one_change() {
    let (f, id1, mut mem) = merging("two-entries", &Scene::default(), "echo run >> ran.log");
    add_second_accepted(&f, 1);
    f.cli.replies.lock().unwrap().insert(0, reply("stopped abc22222\n"));
    let agents = list(&[worker("busy"), SECOND_WORKER.to_string(), lead_agent(&f, "busy")]);
    let log = f.dir.join("wt").join("ran.log");
    let runs = || std::fs::read_to_string(&log).map(|t| t.lines().count()).unwrap_or(0);
    go(&f, &agents, &mut mem, 1);
    assert_eq!(runs(), 1, "one check in the pass");
    assert_eq!(f.merges(), 1, "one merge in the pass");
    assert_eq!(f.one::<i64>("SELECT COUNT(*) FROM task_agents WHERE outcome = 'merged'"), 1);
    // The next pass reads everything fresh and takes the other one.
    go(&f, &agents, &mut mem, 2);
    assert_eq!(runs(), 2);
    assert_eq!(f.merges(), 2);
    assert_eq!(f.one::<i64>("SELECT COUNT(*) FROM task_agents WHERE outcome = 'merged'"), 2);
    assert_eq!(f.one::<i64>("SELECT COUNT(*) FROM needs_you WHERE kind = 'alone'"), 2);
    go(&f, &agents, &mut mem, 3);
    assert_eq!(f.merges(), 2);
    assert_eq!(f.status_of(id1), "answered");
    assert_safe(&f);
}

#[test]
fn a_cheap_refusal_does_not_use_up_the_pass() {
    // The older entry has no stored pass: refused before any process, so the other still gets its check.
    let (f, _id1, mut mem) = merging("cheap-and-check", &Scene::default(), "echo run >> ran.log");
    add_second_accepted(&f, 0);
    f.conn().execute("UPDATE needs_you SET created_at = '2000-01-01 00:00:00' WHERE task_id = 2", []).unwrap();
    go(&f, &list(&[worker("busy"), SECOND_WORKER.to_string(), lead_agent(&f, "busy")]), &mut mem, 1);
    let rec = f.recommendation(f.one("SELECT id FROM needs_you WHERE task_id = 2"));
    assert_eq!(f.merges(), 1, "{rec} {:?}", f.recommendation(1));
    assert_eq!(f.one::<i64>("SELECT COUNT(*) FROM needs_you WHERE status = 'open' AND task_id = 2"), 1);
}

// ------------------------------------------------------------ small things

#[test]
fn an_item_that_is_already_done_is_not_written_again_by_a_merge() {
    let (f, id, mut mem) = merging("already-done", &Scene::default(), "true");
    f.conn().execute("UPDATE tasks SET status = 'done', due_date = '2020-01-01'", []).unwrap();
    pass(&f, &mut mem, 1);
    assert_eq!(f.merges(), 1);
    let due: String = f.one("SELECT due_date FROM tasks WHERE id = 1");
    assert_eq!(due, "2020-01-01", "a done item keeps its due date");
    assert_eq!(f.one::<String>("SELECT outcome FROM task_agents WHERE id = 1"), "merged");
    assert_eq!(f.alone_rows()[0].0, "Merged: check passed, 7 lines");
    assert_eq!(f.status_of(id), "answered");
}
