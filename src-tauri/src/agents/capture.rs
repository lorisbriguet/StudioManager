//! Captures: a thought typed in the menu bar panel or the capture panel, kept in the active
//! organisation's `captures` table until the brief session files it. Both panels have no SQL, so
//! they call `capture_add` and `capture_projects` here. Design:
//! docs/superpowers/specs/2026-11-12-agent-orchestrator-design.md

use super::actions::switched_on;
use super::pty::blocking;
use crate::ActiveOrg;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::path::Path;
use std::time::Duration;
use tauri::Emitter;

/// Same cap as the MCP server's `capped`.
const MAX_TEXT: usize = 1024 * 1024;

pub const CAPTURE_MODE: &str =
    "StudioManager is in test or presentation mode: the capture was not saved.";

/// `Agent` and `Reminders` are used by later tasks (Reminders import).
#[allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Source {
    Hotkey,
    Menubar,
    Agent,
    Reminders,
}

impl Source {
    pub fn as_str(self) -> &'static str {
        match self {
            Source::Hotkey => "hotkey",
            Source::Menubar => "menubar",
            Source::Agent => "agent",
            Source::Reminders => "reminders",
        }
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct CaptureProject {
    pub id: i64,
    pub name: String,
    pub client: String,
}

pub(super) fn open(db: &Path) -> Result<Connection, String> {
    let conn = Connection::open(db).map_err(|e| format!("Failed to open DB: {e}"))?;
    conn.pragma_update(None, "foreign_keys", true)
        .map_err(|e| format!("Failed to enable foreign_keys: {e}"))?;
    conn.busy_timeout(Duration::from_millis(5000))
        .map_err(|e| format!("Failed to set busy_timeout: {e}"))?;
    Ok(conn)
}

/// Writes one capture. `Ok(None)` when `reminder_id` was already read.
pub fn add(
    db: &Path,
    text: &str,
    source: Source,
    project_id: Option<i64>,
    reminder_id: Option<&str>,
) -> Result<Option<i64>, String> {
    if text.len() > MAX_TEXT {
        return Err("Capture too long (over 1 MB).".into());
    }
    let text = text.trim();
    if text.is_empty() {
        return Err("Nothing to capture".into());
    }
    let mut conn = open(db)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| format!("Failed to save the capture: {e}"))?;
    if let Some(pid) = project_id {
        let found: Option<i64> = tx
            .query_row("SELECT id FROM projects WHERE id = ?1", [pid], |r| r.get(0))
            .optional()
            .map_err(|e| format!("Failed to check the project: {e}"))?;
        if found.is_none() {
            return Err("That project is not in this organisation".into());
        }
    }
    let n = tx
        .execute(
            "INSERT INTO captures (text, source, project_id, reminder_id) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(reminder_id) DO NOTHING",
            params![text, source.as_str(), project_id, reminder_id],
        )
        .map_err(|e| format!("Failed to save the capture: {e}"))?;
    let id = tx.last_insert_rowid();
    tx.commit().map_err(|e| format!("Failed to save the capture: {e}"))?;
    Ok(if n == 0 { None } else { Some(id) })
}

/// Active projects, by client then name: the picker's list.
pub fn open_projects(db: &Path) -> Result<Vec<CaptureProject>, String> {
    let conn = open(db)?;
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.name, c.name FROM projects p JOIN clients c ON c.id = p.client_id
             WHERE p.status = 'active' ORDER BY c.name COLLATE NOCASE, p.name COLLATE NOCASE",
        )
        .map_err(|e| format!("Failed to list projects: {e}"))?;
    let rows = stmt
        .query_map([], |r| Ok(CaptureProject { id: r.get(0)?, name: r.get(1)?, client: r.get(2)? }))
        .map_err(|e| format!("Failed to list projects: {e}"))?;
    rows.collect::<Result<_, _>>().map_err(|e| format!("Failed to list projects: {e}"))
}

