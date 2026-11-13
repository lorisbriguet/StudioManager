//! Merging alone: the rules that decide whether the lead may merge a small, checked change
//! itself, and the one `gh pr merge` that does it. `may_merge` is a pure function of facts the
//! caller already holds; `pr_facts` and `merge` talk to `gh` through the same `Git` trait as every
//! other call here (argv, never a shell). Nothing here deletes a branch, a worktree or a file,
//! and nothing runs `git push`, `git checkout`, `git reset` or any command that changes the
//! repository other than the single `gh pr merge`. `lead::accept` wires it to the lead's "accept".
//! Plan: docs/superpowers/plans/2026-11-13-agent-orchestrator-3-watcher-lead.md (Task 13).
//!
//! The pull request url comes from a worker, so it is checked before any `gh` call: only
//! `https://github.com/<owner>/<repo>/pull/<n>`, and only for the repository the project folder's
//! and the worktree's `origin` both name. Both read the same git config (a worktree shares it
//! with its repository, and a worker can write it), so this guards against mistakes, not against
//! a hostile worker, who has `gh` and a shell anyway. What GitHub merges is its own diff: the
//! line count, the file count and the paths GitHub reports must equal what was measured locally.

use super::check::{is_dependency_file, DiffFacts, DEPENDENCY_FILES};
use super::git::{first_line, git, succeeded, Git};
use crate::agents::routines::run::CommandOutcome;
use std::collections::BTreeSet;

/// A change of this many added plus removed lines, or more, is left to the owner.
pub const MERGE_LINES: i64 = 100;

/// Rules that always send a change to the owner: the rule name and its path patterns.
/// `dependencies` is also matched by `check::DEPENDENCY_FILES`. The others are in `touches`:
/// `money` is matched by words (`MONEY_WORDS`), `unusual path` by a path git prints quoted or with
/// control characters, `deleting` by the deleted paths. `unusual file` (a symlink, a submodule or
/// a mode change in the raw diff) is added by `may_merge`.
pub const ALWAYS_ASKS: &[(&str, &[&str])] = &[
    ("migrations", &["**/migrations/**", "*.sql"]),
    (
        "dependencies",
        &[
            "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "Cargo.toml", "Cargo.lock", "pyproject.toml",
            "requirements*.txt", "Gemfile", "Gemfile.lock", "go.mod", "go.sum", "Podfile", "Podfile.lock",
        ],
    ),
    ("version", &["tauri.conf.json", "CHANGELOG.md", "VERSION", "latest.json", "RELEASING.md"]),
    ("release", &[".github/**", "scripts/release*"]),
    (
        "security",
        &[
            ".claude/**", "**/capabilities/**", "**/permissions/**", "*.entitlements", "Info.plist", ".env*", ".gitmodules",
            ".gitattributes", ".cargo/**", ".npmrc", "rust-toolchain", "rust-toolchain.toml", ".husky/**", ".pre-commit-config.yaml",
            "CLAUDE.md", "AGENTS.md", ".mcp.json",
        ],
    ),
];

/// A path containing one of these (any case, anywhere) is the rule `money`. It over-matches on
/// purpose: a false match only sends the change to the owner.
const MONEY_WORDS: &[&str] = &[
    "invoice", "quote", "expense", "payment", "billing", "money", "price", "pricing", "vat", "qr-bill", "qrbill", "tax", "salary",
    "bank", "iban", "currency", "chf", "receipt", "ledger", "pnl", "accounting", "bill",
];

/// A `*` in the pattern stands for any run of characters (at most one `*`).
fn glob_one(pattern: &str, text: &str) -> bool {
    match pattern.split_once('*') {
        None => pattern == text,
        Some((pre, post)) => text.len() >= pre.len() + post.len() && text.starts_with(pre) && text.ends_with(post),
    }
}

/// `pattern` (one trailing `*` at most) matches the start of `text`.
fn glob_prefix(pattern: &str, text: &str) -> bool {
    match pattern.strip_suffix('*') {
        Some(pre) => text.starts_with(pre),
        None => text == pattern,
    }
}

/// Whether `path` matches one pattern of `ALWAYS_ASKS` (case-insensitive).
fn matches(pattern: &str, path: &str) -> bool {
    let pattern = pattern.to_lowercase();
    let path = path.trim_start_matches("./").to_lowercase();
    let segs: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    let Some(last) = segs.last() else { return false };
    // `**/x/**` and `x/**`: a folder `x` anywhere in the path, or a file of that name (a file named
    // like a protected folder is refused too).
    if let Some(folder) = pattern.strip_suffix("/**") {
        let folder = folder.strip_prefix("**/").unwrap_or(folder);
        return segs.contains(&folder);
    }
    // `scripts/release*`: the path, from any folder on, starts with it.
    if pattern.contains('/') {
        return (0..segs.len()).any(|i| glob_prefix(&pattern, &segs[i..].join("/")));
    }
    // A bare name, `*.ext`, `requirements*.txt`, `.env*`: the last segment, at any depth.
    glob_one(&pattern, last)
}

/// The last segment of the path names a package or lock file (in any case): the one list of
/// `check::DEPENDENCY_FILES`.
fn is_dependency_path(path: &str) -> bool {
    let last = path.trim_start_matches("./").rsplit('/').next().unwrap_or("");
    is_dependency_file(last) || DEPENDENCY_FILES.iter().any(|f| f.eq_ignore_ascii_case(last)) || is_dependency_file(&last.to_lowercase())
}

