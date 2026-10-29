//! Start, stop, delete, switch model and dismiss: the write side of Agents.

use super::cli::{read_settings, timed_out, Cli, CliOutput};
use super::model::{parse_agents, Agent, Kind};
use super::projects::read_trusted;
use super::pty::blocking;
use super::validate::{valid_model, valid_name, valid_short_id, valid_task};
use crate::agent_access::write_atomic;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const STATE_FILE: &str = "agents-state.json";
const OFF: &str = "Agents are switched off";

/// `agents-state.json`: dismissed prompts and old session id -> new short id.
#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct AgentsStateFile {
    pub dismissed: Vec<String>,
    pub links: BTreeMap<String, String>,
    /// Copies started by a model switch, by their short id: the session they continue
    /// and the model chosen. A copy has no transcript until it gets its first message.
    pub copies: BTreeMap<String, CopyOf>,
}

#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CopyOf {
    pub session_id: String,
    pub model: String,
}

/// The session whose transcript shows for `session_id`: itself, or for a model-switch copy
/// with no transcript yet, the session it was copied from (following copies of copies).
pub fn transcript_session(
    session_id: &str,
    copies: &BTreeMap<String, CopyOf>,
    has_transcript: &dyn Fn(&str) -> bool,
) -> String {
    let mut current = session_id.to_string();
    for _ in 0..8 {
        if has_transcript(&current) {
            break;
        }
        let short: String = current.chars().take(8).collect();
        match copies.get(&short) {
            Some(c) => current = c.session_id.clone(),
            None => break,
        }
    }
    current
}

/// The state file; a missing or unreadable one is empty. One that does not parse is moved to
/// `agents-state.json.bak` (and logged) before it reads as empty, so the next write does not
/// silently throw its dismissals, links and copies away.
pub fn read_state(dir: &Path) -> AgentsStateFile {
    match load_state(dir) {
        Some(st) => st,
        None => {
            let _held = STATE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            load_state(dir).unwrap_or_else(|| set_aside_corrupt(dir))
        }
    }
}

/// None when the file exists but does not parse.
fn load_state(dir: &Path) -> Option<AgentsStateFile> {
    match std::fs::read_to_string(dir.join(STATE_FILE)) {
        Ok(raw) => serde_json::from_str(&raw).ok(),
        Err(_) => Some(AgentsStateFile::default()),
    }
}

/// Moves a state file that does not parse to `.bak`. The caller holds `STATE_LOCK` and has just
/// read it, so a good file written meanwhile is never the one moved.
fn set_aside_corrupt(dir: &Path) -> AgentsStateFile {
    let path = dir.join(STATE_FILE);
    let bak = dir.join(format!("{STATE_FILE}.bak"));
    match std::fs::rename(&path, &bak) {
        Ok(()) => {
            log::warn!("[agents] {STATE_FILE} is damaged; kept it as {}, starting anew", bak.display())
        }
        Err(e) => log::warn!("[agents] {STATE_FILE} is damaged and could not be set aside: {e}"),
    }
    AgentsStateFile::default()
}

fn write_state(dir: &Path, s: &AgentsStateFile) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    let json = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    write_atomic(&dir.join(STATE_FILE), &format!("{json}\n"))
}

/// Serialises every read-modify-write of `agents-state.json` (dismiss, the poller's pruning,
/// a model switch's link), so none of them loses another's update.
static STATE_LOCK: Mutex<()> = Mutex::new(());

/// Reads the state file, applies `f`, and writes it back if `f` changed it.
fn update_state<T>(dir: &Path, f: impl FnOnce(&mut AgentsStateFile) -> T) -> Result<T, String> {
    let _held = STATE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let before = load_state(dir).unwrap_or_else(|| set_aside_corrupt(dir));
    let mut st = before.clone();
    let out = f(&mut st);
    if st != before {
        write_state(dir, &st)?;
    }
    Ok(out)
}

/// Keeps the dismissals for which `keep` holds and returns them. A dismissal covers one wait:
/// the poller drops it once the agent is no longer waiting. If the file cannot be written the
/// kept list is still returned.
pub fn retain_dismissed(dir: &Path, keep: impl Fn(&str) -> bool) -> Vec<String> {
    let kept = |st: &mut AgentsStateFile| {
        st.dismissed.retain(|id| keep(id));
        st.dismissed.clone()
    };
    update_state(dir, kept).unwrap_or_else(|_| {
        read_state(dir).dismissed.into_iter().filter(|id| keep(id)).collect()
    })
}

