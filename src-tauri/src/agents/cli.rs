//! Agents settings file, locating `claude`, and running the CLI.

use crate::agent_access::write_atomic;
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

const READER_GRACE: Duration = Duration::from_millis(500);
const CLAUDE_MARK: &str = "__SM_CLAUDE__=";
const PATH_MARK: &str = "__SM_PATH__=";
/// Fixed lookup script; marker lines survive rc-file noise around them.
const LOOKUP_SCRIPT: &str =
    r#"printf "__SM_CLAUDE__=%s\n__SM_PATH__=%s\n" "$(command -v claude)" "$PATH""#;

pub const SETTINGS_FILE: &str = "agents.json";
const CLI_TIMEOUT: Duration = Duration::from_secs(10);

/// `agents.json`: the app-wide switches. Missing or unreadable = everything off (limit
/// alerts on, but they only matter once the menu bar is).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentsSettings {
    pub enabled: bool,
    /// Menu bar icon + panel; the app keeps running when its window is closed. Needs `enabled`.
    pub menu_bar: bool,
    /// Notifications when a usage window nears its limit.
    pub limit_alerts: bool,
}

impl Default for AgentsSettings {
    fn default() -> Self {
        Self { enabled: false, menu_bar: false, limit_alerts: true }
    }
}

/// The menu bar is part of the Agents feature: it cannot be on while Agents is off.
pub fn can_enable_menu_bar(s: &AgentsSettings) -> bool {
    s.enabled
}

pub fn read_settings(dir: &Path) -> AgentsSettings {
    std::fs::read_to_string(dir.join(SETTINGS_FILE))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn write_settings(dir: &Path, s: &AgentsSettings) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    let json = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    write_atomic(&dir.join(SETTINGS_FILE), &format!("{json}\n"))
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct LoginEnv {
    pub claude: Option<PathBuf>,
    pub path: String,
}

/// Parse the two lines printed by the lookup script: `command -v claude`,
/// then `$PATH`. An empty first line means claude was not found.
pub fn parse_login_output(out: &str) -> LoginEnv {
    let mut claude = None;
    let mut path = "";
    for line in out.lines() {
        if let Some(v) = line.strip_prefix(CLAUDE_MARK) {
            claude = Some(v.trim()).filter(|v| !v.is_empty());
        } else if let Some(v) = line.strip_prefix(PATH_MARK) {
            path = v.trim();
        }
    }
    LoginEnv { claude: claude.map(PathBuf::from), path: path.to_string() }
}

/// First existing well-known install location.
pub fn fallback_claude(home: &Path, exists: &dyn Fn(&Path) -> bool) -> Option<PathBuf> {
    [
        home.join(".local/bin/claude"),
        home.join(".claude/local/claude"),
        PathBuf::from("/opt/homebrew/bin/claude"),
        PathBuf::from("/usr/local/bin/claude"),
    ]
    .into_iter()
    .find(|p| exists(p))
}

/// The shell used for the lookup: the user's own if zsh or bash, else zsh.
fn lookup_shell(shell_var: Option<&str>) -> &'static str {
    match shell_var {
        Some("/bin/bash") => "/bin/bash",
        _ => "/bin/zsh",
    }
}

/// The one shell invocation of the feature: a fixed script in a login shell,
/// so the app (started from Finder) sees the user's real `PATH`.
pub fn resolve_login_env() -> LoginEnv {
    let shell = lookup_shell(std::env::var("SHELL").ok().as_deref());
    let output = run_with_timeout(
        Command::new(shell)
            .args(["-lic", LOOKUP_SCRIPT])
            .stdin(Stdio::null()),
        CLI_TIMEOUT,
    );
    let mut env = match output {
        Some(o) if o.code == 0 => parse_login_output(&o.stdout),
        _ => LoginEnv::default(),
    };
    if env.path.is_empty() {
        env.path = std::env::var("PATH").unwrap_or_default();
    }
    if env.claude.as_deref().map_or(true, |p| !p.is_file()) {
        let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
        env.claude = fallback_claude(&home, &|p| p.is_file());
    }
    env
}