/// The rules the change touches, each once: those of `ALWAYS_ASKS` in order, then `money`, then
/// `unusual path`, then `deleting` (any deleted path). Deleted paths count as paths too.
pub fn touches(paths: &[String], deleted: &[String]) -> Vec<&'static str> {
    let all = || paths.iter().chain(deleted.iter());
    let mut out: Vec<&'static str> = ALWAYS_ASKS
        .iter()
        .filter(|(name, pats)| {
            (*name == "dependencies" && all().any(|p| is_dependency_path(p))) || all().any(|p| pats.iter().any(|pat| matches(pat, p)))
        })
        .map(|(name, _)| *name)
        .collect();
    if all().any(|p| {
        let l = p.to_lowercase();
        MONEY_WORDS.iter().any(|w| l.contains(w))
    }) {
        out.push("money");
    }
    // `git diff --name-status` writes a path with non-ASCII characters, quotes, backslashes or
    // control characters C-quoted (`"migrations/\\303\\251.sql"`): no pattern can read it, so it is
    // refused rather than unquoted.
    if all().any(|p| p.starts_with('"') || p.chars().any(|c| c == '\\' || c.is_control())) {
        out.push("unusual path");
    }
    if !deleted.is_empty() {
        out.push("deleting");
    }
    out
}

