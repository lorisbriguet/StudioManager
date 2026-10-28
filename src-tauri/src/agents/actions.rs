//! Start, stop, delete, switch model and dismiss: the write side of Agents.

use super::cli::{read_settings, Cli, CliOutput};
use super::model::{parse_agents, Agent, Kind};
use super::projects::read_trusted;
use super::validate::{valid_model, valid_name, valid_short_id, valid_task};
use crate::agent_access::write_atomic;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const STATE_FILE: &str = "agents-state.json";
const OFF: &str = "Agents are switched off";

/// `agents-state.json`: dismissed prompts and old session id -> new short id.
#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct AgentsStateFile {
    pub dismissed: Vec<String>,
    pub links: BTreeMap<String, String>,
}

pub fn read_state(dir: &Path) -> AgentsStateFile {
    std::fs::read_to_string(dir.join(STATE_FILE))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_state(dir: &Path, s: &AgentsStateFile) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    let json = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    write_atomic(&dir.join(STATE_FILE), &format!("{json}\n"))
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
        .last()
}

fn trim_slash(s: &str) -> &str {
    s.trim_end_matches('/')
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
    let out = cli.run(&args(&["--bg", "--model", model, "--name", name, task]), Path::new(folder));
    if let Some(l) = not_trusted_line(&out) {
        return Err(l);
    }
    last_backgrounded_id(&out.stdout)
        .ok_or_else(|| first_error_line(&out, "Failed to start the agent"))
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
    let out = cli.run(
        &args(&["--resume", &agent.session_id, "--bg", "--model", model, "--name", name]),
        Path::new(&agent.cwd),
    );
    let new_id = match not_trusted_line(&out) {
        Some(l) => Err(l),
        None => last_backgrounded_id(&out.stdout)
            .ok_or_else(|| first_error_line(&out, "unknown error")),
    }
    .map_err(|e| format!("Stopped the old agent; starting the copy failed: {e}"))?;
    // Best effort: the copy already runs, so a bookkeeping failure is not a failed switch.
    let mut st = read_state(state_dir);
    st.links.insert(agent.session_id.clone(), new_id.clone());
    let _ = write_state(state_dir, &st);
    Ok(new_id)
}

pub fn dismiss(state_dir: &Path, session_id: &str) -> Result<(), String> {
    if !valid_session_id(session_id) {
        return Err("Invalid session id".into());
    }
    let mut st = read_state(state_dir);
    if !st.dismissed.iter().any(|s| s == session_id) {
        st.dismissed.push(session_id.to_string());
        write_state(state_dir, &st)?;
    }
    Ok(())
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

pub(super) fn ready(state: &super::AgentsState) -> Result<super::cli::RealCli, String> {
    switched_on(state)?;
    state.real_cli().ok_or_else(|| "claude not found".to_string())
}

#[tauri::command]
pub async fn agents_start(
    state: tauri::State<'_, super::AgentsState>,
    folder: String,
    task: String,
    model: String,
    name: String,
) -> Result<String, String> {
    let cli = ready(&state)?;
    start(&cli, &read_trusted(&home_dir()), &folder, &task, &model, &name)
}

#[tauri::command]
pub async fn agents_stop(
    state: tauri::State<'_, super::AgentsState>,
    short_id: String,
) -> Result<(), String> {
    let cli = ready(&state)?;
    stop(&cli, &home_dir(), &short_id)
}

#[tauri::command]
pub async fn agents_delete(
    state: tauri::State<'_, super::AgentsState>,
    short_id: String,
) -> Result<(), String> {
    let cli = ready(&state)?;
    delete(&cli, &home_dir(), &short_id)
}

#[tauri::command]
pub async fn agents_switch_model(
    state: tauri::State<'_, super::AgentsState>,
    session_id: String,
    model: String,
) -> Result<String, String> {
    let cli = ready(&state)?;
    let agent = find_agent(&cli, &session_id)?;
    switch_model(&cli, &home_dir(), &agent, &model, &state.app_dir)
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
    use std::sync::Mutex;

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
    fn find_agent_by_session_id() {
        let json = format!(r#"[{{"sessionId":"{SID}","id":"0a1b2c3d","kind":"bg"}}]"#);
        let cli = FakeCli::new(vec![ok(&json), ok(&json), fail("down")]);
        assert_eq!(find_agent(&cli, SID).unwrap().session_id, SID);
        assert!(find_agent(&cli, "11111111-1111-1111-1111-111111111111").is_err());
        assert_eq!(cli.calls()[0].0, args(&["agents", "--json", "--all"]));
        assert!(fetch_agents(&cli).is_err());
    }
}
