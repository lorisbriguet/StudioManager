//! Claude Code's status line: StudioManager's `studiomanager-mcp --statusline` captures the plan
//! limits Claude Code passes to it. Setting it up edits `~/.claude/settings.json`, only after a
//! preview the user approved, with a backup first and the previous `statusLine` kept in
//! `agents.json` to restore on removal. Only the `statusLine` key is ever touched.

use super::cli::{read_settings, write_settings};
use crate::agent_access::install_previewed;
use serde::Serialize;
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};

const KEY: &str = "statusLine";
const INVALID: &str = "Claude Code's settings file isn't valid JSON; nothing was changed.";
const UNEXPECTED: &str =
    "Claude Code's settings file has an unexpected layout; nothing was changed.";
const CHANGED: &str = "Claude Code's settings changed; review again.";
const NOT_INSTALLED: &str = "StudioManager's status line isn't set up; nothing was changed.";

/// What setting up (or removing) the status line would do, for the settings card.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatusLinePreview {
    /// The current status line's command (or its JSON when it has none).
    pub current: Option<String>,
    /// Claude Code's settings file after setting up StudioManager's status line.
    pub next: String,
    /// A status line exists and it is not StudioManager's.
    pub replaces_other: bool,
    /// The current status line is StudioManager's.
    pub installed: bool,
    /// The settings file after removing it (the previous status line restored); only when
    /// installed.
    pub remove_next: Option<String>,
}

/// The status line command: the sidecar path single-quoted for the shell.
pub fn status_line_command(mcp_path: &str) -> String {
    let quoted = mcp_path.replace('\'', r"'\''");
    format!("'{quoted}' --statusline")
}

/// The settings file's top-level object; an empty or missing file is an empty object.
fn parse_root(existing: Option<&str>) -> Result<Map<String, Value>, String> {
    match existing.map(str::trim) {
        None | Some("") => Ok(Map::new()),
        Some(text) => match serde_json::from_str::<Value>(text) {
            Ok(Value::Object(map)) => Ok(map),
            Ok(_) => Err(UNEXPECTED.to_string()),
            Err(_) => Err(INVALID.to_string()),
        },
    }
}

fn to_text(root: Map<String, Value>) -> Result<String, String> {
    let out = serde_json::to_string_pretty(&Value::Object(root)).map_err(|e| e.to_string())?;
    Ok(format!("{out}\n"))
}

/// The `statusLine` is StudioManager's: its command is ours (both trimmed).
fn is_ours(line: Option<&Value>, command: &str) -> bool {
    line.and_then(|l| l.get("command"))
        .and_then(Value::as_str)
        .is_some_and(|c| c.trim() == command.trim())
}

/// Claude Code's settings with `statusLine` set to StudioManager's command, every other key
/// kept in place. Returns the new text and the `statusLine` it replaces, if any.
pub fn merge_status_line(
    existing: Option<&str>,
    command: &str,
) -> Result<(String, Option<Value>), String> {
    let mut root = parse_root(existing)?;
    let line = serde_json::json!({ "type": "command", "command": command });
    // An existing key is replaced where it stands (preserve_order); a new one goes last.
    let previous = root.insert(KEY.to_string(), line);
    Ok((to_text(root)?, previous))
}

/// Claude Code's settings with `statusLine` set back to `previous`, or removed when there was
/// none; every other key kept in place.
pub fn unmerge_status_line(existing: &str, previous: Option<&Value>) -> Result<String, String> {
    let mut root = parse_root(Some(existing))?;
    match previous {
        Some(line) => {
            root.insert(KEY.to_string(), line.clone());
        }
        None => {
            // shift_remove, not remove: the latter swaps the last key into its place.
            root.shift_remove(KEY);
        }
    }
    to_text(root)
}

fn read_existing(settings: &Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(settings) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Failed to read {}: {e}", settings.display())),
    }
}