/// `PATH` from the login shell, plus a minimal set of other variables.
pub fn spawn_env(env: &LoginEnv) -> Vec<(String, String)> {
    let var = |k: &str| std::env::var(k).unwrap_or_default();
    vec![
        ("PATH".into(), env.path.clone()),
        ("HOME".into(), var("HOME")),
        ("USER".into(), var("USER")),
        ("LANG".into(), std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".into())),
        ("TERM".into(), "xterm-256color".into()),
    ]
}

#[derive(Clone, Debug, PartialEq)]
pub struct CliOutput {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

pub trait Cli: Send + Sync {
    fn run(&self, args: &[String], cwd: &Path) -> CliOutput;
}

pub struct RealCli {
    pub claude: PathBuf,
    pub path_env: String,
}

impl Cli for RealCli {
    fn run(&self, args: &[String], cwd: &Path) -> CliOutput {
        let env = LoginEnv { claude: Some(self.claude.clone()), path: self.path_env.clone() };
        let mut cmd = Command::new(&self.claude);
        cmd.args(args)
            .current_dir(cwd)
            .env_clear()
            .envs(spawn_env(&env))
            .stdin(Stdio::null());
        run_with_timeout(&mut cmd, CLI_TIMEOUT).unwrap_or_else(|| CliOutput {
            code: -1,
            stdout: String::new(),
            stderr: "failed to start claude".into(),
        })
    }
}

/// Run to completion; kill the child after `timeout` (code -1). None when the
/// process cannot be started.
fn run_with_timeout(cmd: &mut Command, timeout: Duration) -> Option<CliOutput> {
    let mut child = cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().ok()?;
    let out = child.stdout.take()?;
    let err = child.stderr.take()?;
    let (out_buf, out_done) = drain(out);
    let (err_buf, err_done) = drain(err);
    let start = Instant::now();
    let mut timed_out = false;
    let code = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code().unwrap_or(-1),
            Ok(None) if start.elapsed() >= timeout => {
                timed_out = true;
                let _ = child.kill();
                let _ = child.wait();
                break -1;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(_) => break -1,
        }
    };
    // A grandchild may keep the pipes open: give the readers a short grace
    // period, then return what was collected (the threads end at EOF).
    let deadline = Instant::now() + READER_GRACE;
    let _ = out_done.recv_timeout(deadline.saturating_duration_since(Instant::now()));
    let _ = err_done.recv_timeout(deadline.saturating_duration_since(Instant::now()));
    let text = |b: &Arc<Mutex<Vec<u8>>>| {
        String::from_utf8_lossy(&b.lock().unwrap_or_else(|e| e.into_inner())).into_owned()
    };
    let stdout = text(&out_buf);
    let mut stderr = text(&err_buf);
    if timed_out {
        stderr.push_str("timed out");
    }
    Some(CliOutput { code, stdout, stderr })
}

/// Read a pipe on a thread into a shared buffer; the channel fires at EOF.
fn drain<R: Read + Send + 'static>(mut r: R) -> (Arc<Mutex<Vec<u8>>>, mpsc::Receiver<()>) {
    let buf = Arc::new(Mutex::new(Vec::new()));
    let (tx, rx) = mpsc::channel();
    let shared = buf.clone();
    std::thread::spawn(move || {
        let mut chunk = [0u8; 4096];
        while let Ok(n) = r.read(&mut chunk) {
            if n == 0 {
                break;
            }
            shared.lock().unwrap_or_else(|e| e.into_inner()).extend_from_slice(&chunk[..n]);
        }
        let _ = tx.send(());
    });
    (buf, rx)
}

// ---------------------------------------------------------------- commands

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentsInfo {
    pub enabled: bool,
    pub menu_bar: bool,
    pub limit_alerts: bool,
    pub claude_path: Option<String>,
}

/// A runner for `claude` from the cached login environment, or None when it cannot be found.
/// The first call runs the login-shell lookup.
pub fn real_cli(login: &super::pty::LoginCache) -> Option<RealCli> {
    let env = super::pty::cached_login_env(login);
    let claude = env.claude.clone()?;
    Some(RealCli { claude, path_env: env.path.clone() })
}