#[derive(Clone, Debug, PartialEq)]
pub struct PrFacts {
    /// `OPEN`, `MERGED` or `CLOSED`.
    pub state: String,
    pub draft: bool,
    /// The full sha of the pull request's head.
    pub head: String,
    /// The branch it targets.
    pub base: String,
    /// `MERGEABLE`, `CONFLICTING` or `UNKNOWN` (GitHub has not worked it out yet).
    pub mergeable: String,
    /// What GitHub counts for the whole pull request.
    pub additions: i64,
    pub deletions: i64,
    pub changed_files: i64,
    /// The paths GitHub lists (it cuts a long list: compare with `changed_files`).
    pub paths: Vec<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct MergeRules {
    pub merge_alone: bool,
    pub hub_project: bool,
    /// None: no check command, or it did not run; Some(false): it failed.
    pub check_passed: Option<bool>,
    pub lead_accepts: bool,
}

/// Why a change is not merged alone. `text` is what the owner reads after "not merged: ".
#[derive(Clone, Debug, PartialEq)]
pub enum Refusal {
    HubProject,
    MergeAloneOff,
    CheckNotPassed,
    LeadDoesNotAccept,
    SizeUnknown,
    TooBig(i64),
    Touches(Vec<&'static str>),
    Dirty,
    PrState(String),
    PrDraft,
    PrOtherBase,
    PrOtherHead,
    PrNotMergeable,
    /// GitHub's line count, file count or paths differ from the local measure.
    PrNotMeasured,
}

impl Refusal {
    pub fn text(&self) -> String {
        match self {
            Refusal::HubProject => "the project belongs to a hub".to_string(),
            Refusal::MergeAloneOff => "merging alone is off for this project".to_string(),
            Refusal::CheckNotPassed => "the check did not pass".to_string(),
            Refusal::LeadDoesNotAccept => "the lead does not accept the change".to_string(),
            Refusal::SizeUnknown => "the size of the change is not known".to_string(),
            Refusal::TooBig(n) => format!("the change is {n} lines (the limit is under {MERGE_LINES})"),
            Refusal::Touches(rules) => format!("it touches: {}", rules.join(", ")),
            Refusal::Dirty => "the worktree has uncommitted changes".to_string(),
            Refusal::PrState(s) => format!("the pull request is {}", s.to_lowercase()),
            Refusal::PrDraft => "the pull request is a draft".to_string(),
            Refusal::PrOtherBase => "the pull request targets another branch".to_string(),
            Refusal::PrOtherHead => "the pull request has other commits than the ones checked".to_string(),
            Refusal::PrNotMergeable => {
                "the pull request cannot be merged cleanly or GitHub has not worked it out yet".to_string()
            }
            Refusal::PrNotMeasured => "the pull request on GitHub is not the change that was measured".to_string(),
        }
    }
}

/// Whether the lead may merge alone. The first reason that applies is returned. `head` is the
/// worktree's HEAD (see `head_of`); the pull request must be at exactly that commit.
pub fn may_merge(r: &MergeRules, d: &DiffFacts, pr: &PrFacts, base_branch: &str, head: &str) -> Result<(), Refusal> {
    if r.hub_project {
        return Err(Refusal::HubProject);
    }
    if !r.merge_alone {
        return Err(Refusal::MergeAloneOff);
    }
    if r.check_passed != Some(true) {
        return Err(Refusal::CheckNotPassed);
    }
    if !r.lead_accepts {
        return Err(Refusal::LeadDoesNotAccept);
    }
    match d.lines {
        // An empty change, or a size with no path to go with it, is never merged alone.
        Some(n) if d.complete && n >= 1 && !d.paths.is_empty() => {
            if n >= MERGE_LINES {
                return Err(Refusal::TooBig(n));
            }
        }
        _ => return Err(Refusal::SizeUnknown),
    }
    let mut rules = touches(&d.paths, &d.deleted);
    // GitHub merges its own diff: what it lists is asked the same rules.
    for r in touches(&pr.paths, &[]) {
        if !rules.contains(&r) {
            rules.push(r);
        }
    }
    if !d.unusual.is_empty() {
        rules.push("unusual file");
    }
    if !rules.is_empty() {
        return Err(Refusal::Touches(rules));
    }
    if !d.clean {
        return Err(Refusal::Dirty);
    }
    if pr.state != "OPEN" {
        return Err(Refusal::PrState(pr.state.clone()));
    }
    if pr.draft {
        return Err(Refusal::PrDraft);
    }
    if base_branch.is_empty() || pr.base.is_empty() || pr.base != base_branch {
        return Err(Refusal::PrOtherBase);
    }
    if head.is_empty() || !pr.head.eq_ignore_ascii_case(head) {
        return Err(Refusal::PrOtherHead);
    }
    if pr.mergeable != "MERGEABLE" {
        return Err(Refusal::PrNotMergeable);
    }
    // The paths measured locally (a deleted path is a path too), against what GitHub lists.
    let local: BTreeSet<&str> = d.paths.iter().chain(d.deleted.iter()).map(String::as_str).collect();
    let theirs: BTreeSet<&str> = pr.paths.iter().map(String::as_str).collect();
    let lines = d.lines.unwrap_or(-1);
    if pr.additions.checked_add(pr.deletions) != Some(lines)
        || pr.changed_files != local.len() as i64
        || pr.paths.len() as i64 != pr.changed_files
        || theirs != local
    {
        return Err(Refusal::PrNotMeasured);
    }
    Ok(())
}

fn name_ok(s: &str) -> bool {
    !s.is_empty() && s != "." && s != ".." && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// `https://github.com/<owner>/<repo>/pull/<n>` and nothing else: the owner, the repo and the
/// number. A url from a worker is never passed on as it came.
pub fn pr_url_ok(url: &str) -> Option<(String, String, u64)> {
    let rest = url.strip_prefix("https://github.com/")?;
    let parts: Vec<&str> = rest.split('/').collect();
    if parts.len() != 4 || parts[2] != "pull" || !name_ok(parts[0]) || !name_ok(parts[1]) {
        return None;
    }
    if parts[3].is_empty() || !parts[3].bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some((parts[0].to_string(), parts[1].to_string(), parts[3].parse().ok()?))
}

/// Owner and repo of `https://github.com/o/r(.git)`, `git@github.com:o/r(.git)` or
/// `ssh://git@github.com/o/r(.git)`.
fn parse_remote(url: &str) -> Option<(String, String)> {
    let url = url.trim();
    let rest = ["https://github.com/", "git@github.com:", "ssh://git@github.com/"].iter().find_map(|p| url.strip_prefix(p))?;
    let rest = rest.trim_end_matches('/');
    let rest = rest.strip_suffix(".git").unwrap_or(rest);
    let (owner, repo) = rest.split_once('/')?;
    (name_ok(owner) && name_ok(repo)).then(|| (owner.to_string(), repo.to_string()))
}

/// The repository the worktree's `origin` points at.
pub fn origin_repo(g: &dyn Git, worktree: &str) -> Result<(String, String), String> {
    let o = git(g, worktree, &["remote", "get-url", "origin"]);
    if !succeeded(&o) {
        return Err(first_line(&o, "git remote get-url failed"));
    }
    let line = o.tail.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
    parse_remote(line).ok_or_else(|| "The origin is not a GitHub repository".to_string())
}

fn sha_ok(s: &str) -> bool {
    s.len() == 40 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// The worktree's HEAD: a full 40-character sha.
pub fn head_of(g: &dyn Git, worktree: &str) -> Result<String, String> {
    let o = git(g, worktree, &["rev-parse", "HEAD"]);
    if !succeeded(&o) {
        return Err(first_line(&o, "git rev-parse failed"));
    }
    let sha = o.tail.trim();
    if sha_ok(sha) {
        Ok(sha.to_string())
    } else {
        Err("HEAD is not a commit sha".to_string())
    }
}

fn gh(g: &dyn Git, folder: &str, a: &[&str]) -> CommandOutcome {
    let args: Vec<String> = a.iter().map(|s| s.to_string()).collect();
    g.run("gh", &args, folder)
}

/// Why a `gh` call failed, from its first line.
fn gh_failure(o: &CommandOutcome, fallback: &str) -> String {
    if o.timed_out {
        return "gh took too long".to_string();
    }
    first_line(o, fallback)
}

/// The url must be a pull request of the repository `origin` points at, read in `folder` (the
/// project folder or the worktree: the same config, see the module doc).
pub fn check_url(g: &dyn Git, worktree: &str, url: &str) -> Result<(), String> {
    let (owner, repo, _) = pr_url_ok(url).ok_or_else(|| "Not a GitHub pull request url".to_string())?;
    let (o, r) = origin_repo(g, worktree)?;
    if o.eq_ignore_ascii_case(&owner) && r.eq_ignore_ascii_case(&repo) {
        Ok(())
    } else {
        Err("The pull request is not in this project's repository".to_string())
    }
}

/// The fields `gh pr view` is asked for.
const VIEW_FIELDS: &str = "state,isDraft,headRefOid,baseRefName,mergeable,additions,deletions,changedFiles,files";

/// `gh pr view <url> --json <VIEW_FIELDS>`, after the url checks. The output interleaves stdout and
/// stderr, so the JSON is the last line that is an object holding `state` and `headRefOid`.
pub fn pr_facts(g: &dyn Git, worktree: &str, url: &str) -> Result<PrFacts, String> {
    check_url(g, worktree, url)?;
    let o = gh(g, worktree, &["pr", "view", url, "--json", VIEW_FIELDS]);
    if !succeeded(&o) {
        return Err(gh_failure(&o, "gh pr view failed"));
    }
    let v = o
        .tail
        .lines()
        .rev()
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l.trim()).ok())
        .find(|v| v.get("state").is_some() && v.get("headRefOid").is_some())
        .ok_or_else(|| "gh pr view gave no JSON".to_string())?;
    let text = |k: &str| v.get(k).and_then(|x| x.as_str()).map(str::to_string).ok_or_else(|| format!("gh pr view gave no {k}"));
    let number = |k: &str| v.get(k).and_then(|x| x.as_i64()).ok_or_else(|| format!("gh pr view gave no {k}"));
    let draft = v.get("isDraft").and_then(|x| x.as_bool()).ok_or_else(|| "gh pr view gave no isDraft".to_string())?;
    let paths = v
        .get("files")
        .and_then(|x| x.as_array())
        .and_then(|a| a.iter().map(|f| f.get("path").and_then(|p| p.as_str()).map(str::to_string)).collect::<Option<Vec<String>>>())
        .ok_or_else(|| "gh pr view gave no files".to_string())?;
    Ok(PrFacts {
        state: text("state")?,
        draft,
        head: text("headRefOid")?,
        base: text("baseRefName")?,
        mergeable: text("mergeable")?,
        additions: number("additions")?,
        deletions: number("deletions")?,
        changed_files: number("changedFiles")?,
        paths,
    })
}

/// `gh pr merge <url> --squash --match-head-commit <head>`: GitHub refuses it when the head moved.
/// Nothing else is passed (no branch deletion, no admin, no auto).
pub fn merge(g: &dyn Git, worktree: &str, url: &str, head: &str) -> Result<(), String> {
    if !sha_ok(head) {
        return Err("The head is not a commit sha".to_string());
    }
    check_url(g, worktree, url)?;
    let o = gh(g, worktree, &["pr", "merge", url, "--squash", "--match-head-commit", head]);
    if succeeded(&o) {
        Ok(())
    } else {
        Err(gh_failure(&o, "gh pr merge failed"))
    }
}

#[cfg(test)]
mod tests {
    use super::super::git::fake::out;
    use super::*;
    use std::sync::Mutex;