/// A session id as the CLI reports it: a uuid (hex digits and hyphens).
pub(super) fn valid_session_id(s: &str) -> bool {
    s.len() == 36 && s.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f' | '-'))
}

fn args(a: &[&str]) -> Vec<String> {
    a.iter().map(|s| s.to_string()).collect()
}

fn first_error_line(o: &CliOutput, fallback: &str) -> String {
    let line = o
        .stderr
        .lines()
        .next()
        .filter(|l| !l.trim().is_empty())
        .or_else(|| o.stdout.lines().next())
        .unwrap_or("")
        .trim();
    if line.is_empty() {
        fallback.to_string()
    } else {
        line.to_string()
    }
}

/// The CLI reports an untrusted workspace with any exit code: the text decides.
fn not_trusted_line(o: &CliOutput) -> Option<String> {
    [&o.stdout, &o.stderr]
        .into_iter()
        .flat_map(|s| s.lines())
        .find(|l| l.contains("Workspace not trusted"))
        .map(|l| l.trim().to_string())
}

/// Last `backgrounded · <8 hex>` line of the output.
fn last_backgrounded_id(out: &str) -> Option<String> {
    out.lines()
        .filter_map(|l| {
            let rest = l.split("backgrounded · ").nth(1)?;
            let id: String = rest.chars().take(8).collect();
            valid_short_id(&id).then_some(id)
        })
        .next_back()
}

fn trim_slash(s: &str) -> &str {
    s.trim_end_matches('/')
}

const START_TIMED_OUT: &str = "Claude took too long to start the agent. It may still appear in \
    the list in a moment: check there before starting it again.";
/// Clock difference allowed between "the start was asked" and the agent's `startedAt`.
const START_SLACK_MS: i64 = 5_000;

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// After `claude --bg` was killed at its timeout: the agent it started anyway, found in the list
/// by name and folder among those started since `since_ms` (the newest, `not` excepted).
fn started_meanwhile(
    cli: &dyn Cli,
    name: &str,
    folder: &str,
    since_ms: i64,
    not: Option<&str>,
) -> Option<String> {
    fetch_agents(cli)
        .ok()?
        .into_iter()
        .filter(|a| a.kind == Kind::Background && a.name == name)
        .filter(|a| trim_slash(&a.cwd) == trim_slash(folder))
        .filter(|a| a.started_at >= since_ms - START_SLACK_MS)
        .filter_map(|a| {
            let id = a.short_id.filter(|s| valid_short_id(s) && Some(s.as_str()) != not)?;
            Some((a.started_at, id))
        })
        .max_by_key(|(at, _)| *at)
        .map(|(_, id)| id)
}

/// The short id of the agent `claude --bg` started: the one it printed or, when it timed out
/// while the agent was still being set up, the one that shows up in the list.
fn backgrounded(
    cli: &dyn Cli,
    out: &CliOutput,
    (name, folder): (&str, &str),
    since_ms: i64,
    not: Option<&str>,
    fallback: &str,
) -> Result<String, String> {
    if let Some(l) = not_trusted_line(out) {
        return Err(l);
    }
    if let Some(id) = last_backgrounded_id(&out.stdout) {
        return Ok(id);
    }
    if timed_out(out) {
        return started_meanwhile(cli, name, folder, since_ms, not)
            .ok_or_else(|| START_TIMED_OUT.to_string());
    }
    Err(first_error_line(out, fallback))
}

pub fn start(
    cli: &dyn Cli,
    trusted: &[String],
    folder: &str,
    task: &str,
    model: &str,
    name: &str,
) -> Result<String, String> {
    if !valid_model(model) {
        return Err("Unknown model".into());
    }
    if !valid_name(name) {
        return Err("Invalid agent name".into());
    }
    if task.trim().is_empty() || !valid_task(task) {
        return Err("Task must be 1-8000 characters and not start with \"-\"".into());
    }
    if !trusted.iter().any(|t| trim_slash(t) == trim_slash(folder)) {
        return Err("Folder not trusted: open it once with Claude Code first".into());
    }
    let since = now_ms();
    let argv = args(&["--bg", "--model", model, "--name", name, task]);
    let out = cli.run_start(&argv, Path::new(folder));
    backgrounded(cli, &out, (name, folder), since, None, "Failed to start the agent")
}

