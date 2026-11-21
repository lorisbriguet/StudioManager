//! `studiomanager-mcp --worker-guard`: the `PreToolUse` hook of a worker the watcher started.
//! It only refuses; everything it lets through is still judged by Claude Code's own rules.

use serde_json::Value;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

const FILE_TOOLS: [&str; 4] = ["Edit", "Write", "MultiEdit", "NotebookEdit"];
const WORKTREE_MESSAGE: &str = "The worktree's .git file is not as the app made it.";
const GH_MESSAGE: &str = "The app opens the pull request after your push. Report your result instead.";

pub struct HookInput {
    pub tool_name: String,
    pub tool_input: Value,
    pub cwd: Option<String>,
}

pub struct GuardConfig {
    pub worktree: PathBuf,
    pub branch: String,
    pub settings: PathBuf,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Decision {
    Allow,
    Deny(String),
}

fn deny(reason: &str) -> Decision {
    Decision::Deny(reason.to_string())
}

impl HookInput {
    /// The hook's JSON. Anything that is not an object with a tool name and an object of tool
    /// input is an error: the caller then refuses.
    pub fn parse(raw: &str) -> Result<HookInput, String> {
        let v: Value = serde_json::from_str(raw).map_err(|e| format!("The hook input is not JSON: {e}"))?;
        let tool_name = v.get("tool_name").and_then(Value::as_str).filter(|n| !n.is_empty());
        let tool_input = v.get("tool_input").filter(|i| i.is_object());
        let (Some(tool_name), Some(tool_input)) = (tool_name, tool_input) else {
            return Err("The hook input has no tool name or no tool input.".to_string());
        };
        let cwd = match v.get("cwd") {
            None | Some(Value::Null) => None,
            Some(Value::String(s)) => Some(s.clone()),
            Some(_) => return Err("The hook input has a cwd that is not text.".to_string()),
        };
        Ok(HookInput { tool_name: tool_name.to_string(), tool_input: tool_input.clone(), cwd })
    }
}

impl GuardConfig {
    /// `--worktree <abs path> --branch <name> --settings <abs path>`: all three, none empty.
    pub fn from_args(args: &[String]) -> Result<GuardConfig, String> {
        let value = |flag: &str| -> Result<String, String> {
            let at = args.iter().position(|a| a == flag).ok_or_else(|| format!("The guard needs {flag}."))?;
            args.get(at + 1)
                .filter(|v| !v.is_empty())
                .cloned()
                .ok_or_else(|| format!("The guard needs a value after {flag}."))
        };
        let worktree = PathBuf::from(value("--worktree")?);
        let settings = PathBuf::from(value("--settings")?);
        if !worktree.is_absolute() || !settings.is_absolute() {
            return Err("The guard needs absolute paths.".to_string());
        }
        Ok(GuardConfig { worktree, branch: value("--branch")?, settings })
    }
}

/// Reads the hook's stdin and answers: exit code 0 and nothing to say, or 2 and one line for
/// stderr. Everything that goes wrong is a 2: the guard fails closed.
pub fn run(args: &[String], stdin: &[u8]) -> (i32, String) {
    let verdict = GuardConfig::from_args(args).and_then(|cfg| {
        let text = std::str::from_utf8(stdin).map_err(|_| "The hook input is not text.".to_string())?;
        Ok(decide(&HookInput::parse(text)?, &cfg))
    });
    match verdict {
        Ok(Decision::Allow) => (0, String::new()),
        Ok(Decision::Deny(reason)) => (2, one_line(&reason)),
        Err(e) => (2, one_line(&e)),
    }
}

fn one_line(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// What `main` calls: reads stdin to its end and returns the exit code. A panic is a 2.
pub fn run_process(args: &[String]) -> i32 {
    std::panic::set_hook(Box::new(|_| {}));
    let outcome = std::panic::catch_unwind(|| {
        let mut input = Vec::new();
        if std::io::stdin().read_to_end(&mut input).is_err() {
            return (2, "The hook input could not be read.".to_string());
        }
        run(args, &input)
    });
    let (code, line) = outcome.unwrap_or((2, "The guard failed.".to_string()));
    if code != 0 {
        eprintln!("{line}");
    }
    code
}

pub fn decide(input: &HookInput, cfg: &GuardConfig) -> Decision {
    let name = input.tool_name.as_str();
    if FILE_TOOLS.contains(&name) {
        file_tool(input, cfg)
    } else if name == "Bash" {
        bash(input, cfg)
    } else {
        // The hook is matched to the five tools above; any other tool is not its business.
        Decision::Allow
    }
}

// ---------------------------------------------------------------- file tools

fn file_tool(input: &HookInput, cfg: &GuardConfig) -> Decision {
    let base = input.cwd.as_deref().map(PathBuf::from).filter(|p| p.is_absolute()).unwrap_or_else(|| cfg.worktree.clone());
    let Some(fields) = input.tool_input.as_object() else { return deny("This tool call has no path: refused.") };
    let mut seen = 0;
    for key in ["file_path", "notebook_path"] {
        let Some(v) = fields.get(key) else { continue };
        let Some(path) = v.as_str().filter(|p| !p.is_empty()) else {
            return deny("This tool call has a path that is not text: refused.");
        };
        seen += 1;
        if let Some(reason) = refuse_path(Path::new(path), &base, cfg) {
            return Decision::Deny(reason);
        }
    }
    if seen == 0 {
        return deny("This tool call has no path: refused.");
    }
    Decision::Allow
}

/// `.` and `..` resolved without touching the disk; the root is dropped.
fn lexical(path: &Path) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for c in path.components() {
        match c {
            Component::Normal(n) => out.push(n.to_string_lossy().into_owned()),
            Component::ParentDir => {
                out.pop();
            }
            _ => {}
        }
    }
    out
}

fn lower_path(parts: &[String]) -> String {
    format!("/{}", parts.join("/")).to_lowercase()
}

fn has_dot_git(parts: &[String]) -> bool {
    parts.iter().any(|p| p.to_lowercase() == ".git")
}

/// The path with its deepest existing part resolved through the disk.
fn resolved(parts: &[String]) -> Vec<String> {
    let mut existing = PathBuf::from("/");
    existing.extend(parts);
    let mut tail: Vec<String> = Vec::new();
    loop {
        if let Ok(c) = existing.canonicalize() {
            let mut out = lexical(&c);
            out.extend(tail.into_iter().rev());
            return out;
        }
        match existing.file_name().map(|n| n.to_string_lossy().into_owned()) {
            Some(n) => tail.push(n),
            None => return parts.to_vec(),
        }
        if !existing.pop() {
            return parts.to_vec();
        }
    }
}

fn refuse_path(path: &Path, base: &Path, cfg: &GuardConfig) -> Option<String> {
    let full = if path.is_absolute() { path.to_path_buf() } else { base.join(path) };
    let parts = lexical(&full);
    let refuse_git = || Some("Nothing may write a .git file or folder: edit the files of the work only.".to_string());
    let refuse_settings = || Some("The hook settings file is the app's: do not edit it.".to_string());
    if has_dot_git(&parts) {
        return refuse_git();
    }
    let settings = lexical(&cfg.settings);
    if lower_path(&parts) == lower_path(&settings) {
        return refuse_settings();
    }
    let real = resolved(&parts);
    if has_dot_git(&real) {
        return refuse_git();
    }
    if lower_path(&real) == lower_path(&resolved(&settings)) {
        return refuse_settings();
    }
    None
}

// ---------------------------------------------------------------- Bash

fn bash(input: &HookInput, cfg: &GuardConfig) -> Decision {
    let Some(raw) = input.tool_input.get("command").and_then(Value::as_str) else {
        return deny("This shell call has no command: refused.");
    };
    let dequoted: String = raw.chars().filter(|c| !matches!(c, '"' | '\'' | '\\')).collect();

    if names_dot_git(raw) || names_dot_git(&dequoted) {
        return deny("Nothing may touch .git: do not name it in a command. Work on the files of the task only.");
    }
    if let Some(file) = cfg.settings.file_name().map(|n| n.to_string_lossy().to_lowercase()) {
        if raw.to_lowercase().contains(&file) || dequoted.to_lowercase().contains(&file) {
            return deny("The hook settings file is the app's: do not name it in a command.");
        }
    }

    // The two exact forms a worker may use; nothing else can ride along.
    let trimmed = raw.trim();
    if is_exact_commit(trimmed) || is_exact_push(trimmed, &cfg.branch) {
        return match check_worktree(input.cwd.as_deref(), cfg) {
            Ok(()) => Decision::Allow,
            Err(m) => Decision::Deny(m),
        };
    }

    if mentions_gh_pr_create(&dequoted) {
        return deny(GH_MESSAGE);
    }
    let lower = dequoted.to_lowercase();
    if lower.contains("git") && lower.contains("commit") {
        return deny("Only this commit is allowed: git commit -m \"message\" (one -m per paragraph, plain text with no double quote, $, backtick or backslash; or single quotes with no apostrophe), alone in its call. No other option. If you only mention commit and git, rephrase the command.");
    }
    if lower.contains("git") && lower.contains("push") {
        return Decision::Deny(format!(
            "Only this push is allowed: git push -u origin {b} (or git push origin {b}), alone in its call. Say in your result what else you wanted to push. If you only mention push and git, rephrase the command.",
            b = cfg.branch
        ));
    }
    Decision::Allow
}

/// `git commit` followed by one or more ` -m "text"` or ` -m 'text'`, single spaces, nothing else.
fn is_exact_commit(s: &str) -> bool {
    let Some(mut rest) = s.strip_prefix("git commit") else { return false };
    let mut messages = 0;
    loop {
        if rest.is_empty() {
            return messages > 0;
        }
        let Some(after) = rest.strip_prefix(" -m ") else { return false };
        let Some(quote) = after.chars().next().filter(|q| matches!(q, '"' | '\'')) else { return false };
        let body = &after[1..];
        let Some(end) = body.find(quote) else { return false };
        let text = &body[..end];
        if text.chars().any(char::is_control) {
            return false;
        }
        if quote == '"' && text.contains(['$', '`', '\\']) {
            return false;
        }
        rest = &body[end + 1..];
        messages += 1;
    }
}

/// Whether `branch` is plain: `A-Za-z0-9/_.-`, not starting with `-`, `.` or `/`, no `..`.
fn branch_ok(branch: &str) -> bool {
    !branch.is_empty()
        && !branch.starts_with(['-', '.', '/'])
        && !branch.contains("..")
        && branch.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '_' | '.' | '-'))
}

