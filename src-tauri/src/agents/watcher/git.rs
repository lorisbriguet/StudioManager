//! The watcher's `git`: finding the base branch and making a worktree for one item. Every call is
//! argv, never a shell, and goes through the `Git` trait so tests run no process. Nothing here
//! removes a worktree, a branch or a file.

use super::super::links::ItemKind;
use crate::agents::routines::run::{run_command, CommandOutcome};
use std::path::Path;
use std::time::Duration;

/// A `git` call that takes longer than this is killed (a fetch on a bad network).
pub const GIT_TIMEOUT: Duration = Duration::from_secs(60);

pub trait Git {
    fn run(&self, program: &str, args: &[String], cwd: &str) -> CommandOutcome;
}

/// `git` with the login shell's `PATH` (resolved on first use, then cached).
pub struct RealGit {
    pub login: crate::agents::pty::LoginCache,
}

impl Git for RealGit {
    fn run(&self, program: &str, args: &[String], cwd: &str) -> CommandOutcome {
        let env = crate::agents::pty::cached_login_env(&self.login);
        run_command(program, args, cwd, &env.path, GIT_TIMEOUT)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Worktree {
    pub path: String,
    pub branch: String,
}

fn argv(a: &[&str]) -> Vec<String> {
    a.iter().map(|s| s.to_string()).collect()
}

pub(super) fn succeeded(o: &CommandOutcome) -> bool {
    o.code == Some(0) && !o.timed_out && o.error.is_none()
}

pub(super) fn git(g: &dyn Git, folder: &str, a: &[&str]) -> CommandOutcome {
    g.run("git", &argv(a), folder)
}

/// The first line of what a failed call said.
pub(super) fn first_line(o: &CommandOutcome, fallback: &str) -> String {
    if let Some(e) = &o.error {
        return e.clone();
    }
    if o.timed_out {
        return "git took too long".to_string();
    }
    o.tail.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or(fallback).chars().take(160).collect()
}

/// Whether `folder` is inside a git work tree.
pub fn is_repo(g: &dyn Git, folder: &str) -> bool {
    let o = git(g, folder, &["rev-parse", "--is-inside-work-tree"]);
    succeeded(&o) && o.tail.trim() == "true"
}

pub(super) fn ref_ok(r: &str) -> bool {
    !r.is_empty() && !r.starts_with('-') && !r.chars().any(|c| c.is_whitespace() || c.is_control())
}

/// What a worktree starts from: with an `origin`, its default branch (after a fetch, which may
/// fail offline), else a local `main` or `master`.
pub fn base_ref(g: &dyn Git, folder: &str) -> Result<String, String> {
    let remotes = git(g, folder, &["remote"]);
    if succeeded(&remotes) && remotes.tail.lines().any(|l| l.trim() == "origin") {
        let _ = git(g, folder, &["fetch", "origin", "--quiet"]);
        let head = git(g, folder, &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
        if succeeded(&head) && ref_ok(head.tail.trim()) {
            return Ok(head.tail.trim().to_string());
        }
        for cand in ["origin/main", "origin/master"] {
            let c = format!("refs/remotes/{cand}");
            if succeeded(&git(g, folder, &["show-ref", "--verify", "--quiet", &c])) {
                return Ok(cand.to_string());
            }
        }
    }
    for cand in ["main", "master"] {
        let c = format!("refs/heads/{cand}");
        if succeeded(&git(g, folder, &["show-ref", "--verify", "--quiet", &c])) {
            return Ok(cand.to_string());
        }
    }
    Err("No base branch".to_string())
}

/// The branch of an item's worktree: `sm/<kind>-<id>`, built from the kind and the id only.
pub fn branch_name(kind: ItemKind, id: i64) -> String {
    format!("sm/{}-{id}", kind_word(kind))
}

pub fn kind_word(kind: ItemKind) -> &'static str {
    match kind {
        ItemKind::Task => "task",
        ItemKind::Subtask => "subtask",
    }
}

/// `git worktree add -b sm/<kind>-<id> <folder>/.claude/worktrees/sm-<kind>-<id> <base>`. Refused
/// when the branch or the path already exists: the watcher never reuses (or removes) one.
pub fn add_worktree(g: &dyn Git, folder: &str, kind: ItemKind, id: i64, base: &str) -> Result<Worktree, String> {
    if !ref_ok(base) {
        return Err("Invalid base branch".to_string());
    }
    if !Path::new(folder).is_absolute() {
        return Err("The project folder is not an absolute path".to_string());
    }
    let word = kind_word(kind);
    let branch = branch_name(kind, id);
    let path = format!("{}/.claude/worktrees/sm-{word}-{id}", folder.trim_end_matches('/'));
    if Path::new(&path).exists() {
        return Err(format!("The worktree sm-{word}-{id} already exists"));
    }
    let exists = git(g, folder, &["show-ref", "--verify", "--quiet", &format!("refs/heads/{branch}")]);
    if exists.error.is_some() || exists.timed_out {
        return Err(first_line(&exists, "git failed"));
    }
    if exists.code == Some(0) {
        return Err(format!("The branch {branch} already exists"));
    }
    let o = git(g, folder, &["worktree", "add", "-b", &branch, "--", &path, base]);
    if !succeeded(&o) {
        return Err(first_line(&o, "git worktree add failed"));
    }
    Ok(Worktree { path, branch })
}

#[cfg(test)]
pub(super) mod fake {
    use super::*;
    use std::sync::Mutex;

    type Script = Box<dyn Fn(&str) -> CommandOutcome + Send + Sync>;

    /// A scripted `git` (and, once `with_gh` is called, `gh`): each call is matched by the joined
    /// argv; no process is spawned. A `gh` call with no `gh` script, or any other program, panics.
    pub struct FakeGit {
        pub calls: Mutex<Vec<(String, String)>>,
        script: Script,
        gh: Option<Script>,
        /// The folder each call ran in, parallel to `calls`.
        pub cwds: Mutex<Vec<String>>,
        /// `git remote get-url origin` says this in the given folder (before the script is asked).
        origins: Vec<(String, String)>,
    }

    pub fn out(code: i32, tail: &str) -> CommandOutcome {
        CommandOutcome { code: Some(code), timed_out: false, tail: tail.to_string(), error: None }
    }

    impl FakeGit {
        pub fn new(script: impl Fn(&str) -> CommandOutcome + Send + Sync + 'static) -> Self {
            Self { calls: Mutex::new(vec![]), script: Box::new(script), gh: None, cwds: Mutex::new(vec![]), origins: vec![] }
        }
        /// Scripts the `gh` calls too (matched by the joined argv, as `git` is).
        pub fn with_gh(mut self, script: impl Fn(&str) -> CommandOutcome + Send + Sync + 'static) -> Self {
            self.gh = Some(Box::new(script));
            self
        }
        /// `git remote get-url origin` says `tail` when run in `folder`, whatever the script says.
        pub fn with_origin_in(mut self, folder: &str, tail: &str) -> Self {
            self.origins.push((folder.to_string(), tail.to_string()));
            self
        }
        /// The folders `git remote get-url origin` was run in.
        pub fn origin_folders(&self) -> Vec<String> {
            let calls = self.calls.lock().unwrap();
            let cwds = self.cwds.lock().unwrap();
            calls.iter().zip(cwds.iter()).filter(|((_, a), _)| a == "remote get-url origin").map(|(_, c)| c.clone()).collect()
        }
        /// The recorded `gh` calls, joined argv.
        pub fn gh_commands(&self) -> Vec<String> {
            self.calls.lock().unwrap().iter().filter(|(p, _)| p == "gh").map(|(_, a)| a.clone()).collect()
        }
        /// A repository with an `origin` whose default branch is `origin/main`.
        pub fn repo() -> Self {
            Self::new(|c| match c {
                "rev-parse --is-inside-work-tree" => out(0, "true\n"),
                "remote" => out(0, "origin\n"),
                "symbolic-ref --short refs/remotes/origin/HEAD" => out(0, "origin/main\n"),
                c if c.starts_with("show-ref") => out(1, ""),
                c if c.starts_with("worktree add") => out(0, ""),
                _ => out(0, ""),
            })
        }
        pub fn commands(&self) -> Vec<String> {
            self.calls.lock().unwrap().iter().map(|(_, a)| a.clone()).collect()
        }
    }

    impl Git for FakeGit {
        fn run(&self, program: &str, args: &[String], cwd: &str) -> CommandOutcome {
            let joined = args.join(" ");
            self.calls.lock().unwrap().push((program.to_string(), joined.clone()));
            self.cwds.lock().unwrap().push(cwd.to_string());
            match program {
                "git" if joined == "remote get-url origin" && self.origins.iter().any(|(f, _)| f == cwd) => {
                    out(0, &self.origins.iter().find(|(f, _)| f == cwd).map(|(_, t)| t.clone()).unwrap_or_default())
                }
                "git" => (self.script)(&joined),
                "gh" => (self.gh.as_ref().expect("gh is not scripted in this test"))(&joined),
                other => panic!("the watcher runs only git and gh here, not {other}"),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fake::*;
    use super::*;

    #[test]
    fn is_repo_needs_true_from_git() {
        assert!(is_repo(&FakeGit::repo(), "/x"));
        assert!(!is_repo(&FakeGit::new(|_| out(128, "fatal: not a git repository")), "/x"));
        assert!(!is_repo(&FakeGit::new(|_| out(0, "false\n")), "/x"));
    }

    #[test]
    fn base_ref_prefers_origin_head_then_origin_main_then_local() {
        assert_eq!(base_ref(&FakeGit::repo(), "/x").unwrap(), "origin/main");
        let no_head = FakeGit::new(|c| match c {
            "remote" => out(0, "origin\n"),
            "symbolic-ref --short refs/remotes/origin/HEAD" => out(1, "fatal"),
            "show-ref --verify --quiet refs/remotes/origin/master" => out(0, ""),
            _ => out(1, ""),
        });
        assert_eq!(base_ref(&no_head, "/x").unwrap(), "origin/master");
        let local = FakeGit::new(|c| match c {
            "remote" => out(0, ""),
            "show-ref --verify --quiet refs/heads/master" => out(0, ""),
            _ => out(1, ""),
        });
        assert_eq!(base_ref(&local, "/x").unwrap(), "master");
        let none = FakeGit::new(|_| out(1, ""));
        assert_eq!(base_ref(&none, "/x").unwrap_err(), "No base branch");
        // A refused fetch (offline) does not stop it.
        let offline = FakeGit::new(|c| match c {
            "remote" => out(0, "origin\n"),
            "fetch origin --quiet" => out(1, "unable to access"),
            "symbolic-ref --short refs/remotes/origin/HEAD" => out(0, "origin/main\n"),
            _ => out(1, ""),
        });
        assert_eq!(base_ref(&offline, "/x").unwrap(), "origin/main");
    }

    #[test]
    fn a_base_that_looks_like_a_flag_is_refused() {
        let g = FakeGit::new(|c| match c {
            "remote" => out(0, "origin\n"),
            "symbolic-ref --short refs/remotes/origin/HEAD" => out(0, "--force\n"),
            _ => out(1, ""),
        });
        assert_eq!(base_ref(&g, "/x").unwrap_err(), "No base branch");
        assert!(add_worktree(&FakeGit::repo(), "/x", ItemKind::Task, 1, "--force").is_err());
    }

    #[test]
    fn the_branch_is_named_from_the_kind_and_the_id() {
        assert_eq!(branch_name(ItemKind::Task, 31), "sm/task-31");
        assert_eq!(branch_name(ItemKind::Subtask, 7), "sm/subtask-7");
    }

    #[test]
    fn add_worktree_names_the_branch_and_path_and_refuses_an_existing_branch() {
        let g = FakeGit::repo();
        let w = add_worktree(&g, "/nonexistent-folder/poster/", ItemKind::Subtask, 7, "origin/main").unwrap();
        assert_eq!(w.branch, "sm/subtask-7");
        assert_eq!(w.path, "/nonexistent-folder/poster/.claude/worktrees/sm-subtask-7");
        assert!(g
            .commands()
            .contains(&format!("worktree add -b sm/subtask-7 -- {} origin/main", w.path)));
        let taken = FakeGit::new(|_| out(0, ""));
        let e = add_worktree(&taken, "/nonexistent-folder/poster", ItemKind::Task, 1, "origin/main").unwrap_err();
        assert!(e.contains("already exists"), "{e}");
        assert!(!taken.commands().iter().any(|c| c.starts_with("worktree")), "nothing was made");
    }

    #[test]
    fn add_worktree_refuses_a_relative_folder_and_ends_options_before_the_path() {
        let g = FakeGit::repo();
        let e = add_worktree(&g, "poster", ItemKind::Task, 1, "origin/main").unwrap_err();
        assert!(e.contains("absolute"), "{e}");
        assert!(g.commands().is_empty());
        let w = add_worktree(&g, "/nonexistent-folder/poster", ItemKind::Task, 2, "origin/main").unwrap();
        let add = g.commands().into_iter().find(|c| c.starts_with("worktree add")).unwrap();
        assert_eq!(add, format!("worktree add -b sm/task-2 -- {} origin/main", w.path));
    }

    #[test]
    fn add_worktree_refuses_an_existing_path() {
        let d = std::env::temp_dir().join(format!("sm-watcher-git-path-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join(".claude/worktrees/sm-task-3")).unwrap();
        let g = FakeGit::repo();
        let e = add_worktree(&g, &d.to_string_lossy(), ItemKind::Task, 3, "origin/main").unwrap_err();
        assert!(e.contains("already exists"), "{e}");
        assert!(g.commands().is_empty(), "git was not even asked");
        assert!(d.join(".claude/worktrees/sm-task-3").exists(), "the folder is left alone");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn a_failed_worktree_add_says_why() {
        let g = FakeGit::new(|c| {
            if c.starts_with("worktree add") {
                out(128, "fatal: invalid reference: origin/nope\n")
            } else {
                out(1, "")
            }
        });
        let e = add_worktree(&g, "/nonexistent-folder/poster", ItemKind::Task, 1, "origin/nope").unwrap_err();
        assert_eq!(e, "fatal: invalid reference: origin/nope");
    }
}