pub fn stop(cli: &dyn Cli, home: &Path, short_id: &str) -> Result<(), String> {
    if !valid_short_id(short_id) {
        return Err("Invalid agent id".into());
    }
    let out = cli.run(&args(&["stop", short_id]), home);
    if out.code != 0 || !out.stdout.contains(&format!("stopped {short_id}")) {
        return Err(first_error_line(&out, "Failed to stop the agent"));
    }
    Ok(())
}

pub fn delete(cli: &dyn Cli, home: &Path, short_id: &str) -> Result<(), String> {
    if !valid_short_id(short_id) {
        return Err("Invalid agent id".into());
    }
    let out = cli.run(&args(&["rm", short_id]), home);
    if out.code != 0 || !out.stdout.contains(&format!("removed {short_id}")) {
        return Err(first_error_line(&out, "Failed to delete the agent"));
    }
    Ok(())
}

pub fn switch_model(
    cli: &dyn Cli,
    home: &Path,
    agent: &Agent,
    model: &str,
    state_dir: &Path,
) -> Result<String, String> {
    if !valid_model(model) {
        return Err("Unknown model".into());
    }
    if agent.kind != Kind::Background {
        return Err("Only background agents can switch model".into());
    }
    let short = agent
        .short_id
        .as_deref()
        .filter(|s| valid_short_id(s))
        .ok_or("Invalid agent id")?;
    if !valid_session_id(&agent.session_id) {
        return Err("Invalid session id".into());
    }
    if !agent.cwd.starts_with('/') {
        return Err("Invalid agent folder".into());
    }
    let name = if valid_name(&agent.name) { agent.name.as_str() } else { short };
    stop(cli, home, short)?;
    let since = now_ms();
    let out = cli.run_start(
        &args(&["--resume", &agent.session_id, "--bg", "--model", model, "--name", name]),
        Path::new(&agent.cwd),
    );
    // On a timeout the copy is looked up by name, so it still gets its link and model below:
    // otherwise it would show as blocked, and a retry would start a second copy.
    let new_id = backgrounded(cli, &out, (name, &agent.cwd), since, Some(short), "unknown error")
        .map_err(|e| format!("Stopped the old agent; starting the copy failed: {e}"))?;
    // Best effort: the copy already runs, so a bookkeeping failure is not a failed switch.
    let _ = update_state(state_dir, |st| {
        st.links.insert(agent.session_id.clone(), new_id.clone());
        st.copies.insert(
            new_id.clone(),
            CopyOf { session_id: agent.session_id.clone(), model: model.to_string() },
        );
    });
    Ok(new_id)
}

pub fn dismiss(state_dir: &Path, session_id: &str) -> Result<(), String> {
    if !valid_session_id(session_id) {
        return Err("Invalid session id".into());
    }
    update_state(state_dir, |st| {
        if !st.dismissed.iter().any(|s| s == session_id) {
            st.dismissed.push(session_id.to_string());
        }
    })
}

pub fn fetch_agents(cli: &dyn Cli) -> Result<Vec<Agent>, String> {
    let out = cli.run(&args(&["agents", "--json", "--all"]), &home_dir());
    if out.code != 0 {
        return Err(first_error_line(&out, "Failed to list agents"));
    }
    parse_agents(&out.stdout)
}

pub fn find_agent(cli: &dyn Cli, session_id: &str) -> Result<Agent, String> {
    if !valid_session_id(session_id) {
        return Err("Invalid session id".into());
    }
    fetch_agents(cli)?
        .into_iter()
        .find(|a| a.session_id == session_id)
        .ok_or_else(|| "Agent not found".to_string())
}

/// Like `find_agent`, but looks in the poller's last list first and asks the
/// CLI only when the agent is not in it (or the list is empty).
pub fn find_agent_cached(
    cli: &dyn Cli,
    cache: &[Agent],
    session_id: &str,
) -> Result<Agent, String> {
    if !valid_session_id(session_id) {
        return Err("Invalid session id".into());
    }
    match cache.iter().find(|a| a.session_id == session_id) {
        Some(a) => Ok(a.clone()),
        None => find_agent(cli, session_id),
    }
}