    const SHA: &str = "0123456789abcdef0123456789abcdef01234567";
    const URL: &str = "https://github.com/studio-a/poster-tool/pull/12";
    const ORIGIN: &str = "https://github.com/studio-a/poster-tool.git\n";
    const VIEW: &str = "{\"state\":\"OPEN\",\"isDraft\":false,\"headRefOid\":\"0123456789abcdef0123456789abcdef01234567\",\"baseRefName\":\"main\",\"mergeable\":\"MERGEABLE\",\"additions\":10,\"deletions\":2,\"changedFiles\":1,\"files\":[{\"path\":\"src/poster.ts\",\"additions\":10,\"deletions\":2}]}\n";

    type Script = Box<dyn Fn(&str, &str) -> CommandOutcome + Send + Sync>;

    /// A scripted `git` and `gh`: the call is matched by program and joined argv.
    struct Fake {
        calls: Mutex<Vec<(String, String)>>,
        script: Script,
    }
    impl Fake {
        fn new(f: impl Fn(&str, &str) -> CommandOutcome + Send + Sync + 'static) -> Self {
            Self { calls: Mutex::new(vec![]), script: Box::new(f) }
        }
        fn calls(&self) -> Vec<(String, String)> {
            self.calls.lock().unwrap().clone()
        }
        fn gh_calls(&self) -> Vec<String> {
            self.calls().into_iter().filter(|(p, _)| p == "gh").map(|(_, a)| a).collect()
        }
    }
    impl Git for Fake {
        fn run(&self, program: &str, args: &[String], _cwd: &str) -> CommandOutcome {
            let j = args.join(" ");
            self.calls.lock().unwrap().push((program.to_string(), j.clone()));
            (self.script)(program, &j)
        }
    }
    /// `git` says the origin is `origin`; `gh` says `gh_says`.
    fn fake(origin: &'static str, gh_says: CommandOutcome) -> Fake {
        Fake::new(move |p, a| match (p, a) {
            ("git", "remote get-url origin") => out(0, origin),
            ("gh", _) => gh_says.clone(),
            _ => out(1, "unexpected"),
        })
    }

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }
    fn rules() -> MergeRules {
        MergeRules { merge_alone: true, hub_project: false, check_passed: Some(true), lead_accepts: true }
    }
    fn facts() -> DiffFacts {
        DiffFacts {
            lines: Some(12),
            complete: true,
            paths: s(&["src/poster.ts"]),
            deleted: vec![],
            head: String::new(),
            clean: true,
            unusual: vec![],
        }
    }
    fn pr() -> PrFacts {
        PrFacts {
            state: "OPEN".into(),
            draft: false,
            head: SHA.into(),
            base: "main".into(),
            mergeable: "MERGEABLE".into(),
            additions: 10,
            deletions: 2,
            changed_files: 1,
            paths: s(&["src/poster.ts"]),
        }
    }
    fn ask(r: &MergeRules, d: &DiffFacts, p: &PrFacts) -> Result<(), Refusal> {
        may_merge(r, d, p, "main", SHA)
    }
    fn with_paths(paths: &[&str]) -> DiffFacts {
        DiffFacts { paths: s(paths), ..facts() }
    }

    #[test]
    fn merge_rule_everything_fine_is_ok() {
        assert_eq!(ask(&rules(), &facts(), &pr()), Ok(()));
    }

    #[test]
    fn merge_rule_hub_project() {
        let r = MergeRules { hub_project: true, ..rules() };
        assert_eq!(ask(&r, &facts(), &pr()), Err(Refusal::HubProject));
    }

    #[test]
    fn merge_rule_merge_alone_off() {
        let r = MergeRules { merge_alone: false, ..rules() };
        assert_eq!(ask(&r, &facts(), &pr()), Err(Refusal::MergeAloneOff));
    }

    #[test]
    fn merge_rule_check_not_passed() {
        for c in [None, Some(false)] {
            let r = MergeRules { check_passed: c, ..rules() };
            assert_eq!(ask(&r, &facts(), &pr()), Err(Refusal::CheckNotPassed));
        }
    }

    #[test]
    fn merge_rule_lead_does_not_accept() {
        let r = MergeRules { lead_accepts: false, ..rules() };
        assert_eq!(ask(&r, &facts(), &pr()), Err(Refusal::LeadDoesNotAccept));
    }

    #[test]
    fn merge_rule_size_limit() {
        let at = |n| DiffFacts { lines: Some(n), ..facts() };
        assert_eq!(ask(&rules(), &at(99), &PrFacts { additions: 99, deletions: 0, ..pr() }), Ok(()));
        assert_eq!(ask(&rules(), &at(100), &pr()), Err(Refusal::TooBig(100)));
        assert_eq!(ask(&rules(), &at(140), &pr()).unwrap_err().text(), "the change is 140 lines (the limit is under 100)");
    }

    #[test]
    fn merge_rule_unknown_size() {
        let binary = DiffFacts { lines: None, ..facts() };
        assert_eq!(ask(&rules(), &binary, &pr()), Err(Refusal::SizeUnknown));
        let cut = DiffFacts { complete: false, ..facts() };
        assert_eq!(ask(&rules(), &cut, &pr()), Err(Refusal::SizeUnknown));
    }