/// Runs the login-shell lookup (again, if `claude` was not found before): call it on a
/// blocking thread.
fn info(app_dir: &Path, login: &super::pty::LoginCache) -> AgentsInfo {
    let s = read_settings(app_dir);
    AgentsInfo {
        enabled: s.enabled,
        menu_bar: s.menu_bar,
        limit_alerts: s.limit_alerts,
        claude_path: super::pty::fresh_login_env(login)
            .claude
            .as_ref()
            .map(|p| p.display().to_string()),
    }
}

/// The switch only, for app startup: no login-shell lookup, so a switched-off feature runs
/// nothing.
#[tauri::command]
pub async fn agents_get_enabled(state: tauri::State<'_, super::AgentsState>) -> Result<bool, String> {
    Ok(read_settings(&state.app_dir).enabled)
}

/// The switch and the `claude` path, for the settings card. Exempt from the "switched off"
/// guard, like `agents_set_enabled`.
#[tauri::command]
pub async fn agents_get_settings(
    state: tauri::State<'_, super::AgentsState>,
) -> Result<AgentsInfo, String> {
    let (app_dir, login) = (state.app_dir.clone(), state.login_cache());
    super::pty::blocking(move || Ok(info(&app_dir, &login))).await
}

#[tauri::command]
pub async fn agents_set_enabled(
    app: tauri::AppHandle,
    state: tauri::State<'_, super::AgentsState>,
    enabled: bool,
) -> Result<AgentsInfo, String> {
    let (app_dir, login, hub) = (state.app_dir.clone(), state.login_cache(), state.hub.clone());
    super::pty::blocking(move || {
        if enabled && super::pty::fresh_login_env(&login).claude.is_none() {
            return Err("claude not found".into());
        }
        let mut s = read_settings(&app_dir);
        s.enabled = enabled;
        if !enabled {
            // The menu bar is part of Agents: it goes off with it, and so does start at login.
            s.menu_bar = false;
            crate::menubar::set_autostart(&app, false);
        }
        write_settings(&app_dir, &s)?;
        if !enabled {
            // Each panel still gets `agents:term-exit` from its reader thread.
            hub.close_all();
        }
        Ok(info(&app_dir, &login))
    })
    .await
}

/// Show or hide the menu bar part. Refuses to turn it on while Agents is off. Turning it on
/// also starts the app at login (hidden, with `--menubar`); turning it off stops that.
#[tauri::command]
pub async fn agents_set_menu_bar(
    app: tauri::AppHandle,
    state: tauri::State<'_, super::AgentsState>,
    on: bool,
) -> Result<AgentsInfo, String> {
    let (app_dir, login) = (state.app_dir.clone(), state.login_cache());
    super::pty::blocking(move || {
        let mut s = read_settings(&app_dir);
        if on && !can_enable_menu_bar(&s) {
            return Err("Turn the Agents page on first".into());
        }
        s.menu_bar = on;
        write_settings(&app_dir, &s)?;
        crate::menubar::set_autostart(&app, on);
        Ok(info(&app_dir, &login))
    })
    .await
}