pub(super) fn home_dir() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

// ---------------------------------------------------------------- commands

pub(super) fn switched_on(state: &super::AgentsState) -> Result<(), String> {
    if !read_settings(&state.app_dir).enabled {
        return Err(OFF.into());
    }
    Ok(())
}

/// Checks the switch, and hands back what `cli` needs. `cli` may run the login-shell lookup
/// and every CLI call blocks, so both happen inside `pty::blocking`.
pub(super) fn ready(state: &super::AgentsState) -> Result<super::pty::LoginCache, String> {
    switched_on(state)?;
    Ok(state.login_cache())
}

/// The `claude` runner, or "claude not found". Call it on a blocking thread.
pub(super) fn cli(login: &super::pty::LoginCache) -> Result<super::cli::RealCli, String> {
    super::cli::real_cli(login).ok_or_else(|| "claude not found".to_string())
}

#[tauri::command]
pub async fn agents_start(
    state: tauri::State<'_, super::AgentsState>,
    folder: String,
    task: String,
    model: String,
    name: String,
) -> Result<String, String> {
    let login = ready(&state)?;
    blocking(move || start(&cli(&login)?, &read_trusted(&home_dir()), &folder, &task, &model, &name))
        .await
}

#[tauri::command]
pub async fn agents_stop(
    state: tauri::State<'_, super::AgentsState>,
    short_id: String,
) -> Result<(), String> {
    let login = ready(&state)?;
    blocking(move || stop(&cli(&login)?, &home_dir(), &short_id)).await
}

#[tauri::command]
pub async fn agents_delete(
    state: tauri::State<'_, super::AgentsState>,
    short_id: String,
) -> Result<(), String> {
    let login = ready(&state)?;
    blocking(move || delete(&cli(&login)?, &home_dir(), &short_id)).await
}

#[tauri::command]
pub async fn agents_switch_model(
    state: tauri::State<'_, super::AgentsState>,
    session_id: String,
    model: String,
) -> Result<String, String> {
    let login = ready(&state)?;
    let cache = state.cached();
    let app_dir = state.app_dir.clone();
    blocking(move || {
        let cli = cli(&login)?;
        let agent = find_agent_cached(&cli, &cache, &session_id)?;
        switch_model(&cli, &home_dir(), &agent, &model, &app_dir)
    })
    .await
}