    #[test]
    fn merge_rule_each_always_asks_rule_by_a_path_at_depth_too() {
        let cases: &[(&str, &str)] = &[
            ("migrations", "src-tauri/migrations/0042_posters.rs"),
            ("migrations", "migrations/0042.txt"),
            ("migrations", "db/schema.sql"),
            ("dependencies", "package.json"),
            ("dependencies", "apps/poster/package-lock.json"),
            ("dependencies", "pnpm-lock.yaml"),
            ("dependencies", "yarn.lock"),
            ("dependencies", "src-tauri/Cargo.toml"),
            ("dependencies", "src-tauri/mcp/Cargo.lock"),
            ("dependencies", "pyproject.toml"),
            ("dependencies", "tools/requirements-dev.txt"),
            ("dependencies", "requirements.txt"),
            ("dependencies", "Gemfile.lock"),
            ("dependencies", "cmd/go.sum"),
            ("dependencies", "ios/Podfile"),
            ("version", "src-tauri/tauri.conf.json"),
            ("version", "CHANGELOG.md"),
            ("version", "docs/VERSION"),
            ("version", "latest.json"),
            ("version", "RELEASING.md"),
            ("release", ".github/workflows/build.yml"),
            ("release", "scripts/release-notes.sh"),
            ("security", ".claude/settings.json"),
            ("security", "src-tauri/capabilities/default.json"),
            ("security", "src-tauri/permissions/x.toml"),
            ("security", "app/Poster.entitlements"),
            ("security", "ios/Info.plist"),
            ("security", ".env.local"),
            ("security", "apps/poster/.env"),
        ];
        for (rule, path) in cases {
            let t = touches(&s(&[path]), &[]);
            assert!(t.contains(rule), "{path} should touch {rule}, got {t:?}");
        }
    }

    #[test]
    fn merge_rule_touches_blocks_a_merge_and_names_the_rules() {
        let d = with_paths(&["src/poster.ts", "package.json", "src-tauri/Cargo.lock"]);
        let e = ask(&rules(), &d, &pr()).unwrap_err();
        assert_eq!(e, Refusal::Touches(vec!["dependencies"]));
        assert_eq!(e.text(), "it touches: dependencies");
    }

    #[test]
    fn merge_rule_money_words_in_any_case_anywhere() {
        for p in ["src/Invoice.tsx", "src/db/queries/quotes.ts", "lib/QR-Bill.rs", "src/payment_form.ts", "src/vat.ts", "src/iban.ts"] {
            assert_eq!(touches(&s(&[p]), &[]), vec!["money"], "{p}");
        }
        assert_eq!(ask(&rules(), &with_paths(&["src/pricing.ts"]), &pr()).unwrap_err().text(), "it touches: money");
    }

    #[test]
    fn merge_rule_a_deleted_file() {
        let d = DiffFacts { deleted: s(&["src/old.ts"]), ..facts() };
        assert_eq!(ask(&rules(), &d, &pr()).unwrap_err().text(), "it touches: deleting");
        // A deleted migration is both, in the documented order.
        let t = touches(&[], &s(&["src-tauri/migrations/0001.sql"]));
        assert_eq!(t, vec!["migrations", "deleting"]);
    }

    #[test]
    fn merge_rule_touches_is_empty_on_clean_paths() {
        let t = touches(&s(&["src/poster.ts", "src/components/Button.tsx", "docs/usage.md", "scripts/build.sh", "src/githubby/x.ts"]), &[]);
        assert!(t.is_empty(), "{t:?}");
        assert!(touches(&[], &[]).is_empty());
    }

    #[test]
    fn merge_rule_touches_lists_each_rule_once_in_order() {
        let t = touches(&s(&["a.sql", "b/migrations/x", "package.json", "src/invoice.ts", ".github/x.yml", "CHANGELOG.md"]), &s(&["gone.ts"]));
        assert_eq!(t, vec!["migrations", "dependencies", "version", "release", "money", "deleting"]);
    }

    #[test]
    fn merge_rule_dirty_worktree() {
        let d = DiffFacts { clean: false, ..facts() };
        assert_eq!(ask(&rules(), &d, &pr()), Err(Refusal::Dirty));
    }

    #[test]
    fn merge_rule_pull_request_state_draft_base_and_head() {
        for st in ["MERGED", "CLOSED"] {
            let p = PrFacts { state: st.into(), ..pr() };
            assert_eq!(ask(&rules(), &facts(), &p), Err(Refusal::PrState(st.into())));
        }
        assert_eq!(ask(&rules(), &facts(), &PrFacts { state: "MERGED".into(), ..pr() }).unwrap_err().text(), "the pull request is merged");
        assert_eq!(ask(&rules(), &facts(), &PrFacts { draft: true, ..pr() }), Err(Refusal::PrDraft));
        assert_eq!(ask(&rules(), &facts(), &PrFacts { base: "develop".into(), ..pr() }), Err(Refusal::PrOtherBase));
        let moved = PrFacts { head: "f".repeat(40), ..pr() };
        assert_eq!(ask(&rules(), &facts(), &moved), Err(Refusal::PrOtherHead));
        assert_eq!(may_merge(&rules(), &facts(), &pr(), "main", ""), Err(Refusal::PrOtherHead));
        // The sha is compared without regard to case.
        let upper = PrFacts { head: SHA.to_uppercase(), ..pr() };
        assert_eq!(ask(&rules(), &facts(), &upper), Ok(()));
    }

    #[test]
    fn merge_rule_order_hub_wins_when_several_apply() {
        let r = MergeRules { hub_project: true, merge_alone: false, check_passed: None, lead_accepts: false };
        let d = DiffFacts {
            lines: None,
            complete: false,
            paths: s(&["package.json"]),
            deleted: s(&["x"]),
            head: String::new(),
            clean: false,
            unusual: vec![],
        };
        let p = PrFacts { state: "CLOSED".into(), draft: true, head: "x".into(), base: "y".into(), ..pr() };
        assert_eq!(ask(&r, &d, &p), Err(Refusal::HubProject));
        let r = MergeRules { hub_project: false, ..r };
        assert_eq!(ask(&r, &d, &p), Err(Refusal::MergeAloneOff));
        let r = MergeRules { merge_alone: true, ..r };
        assert_eq!(ask(&r, &d, &p), Err(Refusal::CheckNotPassed));
        let r = MergeRules { check_passed: Some(true), ..r };
        assert_eq!(ask(&r, &d, &p), Err(Refusal::LeadDoesNotAccept));
        let r = MergeRules { lead_accepts: true, ..r };
        assert_eq!(ask(&r, &d, &p), Err(Refusal::SizeUnknown));
        let d = DiffFacts { lines: Some(5), complete: true, ..d };
        assert!(matches!(ask(&r, &d, &p), Err(Refusal::Touches(_))));
        let d = DiffFacts { paths: s(&["src/a.ts"]), deleted: vec![], ..d };
        assert_eq!(ask(&r, &d, &p), Err(Refusal::Dirty));
        let d = DiffFacts { clean: true, ..d };
        assert_eq!(ask(&r, &d, &p), Err(Refusal::PrState("CLOSED".into())));
    }