/// The preview for the settings card. `previous` is the `statusLine` saved at setup, restored
/// by a removal.
pub fn preview_at(
    settings: &Path,
    command: &str,
    previous: Option<&Value>,
) -> Result<StatusLinePreview, String> {
    let existing = read_existing(settings)?;
    let root = parse_root(existing.as_deref())?;
    let line = root.get(KEY);
    let installed = is_ours(line, command);
    let current = line.map(|l| match l.get("command").and_then(Value::as_str) {
        Some(c) => c.to_string(),
        None => l.to_string(),
    });
    let (next, _) = merge_status_line(existing.as_deref(), command)?;
    let remove_next = match (&existing, installed) {
        (Some(text), true) => Some(unmerge_status_line(text, previous)?),
        _ => None,
    };
    Ok(StatusLinePreview {
        current,
        next,
        replaces_other: line.is_some() && !installed,
        installed,
        remove_next,
    })
}

/// Write `expected` (the approved preview's `next`) to Claude Code's settings: refused when
/// the file changed since the preview; otherwise the replaced `statusLine` is saved in
/// `agents.json` (unless it was already ours: the saved one stays), then the file is backed up
/// and written. Returns the backup path, `None` when there was no file.
pub fn install_at(
    settings: &Path,
    app_dir: &Path,
    command: &str,
    expected: &str,
    stamp: &str,
) -> Result<Option<PathBuf>, String> {
    install_previewed(
        settings,
        expected,
        &|existing| {
            let (text, previous) = merge_status_line(existing, command)?;
            // Only once the preview is confirmed current, and before the file is written.
            if text == expected && !is_ours(previous.as_ref(), command) {
                let mut s = read_settings(app_dir);
                s.previous_status_line = previous;
                write_settings(app_dir, &s)?;
            }
            Ok(text)
        },
        CHANGED,
        stamp,
    )
}

/// Write `expected` (the approved preview's `removeNext`): the saved `statusLine` restored, or
/// the key removed. Refused when the status line isn't ours or the file changed since the
/// preview. Backs up first; forgets the saved line once restored.
pub fn remove_at(
    settings: &Path,
    app_dir: &Path,
    command: &str,
    expected: &str,
    stamp: &str,
) -> Result<Option<PathBuf>, String> {
    let saved = read_settings(app_dir).previous_status_line;
    let backup = install_previewed(
        settings,
        expected,
        &|existing| {
            let root = parse_root(existing)?;
            match existing {
                Some(text) if is_ours(root.get(KEY), command) => {
                    unmerge_status_line(text, saved.as_ref())
                }
                _ => Err(NOT_INSTALLED.to_string()),
            }
        },
        CHANGED,
        stamp,
    )?;
    let mut s = read_settings(app_dir);
    if s.previous_status_line.take().is_some() {
        if let Err(e) = write_settings(app_dir, &s) {
            log::warn!("[agents] status line removed, but agents.json still holds the old one: {e}");
        }
    }
    Ok(backup)
}

// ---------------------------------------------------------------- commands

/// Claude Code's user settings.
fn settings_path() -> PathBuf {
    crate::agent_access::home().join(".claude/settings.json")
}

/// The bundled sidecar (agent_access's path; in a dev build, the dev binary's folder).
fn our_command() -> String {
    status_line_command(&crate::agent_access::mcp_path())
}

fn stamp() -> String {
    chrono::Local::now().format("%Y%m%d-%H%M%S").to_string()
}

fn path_text(backup: Option<PathBuf>) -> String {
    backup.map(|p| p.to_string_lossy().to_string()).unwrap_or_default()
}

#[tauri::command]
pub async fn agents_status_line_preview(
    state: tauri::State<'_, super::AgentsState>,
) -> Result<StatusLinePreview, String> {
    let app_dir = state.app_dir.clone();
    super::pty::blocking(move || {
        let saved = read_settings(&app_dir).previous_status_line;
        preview_at(&settings_path(), &our_command(), saved.as_ref())
    })
    .await
}

