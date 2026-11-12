//! Write tools: each opens a write connection through the guards, does all
//! its work in one `BEGIN IMMEDIATE` transaction, commits, then appends one
//! line to the change log. Rows are only ever inserted or updated, and the
//! calendar, workload and layout columns the app owns are never written.

use crate::guard::{self, Org};
use crate::read::{self, ProjectRef};
use crate::text::fold;
use crate::{log, markdown};
use chrono::NaiveDate;
use rusqlite::types::Value;
use rusqlite::{
    params, params_from_iter, Connection, OptionalExtension, Transaction, TransactionBehavior,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

type R<T> = Result<T, String>;

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct ProjectResult {
    pub org: String,
    pub project: ProjectRef,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct TaskResult {
    pub org: String,
    pub id: i64,
    pub title: String,
    pub status: String,
    pub priority: Option<String>,
    pub due_date: Option<String>,
    pub project_id: i64,
    pub project: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct SubtaskResult {
    pub org: String,
    pub id: i64,
    pub title: String,
    pub status: String,
    pub due_date: Option<String>,
    pub task_id: i64,
    pub task: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct ClientResult {
    pub org: String,
    pub id: String,
    pub name: String,
    pub language: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct ArticleResult {
    pub org: String,
    pub project_id: i64,
    pub project: String,
    pub id: i64,
    pub title: String,
    pub created: bool,
    /// `[[...]]` links that matched no article: left as text.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub unresolved_links: Vec<String>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct DecisionResult {
    pub org: String,
    pub project_id: i64,
    pub project: String,
    pub article_id: i64,
    /// False when the same decision was already recorded.
    pub added: bool,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct ToolResult {
    pub org: String,
    pub project_id: i64,
    pub project: String,
    pub resource_id: i64,
    pub name: String,
    pub url: String,
    /// True when no matching resource existed and one was added.
    pub created: bool,
}

/// Fields `update_project` may change; `None` leaves a field as it is.
/// An empty `deadline` or `folder_path` clears it.
#[derive(Deserialize, Default, Debug, Clone)]
pub struct ProjectChanges {
    pub status: Option<String>,
    pub deadline: Option<String>,
    pub notes: Option<String>,
    pub folder_path: Option<String>,
}

/// Fields `update_task` may change; `None` leaves a field as it is.
/// An empty `due_date` clears it.
#[derive(Deserialize, Default, Debug, Clone)]
pub struct TaskChanges {
    pub title: Option<String>,
    pub status: Option<String>,
    pub due_date: Option<String>,
    pub priority: Option<String>,
    pub notes: Option<String>,
}

/// Fields `update_subtask` may change; `None` leaves a field as it is.
/// An empty `due_date` clears it.
#[derive(Deserialize, Default, Debug, Clone)]
pub struct SubtaskChanges {
    pub title: Option<String>,
    pub status: Option<String>,
    pub due_date: Option<String>,
}

// ── Shared mechanics ─────────────────────────────────────────

pub(crate) fn db<T>(r: rusqlite::Result<T>) -> R<T> {
    read::db(r)
}

/// Run `work` in one `BEGIN IMMEDIATE` transaction, commit, then log its
/// summary. A `None` summary means nothing changed and nothing is logged.
/// Any error drops the transaction, which rolls it back.
pub(crate) fn write<T>(
    dir: &Path,
    org: &Org,
    tool: &str,
    work: impl FnOnce(&Transaction) -> R<(T, Option<String>)>,
) -> R<T> {
    let mut conn = guard::open_write(dir, org)?;
    let tx = db(conn.transaction_with_behavior(TransactionBehavior::Immediate))?;
    let (out, summary) = work(&tx)?;
    db(tx.commit())?;
    if let Some(summary) = summary {
        log::append(dir, &org.id, tool, &summary);
    }
    Ok(out)
}

/// `UPDATE <table> SET <given columns>, updated_at = now WHERE id = ?`.
/// Column names are always literals from this file.
pub(crate) fn update_row(conn: &Connection, table: &str, id: i64, sets: Vec<(&'static str, Value)>) -> R<()> {
    let mut parts: Vec<String> = sets
        .iter()
        .enumerate()
        .map(|(i, (col, _))| format!("{col} = ?{}", i + 1))
        .collect();
    parts.push("updated_at = datetime('now')".to_string());
    let sql = format!(
        "UPDATE {table} SET {} WHERE id = ?{}",
        parts.join(", "),
        sets.len() + 1
    );
    let mut values: Vec<Value> = sets.into_iter().map(|(_, v)| v).collect();
    values.push(Value::Integer(id));
    db(conn.execute(&sql, params_from_iter(values)))?;
    Ok(())
}

fn next_sort_order(conn: &Connection, table: &str, parent: &str, id: i64) -> R<i64> {
    db(conn.query_row(
        &format!("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM {table} WHERE {parent} = ?1"),
        [id],
        |r| r.get(0),
    ))
}

pub(crate) fn columns(sets: &[(&'static str, Value)]) -> String {
    sets.iter().map(|(c, _)| *c).collect::<Vec<_>>().join(", ")
}

// ── Validation ───────────────────────────────────────────────

pub const TASK_STATUS: &str = "Status must be \"todo\" or \"done\".";
pub const PROJECT_STATUS: &str = "Status must be one of: active, completed, on_hold, cancelled.";
pub const PRIORITY: &str = "Priority must be low, medium or high.";
pub const DATES: &str = "Dates use YYYY-MM-DD.";
pub const FULL_PATH: &str = "Use a full folder path.";
pub const LANGUAGE: &str = "Language must be FR or EN.";
pub const NOTHING: &str = "Nothing to update.";
pub const FOLDER_MISSING: &str = "No folder at that path.";
pub const FOLDER_OUTSIDE: &str =
    "Link the project's own folder, inside Documents, Desktop, Downloads or ~/Library/CloudStorage.";
pub const FOLDER_BUNDLE: &str = "That is an app or a bundle, not a project folder.";

/// Largest title, name, notes or article an agent may write.
pub const MAX_TEXT: usize = 1024 * 1024;

/// Folder extensions macOS opens as a package (an app, a plug-in…).
const BUNDLE_EXTENSIONS: [&str; 15] = [
    "app", "appex", "bundle", "component", "framework", "kext", "mdimporter", "mpkg", "pkg",
    "plugin", "prefpane", "qlgenerator", "saver", "workflow", "xpc",
];

fn task_status(s: &str) -> R<&'static str> {
    match s.trim() {
        "todo" => Ok("todo"),
        "done" => Ok("done"),
        _ => Err(TASK_STATUS.to_string()),
    }
}

fn project_status(s: &str) -> R<&'static str> {
    match s.trim() {
        "active" => Ok("active"),
        "completed" => Ok("completed"),
        "on_hold" => Ok("on_hold"),
        "cancelled" => Ok("cancelled"),
        _ => Err(PROJECT_STATUS.to_string()),
    }
}

fn parse_priority(s: &str) -> R<&'static str> {
    match s.trim() {
        "low" => Ok("low"),
        "medium" => Ok("medium"),
        "high" => Ok("high"),
        _ => Err(PRIORITY.to_string()),
    }
}

pub(crate) fn parse_date(s: &str) -> R<String> {
    let s = s.trim();
    if s.len() == 10 && NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok() {
        Ok(s.to_string())
    } else {
        Err(DATES.to_string())
    }
}

/// Creation: absent or empty means no date.
pub(crate) fn optional_date(s: Option<&str>) -> R<Option<String>> {
    match s.map(str::trim) {
        None | Some("") => Ok(None),
        Some(d) => parse_date(d).map(Some),
    }
}

/// Update: an empty string clears the date.
pub(crate) fn date_value(s: &str) -> R<Value> {
    if s.trim().is_empty() {
        Ok(Value::Null)
    } else {
        parse_date(s).map(Value::Text)
    }
}

pub(crate) fn capped<'a>(s: &'a str, what: &str) -> R<&'a str> {
    if s.len() > MAX_TEXT {
        Err(format!("{what} too long (over 1 MB)."))
    } else {
        Ok(s)
    }
}

pub(crate) fn required(s: &str, what: &str) -> R<String> {
    let t = capped(s, what)?.trim();
    if t.is_empty() {
        Err(format!("{what} can't be empty."))
    } else {
        Ok(t.to_string())
    }
}

/// Where a project folder may be: the places the app reads project files
/// from (the app's `doc_roots.rs`, compiled in here). Tests add the temp
/// dir, where their fixtures live.
fn allowed_roots() -> Vec<PathBuf> {
    let mut roots = crate::doc_roots::allowed_roots();
    if cfg!(test) {
        roots.extend(std::fs::canonicalize(std::env::temp_dir()).ok());
    }
    roots
}

fn is_bundle(path: &Path) -> bool {
    path.components().any(|c| {
        Path::new(c.as_os_str())
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| BUNDLE_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
    })
}

/// An existing folder inside one of the allowed places (not the place
/// itself, which would claim every folder in it) and not an app bundle.
/// Stored as given minus trailing slashes.
fn folder_path(s: &str) -> R<String> {
    let t = s.trim();
    if !t.starts_with('/') {
        return Err(FULL_PATH.to_string());
    }
    let t = match t.trim_end_matches('/') {
        "" => "/",
        t => t,
    };
    let real = std::fs::canonicalize(t)
        .ok()
        .filter(|p| p.is_dir())
        .ok_or_else(|| FOLDER_MISSING.to_string())?;
    if is_bundle(Path::new(t)) || is_bundle(&real) {
        return Err(FOLDER_BUNDLE.to_string());
    }
    if !crate::doc_roots::inside_root(&real, &allowed_roots()) {
        return Err(FOLDER_OUTSIDE.to_string());
    }
    Ok(t.to_string())
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

// ── Projects ─────────────────────────────────────────────────

mod captures;
mod clients;
mod projects;
mod tasks;
mod tools;
mod wiki;

pub use captures::{capture, file_capture, set_brief, Filing};
pub use clients::create_client;
pub use projects::{create_project, link_folder, update_project};
pub use tasks::{create_subtask, create_task, update_subtask, update_task};
pub use tools::link_tool;
pub use wiki::{add_decision, put_wiki_article};

#[cfg(test)]
mod test_util;

#[cfg(test)]
mod tests {
    use super::test_util::*;
    use super::*;

    #[test]
    fn concurrent_writer_waits() {
        let (dir, org, _conn) = fixture();
        // Take the backup first so the race is only between the writers.
        drop(guard::open_write(&dir, &org).unwrap());
        let db = org.db.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        let holder = std::thread::spawn(move || {
            let other = Connection::open(db).unwrap();
            other.execute_batch("BEGIN IMMEDIATE").unwrap();
            other
                .execute("UPDATE projects SET notes = 'held' WHERE id = 2", [])
                .unwrap();
            tx.send(()).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(300));
            other.execute_batch("COMMIT").unwrap();
        });
        rx.recv().unwrap();
        let started = std::time::Instant::now();
        let r = create_task(&dir, &org, "1", "While busy", None, None, None).unwrap();
        assert!(started.elapsed() >= std::time::Duration::from_millis(100));
        holder.join().unwrap();
        assert_eq!(r.title, "While busy");
        let conn = Connection::open(&org.db).unwrap();
        let notes: String = one(&conn, "SELECT notes FROM projects WHERE id = 2");
        assert_eq!(notes, "held");
    }

    #[test]
    fn write_logged() {
        let (dir, org, _conn) = fixture();
        let t = create_task(&dir, &org, "1", "Print proofs", None, None, None).unwrap();
        update_task(
            &dir,
            &org,
            t.id,
            &TaskChanges {
                status: Some("done".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let lines = log_lines(&dir);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0]["org"], "org001");
        assert_eq!(lines[0]["tool"], "create_task");
        let s = lines[0]["summary"].as_str().unwrap();
        assert!(
            s.contains("Print proofs") && s.contains("Identité Visuelle"),
            "{s}"
        );
        assert_eq!(lines[1]["tool"], "update_task");
        // A refused write leaves no log line.
        let _ = create_task(&dir, &org, "1", "", None, None, None);
        assert_eq!(log_lines(&dir).len(), 2);
    }

    #[test]
    fn writes_refused_in_test_mode() {
        let (dir, org, conn) = fixture();
        std::fs::write(org.db.with_file_name("studiomanager_test.db"), "").unwrap();
        assert_eq!(
            create_task(&dir, &org, "1", "x", None, None, None).unwrap_err(),
            guard::MODE_ACTIVE
        );
        let n: i64 = one(&conn, "SELECT COUNT(*) FROM tasks");
        assert_eq!(n, 2);
    }

    #[test]
    fn no_delete_statements() {
        // Needles are split so this test does not match itself.
        let src = [include_str!("mod.rs"), include_str!("captures.rs"), include_str!("projects.rs"), include_str!("tasks.rs"), include_str!("clients.rs"), include_str!("wiki.rs"), include_str!("tools.rs")].concat().to_uppercase();
        assert!(!src.contains(concat!("DEL", "ETE ")));
        assert!(!src.contains(concat!("ALT", "ER ")));
    }
}