#[tauri::command]
pub async fn agents_dismiss(
    state: tauri::State<'_, super::AgentsState>,
    session_id: String,
) -> Result<(), String> {
    switched_on(&state)?;
    dismiss(&state.app_dir, &session_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeCli {
        calls: Mutex<Vec<(Vec<String>, PathBuf)>>,
        replies: Mutex<Vec<CliOutput>>,
    }

    impl FakeCli {
        fn new(replies: Vec<CliOutput>) -> Self {
            Self {
                calls: Mutex::new(vec![]),
                replies: Mutex::new(replies.into_iter().rev().collect()),
            }
        }
        fn calls(&self) -> Vec<(Vec<String>, PathBuf)> {
            self.calls.lock().unwrap().clone()
        }
    }

    impl Cli for FakeCli {
        fn run(&self, a: &[String], cwd: &Path) -> CliOutput {
            self.calls.lock().unwrap().push((a.to_vec(), cwd.to_path_buf()));
            self.replies.lock().unwrap().pop().expect("unscripted call")
        }
    }

    fn ok(stdout: &str) -> CliOutput {
        CliOutput { code: 0, stdout: stdout.into(), stderr: String::new() }
    }
    fn fail(stderr: &str) -> CliOutput {
        CliOutput { code: 1, stdout: String::new(), stderr: stderr.into() }
    }

    const SID: &str = "00000000-1111-2222-3333-444444444444";

    fn agent(kind: Kind) -> Agent {
        let json = format!(
            r#"[{{"sessionId":"{SID}","id":"0a1b2c3d","name":"worker","cwd":"/work/proj","kind":"{}"}}]"#,
            if kind == Kind::Background { "bg" } else { "interactive" }
        );
        parse_agents(&json).unwrap().remove(0)
    }

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("sm-actions-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn trusted() -> Vec<String> {
        vec!["/work/proj".to_string()]
    }

    #[test]
    fn start_builds_argv() {
        let cli = FakeCli::new(vec![ok("backgrounded · 0a1b2c3d\n")]);
        start(&cli, &trusted(), "/work/proj/", "do it", "opus", "job").unwrap();
        let calls = cli.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, args(&["--bg", "--model", "opus", "--name", "job", "do it"]));
        assert_eq!(calls[0].1, PathBuf::from("/work/proj/"));
    }

    #[test]
    fn start_refuses_untrusted_folder() {
        let cli = FakeCli::new(vec![]);
        assert!(start(&cli, &trusted(), "/elsewhere", "t", "opus", "job").is_err());
        assert!(cli.calls().is_empty());
    }

    #[test]
    fn start_refuses_bad_model_name_task() {
        let cli = FakeCli::new(vec![]);
        assert!(start(&cli, &trusted(), "/work/proj", "t", "gpt", "job").is_err());
        assert!(start(&cli, &trusted(), "/work/proj", "t", "opus", "-job").is_err());
        assert!(start(&cli, &trusted(), "/work/proj", "-t", "opus", "job").is_err());
        assert!(start(&cli, &trusted(), "/work/proj", "  ", "opus", "job").is_err());
        assert!(cli.calls().is_empty());
    }

    #[test]
    fn start_parses_short_id() {
        let cli =
            FakeCli::new(vec![ok("note: x\nbackgrounded · 11111111\nbackgrounded · 0a1b2c3d\n")]);
        assert_eq!(start(&cli, &trusted(), "/work/proj", "t", "opus", "job").unwrap(), "0a1b2c3d");
        let cli = FakeCli::new(vec![ok("nothing\n")]);
        assert!(start(&cli, &trusted(), "/work/proj", "t", "opus", "job").is_err());
        let cli = FakeCli::new(vec![ok("Workspace not trusted: /work/proj\n")]);
        assert!(start(&cli, &trusted(), "/work/proj", "t", "opus", "job")
            .unwrap_err()
            .contains("not trusted"));
    }

    #[test]
    fn stop_requires_confirmation_text() {
        let home = Path::new("/home/x");
        let cli = FakeCli::new(vec![ok("stopped 0a1b2c3d\n"), ok("whatever\n"), fail("boom\nmore")]);
        stop(&cli, home, "0a1b2c3d").unwrap();
        assert_eq!(cli.calls()[0], (args(&["stop", "0a1b2c3d"]), home.to_path_buf()));
        assert!(stop(&cli, home, "0a1b2c3d").is_err());
        assert_eq!(stop(&cli, home, "0a1b2c3d").unwrap_err(), "boom");
        assert!(stop(&cli, home, "nope").is_err());
        assert_eq!(cli.calls().len(), 3);
    }

    #[test]
    fn delete_runs_rm() {
        let home = Path::new("/home/x");
        let cli = FakeCli::new(vec![ok("removed 0a1b2c3d\n")]);
        delete(&cli, home, "0a1b2c3d").unwrap();
        assert_eq!(cli.calls()[0].0, args(&["rm", "0a1b2c3d"]));
    }

    #[test]
    fn copies_show_the_conversation_they_continue() {
        let mut copies = BTreeMap::new();
        copies.insert("bbbbbbbb".to_string(), CopyOf { session_id: "aaaaaaaa-1".into(), model: "opus".into() });
        copies.insert("cccccccc".to_string(), CopyOf { session_id: "bbbbbbbb-2".into(), model: "haiku".into() });
        let has = |s: &str| s == "aaaaaaaa-1";
        // A copy of a copy, neither with a transcript yet: the original's.
        assert_eq!(transcript_session("cccccccc-3", &copies, &has), "aaaaaaaa-1");
        // A copy that has its own transcript keeps it.
        assert_eq!(transcript_session("cccccccc-3", &copies, &|s| s == "cccccccc-3"), "cccccccc-3");
        // Not a copy: itself, even without a transcript.
        assert_eq!(transcript_session("dddddddd-4", &copies, &has), "dddddddd-4");
    }

    #[test]
    fn switch_model_records_link() {
        let dir = tmp("link");
        let home = Path::new("/home/x");
        let cli =
            FakeCli::new(vec![ok("stopped 0a1b2c3d\n"), ok("note: old\nbackgrounded · 99999999\n")]);
        let id = switch_model(&cli, home, &agent(Kind::Background), "haiku", &dir).unwrap();
        assert_eq!(id, "99999999");
        let calls = cli.calls();
        assert_eq!(calls[0], (args(&["stop", "0a1b2c3d"]), home.to_path_buf()));
        assert_eq!(
            calls[1],
            (
                args(&["--resume", SID, "--bg", "--model", "haiku", "--name", "worker"]),
                PathBuf::from("/work/proj")
            )
        );
        assert_eq!(read_state(&dir).links.get(SID).map(String::as_str), Some("99999999"));
        assert_eq!(
            read_state(&dir).copies.get("99999999"),
            Some(&CopyOf { session_id: SID.into(), model: "haiku".into() })
        );
    }

    #[test]
    fn switch_model_resume_failure_leaves_old_stopped() {
        let dir = tmp("fail");
        let cli =
            FakeCli::new(vec![ok("stopped 0a1b2c3d\n"), fail("Workspace not trusted: /work/proj\nx")]);
        let err = switch_model(&cli, Path::new("/h"), &agent(Kind::Background), "haiku", &dir)
            .unwrap_err();
        assert!(err.starts_with("Stopped the old agent"), "{err}");
        assert_eq!(cli.calls().len(), 2);
        assert!(read_state(&dir).links.is_empty());
        assert!(!dir.join(STATE_FILE).exists());
    }

    fn timeout() -> CliOutput {
        CliOutput { code: -1, stdout: String::new(), stderr: "timed out".into() }
    }

    /// A listing: (short id, name, cwd, startedAt).
    fn listing(rows: &[(&str, &str, &str, i64)]) -> CliOutput {
        let rows: Vec<String> = rows
            .iter()
            .map(|(id, name, cwd, at)| {
                format!(
                    r#"{{"id":"{id}","sessionId":"{id}-0000-0000-0000-000000000000","name":"{name}","cwd":"{cwd}","kind":"background","startedAt":{at}}}"#
                )
            })
            .collect();
        ok(&format!("[{}]", rows.join(",")))
    }

    #[test]
    fn start_timeout_finds_the_agent_by_name() {
        let now = now_ms();
        let cli = FakeCli::new(vec![
            timeout(),
            listing(&[
                ("11111111", "job", "/work/proj", now - 3_600_000), // an older one, same name
                ("22222222", "other", "/work/proj", now + 500),
                ("33333333", "job", "/elsewhere", now + 500),
                ("44444444", "job", "/work/proj", now + 800),
            ]),
        ]);
        assert_eq!(start(&cli, &trusted(), "/work/proj/", "t", "opus", "job").unwrap(), "44444444");
        assert_eq!(cli.calls()[1].0, args(&["agents", "--json", "--all"]));
    }

    #[test]
    fn start_timeout_without_the_agent_says_so() {
        let now = now_ms();
        let old = listing(&[("11111111", "job", "/work/proj", now - 60_000)]);
        let cli = FakeCli::new(vec![timeout(), old]);
        let err = start(&cli, &trusted(), "/work/proj", "t", "opus", "job").unwrap_err();
        assert_eq!(err, START_TIMED_OUT);
        // A plain failure is not looked up.
        let cli = FakeCli::new(vec![fail("boom")]);
        assert_eq!(start(&cli, &trusted(), "/work/proj", "t", "opus", "job").unwrap_err(), "boom");
        assert_eq!(cli.calls().len(), 1);
    }

    #[test]
    fn switch_model_timeout_still_records_the_copy() {
        let dir = tmp("switch-timeout");
        let now = now_ms();
        let cli = FakeCli::new(vec![
            ok("stopped 0a1b2c3d\n"),
            timeout(),
            listing(&[
                ("0a1b2c3d", "worker", "/work/proj", now - 1_000),
                ("99999999", "worker", "/work/proj", now + 900),
            ]),
        ]);
        let id = switch_model(&cli, Path::new("/h"), &agent(Kind::Background), "haiku", &dir).unwrap();
        assert_eq!(id, "99999999", "the old agent, even if listed as new, is never the copy");
        assert_eq!(read_state(&dir).links.get(SID).map(String::as_str), Some("99999999"));
        assert_eq!(
            read_state(&dir).copies.get("99999999"),
            Some(&CopyOf { session_id: SID.into(), model: "haiku".into() })
        );
        // Not found: the switch reports it, and records nothing.
        let dir = tmp("switch-timeout-missing");
        let cli = FakeCli::new(vec![ok("stopped 0a1b2c3d\n"), timeout(), listing(&[])]);
        let err = switch_model(&cli, Path::new("/h"), &agent(Kind::Background), "haiku", &dir)
            .unwrap_err();
        assert!(err.starts_with("Stopped the old agent") && err.contains("took too long"), "{err}");
        assert!(read_state(&dir).copies.is_empty());
    }

    #[test]
    fn switch_model_refuses_interactive() {
        let dir = tmp("inter");
        let cli = FakeCli::new(vec![]);
        assert!(
            switch_model(&cli, Path::new("/h"), &agent(Kind::Interactive), "haiku", &dir).is_err()
        );
        assert!(switch_model(&cli, Path::new("/h"), &agent(Kind::Background), "gpt", &dir).is_err());
        assert!(cli.calls().is_empty());
    }

    #[test]
    fn dismiss_is_idempotent() {
        let dir = tmp("dismiss");
        dismiss(&dir, SID).unwrap();
        dismiss(&dir, SID).unwrap();
        assert_eq!(read_state(&dir).dismissed, vec![SID.to_string()]);
        assert!(dismiss(&dir, "../x").is_err());
    }

    #[test]
    fn corrupt_state_file_is_kept_as_bak() {
        let dir = tmp("corrupt");
        std::fs::write(dir.join(STATE_FILE), "{\"dismissed\": [tru").unwrap();
        assert_eq!(read_state(&dir), AgentsStateFile::default());
        let bak = dir.join(format!("{STATE_FILE}.bak"));
        assert_eq!(std::fs::read_to_string(&bak).unwrap(), "{\"dismissed\": [tru");
        assert!(!dir.join(STATE_FILE).exists());
        // Writing starts a new file and leaves the copy alone; so does a corrupt file met by a write.
        dismiss(&dir, SID).unwrap();
        assert_eq!(read_state(&dir).dismissed, vec![SID.to_string()]);
        std::fs::write(dir.join(STATE_FILE), "garbage").unwrap();
        dismiss(&dir, SID).unwrap();
        assert_eq!(std::fs::read_to_string(&bak).unwrap(), "garbage");
        assert_eq!(read_state(&dir).dismissed, vec![SID.to_string()]);
        // A missing file is simply empty: nothing to keep.
        let empty = tmp("corrupt-missing");
        assert_eq!(read_state(&empty), AgentsStateFile::default());
        assert!(!empty.join(format!("{STATE_FILE}.bak")).exists());
    }

    #[test]
    fn find_agent_by_session_id() {
        let json = format!(r#"[{{"sessionId":"{SID}","id":"0a1b2c3d","kind":"bg"}}]"#);
        let cli = FakeCli::new(vec![ok(&json), ok(&json), fail("down")]);
        assert_eq!(find_agent(&cli, SID).unwrap().session_id, SID);
        assert!(find_agent(&cli, "11111111-1111-1111-1111-111111111111").is_err());
        assert_eq!(cli.calls()[0].0, args(&["agents", "--json", "--all"]));
        assert!(fetch_agents(&cli).is_err());
    }

    #[test]
    fn find_agent_cached_asks_cli_only_on_miss() {
        let json = format!(r#"[{{"sessionId":"{SID}","id":"0a1b2c3d","kind":"bg"}}]"#);
        let cli = FakeCli::new(vec![ok(&json)]);
        let cached = parse_agents(&json).unwrap();
        assert_eq!(find_agent_cached(&cli, &cached, SID).unwrap().session_id, SID);
        assert!(cli.calls().is_empty());
        assert_eq!(find_agent_cached(&cli, &[], SID).unwrap().session_id, SID);
        assert_eq!(cli.calls().len(), 1);
        assert!(find_agent_cached(&cli, &cached, "../x").is_err());
    }
}