/// `expected` is the preview's `next` the user approved. Returns the backup path, or an empty
/// string when there was no file to back up.
#[tauri::command]
pub async fn agents_status_line_install(
    state: tauri::State<'_, super::AgentsState>,
    expected: String,
) -> Result<String, String> {
    let app_dir = state.app_dir.clone();
    super::pty::blocking(move || {
        install_at(&settings_path(), &app_dir, &our_command(), &expected, &stamp()).map(path_text)
    })
    .await
}

/// `expected` is the preview's `removeNext` the user approved. Returns the backup path.
#[tauri::command]
pub async fn agents_status_line_remove(
    state: tauri::State<'_, super::AgentsState>,
    expected: String,
) -> Result<String, String> {
    let app_dir = state.app_dir.clone();
    super::pty::blocking(move || {
        remove_at(&settings_path(), &app_dir, &our_command(), &expected, &stamp()).map(path_text)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const CMD: &str = "'/Apps/StudioManager.app/Contents/MacOS/studiomanager-mcp' --statusline";

    fn tmp(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let d = std::env::temp_dir().join(format!("sm-statusline-{name}-{nanos}"));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        v.sort();
        v
    }

    #[test]
    fn command_quotes_the_path() {
        assert_eq!(
            status_line_command("/Apps/Studio Manager.app/Contents/MacOS/studiomanager-mcp"),
            "'/Apps/Studio Manager.app/Contents/MacOS/studiomanager-mcp' --statusline"
        );
        assert_eq!(status_line_command("/a'b"), r"'/a'\''b' --statusline");
    }

    #[test]
    fn merge_keeps_other_keys_and_returns_previous() {
        let existing = r#"{
  "zeta": 1,
  "statusLine": { "type": "command", "command": "~/bin/mine.sh", "padding": 0 },
  "model": "opus",
  "permissions": { "allow": ["Bash(ls)"] }
}"#;
        let (out, previous) = merge_status_line(Some(existing), CMD).unwrap();
        assert_eq!(
            previous,
            Some(json!({ "type": "command", "command": "~/bin/mine.sh", "padding": 0 }))
        );
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["statusLine"], json!({ "type": "command", "command": CMD }));
        assert_eq!(v["zeta"], 1);
        assert_eq!(v["model"], "opus");
        assert_eq!(v["permissions"], json!({ "allow": ["Bash(ls)"] }));
        // Key order kept: statusLine replaced in place.
        let keys: Vec<&String> = v.as_object().unwrap().keys().collect();
        assert_eq!(keys, ["zeta", "statusLine", "model", "permissions"]);
        assert!(out.ends_with("}\n"));

        // No status line yet: added last, nothing to restore.
        let (out, previous) = merge_status_line(Some(r#"{"model":"opus"}"#), CMD).unwrap();
        assert_eq!(previous, None);
        let keys: Vec<String> = serde_json::from_str::<Map<String, Value>>(&out)
            .unwrap()
            .keys()
            .cloned()
            .collect();
        assert_eq!(keys, ["model", "statusLine"]);

        // No file.
        let (out, previous) = merge_status_line(None, CMD).unwrap();
        assert_eq!(previous, None);
        assert_eq!(
            serde_json::from_str::<Value>(&out).unwrap(),
            json!({ "statusLine": { "type": "command", "command": CMD } })
        );
    }

    #[test]
    fn unmerge_restores_previous_or_removes() {
        let installed =
            format!(r#"{{"a":1,"statusLine":{{"type":"command","command":"{CMD}"}},"b":2,"c":3}}"#);
        let previous = json!({ "type": "command", "command": "~/bin/mine.sh" });
        let out = unmerge_status_line(&installed, Some(&previous)).unwrap();
        let v: Map<String, Value> = serde_json::from_str(&out).unwrap();
        assert_eq!(v["statusLine"], previous);
        assert_eq!(v.keys().collect::<Vec<_>>(), ["a", "statusLine", "b", "c"]);

        let out = unmerge_status_line(&installed, None).unwrap();
        let v: Map<String, Value> = serde_json::from_str(&out).unwrap();
        assert!(!v.contains_key("statusLine"));
        // Removal keeps the other keys in their order.
        assert_eq!(v.keys().collect::<Vec<_>>(), ["a", "b", "c"]);

        assert_eq!(unmerge_status_line("{ nope", None).unwrap_err(), INVALID);
        assert_eq!(unmerge_status_line("[1]", None).unwrap_err(), UNEXPECTED);
    }

    #[test]
    fn preview_reports_installed_and_replaces_other() {
        let dir = tmp("preview");
        let settings = dir.join("settings.json");

        let p = preview_at(&settings, CMD, None).unwrap();
        assert_eq!((p.current.clone(), p.installed, p.replaces_other), (None, false, false));
        assert_eq!(p.next, merge_status_line(None, CMD).unwrap().0);
        assert_eq!(p.remove_next, None);

        std::fs::write(&settings, r#"{"statusLine":{"type":"command","command":"~/x.sh"}}"#)
            .unwrap();
        let p = preview_at(&settings, CMD, None).unwrap();
        assert_eq!(p.current.as_deref(), Some("~/x.sh"));
        assert!(p.replaces_other && !p.installed);

        let ours = merge_status_line(None, CMD).unwrap().0;
        std::fs::write(&settings, &ours).unwrap();
        // Trailing spaces around the command still count as ours.
        let previous = json!({ "type": "command", "command": "~/x.sh" });
        let p = preview_at(&settings, &format!(" {CMD} "), Some(&previous)).unwrap();
        assert!(p.installed && !p.replaces_other);
        assert_eq!(p.remove_next, Some(unmerge_status_line(&ours, Some(&previous)).unwrap()));

        std::fs::write(&settings, "{ nope").unwrap();
        assert_eq!(preview_at(&settings, CMD, None).unwrap_err(), INVALID);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn backup_written_before_change() {
        let dir = tmp("backup");
        let app = dir.join("app");
        let claude = dir.join("claude");
        std::fs::create_dir_all(&claude).unwrap();
        let settings = claude.join("settings.json");
        let original = r#"{"model":"opus","statusLine":{"type":"command","command":"~/x.sh"}}"#;
        std::fs::write(&settings, original).unwrap();
        let preview = preview_at(&settings, CMD, None).unwrap();

        let backup = install_at(&settings, &app, CMD, &preview.next, "20261028-120000")
            .unwrap()
            .expect("a backup of the existing file");
        assert_eq!(backup, claude.join("settings.json.studiomanager-backup-20261028-120000"));
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), original);
        assert_eq!(std::fs::read_to_string(&settings).unwrap(), preview.next);
        // The previous status line is remembered in agents.json.
        assert_eq!(
            read_settings(&app).previous_status_line,
            Some(json!({ "type": "command", "command": "~/x.sh" }))
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn reinstall_keeps_the_saved_previous() {
        let dir = tmp("reinstall");
        let app = dir.join("app");
        let settings = dir.join("settings.json");
        std::fs::write(&settings, r#"{"statusLine":{"type":"command","command":"~/x.sh"}}"#)
            .unwrap();
        let p = preview_at(&settings, CMD, None).unwrap();
        install_at(&settings, &app, CMD, &p.next, "1").unwrap();
        // Set up again over our own line: the user's original stays saved.
        let p = preview_at(&settings, CMD, None).unwrap();
        install_at(&settings, &app, CMD, &p.next, "2").unwrap();
        assert_eq!(
            read_settings(&app).previous_status_line,
            Some(json!({ "type": "command", "command": "~/x.sh" }))
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn status_line_install_refuses_when_settings_changed() {
        let dir = tmp("changed");
        let app = dir.join("app");
        let claude = dir.join("claude");
        std::fs::create_dir_all(&claude).unwrap();
        let settings = claude.join("settings.json");
        std::fs::write(&settings, r#"{"model":"opus"}"#).unwrap();
        let preview = preview_at(&settings, CMD, None).unwrap();
        // Claude Code rewrites its settings after the preview was shown.
        std::fs::write(&settings, r#"{"model":"sonnet"}"#).unwrap();
        assert_eq!(
            install_at(&settings, &app, CMD, &preview.next, "20261028-120000").unwrap_err(),
            CHANGED
        );
        assert_eq!(std::fs::read_to_string(&settings).unwrap(), r#"{"model":"sonnet"}"#);
        assert_eq!(names(&claude), ["settings.json"], "no backup or temp file left behind");
        assert!(!app.join(crate::agents::cli::SETTINGS_FILE).exists(), "agents.json untouched");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn invalid_json_is_refused_not_overwritten() {
        let dir = tmp("invalid");
        let app = dir.join("app");
        let claude = dir.join("claude");
        std::fs::create_dir_all(&claude).unwrap();
        let settings = claude.join("settings.json");
        std::fs::write(&settings, "{ not json").unwrap();
        assert_eq!(merge_status_line(Some("{ not json"), CMD).unwrap_err(), INVALID);
        let expected = merge_status_line(None, CMD).unwrap().0;
        assert_eq!(install_at(&settings, &app, CMD, &expected, "1").unwrap_err(), INVALID);
        assert_eq!(remove_at(&settings, &app, CMD, "{}\n", "1").unwrap_err(), INVALID);
        assert_eq!(std::fs::read_to_string(&settings).unwrap(), "{ not json");
        assert_eq!(names(&claude), ["settings.json"], "no backup or temp file left behind");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn remove_restores_the_previous_line_with_a_backup() {
        let dir = tmp("remove");
        let app = dir.join("app");
        let claude = dir.join("claude");
        std::fs::create_dir_all(&claude).unwrap();
        let settings = claude.join("settings.json");
        let original = r#"{"model":"opus","statusLine":{"type":"command","command":"~/x.sh"}}"#;
        std::fs::write(&settings, original).unwrap();
        let p = preview_at(&settings, CMD, None).unwrap();
        install_at(&settings, &app, CMD, &p.next, "1").unwrap();

        let saved = read_settings(&app).previous_status_line;
        let p = preview_at(&settings, CMD, saved.as_ref()).unwrap();
        let installed_text = std::fs::read_to_string(&settings).unwrap();
        let expected = p.remove_next.expect("installed");
        let backup = remove_at(&settings, &app, CMD, &expected, "2").unwrap().unwrap();
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), installed_text);
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&settings).unwrap()).unwrap();
        assert_eq!(v, json!({ "model": "opus", "statusLine": { "type": "command", "command": "~/x.sh" } }));
        assert_eq!(read_settings(&app).previous_status_line, None, "forgotten once restored");

        // Not ours any more: refused, nothing written.
        let before = std::fs::read_to_string(&settings).unwrap();
        assert_eq!(remove_at(&settings, &app, CMD, &before, "3").unwrap_err(), NOT_INSTALLED);
        assert_eq!(std::fs::read_to_string(&settings).unwrap(), before);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn remove_refuses_when_settings_changed() {
        let dir = tmp("remove-changed");
        let app = dir.join("app");
        let settings = dir.join("settings.json");
        let p = preview_at(&settings, CMD, None).unwrap();
        install_at(&settings, &app, CMD, &p.next, "1").unwrap();
        let p = preview_at(&settings, CMD, None).unwrap();
        let expected = p.remove_next.unwrap();
        // Another key changes after the preview.
        let (changed, _) = merge_status_line(Some(r#"{"model":"opus"}"#), CMD).unwrap();
        std::fs::write(&settings, &changed).unwrap();
        assert_eq!(remove_at(&settings, &app, CMD, &expected, "2").unwrap_err(), CHANGED);
        assert_eq!(std::fs::read_to_string(&settings).unwrap(), changed);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
