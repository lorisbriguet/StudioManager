//! Agent access, app side: the settings file the MCP server reads
//! (`agent-access.json`), its change log (`agent-log.jsonl`), installing the
//! server into Claude Desktop, and a `PRAGMA data_version` poller that emits
//! `db-changed` when another process (the agent) writes to the active
//! database.

use crate::ActiveOrgState;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

pub const ACCESS_FILE: &str = "agent-access.json";
pub const LOG_FILE: &str = "agent-log.jsonl";
pub const SERVER_NAME: &str = "studiomanager";
pub const DEMO_SERVER_NAME: &str = "studiomanager-demo";
pub const DEMO_IDENTIFIER: &str = "ch.studiomanager.demo";
pub const MCP_BINARY: &str = "studiomanager-mcp";
pub const CHANGED_EVENT: &str = "db-changed";
const INVALID_CLAUDE_CONFIG: &str =
    "Claude Desktop's settings file isn't valid JSON; nothing was changed.";
const CLAUDE_CONFIG_CHANGED: &str = "Claude Desktop's settings changed; review again.";
const UNEXPECTED_CLAUDE_CONFIG: &str =
    "Claude Desktop's settings file has an unexpected layout; nothing was changed.";

/// `agent-access.json`, same keys as the server's `guard::AccessConfig`.
#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AccessSettings {
    pub enabled: bool,
    pub allow_money: bool,
    pub orgs: HashMap<String, bool>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentAccess {
    pub enabled: bool,
    pub allow_money: bool,
    pub orgs: HashMap<String, bool>,
    pub mcp_path: String,
    pub claude_desktop_installed: bool,
    pub claude_code_command: String,
    pub generic_config: String,
}

/// One line of `agent-log.jsonl`, as the server writes it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct LogEntry {
    pub at: String,
    pub org: String,
    pub tool: String,
    pub summary: String,
}

// ---------------------------------------------------------------- pure parts

/// Write through a sibling temp file and a rename, so readers never see a
/// half-written file.
pub(crate) fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = path.with_file_name(format!("{name}.{}-{nanos}.tmp", std::process::id()));
    std::fs::write(&tmp, contents)
        .map_err(|e| format!("Failed to write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Failed to replace {}: {e}", path.display())
    })
}

/// Missing or unreadable file: everything off (the server's rule too).
pub fn read_access(dir: &Path) -> AccessSettings {
    std::fs::read_to_string(dir.join(ACCESS_FILE))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn write_access(dir: &Path, settings: &AccessSettings) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    write_atomic(&dir.join(ACCESS_FILE), &format!("{json}\n"))
}

/// The newest `limit` log entries, newest first; unreadable lines skipped.
pub fn read_recent(dir: &Path, limit: usize) -> Vec<LogEntry> {
    let raw = std::fs::read_to_string(dir.join(LOG_FILE)).unwrap_or_default();
    raw.lines()
        .rev()
        .filter_map(|line| serde_json::from_str::<LogEntry>(line.trim()).ok())
        .take(limit)
        .collect()
}

/// The MCP server key for an app identifier: the demo build gets its own
/// key so both can be registered side by side.
pub fn server_name(identifier: &str) -> &'static str {
    if identifier == DEMO_IDENTIFIER {
        DEMO_SERVER_NAME
    } else {
        SERVER_NAME
    }
}

/// Claude Desktop's config with `mcpServers.<name>` set to the server,
/// every other key kept. `existing` is the current file's text, if any.
pub fn merge_claude_config(
    existing: Option<&str>,
    name: &str,
    mcp_path: &str,
) -> Result<String, String> {
    let mut root = match existing.map(str::trim) {
        None | Some("") => Map::new(),
        Some(text) => match serde_json::from_str::<Value>(text) {
            Ok(Value::Object(map)) => map,
            Ok(_) => return Err(UNEXPECTED_CLAUDE_CONFIG.to_string()),
            Err(_) => return Err(INVALID_CLAUDE_CONFIG.to_string()),
        },
    };
    let servers = root
        .entry("mcpServers")
        .or_insert_with(|| Value::Object(Map::new()));
    let Value::Object(servers) = servers else {
        return Err(UNEXPECTED_CLAUDE_CONFIG.to_string());
    };
    servers.insert(name.to_string(), server_entry(mcp_path));
    let out = serde_json::to_string_pretty(&Value::Object(root)).map_err(|e| e.to_string())?;
    Ok(format!("{out}\n"))
}