#[tauri::command]
pub async fn agents_set_limit_alerts(
    state: tauri::State<'_, super::AgentsState>,
    on: bool,
) -> Result<AgentsInfo, String> {
    let (app_dir, login) = (state.app_dir.clone(), state.login_cache());
    super::pty::blocking(move || {
        let mut s = read_settings(&app_dir);
        s.limit_alerts = on;
        write_settings(&app_dir, &s)?;
        Ok(info(&app_dir, &login))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("sm-agents-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn settings_missing_file_is_off() {
        let d = tmp("missing");
        assert!(!read_settings(&d).enabled);
        std::fs::write(d.join(SETTINGS_FILE), "not json").unwrap();
        assert!(!read_settings(&d).enabled);
    }

    #[test]
    fn settings_round_trip() {
        let d = tmp("round");
        write_settings(&d, &AgentsSettings { enabled: true, ..Default::default() }).unwrap();
        assert!(read_settings(&d).enabled);
        write_settings(&d, &AgentsSettings { enabled: false, ..Default::default() }).unwrap();
        assert!(!read_settings(&d).enabled);
    }

    #[test]
    fn settings_default_menu_bar_off_alerts_on() {
        let s = AgentsSettings::default();
        assert!(!s.enabled);
        assert!(!s.menu_bar);
        assert!(s.limit_alerts);
    }

    #[test]
    fn menu_bar_needs_agents_on() {
        let on = AgentsSettings { enabled: true, ..Default::default() };
        let off = AgentsSettings { enabled: false, ..Default::default() };
        assert!(can_enable_menu_bar(&on));
        assert!(!can_enable_menu_bar(&off));
    }

    #[test]
    fn old_agents_json_without_new_keys_still_reads() {
        let d = tmp("old-json");
        std::fs::write(d.join(SETTINGS_FILE), "{\n  \"enabled\": true\n}\n").unwrap();
        let s = read_settings(&d);
        assert!(s.enabled);
        assert!(!s.menu_bar);
        assert!(s.limit_alerts);
    }

    #[test]
    fn parse_login_output_two_lines() {
        let e = parse_login_output("__SM_CLAUDE__=/opt/x/claude\n__SM_PATH__=/usr/bin:/opt/x\n");
        assert_eq!(e.claude, Some(PathBuf::from("/opt/x/claude")));
        assert_eq!(e.path, "/usr/bin:/opt/x");
    }

    #[test]
    fn parse_login_output_ignores_rc_noise() {
        let e = parse_login_output(
            "Welcome back\nnvm: using node\n__SM_CLAUDE__=/opt/x/claude\n__SM_PATH__=/usr/bin:/opt/x\nbye\n",
        );
        assert_eq!(e.claude, Some(PathBuf::from("/opt/x/claude")));
        assert_eq!(e.path, "/usr/bin:/opt/x");
        assert_eq!(parse_login_output("just noise\nmore\n"), LoginEnv::default());
    }

    #[test]
    fn run_returns_despite_grandchild_holding_pipes() {
        let mut c = Command::new("/bin/sh");
        c.args(["-c", "sleep 5 & echo hi"]);
        let t = Instant::now();
        let o = run_with_timeout(&mut c, Duration::from_secs(10)).unwrap();
        assert!(t.elapsed() < Duration::from_secs(3));
        assert_eq!(o.code, 0);
        assert_eq!(o.stdout.trim(), "hi");
    }

    #[test]
    fn parse_login_output_missing_claude() {
        let e = parse_login_output("__SM_CLAUDE__=\n__SM_PATH__=/usr/bin:/opt/x\n");
        assert_eq!(e.claude, None);
        assert_eq!(e.path, "/usr/bin:/opt/x");
    }

    #[test]
    fn spawn_env_uses_login_path() {
        let env = LoginEnv { claude: None, path: "/login/bin:/other".into() };
        let vars = spawn_env(&env);
        let get = |k: &str| vars.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone());
        assert_eq!(get("PATH").as_deref(), Some("/login/bin:/other"));
        assert_eq!(get("TERM").as_deref(), Some("xterm-256color"));
        assert!(get("HOME").is_some() && get("USER").is_some() && get("LANG").is_some());
    }

    #[test]
    fn fallback_picks_first_existing_candidate() {
        let home = Path::new("/h");
        assert_eq!(
            fallback_claude(home, &|p: &Path| p == Path::new("/usr/local/bin/claude")),
            Some(PathBuf::from("/usr/local/bin/claude"))
        );
        assert_eq!(
            fallback_claude(home, &|p: &Path| p.starts_with("/h") || p.starts_with("/opt")),
            Some(PathBuf::from("/h/.local/bin/claude"))
        );
        assert_eq!(fallback_claude(home, &|_| false), None);
    }

    #[test]
    fn lookup_shell_is_zsh_or_bash_only() {
        assert_eq!(lookup_shell(Some("/bin/bash")), "/bin/bash");
        assert_eq!(lookup_shell(Some("/bin/zsh")), "/bin/zsh");
        assert_eq!(lookup_shell(Some("/usr/bin/evil")), "/bin/zsh");
        assert_eq!(lookup_shell(None), "/bin/zsh");
    }

    #[test]
    fn run_times_out_and_kills() {
        let mut c = Command::new("/bin/sleep");
        c.arg("5");
        let t = Instant::now();
        let o = run_with_timeout(&mut c, Duration::from_millis(200)).unwrap();
        assert_eq!(o.code, -1);
        assert!(o.stderr.contains("timed out"));
        assert!(t.elapsed() < Duration::from_secs(3));
    }
}