    #[test]
    fn every_refusal_has_a_text() {
        let all = [
            Refusal::HubProject,
            Refusal::MergeAloneOff,
            Refusal::CheckNotPassed,
            Refusal::LeadDoesNotAccept,
            Refusal::SizeUnknown,
            Refusal::TooBig(140),
            Refusal::Touches(vec!["dependencies", "deleting"]),
            Refusal::Dirty,
            Refusal::PrState("MERGED".into()),
            Refusal::PrDraft,
            Refusal::PrOtherBase,
            Refusal::PrOtherHead,
        ];
        for r in all {
            assert!(!r.text().is_empty(), "{r:?}");
        }
        assert_eq!(Refusal::Touches(vec!["dependencies", "deleting"]).text(), "it touches: dependencies, deleting");
    }

    #[test]
    fn url_validation() {
        assert_eq!(pr_url_ok(URL), Some(("studio-a".into(), "poster-tool".into(), 12)));
        assert_eq!(pr_url_ok("https://github.com/Studio_A/poster.tool/pull/1"), Some(("Studio_A".into(), "poster.tool".into(), 1)));
        for bad in [
            "https://gitlab.com/studio-a/poster-tool/pull/12",
            "https://github.com.evil.example/studio-a/poster-tool/pull/12",
            "http://github.com/studio-a/poster-tool/pull/12",
            "https://github.com/studio-a/poster-tool/pull/12/files",
            "https://github.com/studio-a/poster-tool/issues/12",
            "-https://github.com/studio-a/poster-tool/pull/12",
            "--web",
            "https://github.com/studio-a/poster-tool/pull/12?x=1",
            "https://github.com/studio-a/poster-tool/pull/12#a",
            "https://github.com/studio-a/poster-tool/pull/12 ",
            "https://github.com/studio a/poster-tool/pull/12",
            "https://github.com/studio-a/poster-tool/pull/",
            "https://github.com/studio-a/poster-tool/pull/x1",
            "https://github.com/../poster-tool/pull/1",
            "https://github.com/studio-a/poster-tool/pull/1\n",
            "https://github.com/studio-a//pull/1",
            "",
        ] {
            assert_eq!(pr_url_ok(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn origin_forms() {
        for u in [
            "https://github.com/studio-a/poster-tool.git\n",
            "https://github.com/studio-a/poster-tool\n",
            "git@github.com:studio-a/poster-tool.git\n",
            "git@github.com:studio-a/poster-tool\n",
            "ssh://git@github.com/studio-a/poster-tool.git\n",
        ] {
            let g = fake(u, out(0, ""));
            assert_eq!(origin_repo(&g, "/w").unwrap(), ("studio-a".to_string(), "poster-tool".to_string()), "{u}");
        }
        assert!(origin_repo(&fake("https://gitlab.com/a/b.git\n", out(0, "")), "/w").is_err());
        assert!(origin_repo(&Fake::new(|_, _| out(2, "error: No such remote 'origin'")), "/w").is_err());
    }

    #[test]
    fn head_of_needs_a_full_sha() {
        assert_eq!(head_of(&Fake::new(|_, _| out(0, &format!("{SHA}\n"))), "/w").unwrap(), SHA);
        assert!(head_of(&Fake::new(|_, _| out(0, "HEAD\n")), "/w").is_err());
        assert!(head_of(&Fake::new(|_, _| out(0, "0123abc\n")), "/w").is_err());
        assert!(head_of(&Fake::new(|_, _| out(128, "fatal: not a git repository")), "/w").is_err());
    }

    #[test]
    fn pr_facts_parses_the_json() {
        // The origin may be written another way and in another case than the url.
        let g = fake("git@github.com:Studio-A/Poster-Tool.git\n", out(0, VIEW));
        assert_eq!(pr_facts(&g, "/w", URL).unwrap(), pr());
        assert_eq!(
            g.gh_calls(),
            vec![format!(
                "pr view {URL} --json state,isDraft,headRefOid,baseRefName,mergeable,additions,deletions,changedFiles,files"
            )]
        );
    }

    #[test]
    fn pr_facts_takes_the_object_that_has_the_fields_not_a_later_json_warning() {
        let tail = format!("{VIEW}{{\"warning\":\"a new release of gh is available\"}}\n[1,2]\n");
        assert_eq!(pr_facts(&fake(ORIGIN, out(0, &tail)), "/w", URL).unwrap(), pr());
    }

    #[test]
    fn pr_facts_needs_every_field_it_is_asked_for() {
        let g = fake(ORIGIN, out(0, VIEW));
        let f = pr_facts(&g, "/w", URL).unwrap();
        assert_eq!((f.mergeable.as_str(), f.additions, f.deletions, f.changed_files, f.paths.clone()), ("MERGEABLE", 10, 2, 1, s(&["src/poster.ts"])));
        for (cut, why) in [
            ("\"mergeable\":\"MERGEABLE\",", "mergeable"),
            ("\"additions\":10,", "additions"),
            ("\"deletions\":2,", "deletions"),
            ("\"changedFiles\":1,", "changedFiles"),
        ] {
            let e = pr_facts(&fake(ORIGIN, out(0, &VIEW.replace(cut, ""))), "/w", URL).unwrap_err();
            assert_eq!(e, format!("gh pr view gave no {why}"));
        }
        let no_files = VIEW.replace(",\"files\":[{\"path\":\"src/poster.ts\",\"additions\":10,\"deletions\":2}]", "");
        assert_eq!(pr_facts(&fake(ORIGIN, out(0, &no_files)), "/w", URL).unwrap_err(), "gh pr view gave no files");
        let odd = VIEW.replace("\"path\":\"src/poster.ts\",", "");
        assert_eq!(pr_facts(&fake(ORIGIN, out(0, &odd)), "/w", URL).unwrap_err(), "gh pr view gave no files");
    }

    #[test]
    fn merge_rule_an_unusual_path_is_never_merged_alone() {
        // `git diff --name-status` writes such a path C-quoted, so no pattern can read it: it is refused.
        for p in ["\"migrations/\\303\\251.sql\"", "src/a\\b.ts", "src/a\tb.ts", "\"x\""] {
            let t = touches(&s(&[p]), &[]);
            assert!(t.contains(&"unusual path"), "{p}: {t:?}");
            assert!(touches(&[], &s(&[p])).contains(&"unusual path"), "{p} deleted");
        }
        let d = with_paths(&["\"migrations/\\303\\251.sql\""]);
        assert_eq!(ask(&rules(), &d, &pr()).unwrap_err().text(), "it touches: unusual path");
        // After `money`, before `deleting`.
        assert_eq!(touches(&s(&["\"invoice\\303\\251\""]), &s(&["x"])), vec!["money", "unusual path", "deleting"]);
        assert!(touches(&s(&["src/poster.ts"]), &[]).is_empty());
    }

    #[test]
    fn merge_rule_an_empty_base_or_an_empty_pull_request_field_refuses() {
        assert_eq!(may_merge(&rules(), &facts(), &pr(), "", SHA), Err(Refusal::PrOtherBase));
        let no_base = PrFacts { base: String::new(), ..pr() };
        assert_eq!(may_merge(&rules(), &facts(), &no_base, "", SHA), Err(Refusal::PrOtherBase));
        assert_eq!(may_merge(&rules(), &facts(), &no_base, "main", SHA), Err(Refusal::PrOtherBase));
        assert_eq!(ask(&rules(), &facts(), &PrFacts { state: String::new(), ..pr() }), Err(Refusal::PrState(String::new())));
        assert_eq!(ask(&rules(), &facts(), &PrFacts { head: String::new(), ..pr() }), Err(Refusal::PrOtherHead));
    }

    #[test]
    fn merge_rule_an_empty_change_is_never_merged_alone() {
        let zero = DiffFacts { lines: Some(0), ..facts() };
        assert_eq!(ask(&rules(), &zero, &pr()), Err(Refusal::SizeUnknown));
        let no_paths = DiffFacts { lines: Some(5), paths: vec![], ..facts() };
        assert_eq!(ask(&rules(), &no_paths, &pr()), Err(Refusal::SizeUnknown));
        assert_eq!(ask(&rules(), &DiffFacts { lines: Some(1), ..facts() }, &PrFacts { additions: 1, deletions: 0, ..pr() }), Ok(()));
    }

    #[test]
    fn merge_rule_more_matcher_cases() {
        let cases: &[(&str, &str)] = &[
            ("migrations", "db/schema.SQL"),
            ("money", "docs/INVOICE.md"),
            ("dependencies", "./package.json"),
            ("release", "tools/scripts/release-notes.md"),
            ("release", "sub/.github/x"),
        ];
        for (rule, path) in cases {
            let t = touches(&s(&[path]), &[]);
            assert!(t.contains(rule), "{path} should touch {rule}, got {t:?}");
        }
        // A FILE named like a folder rule is a match too (F3): a worker cannot dodge the rule by a
        // file of that name.
        for (rule, path) in [
            ("migrations", "src/migrations"),
            ("security", ".claude"),
            ("security", "docs/.claude"),
            ("release", ".github"),
            ("security", "src-tauri/capabilities"),
            ("security", "x/permissions"),
        ] {
            let t = touches(&s(&[path]), &[]);
            assert!(t.contains(&rule), "{path} should touch {rule}, got {t:?}");
        }
    }

    #[test]
    fn merge_rule_every_dependency_file_the_check_knows_is_a_merge_rule_too() {
        for name in DEPENDENCY_FILES {
            for path in [name.to_string(), format!("apps/poster/{name}"), format!("./{name}")] {
                assert!(touches(&s(&[&path]), &[]).contains(&"dependencies"), "{path}");
                assert!(touches(&[], &s(&[&path])).contains(&"dependencies"), "{path} deleted");
            }
        }
        // The ones that were merged alone before the lists were one.
        for name in ["bun.lock", "bun.lockb", "npm-shrinkwrap.json", "poetry.lock", "uv.lock", "Pipfile", "Pipfile.lock", "setup.py"]
            .into_iter()
            .chain(["composer.json", "composer.lock", "Package.swift", "Package.resolved", "pubspec.yaml", "pubspec.lock", "mix.exs"])
        {
            assert!(touches(&s(&[name]), &[]).contains(&"dependencies"), "{name}");
        }
        assert!(touches(&s(&["tools/Requirements-dev.TXT"]), &[]).contains(&"dependencies"));
        // Case does not matter, as for the rest of the rules.
        assert!(touches(&s(&["CARGO.TOML"]), &[]).contains(&"dependencies"));
        assert!(!touches(&s(&["src/package.json.ts"]), &[]).contains(&"dependencies"));
        // In its place among the rules.
        assert_eq!(touches(&s(&["mix.exs", "CHANGELOG.md"]), &[]), vec!["dependencies", "version"]);
    }

    #[test]
    fn merge_rule_more_security_paths_and_money_words() {
        for p in [
            ".gitmodules",
            "sub/.gitattributes",
            ".cargo/config.toml",
            "app/.cargo/x",
            ".npmrc",
            "rust-toolchain",
            "rust-toolchain.toml",
            ".husky/pre-commit",
            ".pre-commit-config.yaml",
            "CLAUDE.md",
            "docs/AGENTS.md",
            ".mcp.json",
        ] {
            assert!(touches(&s(&[p]), &[]).contains(&"security"), "{p}");
        }
        for p in ["src/currency.ts", "src/Chf.ts", "src/receipt.ts", "src/ledger.rs", "src/pnl.ts", "src/accounting.ts", "src/bill.ts", "src/billing.ts"] {
            assert!(touches(&s(&[p]), &[]).contains(&"money"), "{p}");
        }
        assert!(touches(&s(&["src/poster.ts", "src/githubby/x.ts"]), &[]).is_empty());
    }

    #[test]
    fn merge_rule_an_unusual_file_is_refused() {
        let d = DiffFacts { unusual: s(&["src/link"]), ..facts() };
        assert_eq!(ask(&rules(), &d, &pr()).unwrap_err().text(), "it touches: unusual file");
        assert_eq!(ask(&rules(), &facts(), &pr()), Ok(()));
    }

    #[test]
    fn merge_rule_the_pull_request_must_be_mergeable() {
        for m in ["CONFLICTING", "UNKNOWN", ""] {
            let p = PrFacts { mergeable: m.into(), ..pr() };
            assert_eq!(ask(&rules(), &facts(), &p), Err(Refusal::PrNotMergeable), "{m}");
        }
        assert_eq!(
            Refusal::PrNotMergeable.text(),
            "the pull request cannot be merged cleanly or GitHub has not worked it out yet"
        );
    }

    #[test]
    fn merge_rule_github_must_report_the_change_that_was_measured() {
        let text = "the pull request on GitHub is not the change that was measured";
        let off = |p: PrFacts| ask(&rules(), &facts(), &p);
        assert_eq!(off(PrFacts { additions: 11, ..pr() }), Err(Refusal::PrNotMeasured));
        assert_eq!(off(PrFacts { deletions: 0, ..pr() }), Err(Refusal::PrNotMeasured));
        assert_eq!(off(PrFacts { changed_files: 2, ..pr() }), Err(Refusal::PrNotMeasured));
        assert_eq!(off(PrFacts { paths: s(&["src/other.ts"]), ..pr() }), Err(Refusal::PrNotMeasured));
        // GitHub cut its list: more files changed than it names.
        let cut = DiffFacts { paths: s(&["src/a.ts", "src/b.ts"]), ..facts() };
        let p = PrFacts { changed_files: 2, paths: s(&["src/a.ts"]), ..pr() };
        assert_eq!(ask(&rules(), &cut, &p), Err(Refusal::PrNotMeasured));
        assert_eq!(Refusal::PrNotMeasured.text(), text);
        // The same files in another order, a deleted path counted once.
        let two = DiffFacts { paths: s(&["src/b.ts", "src/gone.ts"]), deleted: vec![], ..facts() };
        let p = PrFacts { changed_files: 2, paths: s(&["src/gone.ts", "src/b.ts"]), ..pr() };
        assert_eq!(ask(&rules(), &two, &p), Ok(()));
        // The rules are asked of GitHub's paths too.
        let p = PrFacts { paths: s(&["package.json"]), ..pr() };
        assert_eq!(ask(&rules(), &facts(), &p).unwrap_err().text(), "it touches: dependencies");
    }

    #[test]
    fn pr_facts_survives_a_warning_line_and_fails_without_json() {
        let warned = format!("warning: a new release of gh is available\n{}", VIEW.replace("OPEN", "MERGED").replace("false", "true"));
        let f = pr_facts(&fake(ORIGIN, out(0, &warned)), "/w", URL).unwrap();
        assert_eq!((f.state.as_str(), f.draft), ("MERGED", true));
        assert!(pr_facts(&fake(ORIGIN, out(0, "warning: no json here\n")), "/w", URL).is_err());
        assert!(pr_facts(&fake(ORIGIN, out(0, "{\"state\":\"OPEN\"}\n")), "/w", URL).is_err());
        let e = pr_facts(&fake(ORIGIN, out(1, "GraphQL: Could not resolve to a PullRequest\n")), "/w", URL).unwrap_err();
        assert_eq!(e, "GraphQL: Could not resolve to a PullRequest");
    }

    #[test]
    fn a_url_for_another_repository_or_a_bad_one_makes_no_gh_call() {
        let other = fake("https://github.com/studio-b/other-tool.git\n", out(0, VIEW));
        assert!(pr_facts(&other, "/w", URL).is_err());
        assert!(merge(&other, "/w", URL, SHA).is_err());
        assert!(other.gh_calls().is_empty(), "{:?}", other.calls());
        let g = fake(ORIGIN, out(0, VIEW));
        assert!(pr_facts(&g, "/w", "--web").is_err());
        assert!(merge(&g, "/w", "https://github.com/studio-a/poster-tool/pull/1?x", SHA).is_err());
        assert!(merge(&g, "/w", URL, "main").is_err());
        assert!(merge(&g, "/w", URL, &"g".repeat(40)).is_err());
        assert!(g.gh_calls().is_empty(), "{:?}", g.calls());
    }

    #[test]
    fn merge_argv_is_exact() {
        let g = fake(ORIGIN, out(0, "Merged\n"));
        merge(&g, "/w", URL, SHA).unwrap();
        assert_eq!(g.gh_calls(), vec![format!("pr merge {URL} --squash --match-head-commit {SHA}")]);
        for (_, a) in g.calls() {
            for bad in ["--delete-branch", "--admin", "--auto", "push", "checkout", "reset"] {
                assert!(!a.contains(bad), "{a}");
            }
        }
    }

    #[test]
    fn a_failed_merge_is_an_error() {
        let failed = fake(ORIGIN, out(1, "X Pull request is not mergeable: head commit changed\nmore\n"));
        assert_eq!(merge(&failed, "/w", URL, SHA).unwrap_err(), "X Pull request is not mergeable: head commit changed");
        let slow = fake(ORIGIN, CommandOutcome { code: None, timed_out: true, tail: String::new(), error: None });
        assert_eq!(merge(&slow, "/w", URL, SHA).unwrap_err(), "gh took too long");
    }
}
