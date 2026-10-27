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
pub const MCP_BINARY: &str = "studiomanager-mcp";
pub const CHANGED_EVENT: &str = "db-changed";
const INVALID_CLAUDE_CONFIG: &str =
    "Claude Desktop's settings file isn't valid JSON; nothing was changed.";
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
fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let tmp = path.with_file_name(format!("{name}.tmp"));
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

/// Claude Desktop's config with `mcpServers.studiomanager` set to the server,
/// every other key kept. `existing` is the current file's text, if any.
pub fn merge_claude_config(existing: Option<&str>, mcp_path: &str) -> Result<String, String> {
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
    servers.insert(SERVER_NAME.to_string(), server_entry(mcp_path));
    let out = serde_json::to_string_pretty(&Value::Object(root)).map_err(|e| e.to_string())?;
    Ok(format!("{out}\n"))
}

fn server_entry(mcp_path: &str) -> Value {
    serde_json::json!({ "command": mcp_path })
}

/// Back up the existing config (if any) next to it, then write the merged
/// one atomically. Returns the backup path, `None` when there was no file.
/// Invalid JSON fails before anything is written.
pub fn install_claude_config_at(
    config: &Path,
    mcp_path: &str,
    stamp: &str,
) -> Result<Option<PathBuf>, String> {
    let existing = match std::fs::read_to_string(config) {
        Ok(text) => Some(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("Failed to read {}: {e}", config.display())),
    };
    let merged = merge_claude_config(existing.as_deref(), mcp_path)?;
    if let Some(parent) = config.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {e}", parent.display()))?;
    }
    let backup = match &existing {
        Some(text) => {
            let name = config
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let backup = config.with_file_name(format!("{name}.studiomanager-backup-{stamp}"));
            std::fs::write(&backup, text)
                .map_err(|e| format!("Failed to back up {}: {e}", config.display()))?;
            Some(backup)
        }
        None => None,
    };
    write_atomic(config, &merged)?;
    Ok(backup)
}

/// `claude mcp add` line for Claude Code; the path single-quoted for the shell.
pub fn claude_code_command(mcp_path: &str) -> String {
    let quoted = mcp_path.replace('\'', r"'\''");
    format!("claude mcp add {SERVER_NAME} -- '{quoted}'")
}

/// The `mcpServers` snippet for any other MCP client.
pub fn generic_config(mcp_path: &str) -> String {
    let value = serde_json::json!({ "mcpServers": { SERVER_NAME: server_entry(mcp_path) } });
    serde_json::to_string_pretty(&value).unwrap_or_default()
}

/// A change since the last read; the first read only records the value.
pub fn changed(prev: Option<i64>, now: i64) -> bool {
    matches!(prev, Some(p) if p != now)
}

// ------------------------------------------------------------- environment

fn home() -> PathBuf {
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
fn mcp_path() -> String {
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
    Ok(AgentAccess {
        enabled: settings.enabled,
        allow_money: settings.allow_money,
        orgs: settings.orgs,
        claude_desktop_installed: claude_desktop_installed(),
        claude_code_command: claude_code_command(&path),
        generic_config: generic_config(&path),
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
pub fn preview_claude_desktop() -> Result<String, String> {
    let existing = match std::fs::read_to_string(claude_config_path()) {
        Ok(text) => Some(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("Failed to read Claude Desktop's settings: {e}")),
    };
    merge_claude_config(existing.as_deref(), &mcp_path())
}

/// Returns the backup path, or an empty string when there was no file to back up.
#[tauri::command]
pub fn install_claude_desktop() -> Result<String, String> {
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let backup = install_claude_config_at(&claude_config_path(), &mcp_path(), &stamp)?;
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
            check_for_changes(&handle);
        });
    if let Err(e) = spawned {
        log::warn!("[agent-access] could not start the change poller: {e}");
    }
}

/// One poll: read `data_version` on the active database and emit
/// `db-changed` when it moved and the main window is visible. A change seen
/// while hidden is kept pending until the window shows. Never panics.
pub fn check_for_changes(app: &tauri::AppHandle) {
    let Some(poller) = app.try_state::<ChangePoller>() else {
        return;
    };
    let Some(org_state) = app.try_state::<ActiveOrgState>() else {
        return;
    };
    let path = match org_state.0.lock() {
        Ok(org) => org.db_path(),
        Err(_) => return,
    };
    let Ok(mut state) = poller.0.lock() else {
        return;
    };
    if state.path.as_ref() != Some(&path) {
        *state = PollState {
            path: Some(path.clone()),
            last_error: state.last_error.take(),
            ..Default::default()
        };
    }
    let read = (|| -> Result<i64, String> {
        if state.conn.is_none() {
            let conn = Connection::open_with_flags(
                &path,
                OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
            )
            .map_err(|e| format!("open {}: {e}", path.display()))?;
            state.conn = Some(conn);
        }
        let conn = state.conn.as_ref().ok_or("no connection")?;
        conn.query_row("PRAGMA data_version", [], |r| r.get::<_, i64>(0))
            .map_err(|e| format!("data_version: {e}"))
    })();
    let now = match read {
        Ok(v) => v,
        Err(e) => {
            // Reopen next time (the file may have been replaced); warn once per distinct error.
            state.conn = None;
            state.prev = None;
            if state.last_error.as_deref() != Some(e.as_str()) {
                log::warn!("[agent-access] change poller: {e}");
                state.last_error = Some(e);
            }
            return;
        }
    };
    state.last_error = None;
    if changed(state.prev, now) {
        let visible = app
            .get_webview_window("main")
            .and_then(|w| w.is_visible().ok())
            .unwrap_or(false);
        if !visible {
            return;
        }
        if let Err(e) = app.emit(CHANGED_EVENT, ()) {
            log::warn!("[agent-access] emit {CHANGED_EVENT}: {e}");
        }
    }
    state.prev = Some(now);
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
        let out = merge_claude_config(None, "/x/studiomanager-mcp").unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(
            v,
            serde_json::json!({ "mcpServers": { "studiomanager": { "command": "/x/studiomanager-mcp" } } })
        );

        let dir = tmp_dir("claude-missing");
        let config = dir.join("Claude").join("claude_desktop_config.json");
        let backup =
            install_claude_config_at(&config, "/x/studiomanager-mcp", "20261027-120000").unwrap();
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
        let backup = install_claude_config_at(&config, "/x/studiomanager-mcp", "20261027-120000")
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
    fn merge_rejects_invalid_json_without_writing() {
        assert_eq!(
            merge_claude_config(Some("{ not json"), "/x").unwrap_err(),
            "Claude Desktop's settings file isn't valid JSON; nothing was changed."
        );
        let dir = tmp_dir("claude-invalid");
        let config = dir.join("claude_desktop_config.json");
        std::fs::write(&config, "{ not json").unwrap();
        assert!(install_claude_config_at(&config, "/x", "20261027-120000").is_err());
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
        assert!(!dir.join(format!("{ACCESS_FILE}.tmp")).exists());
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
            claude_code_command("/Apps/Studio Manager.app/x"),
            "claude mcp add studiomanager -- '/Apps/Studio Manager.app/x'"
        );
        assert_eq!(
            claude_code_command("/a'b"),
            r"claude mcp add studiomanager -- '/a'\''b'"
        );
    }

    #[test]
    fn generic_config_is_the_server_entry() {
        let v: Value = serde_json::from_str(&generic_config("/x/studiomanager-mcp")).unwrap();
        assert_eq!(
            v,
            serde_json::json!({ "mcpServers": { "studiomanager": { "command": "/x/studiomanager-mcp" } } })
        );
    }
}
