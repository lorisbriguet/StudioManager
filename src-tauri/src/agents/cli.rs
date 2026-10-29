//! Agents settings file, locating `claude`, and running the CLI.

use crate::agent_access::write_atomic;
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{mpsc, Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

const READER_GRACE: Duration = Duration::from_millis(500);
const CLAUDE_MARK: &str = "__SM_CLAUDE__=";
const PATH_MARK: &str = "__SM_PATH__=";
const ENV_MARK: &str = "__SM_ENV__\n";
const ENV_END: &str = "\n__SM_ENV_END__";
/// Fixed lookup script; marker lines survive rc-file noise around them. The environment
/// comes last, NUL-separated (`env -0`) so values with newlines stay whole; only the
/// variables `passes_through` allows are kept from it.
const LOOKUP_SCRIPT: &str = r#"printf "__SM_CLAUDE__=%s\n__SM_PATH__=%s\n" "$(command -v claude)" "$PATH"; printf "__SM_ENV__\n"; env -0; printf "\n__SM_ENV_END__\n""#;

pub const SETTINGS_FILE: &str = "agents.json";
const CLI_TIMEOUT: Duration = Duration::from_secs(10);
/// `claude --bg` (start, or `--resume` for a model switch) returns once the agent is
/// backgrounded, which can take far longer than a listing on a cold start.
const START_TIMEOUT: Duration = Duration::from_secs(60);
/// Appended to `stderr` when the CLI was killed for taking too long.
const TIMED_OUT: &str = "timed out";

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
    /// Claude Code's `statusLine` before StudioManager's replaced it, restored on removal.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_status_line: Option<serde_json::Value>,
}

impl Default for AgentsSettings {
    fn default() -> Self {
        Self { enabled: false, menu_bar: false, limit_alerts: true, previous_status_line: None }
    }
}

/// The menu bar is part of the Agents feature: it cannot be on while Agents is off.
pub fn can_enable_menu_bar(s: &AgentsSettings) -> bool {
    s.enabled
}

/// Serialises every read-modify-write of `agents.json` and the menu bar icon's check-then-build
/// that follows a change (`menubar::sync_tray` takes the guard as proof): two quick toggles
/// can't lose a write or leave an icon and a panel behind while `menuBar` is false.
static SETTINGS_LOCK: Mutex<()> = Mutex::new(());