fn server_entry(mcp_path: &str) -> Value {
    serde_json::json!({ "command": mcp_path })
}

/// Write `expected` (the preview the user approved) to Claude Desktop's
/// config, after backing up the current file (if any) next to it. The merge
/// is recomputed from the file as it is now; if it no longer equals
/// `expected`, the file changed since the preview and nothing is written.
/// Returns the backup path, `None` when there was no file.
pub fn install_claude_config_at(
    config: &Path,
    name: &str,
    mcp_path: &str,
    expected: &str,
    stamp: &str,
) -> Result<Option<PathBuf>, String> {
    install_previewed(
        config,
        expected,
        &|existing| merge_claude_config(existing, name, mcp_path),
        CLAUDE_CONFIG_CHANGED,
        stamp,
    )
}

/// The shared preview -> backup -> write step for another app's settings file.
/// `recompute` derives the new text from the file as it is now (`None` when
/// there is no file); if that is not `expected` (the preview the user
/// approved), the file changed since the preview: nothing is written and the
/// error is `changed_msg`. Otherwise the current file (if any) is backed up
/// next to it, then `expected` replaces it atomically. Returns the backup
/// path, `None` when there was no file. `recompute` runs exactly once, before
/// the backup and the write (agents::statusline relies on it).
pub(crate) fn install_previewed(
    config: &Path,
    expected: &str,
    recompute: &dyn Fn(Option<&str>) -> Result<String, String>,
    changed_msg: &str,
    stamp: &str,
) -> Result<Option<PathBuf>, String> {
    let existing = match std::fs::read_to_string(config) {
        Ok(text) => Some(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("Failed to read {}: {e}", config.display())),
    };
    if recompute(existing.as_deref())? != expected {
        return Err(changed_msg.to_string());
    }
    if let Some(parent) = config.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
    }
    let backup = match &existing {
        Some(text) => Some(write_backup(config, text, stamp)?),
        None => None,
    };
    write_atomic(config, expected)?;
    Ok(backup)
}

/// `<file>.studiomanager-backup-<stamp>`, then `-2`, `-3`, ... if taken;
/// never overwrites an earlier backup.
fn write_backup(config: &Path, text: &str, stamp: &str) -> Result<PathBuf, String> {
    use std::io::Write;
    let name = config
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let base = format!("{name}.studiomanager-backup-{stamp}");
    for n in 1..1000 {
        let candidate = if n == 1 {
            config.with_file_name(&base)
        } else {
            config.with_file_name(format!("{base}-{n}"))
        };
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(mut file) => {
                return file
                    .write_all(text.as_bytes())
                    .map(|_| candidate)
                    .map_err(|e| format!("Failed to back up {}: {e}", config.display()));
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("Failed to back up {}: {e}", config.display())),
        }
    }
    Err(format!(
        "Failed to back up {}: too many backups",
        config.display()
    ))
}

/// `claude mcp add` line for Claude Code; the path single-quoted for the shell.
pub fn claude_code_command(name: &str, mcp_path: &str) -> String {
    let quoted = mcp_path.replace('\'', r"'\''");
    format!("claude mcp add {name} -- '{quoted}'")
}

/// The `mcpServers` snippet for any other MCP client.
pub fn generic_config(name: &str, mcp_path: &str) -> String {
    let value = serde_json::json!({ "mcpServers": { name: server_entry(mcp_path) } });
    serde_json::to_string_pretty(&value).unwrap_or_default()
}

/// A change since the last read; the first read only records the value.
pub fn changed(prev: Option<i64>, now: i64) -> bool {
    matches!(prev, Some(p) if p != now)
}

/// Emit when the value moved, or once after reconnecting following an error
/// (changes made while the database was unreadable would otherwise be missed).
pub fn should_emit(prev: Option<i64>, now: i64, resync: bool) -> bool {
    resync || changed(prev, now)
}

// ------------------------------------------------------------- environment

pub(crate) fn home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default()
}

fn claude_support_dir() -> PathBuf {
    home().join("Library/Application Support/Claude")
}

fn claude_config_path() -> PathBuf {
    claude_support_dir().join("claude_desktop_config.json")
}