fn is_exact_push(s: &str, branch: &str) -> bool {
    branch_ok(branch) && (s == format!("git push -u origin {branch}") || s == format!("git push origin {branch}"))
}

fn is_name_char(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '_' | '-')
}

/// Whether the text names `.git` as a path component: a `.git` (any case) that does not start
/// inside a longer name and is not followed by more name (`.gitignore`, `.github` pass). A glob,
/// brace or variable that could spell it counts too.
fn names_dot_git(text: &str) -> bool {
    let t: Vec<char> = text.to_lowercase().chars().collect();
    for i in 0..t.len() {
        if t[i] != '.' || (i > 0 && (is_name_char(t[i - 1]) || t[i - 1] == '.')) {
            continue;
        }
        let mut j = i + 1;
        let mut matched = true;
        for want in ['g', 'i', 't'] {
            match t.get(j) {
                Some(&c) if c == want => j += 1,
                Some('?') => j += 1,
                Some('*' | '[' | '{' | '$' | '`') => return true,
                _ => {
                    matched = false;
                    break;
                }
            }
        }
        if !matched {
            continue;
        }
        match t.get(j) {
            Some(&c) if is_name_char(c) => {}
            Some('.') if t.get(j + 1).is_some_and(|&c| is_name_char(c)) => {}
            _ => return true,
        }
    }
    false
}