/// Held while `agents.json` is changed and the menu bar follows it.
pub struct SettingsGuard(#[allow(dead_code)] MutexGuard<'static, ()>);

/// Never take it on the main thread while a command may hold it: building the menu bar icon
/// waits for the main thread.
pub fn lock_settings() -> SettingsGuard {
    SettingsGuard(SETTINGS_LOCK.lock().unwrap_or_else(|e| e.into_inner()))
}

/// Read `agents.json`, change it, write it back, under the settings lock. Nothing is written
/// when `change` fails.
pub fn update_settings<R>(
    dir: &Path,
    change: impl FnOnce(&mut AgentsSettings) -> Result<R, String>,
) -> Result<R, String> {
    let _held = lock_settings();
    let mut s = read_settings(dir);
    let out = change(&mut s)?;
    write_settings(dir, &s)?;
    Ok(out)
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
    /// Claude Code's own settings, API and proxy variables (`passes_through`), from the login
    /// shell: the app started from Finder does not have the user's exports.
    pub vars: Vec<(String, String)>,
}

/// Variables of a Claude Code session that started StudioManager (in development, from a
/// Claude Code terminal): they belong to that session, not to the agents the app runs.
/// `CLAUDE_CODE_CHILD_SESSION`, for one, turns transcript saving off.
const SESSION_VARS: &[&str] = &[
    "CLAUDE_PID",
    "CLAUDE_JOB_DIR",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_EXECPATH",
    "CLAUDE_CODE_SSE_PORT",
];
const SESSION_PREFIXES: &[&str] =
    &["CLAUDE_CODE_SESSION_", "CLAUDE_CODE_MESSAGING_", "CLAUDE_CODE_BRIDGE_"];

/// Kept besides `PATH`, `HOME`, `USER`, `LANG` and `TERM`: `CLAUDE_*` (`CLAUDE_CONFIG_DIR`, …)
/// and `ANTHROPIC_*`, so the agents see the same config and auth as in a terminal, and the
/// proxy variables (`HTTPS_PROXY`, `no_proxy`, …). Session markers excepted.
pub fn passes_through(key: &str) -> bool {
    let ours = key.starts_with("CLAUDE_") || key.starts_with("ANTHROPIC_");
    let proxy = key.ends_with("_PROXY") || key.ends_with("_proxy");
    let session =
        SESSION_VARS.contains(&key) || SESSION_PREFIXES.iter().any(|p| key.starts_with(p));
    (ours || proxy) && !session
}

/// The allowed variables of a `env -0` dump.
fn parse_env_dump(dump: &str) -> Vec<(String, String)> {
    dump.split('\0')
        .filter_map(|entry| entry.split_once('='))
        .filter(|(k, _)| passes_through(k))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

/// Parse what the lookup script prints: `command -v claude`, then `$PATH`, then the
/// environment. An empty first line means claude was not found.
pub fn parse_login_output(out: &str) -> LoginEnv {
    let (lines, vars) = match out.split_once(ENV_MARK) {
        Some((head, rest)) => {
            let dump = rest.split_once(ENV_END).map_or(rest, |(d, _)| d);
            (head, parse_env_dump(dump))
        }
        None => (out, Vec::new()),
    };
    let mut claude = None;
    let mut path = "";
    for line in lines.lines() {
        if let Some(v) = line.strip_prefix(CLAUDE_MARK) {
            claude = Some(v.trim()).filter(|v| !v.is_empty());
        } else if let Some(v) = line.strip_prefix(PATH_MARK) {
            path = v.trim();
        }
    }
    LoginEnv { claude: claude.map(PathBuf::from), path: path.to_string(), vars }
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
    if env.vars.is_empty() {
        env.vars = std::env::vars().filter(|(k, _)| passes_through(k)).collect();
    }
    if env.claude.as_deref().map_or(true, |p| !p.is_file()) {
        let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
        env.claude = fallback_claude(&home, &|p| p.is_file());
    }
    env
}

/// `PATH` from the login shell, a minimal set of other variables, and the login shell's
/// Claude, Anthropic and proxy variables (`passes_through`). Everything else is cleared.
pub fn spawn_env(env: &LoginEnv) -> Vec<(String, String)> {
    let var = |k: &str| std::env::var(k).unwrap_or_default();
    let mut vars: Vec<(String, String)> = vec![
        ("PATH".into(), env.path.clone()),
        ("HOME".into(), var("HOME")),
        ("USER".into(), var("USER")),
        ("LANG".into(), std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".into())),
        ("TERM".into(), "xterm-256color".into()),
    ];
    vars.extend(env.vars.iter().filter(|(k, _)| passes_through(k)).cloned());
    vars
}

#[derive(Clone, Debug, PartialEq)]
pub struct CliOutput {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

pub trait Cli: Send + Sync {
    fn run(&self, args: &[String], cwd: &Path) -> CliOutput;
    /// `run` for `claude --bg`, with the longer start timeout.
    fn run_start(&self, args: &[String], cwd: &Path) -> CliOutput {
        self.run(args, cwd)
    }
}

/// The CLI was killed at its timeout: what it was doing may still be happening.
pub fn timed_out(o: &CliOutput) -> bool {
    o.code == -1 && o.stderr.ends_with(TIMED_OUT)
}

pub struct RealCli {
    pub claude: PathBuf,
    pub path_env: String,
    /// The login shell's passed-through variables (`LoginEnv::vars`).
    pub vars: Vec<(String, String)>,
}

impl Cli for RealCli {
    fn run(&self, args: &[String], cwd: &Path) -> CliOutput {
        self.run_for(args, cwd, CLI_TIMEOUT)
    }
    fn run_start(&self, args: &[String], cwd: &Path) -> CliOutput {
        self.run_for(args, cwd, START_TIMEOUT)
    }
}

impl RealCli {
    fn run_for(&self, args: &[String], cwd: &Path, timeout: Duration) -> CliOutput {
        let env = LoginEnv {
            claude: Some(self.claude.clone()),
            path: self.path_env.clone(),
            vars: self.vars.clone(),
        };
        let mut cmd = Command::new(&self.claude);
        cmd.args(args)
            .current_dir(cwd)
            .env_clear()
            .envs(spawn_env(&env))
            .stdin(Stdio::null());
        run_with_timeout(&mut cmd, timeout).unwrap_or_else(|| CliOutput {
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
        stderr.push_str(TIMED_OUT);
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
    Some(RealCli { claude, path_env: env.path.clone(), vars: env.vars.clone() })
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
        {
            let held = lock_settings();
            let mut s = read_settings(&app_dir);
            s.enabled = enabled;
            if !enabled {
                // The menu bar is part of Agents: it goes off with it, and so does start at login.
                s.menu_bar = false;
                // Disabling never fails (best effort).
                let _ = crate::menubar::set_autostart(&app, false);
            }
            write_settings(&app_dir, &s)?;
            if !enabled {
                crate::menubar::sync_tray(&app, false, &held);
            }
        }
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
        {
            let held = lock_settings();
            let mut s = read_settings(&app_dir);
            if on && !can_enable_menu_bar(&s) {
                return Err("Turn the Agents page on first".into());
            }
            // Start at login first: if macOS refuses it, nothing changes and the card says why.
            crate::menubar::set_autostart(&app, on)?;
            s.menu_bar = on;
            write_settings(&app_dir, &s)?;
            crate::menubar::sync_tray(&app, on, &held);
        }
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
        update_settings(&app_dir, |s| {
            s.limit_alerts = on;
            Ok(())
        })?;
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
    fn concurrent_updates_lose_nothing() {
        let d = tmp("concurrent");
        write_settings(&d, &AgentsSettings::default()).unwrap();
        // Each update reads a counter and writes it back plus one; another thread toggles the
        // menu bar in between. Without the lock, updates read the same value and some are lost.
        let threads: Vec<_> = (0..8)
            .map(|i| {
                let d = d.clone();
                std::thread::spawn(move || {
                    for _ in 0..25 {
                        update_settings(&d, |s| {
                            let n = s.previous_status_line.as_ref().and_then(|v| v.as_u64()).unwrap_or(0);
                            s.previous_status_line = Some(serde_json::json!(n + 1));
                            s.menu_bar = i % 2 == 0;
                            Ok(())
                        })
                        .unwrap();
                    }
                })
            })
            .collect();
        for t in threads {
            t.join().unwrap();
        }
        assert_eq!(read_settings(&d).previous_status_line, Some(serde_json::json!(200)));
        // A failed change writes nothing.
        let before = std::fs::read_to_string(d.join(SETTINGS_FILE)).unwrap();
        let r: Result<(), String> = update_settings(&d, |s| {
            s.enabled = true;
            Err("no".into())
        });
        assert_eq!(r.unwrap_err(), "no");
        assert_eq!(std::fs::read_to_string(d.join(SETTINGS_FILE)).unwrap(), before);
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
    fn parse_login_output_keeps_only_allowed_env() {
        let out = "noise\n__SM_CLAUDE__=/opt/x/claude\n__SM_PATH__=/usr/bin\n__SM_ENV__\n\
            HOME=/h\0CLAUDE_CONFIG_DIR=/h/.claude-work\0ANTHROPIC_BASE_URL=https://gw\0\
            SECRET_TOKEN=x\0HTTPS_PROXY=http://p:3128\0no_proxy=localhost\0\
            MULTI=a\n__SM_PATH__=/evil\0CLAUDE_CODE_CHILD_SESSION=1\0\
            \n__SM_ENV_END__\nbye\n";
        let e = parse_login_output(out);
        assert_eq!(e.claude, Some(PathBuf::from("/opt/x/claude")));
        assert_eq!(e.path, "/usr/bin", "a value in the dump cannot pass for a marker line");
        let keys: Vec<&str> = e.vars.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(keys, ["CLAUDE_CONFIG_DIR", "ANTHROPIC_BASE_URL", "HTTPS_PROXY", "no_proxy"]);
        assert_eq!(e.vars[0].1, "/h/.claude-work");
    }

    #[test]
    fn env_allowlist() {
        for k in ["CLAUDE_CONFIG_DIR", "CLAUDE_CODE_USE_BEDROCK", "ANTHROPIC_API_KEY", "HTTP_PROXY",
            "https_proxy", "ALL_PROXY", "NO_PROXY", "no_proxy"]
        {
            assert!(passes_through(k), "{k}");
        }
        for k in ["PATH", "SECRET", "CLAUDECODE", "CLAUDE_PID", "CLAUDE_CODE_CHILD_SESSION",
            "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDE_CODE_ENTRYPOINT",
            "DYLD_INSERT_LIBRARIES", "PROXY"]
        {
            assert!(!passes_through(k), "{k}");
        }
    }

    #[test]
    fn spawn_env_adds_allowed_login_vars() {
        let env = LoginEnv {
            claude: None,
            path: "/login/bin".into(),
            vars: vec![
                ("CLAUDE_CONFIG_DIR".into(), "/h/.c".into()),
                ("HTTPS_PROXY".into(), "http://p".into()),
                ("NODE_OPTIONS".into(), "--require /x".into()),
            ],
        };
        let vars = spawn_env(&env);
        let get = |k: &str| vars.iter().find(|(n, _)| n == k).map(|(_, v)| v.clone());
        assert_eq!(get("CLAUDE_CONFIG_DIR").as_deref(), Some("/h/.c"));
        assert_eq!(get("HTTPS_PROXY").as_deref(), Some("http://p"));
        assert_eq!(get("NODE_OPTIONS"), None, "only the allowlist");
        assert_eq!(vars.len(), 7);
    }

    #[test]
    fn spawn_env_uses_login_path() {
        let env = LoginEnv { claude: None, path: "/login/bin:/other".into(), vars: vec![] };
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
        assert!(timed_out(&o));
        let mut c = Command::new("/bin/sh");
        c.args(["-c", "echo boom >&2; exit 1"]);
        assert!(!timed_out(&run_with_timeout(&mut c, Duration::from_secs(5)).unwrap()));
        assert!(t.elapsed() < Duration::from_secs(3));
    }
}