fn claude_desktop_installed() -> bool {
    Path::new("/Applications/Claude.app").exists() || claude_support_dir().exists()
}

/// The server binary ships next to the app executable. In dev builds it is
/// usually absent; the path is still returned.
pub(crate) fn mcp_path() -> String {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.join(MCP_BINARY)))
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| MCP_BINARY.to_string())
}

// ---------------------------------------------------------------- commands

#[tauri::command]
pub fn get_agent_access(app: tauri::AppHandle) -> Result<AgentAccess, String> {
    let dir = crate::app_data_dir(&app)?;
    let settings = read_access(&dir);
    let path = mcp_path();
    let name = server_name(&app.config().identifier);
    Ok(AgentAccess {
        enabled: settings.enabled,
        allow_money: settings.allow_money,
        orgs: settings.orgs,
        claude_desktop_installed: claude_desktop_installed(),
        claude_code_command: claude_code_command(name, &path),
        generic_config: generic_config(name, &path),
        mcp_path: path,
    })
}

#[tauri::command]
pub fn set_agent_access(
    app: tauri::AppHandle,
    enabled: bool,
    allow_money: bool,
    orgs: HashMap<String, bool>,
) -> Result<(), String> {
    let dir = crate::app_data_dir(&app)?;
    write_access(
        &dir,
        &AccessSettings {
            enabled,
            allow_money,
            orgs,
        },
    )
}

#[tauri::command]
pub fn preview_claude_desktop(app: tauri::AppHandle) -> Result<String, String> {
    let existing = match std::fs::read_to_string(claude_config_path()) {
        Ok(text) => Some(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("Failed to read Claude Desktop's settings: {e}")),
    };
    merge_claude_config(
        existing.as_deref(),
        server_name(&app.config().identifier),
        &mcp_path(),
    )
}

/// `expected` is the text `preview_claude_desktop` returned and the user
/// approved; it is written as-is, or refused if the file changed meanwhile.
/// Returns the backup path, or an empty string when there was no file to back up.
#[tauri::command]
pub fn install_claude_desktop(app: tauri::AppHandle, expected: String) -> Result<String, String> {
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let backup = install_claude_config_at(
        &claude_config_path(),
        server_name(&app.config().identifier),
        &mcp_path(),
        &expected,
        &stamp,
    )?;
    Ok(backup
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default())
}

#[tauri::command]
pub fn recent_agent_changes(app: tauri::AppHandle, limit: u32) -> Result<Vec<LogEntry>, String> {
    let dir = crate::app_data_dir(&app)?;
    Ok(read_recent(&dir, limit as usize))
}

// ------------------------------------------------------------------ poller

const POLL_INTERVAL: std::time::Duration = std::time::Duration::from_secs(2);

#[derive(Default)]
struct PollState {
    path: Option<PathBuf>,
    conn: Option<Connection>,
    prev: Option<i64>,
    /// Set after a read error; the next good read emits once.
    resync: bool,
    last_error: Option<String>,
}

pub struct ChangePoller(Mutex<PollState>);