/// A webview may only capture as itself: never as an agent or a reminder.
fn webview_source(s: &str) -> Result<Source, String> {
    match s {
        "hotkey" => Ok(Source::Hotkey),
        "menubar" => Ok(Source::Menubar),
        _ => Err("Unknown capture source".into()),
    }
}

fn add_for_org(org: &ActiveOrg, text: &str, project_id: Option<i64>, source: &str) -> Result<i64, String> {
    let source = webview_source(source)?;
    if org.in_mode() {
        return Err(CAPTURE_MODE.into());
    }
    add(&org.prod_db_path(), text, source, project_id, None)?.ok_or_else(|| "Failed to save the capture".into())
}

#[tauri::command]
pub async fn capture_add(
    app: tauri::AppHandle,
    state: tauri::State<'_, super::AgentsState>,
    text: String,
    project_id: Option<i64>,
    source: String,
) -> Result<i64, String> {
    switched_on(&state)?;
    let handle = app.clone();
    let id = blocking(move || {
        let _guard = crate::org_shared();
        let org = crate::active_org(&handle)?;
        add_for_org(&org, &text, project_id, &source)
    })
    .await?;
    if let Err(e) = app.emit(crate::agent_access::CHANGED_EVENT, ["capture"]) {
        log::warn!("[capture] emit {}: {e}", crate::agent_access::CHANGED_EVENT);
    }
    Ok(id)
}