/// `gh` somewhere in the text, then `pr`, then `create`, as separate words: in any segment,
/// behind any wrapper, in `sh -c`, after a variable assignment.
fn mentions_gh_pr_create(dequoted: &str) -> bool {
    let lower = dequoted.to_lowercase();
    let words: Vec<&str> =
        lower.split(|c: char| c.is_whitespace() || "&|;()`<>{}=,".contains(c)).filter(|w| !w.is_empty()).collect();
    let Some(gh) = words.iter().position(|w| *w == "gh" || w.ends_with("/gh")) else { return false };
    let Some(pr) = words[gh + 1..].iter().position(|w| *w == "pr") else { return false };
    words[gh + 1 + pr + 1..].contains(&"create")
}

/// Walking up from the hook's cwd to the first folder with a `.git` entry: it must be the worktree,
/// and its `.git` must be the file `git worktree add` wrote, pointing at an admin folder that
/// points back.
fn check_worktree(cwd: Option<&str>, cfg: &GuardConfig) -> Result<(), String> {
    let bad = || WORKTREE_MESSAGE.to_string();
    let mut dir = Path::new(cwd.ok_or_else(bad)?).canonicalize().map_err(|_| bad())?;
    while dir.join(".git").symlink_metadata().is_err() {
        if !dir.pop() {
            return Err(bad());
        }
    }
    let worktree = cfg.worktree.canonicalize().map_err(|_| bad())?;
    if dir != worktree {
        return Err(bad());
    }
    let gitfile = worktree.join(".git");
    if !gitfile.symlink_metadata().map_err(|_| bad())?.file_type().is_file() {
        return Err(bad());
    }
    let content = std::fs::read_to_string(&gitfile).map_err(|_| bad())?;
    let target = content.trim().strip_prefix("gitdir: ").map(str::trim).filter(|t| !t.is_empty() && !t.contains('\n')).ok_or_else(bad)?;
    let target = Path::new(target);
    let admin = if target.is_absolute() { target.to_path_buf() } else { worktree.join(target) };
    let admin = admin.canonicalize().map_err(|_| bad())?;
    let worktrees = admin.parent().ok_or_else(bad)?;
    let dot_git = worktrees.parent().ok_or_else(bad)?;
    if admin.file_name().is_none() || worktrees.file_name().is_none_or(|n| n != "worktrees") || dot_git.file_name().is_none_or(|n| n != ".git") {
        return Err(bad());
    }
    let back = std::fs::read_to_string(admin.join("gitdir")).map_err(|_| bad())?;
    let back = Path::new(back.trim()).canonicalize().map_err(|_| bad())?;
    if back != gitfile.canonicalize().map_err(|_| bad())? {
        return Err(bad());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::temp_data_dir;
    use serde_json::json;
    use std::path::Path;

    struct Fx {
        base: PathBuf,
        wt: PathBuf,
        main: PathBuf,
        cfg: GuardConfig,
    }

    /// A main repository with one linked worktree, laid out as `git worktree add` leaves it.
    fn fx() -> Fx {
        let base = temp_data_dir().canonicalize().unwrap();
        let main = base.join("main");
        let wt = base.join("main/.claude/worktrees/sm-task-1");
        let admin = main.join(".git/worktrees/sm-task-1");
        std::fs::create_dir_all(&admin).unwrap();
        std::fs::create_dir_all(wt.join("src")).unwrap();
        std::fs::write(wt.join(".git"), format!("gitdir: {}\n", admin.display())).unwrap();
        std::fs::write(admin.join("gitdir"), format!("{}\n", wt.join(".git").display())).unwrap();
        let settings = base.join("app/watcher/hook-settings-sm-task-1.json");
        std::fs::create_dir_all(settings.parent().unwrap()).unwrap();
        std::fs::write(&settings, "{}").unwrap();
        let cfg = GuardConfig { worktree: wt.clone(), branch: "sm/task-1".into(), settings };
        Fx { base, wt, main, cfg }
    }

    fn bash_in(f: &Fx, cwd: &Path, cmd: &str) -> Decision {
        let input = HookInput {
            tool_name: "Bash".into(),
            tool_input: json!({ "command": cmd }),
            cwd: Some(cwd.to_string_lossy().into_owned()),
        };
        decide(&input, &f.cfg)
    }
    fn bash(f: &Fx, cmd: &str) -> Decision {
        bash_in(f, &f.wt, cmd)
    }
    fn allowed(f: &Fx, cmd: &str) {
        assert_eq!(bash(f, cmd), Decision::Allow, "should pass: {cmd:?}");
    }
    fn denied(f: &Fx, cmd: &str) {
        match bash(f, cmd) {
            Decision::Deny(r) => {
                assert!(!r.is_empty() && !r.contains('\n'), "one plain line: {r:?}");
            }
            Decision::Allow => panic!("should be refused: {cmd:?}"),
        }
    }
    fn file_tool(f: &Fx, tool: &str, field: &str, path: &str) -> Decision {
        let input = HookInput {
            tool_name: tool.into(),
            tool_input: json!({ field: path }),
            cwd: Some(f.wt.to_string_lossy().into_owned()),
        };
        decide(&input, &f.cfg)
    }

    // ------------------------------------------------------------ commit

    #[test]
    fn commit_accepted_forms() {
        let f = fx();
        for c in [
            r#"git commit -m "Add the export""#,
            r#"git commit -m "First paragraph" -m "Second paragraph""#,
            "git commit -m 'Add the export'",
            "git commit -m 'one' -m \"two\"",
            r#"git commit -m "It's done""#,
            r#"git commit -m "Réglé: l'été à Genève""#,
            "  git commit -m \"x\"  \n",
            r#"git commit -m "fix; push && more | stuff""#,
            r#"git commit -m "mention git push in the message""#,
            r#"git commit -m "see .gitignore""#,
        ] {
            allowed(&f, c);
        }
    }

    #[test]
    fn commit_refused_forms() {
        let f = fx();
        for c in [
            "git commit -F file",
            "git commit -aF file",
            "git commit --file=x",
            "git commit --fil=x",
            "git commit -t x",
            "git commit --template=x",
            "git commit -C HEAD",
            "git commit -c HEAD",
            "git commit --reuse-message=HEAD",
            "git commit --amend",
            r#"git commit -a -m "x""#,
            r#"git commit -m "x" -a"#,
            r#"git commit -m "$(cat ~/.ssh/id_rsa)""#,
            r#"git commit -m "`id`""#,
            "git commit -m \"a\\nb\"",
            "git commit -m \"a\"\"b\"",
            "git commit -m \"it\\\"s\"",
            "git commit -m <<EOF\nhello\nEOF",
            "git commit -m \"$(cat <<'EOF'\nmsg\nEOF\n)\"",
            r#"git commit -m "x" && cat y"#,
            r#"git commit -m "x" > /tmp/y"#,
            r#"git commit -m "x";"#,
            r#"git -c core.editor=x commit -m "x""#,
            r#"git -C /tmp commit -m "x""#,
            r#"command git commit -F x"#,
            r#"FOO=1 git commit -m "x""#,
            r#"git "commit" -F x"#,
            r#"git comm""it -F x"#,
            r#"git com\mit -F x"#,
            r#"sh -c 'git commit -F x'"#,
            "git commit -m \"a\nb\"",
            "git commit -m 'a\nb'",
            "git\tcommit\t-m\t\"x\"",
            "git  commit -m \"x\"",
            "git commit -m 'it's'",
            "git commit",
            "git commit -m",
            "git commit -m x",
            "git commit -m \"x\" --no-verify",
            "GIT COMMIT -F x",
            "git commit -m \"a\r\"",
        ] {
            denied(&f, c);
        }
    }

    // ------------------------------------------------------------ push

    #[test]
    fn push_exact_forms() {
        let f = fx();
        allowed(&f, "git push -u origin sm/task-1");
        allowed(&f, "git push origin sm/task-1");
        allowed(&f, "  git push origin sm/task-1\n");
    }

    #[test]
    fn push_refused_forms() {
        let f = fx();
        for c in [
            "git push --force origin sm/task-1",
            "git push -f origin sm/task-1",
            "git push origin +sm/task-1",
            "git push origin sm/task-1:main",
            "git push origin sm/task-2",
            "git push upstream sm/task-1",
            "git push -u origin main",
            "git -C x push origin sm/task-1",
            "GIT_SSH_COMMAND=x git push origin sm/task-1",
            "git push origin sm/task-1 && echo hi",
            "git push origin sm/task-1; id",
            "git push",
            "git push -u origin sm/task-1 --force",
            "git push -u  origin sm/task-1",
            "git \"push\" origin main",
            "git pu\\sh origin main",
            "GIT push origin main",
            "git push origin sm/task-1 --receive-pack=x",
        ] {
            denied(&f, c);
        }
    }

    #[test]
    fn push_of_a_hostile_configured_branch_is_refused() {
        let mut f = fx();
        f.cfg.branch = "sm/task-1 --force".into();
        denied(&f, "git push origin sm/task-1 --force");
    }

    // ------------------------------------------------------------ .git and the settings file

    #[test]
    fn dot_git_in_a_command_is_refused() {
        let f = fx();
        for c in [
            "echo x > .git",
            "mv a .git",
            "rm .git",
            "rm -rf .git",
            "sed -i s/a/b/ .git",
            "cat .git/config",
            "ls sub/.git/hooks",
            r#"cp x "./.git""#,
            "cp x './.git'",
            "cat .GIT/config",
            "echo x>.git",
            "cat (.git)",
            "cat $(pwd)/.git",
            "ls -a .*",
            "cat .g*",
            "cat .gi?",
            "cat .[g]it",
            "cat .{g,x}it",
            "cat .g$X",
            "cat ../../main/.git/config",
            "cat .g\"\"it/config",
            "cat '.git'/config",
            "echo hi;.git",
            "echo x > .git.",
        ] {
            denied(&f, c);
        }
    }

    #[test]
    fn the_settings_file_in_a_command_is_refused() {
        let f = fx();
        denied(&f, &format!("cat {}", f.cfg.settings.display()));
        denied(&f, "cat ../hook-settings-sm-task-1.json");
        denied(&f, "echo {} > 'hook-settings-sm-task-1.json'");
        denied(&f, "cat HOOK-SETTINGS-SM-TASK-1.JSON");
    }

    #[test]
    fn ordinary_commands_pass() {
        let f = fx();
        for c in [
            "cat .gitignore",
            "ls .github/workflows",
            "git status",
            "git diff",
            "git add -A",
            "git add src/a.rs",
            "cat .gitattributes",
            "git diff -- .github",
            "ls -la",
            "ls .",
            "ls ..",
            "cargo test",
            "git log --oneline",
            "git clone https://example.com/x/repo.git",
            "cat README.md",
        ] {
            allowed(&f, c);
        }
    }

    // ------------------------------------------------------------ gh

    #[test]
    fn gh_pr_create_is_refused_in_any_shape() {
        let f = fx();
        for c in [
            "gh pr create --title x",
            "command gh pr create",
            "cd x && gh pr create -F y",
            "GH_TOKEN=x gh pr create",
            "timeout 5 gh pr create",
            "env -i gh pr create",
            "/opt/homebrew/bin/gh pr create",
            "sh -c 'gh pr create'",
            "echo a | xargs gh pr create",
            "(gh pr create)",
            "x=$(gh pr create)",
            "\"gh\" pr create",
            "g\\h pr create",
            "gh -R owner/repo pr create",
            "nohup gh pr create &",
            "gh\npr create",
        ] {
            denied(&f, c);
        }
        match bash(&f, "gh pr create --title x") {
            Decision::Deny(r) => assert!(r.contains("The app opens the pull request after your push"), "{r}"),
            _ => panic!(),
        }
    }

    #[test]
    fn other_gh_commands_pass() {
        let f = fx();
        allowed(&f, "gh pr view 3");
        allowed(&f, "gh pr list");
        allowed(&f, "gh run list");
    }

    // ------------------------------------------------------------ file tools

    #[test]
    fn file_tools_cannot_write_dot_git_or_the_settings_file() {
        let f = fx();
        let wt = f.wt.display().to_string();
        let denied_path = |tool: &str, field: &str, p: &str| match file_tool(&f, tool, field, p) {
            Decision::Deny(r) => assert!(!r.is_empty() && !r.contains('\n')),
            Decision::Allow => panic!("{tool} {p} should be refused"),
        };
        for tool in ["Edit", "Write"] {
            denied_path(tool, "file_path", &format!("{wt}/.git"));
            denied_path(tool, "file_path", &format!("{wt}/sub/../.git"));
            denied_path(tool, "file_path", &format!("{wt}/./.git"));
            denied_path(tool, "file_path", "/tmp/elsewhere/.git/config");
            denied_path(tool, "file_path", &format!("{wt}/.GIT"));
            denied_path(tool, "file_path", &format!("{wt}/a/.Git/hooks/pre-commit"));
            denied_path(tool, "file_path", &f.cfg.settings.to_string_lossy());
            denied_path(tool, "file_path", &format!("{}/main/../app/watcher/./hook-settings-sm-task-1.json", f.base.display()));
            denied_path(tool, "file_path", &format!("{}/app/watcher/HOOK-SETTINGS-SM-TASK-1.JSON", f.base.display()));
            // The admin folder of the worktree is under a `.git` too.
            denied_path(tool, "file_path", &format!("{}/.git/worktrees/sm-task-1/gitdir", f.main.display()));
        }
        denied_path("MultiEdit", "file_path", &format!("{wt}/.git"));
        denied_path("NotebookEdit", "notebook_path", &format!("{wt}/.git"));
        denied_path("NotebookEdit", "notebook_path", &format!("{wt}/x/.git/n.ipynb"));
        for (tool, field) in [("Edit", "file_path"), ("Write", "file_path"), ("MultiEdit", "file_path"), ("NotebookEdit", "notebook_path")] {
            assert_eq!(file_tool(&f, tool, field, &format!("{wt}/src/a.rs")), Decision::Allow);
            assert_eq!(file_tool(&f, tool, field, &format!("{wt}/.gitignore")), Decision::Allow);
            assert_eq!(file_tool(&f, tool, field, &format!("{wt}/.github/x.yml")), Decision::Allow);
        }
    }

    #[test]
    fn file_tools_follow_a_symlink_to_dot_git_or_the_settings_file() {
        let f = fx();
        let link = f.wt.join("link");
        std::os::unix::fs::symlink(f.wt.join(".git"), &link).unwrap();
        assert!(matches!(file_tool(&f, "Write", "file_path", &link.to_string_lossy()), Decision::Deny(_)));
        let link2 = f.wt.join("link2");
        std::os::unix::fs::symlink(&f.cfg.settings, &link2).unwrap();
        assert!(matches!(file_tool(&f, "Edit", "file_path", &link2.to_string_lossy()), Decision::Deny(_)));
        let dir = f.wt.join("dirlink");
        std::os::unix::fs::symlink(f.main.join(".git"), &dir).unwrap();
        assert!(matches!(file_tool(&f, "Write", "file_path", &format!("{}/config", dir.display())), Decision::Deny(_)));
    }

    #[test]
    fn a_file_tool_without_a_usable_path_is_refused() {
        let f = fx();
        for (tool, input) in [
            ("Edit", json!({})),
            ("Write", json!({"content": "x"})),
            ("MultiEdit", json!({"edits": []})),
            ("NotebookEdit", json!({"file_path_typo": "/x"})),
            ("Edit", json!({"file_path": 3})),
            ("Edit", json!({"file_path": ""})),
            ("Edit", json!({"file_path": null})),
        ] {
            let i = HookInput { tool_name: tool.into(), tool_input: input, cwd: None };
            assert!(matches!(decide(&i, &f.cfg), Decision::Deny(_)), "{tool}");
        }
    }

    #[test]
    fn a_relative_path_is_resolved_from_the_cwd() {
        let f = fx();
        let cwd = Some(f.wt.join("src").to_string_lossy().into_owned());
        // From `src`, `../.git` is the worktree's own `.git` file.
        let i = HookInput { tool_name: "Write".into(), tool_input: json!({"file_path": "../.git"}), cwd: cwd.clone() };
        assert!(matches!(decide(&i, &f.cfg), Decision::Deny(_)));
        let i = HookInput { tool_name: "Write".into(), tool_input: json!({"file_path": "a.rs"}), cwd };
        assert_eq!(decide(&i, &f.cfg), Decision::Allow);
    }

    #[test]
    fn bash_without_a_command_is_refused_and_other_tools_pass() {
        let f = fx();
        for input in [json!({}), json!({"command": 5}), json!({"command": null})] {
            let i = HookInput { tool_name: "Bash".into(), tool_input: input, cwd: None };
            assert!(matches!(decide(&i, &f.cfg), Decision::Deny(_)));
        }
        // The hook is matched to five tools only; any other name is not its business.
        let i = HookInput { tool_name: "Read".into(), tool_input: json!({"file_path": "/x/.git/config"}), cwd: None };
        assert_eq!(decide(&i, &f.cfg), Decision::Allow);
        let i = HookInput { tool_name: "mcp__x__y".into(), tool_input: json!("odd"), cwd: None };
        assert_eq!(decide(&i, &f.cfg), Decision::Allow);
    }

    // ------------------------------------------------------------ the worktree check

    #[test]
    fn an_intact_worktree_lets_a_commit_and_a_push_pass_from_a_subfolder_too() {
        let f = fx();
        let c = r#"git commit -m "x""#;
        assert_eq!(bash_in(&f, &f.wt, c), Decision::Allow);
        assert_eq!(bash_in(&f, &f.wt.join("src"), c), Decision::Allow);
        assert_eq!(bash_in(&f, &f.wt.join("src"), "git push origin sm/task-1"), Decision::Allow);
    }

    fn refused_with_worktree_message(f: &Fx, cwd: &Path) {
        for c in [r#"git commit -m "x""#, "git push -u origin sm/task-1"] {
            match bash_in(f, cwd, c) {
                Decision::Deny(r) => assert!(r.contains("The worktree's .git file is not as the app made it."), "{r}"),
                Decision::Allow => panic!("{c} should be refused"),
            }
        }
    }

    #[test]
    fn a_dot_git_that_is_a_folder_is_refused() {
        let f = fx();
        std::fs::remove_file(f.wt.join(".git")).unwrap();
        std::fs::create_dir(f.wt.join(".git")).unwrap();
        refused_with_worktree_message(&f, &f.wt);
    }

    #[test]
    fn a_dot_git_that_is_a_symlink_is_refused() {
        let f = fx();
        let real = f.base.join("real-dot-git-file");
        std::fs::copy(f.wt.join(".git"), &real).unwrap();
        std::fs::remove_file(f.wt.join(".git")).unwrap();
        std::os::unix::fs::symlink(&real, f.wt.join(".git")).unwrap();
        refused_with_worktree_message(&f, &f.wt);
    }

    #[test]
    fn a_dot_git_pointing_at_another_gitdir_is_refused() {
        let f = fx();
        let other = f.main.join(".git/worktrees/other");
        std::fs::create_dir_all(&other).unwrap();
        std::fs::write(other.join("gitdir"), "/somewhere/else/.git\n").unwrap();
        std::fs::write(f.wt.join(".git"), format!("gitdir: {}\n", other.display())).unwrap();
        refused_with_worktree_message(&f, &f.wt);
    }

    #[test]
    fn a_dot_git_with_odd_content_is_refused() {
        let f = fx();
        let admin = f.main.join(".git/worktrees/sm-task-1");
        for content in [
            String::new(),
            "gitdir:".to_string(),
            format!("gitdir: {}\nextra: line\n", admin.display()),
            format!("gitdir:{}", admin.display()),
            format!("{}", admin.display()),
            format!("gitdir: {}\n", f.main.join(".git").display()),
            format!("gitdir: {}\n", f.base.display()),
            format!("gitdir: {}/missing\n", f.main.join(".git/worktrees").display()),
        ] {
            std::fs::write(f.wt.join(".git"), content).unwrap();
            refused_with_worktree_message(&f, &f.wt);
        }
    }

    #[test]
    fn a_gitdir_back_pointer_that_names_another_worktree_is_refused() {
        let f = fx();
        let admin = f.main.join(".git/worktrees/sm-task-1");
        std::fs::write(admin.join("gitdir"), format!("{}\n", f.base.join("elsewhere/.git").display())).unwrap();
        refused_with_worktree_message(&f, &f.wt);
        std::fs::remove_file(admin.join("gitdir")).unwrap();
        refused_with_worktree_message(&f, &f.wt);
    }

    #[test]
    fn a_nested_folder_with_its_own_dot_git_as_cwd_is_refused() {
        let f = fx();
        let nested = f.wt.join("vendor/lib");
        std::fs::create_dir_all(nested.join(".git")).unwrap();
        refused_with_worktree_message(&f, &nested);
    }

    #[test]
    fn a_cwd_outside_the_worktree_or_missing_is_refused() {
        let f = fx();
        refused_with_worktree_message(&f, &f.main);
        refused_with_worktree_message(&f, &f.base);
        refused_with_worktree_message(&f, &f.wt.join("missing"));
        let i = HookInput { tool_name: "Bash".into(), tool_input: json!({"command": "git push origin sm/task-1"}), cwd: None };
        assert!(matches!(decide(&i, &f.cfg), Decision::Deny(_)));
        // Only a commit or a push needs the check.
        assert_eq!(bash_in(&f, &f.base, "git status"), Decision::Allow);
    }

    #[test]
    fn a_missing_dot_git_is_refused() {
        let f = fx();
        std::fs::remove_file(f.wt.join(".git")).unwrap();
        refused_with_worktree_message(&f, &f.wt);
    }

    // ------------------------------------------------------------ input and arguments

    #[test]
    fn the_hook_input_is_parsed_strictly() {
        let ok = HookInput::parse(r#"{"tool_name":"Bash","tool_input":{"command":"ls"},"cwd":"/x","session_id":"s"}"#).unwrap();
        assert_eq!((ok.tool_name.as_str(), ok.cwd.as_deref()), ("Bash", Some("/x")));
        for bad in ["", "   ", "nope", "[]", "{}", r#"{"tool_name":"Bash"}"#, r#"{"tool_input":{}}"#, r#"{"tool_name":3,"tool_input":{}}"#, r#"{"tool_name":"Bash","tool_input":"x"}"#, r#"{"tool_name":"Bash","tool_input":{},"cwd":5}"#] {
            assert!(HookInput::parse(bad).is_err(), "{bad:?}");
        }
    }

    fn args(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn the_arguments_are_all_required_and_absolute() {
        let f = fx();
        let wt = f.wt.to_string_lossy().into_owned();
        let st = f.cfg.settings.to_string_lossy().into_owned();
        let good = args(&["--worker-guard", "--worktree", &wt, "--branch", "sm/task-1", "--settings", &st]);
        let cfg = GuardConfig::from_args(&good).unwrap();
        assert_eq!((cfg.worktree, cfg.branch, cfg.settings), (f.wt.clone(), "sm/task-1".to_string(), f.cfg.settings.clone()));
        for bad in [
            args(&["--worker-guard"]),
            args(&["--worker-guard", "--worktree", &wt, "--branch", "sm/task-1"]),
            args(&["--worker-guard", "--worktree", &wt, "--settings", &st]),
            args(&["--worker-guard", "--branch", "sm/task-1", "--settings", &st]),
            args(&["--worker-guard", "--worktree", "rel/wt", "--branch", "sm/task-1", "--settings", &st]),
            args(&["--worker-guard", "--worktree", &wt, "--branch", "sm/task-1", "--settings", "rel.json"]),
            args(&["--worker-guard", "--worktree", &wt, "--branch", "sm/task-1", "--settings"]),
            args(&["--worker-guard", "--worktree", &wt, "--branch", "", "--settings", &st]),
        ] {
            assert!(GuardConfig::from_args(&bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn run_answers_with_exit_codes() {
        let f = fx();
        let wt = f.wt.to_string_lossy().into_owned();
        let st = f.cfg.settings.to_string_lossy().into_owned();
        let a = args(&["--worker-guard", "--worktree", &wt, "--branch", "sm/task-1", "--settings", &st]);
        let ok = json!({"tool_name":"Bash","tool_input":{"command":"git status"},"cwd":wt}).to_string();
        assert_eq!(run(&a, ok.as_bytes()), (0, String::new()));
        let no = json!({"tool_name":"Bash","tool_input":{"command":"git push --force"},"cwd":wt}).to_string();
        let (code, line) = run(&a, no.as_bytes());
        assert_eq!(code, 2);
        assert!(!line.is_empty() && !line.trim_end().contains('\n'), "{line:?}");
        for bad in [&b""[..], b"garbage", b"\xff\xfe", b"{}", b"null"] {
            assert_eq!(run(&a, bad).0, 2, "{bad:?}");
        }
        assert_eq!(run(&args(&["--worker-guard"]), ok.as_bytes()).0, 2);
    }
}