/// Manage the poller state and start the background thread.
pub fn start_poller(app: &tauri::AppHandle) {
    app.manage(ChangePoller(Mutex::new(PollState::default())));
    let handle = app.clone();
    let spawned = std::thread::Builder::new()
        .name("db-change-poller".into())
        .spawn(move || loop {
            std::thread::sleep(POLL_INTERVAL);
            check_for_changes(&handle, Trigger::Timer);
        });
    if let Err(e) = spawned {
        log::warn!("[agent-access] could not start the change poller: {e}");
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Trigger {
    /// The background thread.
    Timer,
    /// `WindowEvent::Focused(true)`, on the main thread.
    Focus,
}

/// One poll: read `data_version` on the active database and emit
/// `db-changed` when it moved and the main window is visible. A change seen
/// while hidden is kept pending until the window shows. Never panics.
///
/// Locking: no lock is ever held across a window call or `emit` (those can
/// wait on the main thread). The focus path runs on the main thread, so it
/// only `try_lock`s and skips when the poller is mid-read, and it skips the
/// visibility check (a focused window is visible).
pub fn check_for_changes(app: &tauri::AppHandle, trigger: Trigger) {
    let focus = trigger == Trigger::Focus;
    let Some(poller) = app.try_state::<ChangePoller>() else {
        return;
    };
    let Some(org_state) = app.try_state::<ActiveOrgState>() else {
        return;
    };
    let path = {
        let org = if focus {
            org_state.0.try_lock().ok()
        } else {
            org_state.0.lock().ok()
        };
        match org {
            Some(org) => org.db_path(),
            None => return,
        }
    };

    // Phase 1, under the state lock: read the value and decide.
    let now = {
        let state = if focus {
            poller.0.try_lock().ok()
        } else {
            poller.0.lock().ok()
        };
        let Some(mut state) = state else { return };
        let Some(now) = read_version(&mut state, &path) else {
            return;
        };
        if !should_emit(state.prev, now, state.resync) {
            state.prev = Some(now);
            return;
        }
        now
    };

    // Phase 2, no lock held: visibility (timer only) and emit.
    if !focus {
        let visible = app
            .get_webview_window("main")
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false);
        if !visible {
            return; // stays pending: prev/resync untouched
        }
    }
    if let Err(e) = app.emit(CHANGED_EVENT, ()) {
        log::warn!("[agent-access] emit {CHANGED_EVENT}: {e}");
    }

    // Phase 3, re-lock to commit what was emitted (same path only).
    let state = if focus {
        poller.0.try_lock().ok()
    } else {
        poller.0.lock().ok()
    };
    if let Some(mut state) = state {
        if state.path.as_ref() == Some(&path) {
            state.prev = Some(now);
            state.resync = false;
        }
    }
}

/// Read `PRAGMA data_version` through the long-lived read-only connection,
/// (re)opening it when the active path changed or after an error. `None` on
/// error (logged once per distinct message; the next good read resyncs).
fn read_version(state: &mut PollState, path: &Path) -> Option<i64> {
    if state.path.as_deref() != Some(path) {
        *state = PollState {
            path: Some(path.to_path_buf()),
            resync: state.resync,
            last_error: state.last_error.take(),
            ..Default::default()
        };
    }
    let read = (|| -> Result<i64, String> {
        if state.conn.is_none() {
            let conn = Connection::open_with_flags(
                path,
                OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
            )
            .map_err(|e| format!("open {}: {e}", path.display()))?;
            state.conn = Some(conn);
        }
        let conn = state.conn.as_ref().ok_or("no connection")?;
        conn.query_row("PRAGMA data_version", [], |r| r.get::<_, i64>(0))
            .map_err(|e| format!("data_version: {e}"))
    })();
    match read {
        Ok(v) => {
            state.last_error = None;
            Some(v)
        }
        Err(e) => {
            state.conn = None;
            state.prev = None;
            state.resync = true;
            if state.last_error.as_deref() != Some(e.as_str()) {
                log::warn!("[agent-access] change poller: {e}");
                state.last_error = Some(e);
            }
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("sm-agent-{nanos}-{name}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn merge_keeps_other_servers_and_keys() {
        let existing = r#"{
  "zeta": [1, 2],
  "globalShortcut": "Alt+Space",
  "mcpServers": {
    "other": { "command": "/usr/local/bin/other", "args": ["--x"] },
    "studiomanager": { "command": "/old/path" }
  }
}"#;
        let out = merge_claude_config(
            Some(existing),
            "studiomanager",
            "/Apps/StudioManager.app/Contents/MacOS/studiomanager-mcp",
        )
        .unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["globalShortcut"], "Alt+Space");
        assert_eq!(v["zeta"], serde_json::json!([1, 2]));
        assert_eq!(v["mcpServers"]["other"]["command"], "/usr/local/bin/other");
        assert_eq!(v["mcpServers"]["other"]["args"], serde_json::json!(["--x"]));
        assert_eq!(
            v["mcpServers"]["studiomanager"],
            serde_json::json!({ "command": "/Apps/StudioManager.app/Contents/MacOS/studiomanager-mcp" })
        );
        // Key order kept, 2-space indent.
        let g = out.find("globalShortcut").unwrap();
        let m = out.find("mcpServers").unwrap();
        let z = out.find("zeta").unwrap();
        assert!(z < g && g < m, "{out}");
        assert!(out.starts_with("{\n  \"zeta\""), "{out}");
    }

    #[test]
    fn merge_creates_file_when_missing() {
        let out = merge_claude_config(None, "studiomanager", "/x/studiomanager-mcp").unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(
            v,
            serde_json::json!({ "mcpServers": { "studiomanager": { "command": "/x/studiomanager-mcp" } } })
        );

        let dir = tmp_dir("claude-missing");
        let config = dir.join("Claude").join("claude_desktop_config.json");
        let backup = install_claude_config_at(
            &config,
            "studiomanager",
            "/x/studiomanager-mcp",
            &out,
            "20261027-120000",
        )
        .unwrap();
        assert_eq!(backup, None);
        assert_eq!(std::fs::read_to_string(&config).unwrap(), out);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn install_backs_up_the_existing_file() {
        let dir = tmp_dir("claude-backup");
        let config = dir.join("claude_desktop_config.json");
        let original = r#"{"mcpServers":{"other":{"command":"o"}}}"#;
        std::fs::write(&config, original).unwrap();
        let preview =
            merge_claude_config(Some(original), "studiomanager", "/x/studiomanager-mcp").unwrap();
        let backup = install_claude_config_at(
            &config,
            "studiomanager",
            "/x/studiomanager-mcp",
            &preview,
            "20261027-120000",
        )
        .unwrap()
        .expect("a backup when the file existed");
        assert_eq!(
            backup,
            dir.join("claude_desktop_config.json.studiomanager-backup-20261027-120000")
        );
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), original);
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&config).unwrap()).unwrap();
        assert_eq!(v["mcpServers"]["other"]["command"], "o");
        assert_eq!(
            v["mcpServers"]["studiomanager"]["command"],
            "/x/studiomanager-mcp"
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn install_refuses_when_settings_changed_since_preview() {
        let dir = tmp_dir("claude-changed");
        let config = dir.join("claude_desktop_config.json");
        std::fs::write(&config, r#"{"a":1}"#).unwrap();
        let preview = merge_claude_config(Some(r#"{"a":1}"#), "studiomanager", "/x").unwrap();
        // Claude Desktop rewrites its file after the preview was shown.
        std::fs::write(&config, r#"{"a":2}"#).unwrap();
        assert_eq!(
            install_claude_config_at(&config, "studiomanager", "/x", &preview, "20261027-120000")
                .unwrap_err(),
            "Claude Desktop's settings changed; review again."
        );
        assert_eq!(std::fs::read_to_string(&config).unwrap(), r#"{"a":2}"#);
        let entries: Vec<_> = std::fs::read_dir(&dir).unwrap().collect();
        assert_eq!(entries.len(), 1, "no backup or temp file left behind");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn backups_in_the_same_second_do_not_collide() {
        let dir = tmp_dir("claude-collide");
        let config = dir.join("claude_desktop_config.json");
        let mut backups = Vec::new();
        for i in 0..3 {
            let text = format!(r#"{{"n":{i}}}"#);
            std::fs::write(&config, &text).unwrap();
            let preview = merge_claude_config(Some(&text), "studiomanager", "/x").unwrap();
            let backup = install_claude_config_at(
                &config,
                "studiomanager",
                "/x",
                &preview,
                "20261027-120000",
            )
            .unwrap()
            .unwrap();
            assert_eq!(std::fs::read_to_string(&backup).unwrap(), text);
            backups.push(backup.file_name().unwrap().to_string_lossy().to_string());
        }
        assert_eq!(
            backups,
            [
                "claude_desktop_config.json.studiomanager-backup-20261027-120000",
                "claude_desktop_config.json.studiomanager-backup-20261027-120000-2",
                "claude_desktop_config.json.studiomanager-backup-20261027-120000-3",
            ]
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn should_emit_on_change_or_after_reconnect() {
        assert!(!should_emit(None, 1, false), "first read only records");
        assert!(!should_emit(Some(1), 1, false));
        assert!(should_emit(Some(1), 2, false));
        assert!(should_emit(None, 1, true), "once after a reconnect");
        assert!(should_emit(Some(1), 1, true));
    }

    #[test]
    fn merge_rejects_invalid_json_without_writing() {
        assert_eq!(
            merge_claude_config(Some("{ not json"), "studiomanager", "/x").unwrap_err(),
            "Claude Desktop's settings file isn't valid JSON; nothing was changed."
        );
        let dir = tmp_dir("claude-invalid");
        let config = dir.join("claude_desktop_config.json");
        std::fs::write(&config, "{ not json").unwrap();
        assert!(
            install_claude_config_at(&config, "studiomanager", "/x", "{}", "20261027-120000")
                .is_err()
        );
        assert_eq!(std::fs::read_to_string(&config).unwrap(), "{ not json");
        let entries: Vec<_> = std::fs::read_dir(&dir).unwrap().collect();
        assert_eq!(entries.len(), 1, "no backup or temp file left behind");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn access_roundtrip() {
        let dir = tmp_dir("access");
        assert_eq!(read_access(&dir), AccessSettings::default());
        let settings = AccessSettings {
            enabled: true,
            allow_money: false,
            orgs: HashMap::from([("aaa111".to_string(), false), ("unknown".to_string(), true)]),
        };
        write_access(&dir, &settings).unwrap();
        assert_eq!(read_access(&dir), settings);
        // The keys the MCP server reads.
        let raw: Value =
            serde_json::from_str(&std::fs::read_to_string(dir.join(ACCESS_FILE)).unwrap()).unwrap();
        assert_eq!(raw["enabled"], true);
        assert_eq!(raw["allowMoney"], false);
        assert_eq!(raw["orgs"]["aaa111"], false);
        let names: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(names, [ACCESS_FILE], "no temp file left behind");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn changed_detects_only_differences() {
        assert!(!changed(None, 1));
        assert!(!changed(Some(3), 3));
        assert!(changed(Some(3), 4));
        assert!(changed(Some(4), 3));
    }

    #[test]
    fn recent_changes_newest_first() {
        let dir = tmp_dir("log");
        let line = |i: u32| {
            serde_json::json!({ "at": format!("2026-10-27T10:00:0{i}Z"), "org": "aaa111", "tool": "add_task", "summary": format!("entry {i}") })
                .to_string()
        };
        let raw = format!("{}\nnot json\n\n{}\n{}\n", line(1), line(2), line(3));
        std::fs::write(dir.join(LOG_FILE), raw).unwrap();
        let all = read_recent(&dir, 10);
        let summaries: Vec<&str> = all.iter().map(|e| e.summary.as_str()).collect();
        assert_eq!(summaries, ["entry 3", "entry 2", "entry 1"]);
        assert_eq!(all[0].tool, "add_task");
        assert_eq!(all[0].org, "aaa111");
        assert_eq!(read_recent(&dir, 2).len(), 2);
        assert!(read_recent(&tmp_dir("nolog"), 5).is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn claude_code_command_quotes_the_path() {
        assert_eq!(
            claude_code_command("studiomanager", "/Apps/Studio Manager.app/x"),
            "claude mcp add studiomanager -- '/Apps/Studio Manager.app/x'"
        );
        assert_eq!(
            claude_code_command("studiomanager", "/a'b"),
            r"claude mcp add studiomanager -- '/a'\''b'"
        );
    }

    #[test]
    fn generic_config_is_the_server_entry() {
        let v: Value =
            serde_json::from_str(&generic_config("studiomanager", "/x/studiomanager-mcp")).unwrap();
        assert_eq!(
            v,
            serde_json::json!({ "mcpServers": { "studiomanager": { "command": "/x/studiomanager-mcp" } } })
        );
    }

    #[test]
    fn demo_identifier_gets_its_own_server_name() {
        assert_eq!(server_name("ch.studiomanager.app"), "studiomanager");
        assert_eq!(server_name("ch.studiomanager.demo"), "studiomanager-demo");
        assert_eq!(
            claude_code_command("studiomanager-demo", "/a"),
            "claude mcp add studiomanager-demo -- '/a'"
        );
        let out = merge_claude_config(
            Some(r#"{"mcpServers":{"studiomanager":{"command":"/real"}}}"#),
            "studiomanager-demo",
            "/demo",
        )
        .unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["mcpServers"]["studiomanager"]["command"], "/real");
        assert_eq!(v["mcpServers"]["studiomanager-demo"]["command"], "/demo");
        let g: Value =
            serde_json::from_str(&generic_config("studiomanager-demo", "/demo")).unwrap();
        assert_eq!(g["mcpServers"]["studiomanager-demo"]["command"], "/demo");
    }
}