#[tauri::command]
pub async fn capture_projects(
    app: tauri::AppHandle,
    state: tauri::State<'_, super::AgentsState>,
) -> Result<Vec<CaptureProject>, String> {
    switched_on(&state)?;
    blocking(move || {
        let _guard = crate::org_shared();
        let org = crate::active_org(&app)?;
        open_projects(&org.prod_db_path())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("sm-capture-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// A migrated database in `dir` with one client and two projects (one on hold).
    fn migrated(dir: &Path, file: &str) -> PathBuf {
        let path = dir.join(file);
        let conn = Connection::open(&path).unwrap();
        for m in crate::migrate::MIGRATIONS {
            conn.execute_batch(m.sql).unwrap();
        }
        conn.execute("INSERT INTO clients (id, name) VALUES ('c1', 'Studio A')", []).unwrap();
        conn.execute("INSERT INTO projects (id, client_id, name) VALUES (1, 'c1', 'Identity')", []).unwrap();
        conn.execute("INSERT INTO projects (id, client_id, name, status) VALUES (2, 'c1', 'Poster tool', 'on_hold')", [])
            .unwrap();
        path
    }

    fn count(db: &Path) -> i64 {
        Connection::open(db).unwrap().query_row("SELECT COUNT(*) FROM captures", [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn add_stores_a_trimmed_new_capture() {
        let db = migrated(&tmp("add"), "studiomanager.db");
        let id = add(&db, "  call the printer \n", Source::Hotkey, None, None).unwrap().unwrap();
        let (text, source, status): (String, String, String) = Connection::open(&db)
            .unwrap()
            .query_row("SELECT text, source, status FROM captures WHERE id = ?1", [id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!((text.as_str(), source.as_str(), status.as_str()), ("call the printer", "hotkey", "new"));
    }

    #[test]
    fn empty_text_and_unknown_projects_are_refused() {
        let db = migrated(&tmp("refuse"), "studiomanager.db");
        assert_eq!(add(&db, "", Source::Menubar, None, None).unwrap_err(), "Nothing to capture");
        assert_eq!(add(&db, " \n\t ", Source::Menubar, None, None).unwrap_err(), "Nothing to capture");
        assert_eq!(
            add(&db, "idea", Source::Menubar, Some(99), None).unwrap_err(),
            "That project is not in this organisation"
        );
        assert_eq!(count(&db), 0);
        let id = add(&db, "idea", Source::Menubar, Some(1), None).unwrap().unwrap();
        let pid: i64 = Connection::open(&db)
            .unwrap()
            .query_row("SELECT project_id FROM captures WHERE id = ?1", [id], |r| r.get(0))
            .unwrap();
        assert_eq!(pid, 1);
    }

    #[test]
    fn text_over_one_megabyte_is_refused() {
        let db = migrated(&tmp("big"), "studiomanager.db");
        let big = "a".repeat(MAX_TEXT + 1);
        assert!(add(&db, &big, Source::Agent, None, None).unwrap_err().contains("too long"));
        assert_eq!(count(&db), 0);
    }

    #[test]
    fn the_same_reminder_is_read_once() {
        let db = migrated(&tmp("reminder"), "studiomanager.db");
        assert!(add(&db, "buy tape", Source::Reminders, None, Some("rem-1")).unwrap().is_some());
        assert_eq!(add(&db, "buy tape", Source::Reminders, None, Some("rem-1")).unwrap(), None);
        assert_eq!(count(&db), 1);
        // captures without a reminder id never collide
        assert!(add(&db, "a", Source::Agent, None, None).unwrap().is_some());
        assert!(add(&db, "a", Source::Agent, None, None).unwrap().is_some());
    }

    #[test]
    fn a_locked_database_fails_after_the_busy_timeout() {
        let db = migrated(&tmp("busy"), "studiomanager.db");
        let (tx, rx) = std::sync::mpsc::channel();
        let (done_tx, done_rx) = std::sync::mpsc::channel::<()>();
        let held = db.clone();
        let holder = std::thread::spawn(move || {
            let conn = Connection::open(&held).unwrap();
            conn.execute_batch("BEGIN IMMEDIATE").unwrap();
            tx.send(()).unwrap();
            // hold the lock until the capture has given up: a fixed sleep raced
            // the busy timeout on a slow machine
            done_rx.recv().unwrap();
            conn.execute_batch("ROLLBACK").unwrap();
        });
        rx.recv().unwrap();
        let started = std::time::Instant::now();
        let res = add(&db, "idea", Source::Hotkey, None, None);
        let waited = started.elapsed();
        done_tx.send(()).unwrap();
        holder.join().unwrap();
        let err = res.unwrap_err();
        assert!(err.contains("Failed to save the capture"), "{err}");
        assert!(waited >= Duration::from_secs(4), "{waited:?}");
        assert_eq!(count(&db), 0);
    }

    #[test]
    fn a_webview_captures_only_as_hotkey_or_menubar() {
        let dir = tmp("source");
        let db = migrated(&dir, crate::DB_FILE);
        let org = ActiveOrg { id: "abc123".into(), dir, db_name: crate::DB_FILE.into() };
        assert!(add_for_org(&org, "idea", None, "hotkey").is_ok());
        assert!(add_for_org(&org, "idea", None, "menubar").is_ok());
        for bad in ["agent", "reminders", "", "Hotkey"] {
            assert!(add_for_org(&org, "idea", None, bad).is_err(), "{bad}");
        }
        assert_eq!(count(&db), 2);
    }

    #[test]
    fn a_mode_database_is_never_written() {
        let dir = tmp("mode");
        let prod = migrated(&dir, crate::DB_FILE);
        let test = migrated(&dir, "studiomanager_test.db");
        let org = ActiveOrg { id: "abc123".into(), dir, db_name: "studiomanager_test.db".into() };
        assert_eq!(add_for_org(&org, "idea", None, "hotkey").unwrap_err(), CAPTURE_MODE);
        assert_eq!((count(&prod), count(&test)), (0, 0));
    }

    #[test]
    fn open_projects_lists_active_ones_by_client_then_name() {
        let db = migrated(&tmp("projects"), "studiomanager.db");
        let conn = Connection::open(&db).unwrap();
        conn.execute("INSERT INTO clients (id, name) VALUES ('c0', 'Atelier B')", []).unwrap();
        conn.execute("INSERT INTO projects (id, client_id, name) VALUES (3, 'c0', 'Zine')", []).unwrap();
        drop(conn);
        let list = open_projects(&db).unwrap();
        assert_eq!(
            list,
            vec![
                CaptureProject { id: 3, name: "Zine".into(), client: "Atelier B".into() },
                CaptureProject { id: 1, name: "Identity".into(), client: "Studio A".into() },
            ]
        );
    }
}
