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

fn db<T>(r: rusqlite::Result<T>) -> R<T> {
    read::db(r)
}

/// Run `work` in one `BEGIN IMMEDIATE` transaction, commit, then log its
/// summary. A `None` summary means nothing changed and nothing is logged.
/// Any error drops the transaction, which rolls it back.
fn write<T>(
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
fn update_row(conn: &Connection, table: &str, id: i64, sets: Vec<(&'static str, Value)>) -> R<()> {
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

fn columns(sets: &[(&'static str, Value)]) -> String {
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

fn parse_date(s: &str) -> R<String> {
    let s = s.trim();
    if s.len() == 10 && NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok() {
        Ok(s.to_string())
    } else {
        Err(DATES.to_string())
    }
}

/// Creation: absent or empty means no date.
fn optional_date(s: Option<&str>) -> R<Option<String>> {
    match s.map(str::trim) {
        None | Some("") => Ok(None),
        Some(d) => parse_date(d).map(Some),
    }
}

/// Update: an empty string clears the date.
fn date_value(s: &str) -> R<Value> {
    if s.trim().is_empty() {
        Ok(Value::Null)
    } else {
        parse_date(s).map(Value::Text)
    }
}

fn capped<'a>(s: &'a str, what: &str) -> R<&'a str> {
    if s.len() > MAX_TEXT {
        Err(format!("{what} too long (over 1 MB)."))
    } else {
        Ok(s)
    }
}

fn required(s: &str, what: &str) -> R<String> {
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

fn project_result(conn: &Connection, org: &Org, id: i64) -> R<ProjectResult> {
    Ok(ProjectResult {
        org: org.name.clone(),
        project: read::project_ref(conn, id)?,
    })
}

pub fn link_folder(dir: &Path, org: &Org, project: &str, folder: &str) -> R<ProjectResult> {
    let path = folder_path(folder)?;
    write(dir, org, "link_folder", |tx| {
        let id = read::resolve_project(tx, project)?;
        update_row(
            tx,
            "projects",
            id,
            vec![("folder_path", Value::Text(path.clone()))],
        )?;
        let r = project_result(tx, org, id)?;
        let summary = format!("Linked project \"{}\" (id {id}) to {path}", r.project.name);
        Ok((r, Some(summary)))
    })
}

pub fn create_project(
    dir: &Path,
    org: &Org,
    client: &str,
    name: &str,
    status: Option<&str>,
    deadline: Option<&str>,
    notes: Option<&str>,
) -> R<ProjectResult> {
    let name = required(name, "Name")?;
    let status = project_status(status.unwrap_or("active"))?;
    let deadline = optional_date(deadline)?;
    let notes = capped(notes.unwrap_or(""), "Notes")?.to_string();
    write(dir, org, "create_project", |tx| {
        let client_id = read::resolve_client(tx, client)?;
        let mut stmt = db(tx.prepare("SELECT id, name FROM projects WHERE client_id = ?1"))?;
        let existing: Vec<(i64, String)> = db(stmt
            .query_map([&client_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .and_then(|rows| rows.collect()))?;
        if let Some((id, n)) = existing.iter().find(|(_, n)| fold(n.trim()) == fold(&name)) {
            return Err(format!(
                "Client {client_id} already has a project named \"{n}\" (id {id})."
            ));
        }
        db(tx.execute(
            "INSERT INTO projects (client_id, name, status, deadline, notes) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![client_id, name, status, deadline, notes],
        ))?;
        let id = tx.last_insert_rowid();
        let r = project_result(tx, org, id)?;
        let summary = format!(
            "Created project \"{name}\" (id {id}) for client \"{}\"",
            r.project.client_name
        );
        Ok((r, Some(summary)))
    })
}

pub fn update_project(
    dir: &Path,
    org: &Org,
    project: &str,
    changes: &ProjectChanges,
) -> R<ProjectResult> {
    let mut sets: Vec<(&'static str, Value)> = Vec::new();
    if let Some(s) = &changes.status {
        sets.push(("status", Value::Text(project_status(s)?.to_string())));
    }
    if let Some(d) = &changes.deadline {
        sets.push(("deadline", date_value(d)?));
    }
    if let Some(n) = &changes.notes {
        sets.push(("notes", Value::Text(capped(n, "Notes")?.to_string())));
    }
    if let Some(f) = &changes.folder_path {
        let v = if f.trim().is_empty() {
            Value::Null
        } else {
            Value::Text(folder_path(f)?)
        };
        sets.push(("folder_path", v));
    }
    if sets.is_empty() {
        return Err(NOTHING.to_string());
    }
    write(dir, org, "update_project", |tx| {
        let id = read::resolve_project(tx, project)?;
        let changed = columns(&sets);
        update_row(tx, "projects", id, sets)?;
        let r = project_result(tx, org, id)?;
        let summary = format!(
            "Updated project \"{}\" (id {id}): {changed}",
            r.project.name
        );
        Ok((r, Some(summary)))
    })
}

// ── Tasks and subtasks ───────────────────────────────────────

fn task_result(conn: &Connection, org: &Org, id: i64) -> R<TaskResult> {
    db(conn
        .query_row(
            "SELECT t.id, t.title, t.status, t.priority, t.due_date, t.project_id, p.name \
             FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ?1",
            [id],
            |r| {
                Ok(TaskResult {
                    org: org.name.clone(),
                    id: r.get(0)?,
                    title: r.get(1)?,
                    status: r.get(2)?,
                    priority: r.get(3)?,
                    due_date: r.get(4)?,
                    project_id: r.get(5)?,
                    project: r.get(6)?,
                })
            },
        )
        .optional())?
    .ok_or_else(|| format!("No task with id {id}."))
}

fn subtask_result(conn: &Connection, org: &Org, id: i64) -> R<SubtaskResult> {
    db(conn
        .query_row(
            "SELECT s.id, s.title, s.status, s.due_date, s.task_id, t.title \
             FROM subtasks s JOIN tasks t ON t.id = s.task_id WHERE s.id = ?1",
            [id],
            |r| {
                Ok(SubtaskResult {
                    org: org.name.clone(),
                    id: r.get(0)?,
                    title: r.get(1)?,
                    status: r.get(2)?,
                    due_date: r.get(3)?,
                    task_id: r.get(4)?,
                    task: r.get(5)?,
                })
            },
        )
        .optional())?
    .ok_or_else(|| format!("No subtask with id {id}."))
}

pub fn create_task(
    dir: &Path,
    org: &Org,
    project: &str,
    title: &str,
    due_date: Option<&str>,
    priority: Option<&str>,
    notes: Option<&str>,
) -> R<TaskResult> {
    let title = required(title, "Title")?;
    let due = optional_date(due_date)?;
    let prio = parse_priority(priority.unwrap_or("medium"))?;
    let notes = capped(notes.unwrap_or(""), "Notes")?.to_string();
    write(dir, org, "create_task", |tx| {
        let pid = read::resolve_project(tx, project)?;
        let order = next_sort_order(tx, "tasks", "project_id", pid)?;
        db(tx.execute(
            "INSERT INTO tasks (project_id, title, status, priority, due_date, notes, sort_order) \
             VALUES (?1, ?2, 'todo', ?3, ?4, ?5, ?6)",
            params![pid, title, prio, due, notes, order],
        ))?;
        let r = task_result(tx, org, tx.last_insert_rowid())?;
        let summary = format!(
            "Created task \"{title}\" (id {}) in project \"{}\"",
            r.id, r.project
        );
        Ok((r, Some(summary)))
    })
}

pub fn update_task(dir: &Path, org: &Org, task_id: i64, changes: &TaskChanges) -> R<TaskResult> {
    let mut sets: Vec<(&'static str, Value)> = Vec::new();
    if let Some(t) = &changes.title {
        sets.push(("title", Value::Text(required(t, "Title")?)));
    }
    if let Some(s) = &changes.status {
        sets.push(("status", Value::Text(task_status(s)?.to_string())));
    }
    if let Some(d) = &changes.due_date {
        sets.push(("due_date", date_value(d)?));
    }
    if let Some(p) = &changes.priority {
        sets.push(("priority", Value::Text(parse_priority(p)?.to_string())));
    }
    if let Some(n) = &changes.notes {
        sets.push(("notes", Value::Text(capped(n, "Notes")?.to_string())));
    }
    if sets.is_empty() {
        return Err(NOTHING.to_string());
    }
    write(dir, org, "update_task", |tx| {
        task_result(tx, org, task_id)?;
        let changed = columns(&sets);
        update_row(tx, "tasks", task_id, sets)?;
        let r = task_result(tx, org, task_id)?;
        let summary = format!(
            "Updated task \"{}\" (id {task_id}) in project \"{}\": {changed}",
            r.title, r.project
        );
        Ok((r, Some(summary)))
    })
}

pub fn create_subtask(
    dir: &Path,
    org: &Org,
    task_id: i64,
    title: &str,
    due_date: Option<&str>,
) -> R<SubtaskResult> {
    let title = required(title, "Title")?;
    let due = optional_date(due_date)?;
    write(dir, org, "create_subtask", |tx| {
        task_result(tx, org, task_id)?;
        let order = next_sort_order(tx, "subtasks", "task_id", task_id)?;
        db(tx.execute(
            "INSERT INTO subtasks (task_id, title, status, due_date, sort_order) \
             VALUES (?1, ?2, 'todo', ?3, ?4)",
            params![task_id, title, due, order],
        ))?;
        let r = subtask_result(tx, org, tx.last_insert_rowid())?;
        let summary = format!(
            "Created subtask \"{title}\" (id {}) under task \"{}\" (id {task_id})",
            r.id, r.task
        );
        Ok((r, Some(summary)))
    })
}

pub fn update_subtask(
    dir: &Path,
    org: &Org,
    subtask_id: i64,
    changes: &SubtaskChanges,
) -> R<SubtaskResult> {
    let mut sets: Vec<(&'static str, Value)> = Vec::new();
    if let Some(t) = &changes.title {
        sets.push(("title", Value::Text(required(t, "Title")?)));
    }
    if let Some(s) = &changes.status {
        sets.push(("status", Value::Text(task_status(s)?.to_string())));
    }
    if let Some(d) = &changes.due_date {
        sets.push(("due_date", date_value(d)?));
    }
    if sets.is_empty() {
        return Err(NOTHING.to_string());
    }
    write(dir, org, "update_subtask", |tx| {
        subtask_result(tx, org, subtask_id)?;
        let changed = columns(&sets);
        update_row(tx, "subtasks", subtask_id, sets)?;
        let r = subtask_result(tx, org, subtask_id)?;
        let summary = format!(
            "Updated subtask \"{}\" (id {subtask_id}) under task \"{}\": {changed}",
            r.title, r.task
        );
        Ok((r, Some(summary)))
    })
}

// ── Clients ──────────────────────────────────────────────────

pub fn create_client(
    dir: &Path,
    org: &Org,
    name: &str,
    email: Option<&str>,
    language: Option<&str>,
) -> R<ClientResult> {
    let name = required(name, "Name")?;
    let email = capped(email.unwrap_or(""), "Email")?.trim().to_string();
    let language = match language.unwrap_or("FR").trim().to_uppercase().as_str() {
        "FR" => "FR",
        "EN" => "EN",
        _ => return Err(LANGUAGE.to_string()),
    };
    write(dir, org, "create_client", |tx| {
        let mut stmt = db(tx.prepare("SELECT id, name FROM clients ORDER BY id"))?;
        let existing: Vec<(String, String)> = db(stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .and_then(|rows| rows.collect()))?;
        if let Some((id, n)) = existing.iter().find(|(_, n)| fold(n.trim()) == fold(&name)) {
            return Err(format!("A client named \"{n}\" already exists (id {id})."));
        }
        // Same numbering as the app's getNextClientId.
        let max: Option<i64> = db(tx.query_row(
            "SELECT MAX(CAST(SUBSTR(id, 3) AS INTEGER)) FROM clients",
            [],
            |r| r.get(0),
        ))?;
        let id = format!("C-{:03}", max.unwrap_or(0) + 1);
        db(tx.execute(
            "INSERT INTO clients (id, name, billing_name, email, language) \
             VALUES (?1, ?2, ?2, ?3, ?4)",
            params![id, name, email, language],
        ))?;
        let summary = format!("Created client \"{name}\" ({id})");
        Ok((
            ClientResult {
                org: org.name.clone(),
                id,
                name: name.clone(),
                language: language.to_string(),
            },
            Some(summary),
        ))
    })
}

// ── Wiki ─────────────────────────────────────────────────────

fn article_content(conn: &Connection, id: i64) -> R<String> {
    db(conn.query_row("SELECT content FROM wiki_articles WHERE id = ?1", [id], |r| r.get(0)))
}

fn project_name(conn: &Connection, id: i64) -> R<String> {
    db(
        conn.query_row("SELECT name FROM projects WHERE id = ?1", [id], |r| {
            r.get(0)
        }),
    )
}

/// The project's wiki folder: the folder whose trimmed name equals the
/// project name, created at the end of the list if missing.
fn wiki_folder(conn: &Connection, project: &str) -> R<i64> {
    let name = project.trim();
    let found: Option<i64> = db(conn
        .query_row(
            "SELECT id FROM wiki_folders WHERE TRIM(name) = ?1 ORDER BY id LIMIT 1",
            [name],
            |r| r.get(0),
        )
        .optional())?;
    if let Some(id) = found {
        return Ok(id);
    }
    db(conn.execute(
        "INSERT INTO wiki_folders (name, sort_order) \
         VALUES (?1, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM wiki_folders))",
        [name],
    ))?;
    Ok(conn.last_insert_rowid())
}

/// The project's article with this title (accent/case-folded), as id and
/// stored title; several matches are listed, never picked. Titles only:
/// contents stay on disk.
fn find_article(conn: &Connection, project_id: i64, title: &str) -> R<Option<(i64, String)>> {
    let mut stmt =
        db(conn.prepare("SELECT id, title FROM wiki_articles WHERE project_id = ?1 ORDER BY id"))?;
    let rows: Vec<(i64, String)> = db(stmt
        .query_map([project_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .and_then(|rows| rows.collect()))?;
    let wanted = fold(title.trim());
    let hits: Vec<&(i64, String)> = rows
        .iter()
        .filter(|(_, t)| fold(t.trim()) == wanted)
        .collect();
    match hits.as_slice() {
        [] => Ok(None),
        [one] => Ok(Some((*one).clone())),
        many => {
            let list: Vec<String> = many
                .iter()
                .map(|(id, t)| format!("{t} (id {id})"))
                .collect();
            Err(format!(
                "Several articles match \"{title}\": {}. Rename one in StudioManager first.",
                list.join(", ")
            ))
        }
    }
}

/// Tags the app shows for a project article: the project name and the
/// lowercased title.
fn tag_article(conn: &Connection, article_id: i64, project: &str, title: &str) -> R<()> {
    for tag in [project.trim().to_string(), title.trim().to_lowercase()] {
        db(conn.execute(
            "INSERT OR IGNORE INTO wiki_article_tags (article_id, tag) VALUES (?1, ?2)",
            params![article_id, tag],
        ))?;
    }
    Ok(())
}

fn insert_article(
    conn: &Connection,
    project_id: i64,
    project: &str,
    title: &str,
    content: &str,
) -> R<i64> {
    let folder = wiki_folder(conn, project)?;
    let order = next_sort_order(conn, "wiki_articles", "folder_id", folder)?;
    db(conn.execute(
        "INSERT INTO wiki_articles (folder_id, project_id, title, content, sort_order) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![folder, project_id, title, content, order],
    ))?;
    let id = conn.last_insert_rowid();
    tag_article(conn, id, project, title)?;
    Ok(id)
}

/// What a `[[...]]` link points at: `Title` (this project first, then a
/// title unique in the organisation), or `Project/Title`.
fn find_link_target(articles: &[(i64, String, Option<i64>, String)], pid: i64, target: &str) -> Option<i64> {
    let target = target.trim();
    if let Some((project, title)) = target.rsplit_once('/') {
        let (fp, ft) = (fold(project.trim()), fold(title.trim()));
        let hits: Vec<i64> = articles
            .iter()
            .filter(|(_, t, _, p)| fold(t) == ft && fold(p) == fp)
            .map(|a| a.0)
            .collect();
        if hits.len() == 1 {
            return Some(hits[0]);
        }
    }
    let ft = fold(target);
    if let Some(a) = articles.iter().find(|(_, t, p, _)| *p == Some(pid) && fold(t) == ft) {
        return Some(a.0);
    }
    let hits: Vec<i64> = articles.iter().filter(|(_, t, _, _)| fold(t) == ft).map(|a| a.0).collect();
    (hits.len() == 1).then(|| hits[0])
}

/// Whether a file exists; `Path::is_file` outside tests.
type Exists<'a> = &'a dyn Fn(&Path) -> bool;

/// A Markdown file of a project's folder: `[[docs/guide.md]]` in this
/// project, or `[[Project/docs/guide.md]]`. Only files that exist count.
fn find_file_target(
    folders: &[(i64, String, String)],
    pid: i64,
    target: &str,
    is_file: Exists,
) -> Option<(i64, String)> {
    let target = target.trim().trim_start_matches("./");
    if !target.to_ascii_lowercase().ends_with(".md") || target.split('/').any(|p| p == ".." || p.is_empty()) {
        return None;
    }
    let exists = |folder: &str, rel: &str| is_file(&Path::new(folder).join(rel));
    if let Some((_, _, folder)) = folders.iter().find(|(id, _, _)| *id == pid) {
        if exists(folder, target) {
            return Some((pid, target.to_string()));
        }
    }
    let (project, rel) = target.split_once('/')?;
    folders
        .iter()
        .find(|(_, name, folder)| fold(name) == fold(project) && exists(folder, rel))
        .map(|(id, _, _)| (*id, rel.to_string()))
}

/// `[[...]]` links in Markdown, outside fenced blocks and `code spans`:
/// each one's inside goes through `f`, which returns its replacement.
fn map_links(md: &str, f: &mut dyn FnMut(&str) -> String) -> String {
    fn links_in(text: &str, f: &mut dyn FnMut(&str) -> String) -> String {
        let mut out = String::new();
        let mut rest = text;
        while let Some(start) = rest.find("[[") {
            let after = &rest[start + 2..];
            match after.find("]]") {
                Some(end) if !after[..end].contains(['[', '\n']) && !after[..end].trim().is_empty() => {
                    out.push_str(&rest[..start]);
                    out.push_str(&f(&after[..end]));
                    rest = &after[end + 2..];
                }
                _ => {
                    out.push_str(&rest[..start + 2]);
                    rest = after;
                }
            }
        }
        out.push_str(rest);
        out
    }

    // Walk line by line, leaving fenced blocks and `code spans` untouched.
    let mut out = String::with_capacity(md.len());
    let mut in_fence = false;
    for line in md.split_inclusive('\n') {
        let t = line.trim_start();
        if t.starts_with("```") || t.starts_with("~~~") {
            in_fence = !in_fence;
            out.push_str(line);
            continue;
        }
        if in_fence {
            out.push_str(line);
            continue;
        }
        let mut rest = line;
        while let Some(tick) = rest.find('`') {
            out.push_str(&links_in(&rest[..tick], f));
            let run = rest[tick..].chars().take_while(|&c| c == '`').count();
            let fence = &rest[tick..tick + run];
            match rest[tick + run..].find(fence) {
                Some(close) => {
                    let end = tick + run + close + run;
                    out.push_str(&rest[tick..end]);
                    rest = &rest[end..];
                }
                None => {
                    out.push_str(&rest[tick..]);
                    rest = "";
                }
            }
        }
        out.push_str(&links_in(rest, f));
    }
    out
}

/// The link's target: what comes before `|`, or all of it.
fn link_target(inner: &str) -> &str {
    inner.split_once('|').map_or(inner, |(t, _)| t)
}

/// File links found on disk, by link target. Run on a read connection
/// before the write transaction: looking files up in a slow or offline
/// project folder must never hold the database's write lock.
fn file_links(
    conn: &Connection,
    pid: i64,
    md: &str,
    is_file: Exists,
) -> R<HashMap<String, (i64, String)>> {
    let mut found = HashMap::new();
    if !md.contains("[[") {
        return Ok(found);
    }
    let mut stmt = db(conn.prepare("SELECT id, name, folder_path FROM projects WHERE folder_path IS NOT NULL"))?;
    let folders: Vec<(i64, String, String)> = db(stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .and_then(|rows| rows.collect()))?;
    let mut targets = Vec::new();
    map_links(md, &mut |inner| {
        targets.push(link_target(inner).to_string());
        String::new()
    });
    for target in targets {
        if found.contains_key(&target) {
            continue;
        }
        if let Some(hit) = find_file_target(&folders, pid, &target, is_file) {
            found.insert(target, hit);
        }
    }
    Ok(found)
}

/// Replaces `[[Target]]` and `[[Target|text]]` with Markdown links to the
/// article (`/wiki?article=<id>`), or to a project file found beforehand
/// by `file_links`, outside code. Targets that match nothing stay as
/// written and are reported in `unresolved`.
pub(crate) fn resolve_wiki_links(
    tx: &Connection,
    pid: i64,
    md: &str,
    files: &HashMap<String, (i64, String)>,
    unresolved: &mut Vec<String>,
) -> R<String> {
    if !md.contains("[[") {
        return Ok(md.to_string());
    }
    let mut stmt = db(tx.prepare(
        "SELECT a.id, a.title, a.project_id, COALESCE(p.name, '') FROM wiki_articles a \
         LEFT JOIN projects p ON p.id = a.project_id",
    ))?;
    let articles: Vec<(i64, String, Option<i64>, String)> = db(stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .and_then(|rows| rows.collect()))?;

    Ok(map_links(md, &mut |inner| {
        let target = link_target(inner);
        let text = match inner.split_once('|') {
            Some((_, x)) => x.trim().to_string(),
            None => inner.rsplit_once('/').map_or(inner, |(_, t)| t).trim().to_string(),
        };
        if let Some((fpid, rel)) = files.get(target) {
            let file_text = match inner.split_once('|') {
                Some((_, x)) => x.trim().to_string(),
                None => rel.rsplit('/').next().unwrap_or(rel).to_string(),
            };
            if !file_text.contains(']') {
                return format!("[{file_text}](/wiki?file={fpid}:{})", rel.replace(' ', "%20"));
            }
        }
        match find_link_target(&articles, pid, target) {
            Some(id) if !text.contains(']') => format!("[{text}](/wiki?article={id})"),
            _ => {
                unresolved.push(target.trim().to_string());
                format!("[[{inner}]]")
            }
        }
    }))
}

pub fn put_wiki_article(
    dir: &Path,
    org: &Org,
    project: &str,
    title: &str,
    markdown: &str,
) -> R<ArticleResult> {
    put_wiki_article_with(dir, org, project, title, markdown, &|p: &Path| p.is_file())
}

fn put_wiki_article_with(
    dir: &Path,
    org: &Org,
    project: &str,
    title: &str,
    markdown: &str,
    is_file: Exists,
) -> R<ArticleResult> {
    let title = required(title, "Title")?;
    capped(markdown, "Content")?;
    // Project files first, on a read connection (see `file_links`).
    let (pid, files) = {
        let conn = guard::open_read(org)?;
        let pid = read::resolve_project(&conn, project)?;
        (pid, file_links(&conn, pid, markdown, is_file)?)
    };
    write(dir, org, "put_wiki_article", |tx| {
        // By id: the project resolved above (it can't be deleted meanwhile
        // through these tools, but the app could).
        let pid = read::resolve_project(tx, &pid.to_string())?;
        let pname = project_name(tx, pid)?;
        let mut unresolved = Vec::new();
        let html = markdown::to_html(&resolve_wiki_links(tx, pid, markdown, &files, &mut unresolved)?);
        let (id, stored_title, created) = match find_article(tx, pid, &title)? {
            Some((id, t)) => {
                update_row(
                    tx,
                    "wiki_articles",
                    id,
                    vec![("content", Value::Text(html.clone()))],
                )?;
                tag_article(tx, id, &pname, &t)?;
                (id, t, false)
            }
            None => (
                insert_article(tx, pid, &pname, &title, &html)?,
                title.clone(),
                true,
            ),
        };
        let verb = if created { "Created" } else { "Replaced" };
        let summary =
            format!("{verb} wiki article \"{stored_title}\" (id {id}) of project \"{pname}\"");
        Ok((
            ArticleResult {
                org: org.name.clone(),
                project_id: pid,
                project: pname,
                id,
                title: stored_title,
                created,
                unresolved_links: unresolved,
            },
            Some(summary),
        ))
    })
}

pub fn add_decision(
    dir: &Path,
    org: &Org,
    project: &str,
    date: &str,
    text: &str,
) -> R<DecisionResult> {
    let day = parse_date(date)?;
    let text = required(text, "Text")?;
    let head = format!("<strong>{day}</strong> {}", escape_html(&text));
    // Already recorded: as written here or in the editor (`<li><p>…</p>`),
    // or after a get→put round trip (tight `<li>…</li>`, quotes as &quot;).
    let heads = [head.clone(), head.replace('"', "&quot;")];
    let recorded = |content: &str| {
        heads.iter().any(|h| {
            content.contains(&format!("{h}</p>")) || content.contains(&format!("{h}</li>"))
        })
    };
    write(dir, org, "add_decision", |tx| {
        let pid = read::resolve_project(tx, project)?;
        let pname = project_name(tx, pid)?;
        let found = match find_article(tx, pid, "Decisions")? {
            Some((id, _)) => Some((id, article_content(tx, id)?)),
            None => None,
        };
        let (article_id, added) = match found {
            None => (
                insert_article(tx, pid, &pname, "Decisions", &format!("<ul><li><p>{head}</p></li></ul>"))?,
                true,
            ),
            Some((id, content)) if recorded(&content) => (id, false),
            Some((id, content)) => {
                let new = match content.rfind("</ul>") {
                    Some(i) => {
                        // Same form as the list's last item.
                        let tight = content[..i]
                            .rfind("<li")
                            .is_some_and(|li| !content[li..].starts_with("<li><p>"));
                        let li = if tight {
                            format!("<li>{head}</li>\n")
                        } else {
                            format!("<li><p>{head}</p></li>")
                        };
                        format!("{}{li}{}", &content[..i], &content[i..])
                    }
                    None => format!("{content}<ul><li><p>{head}</p></li></ul>"),
                };
                update_row(tx, "wiki_articles", id, vec![("content", Value::Text(new))])?;
                (id, true)
            }
        };
        let summary =
            added.then(|| format!("Added decision {day} \"{text}\" to project \"{pname}\""));
        Ok((
            DecisionResult {
                org: org.name.clone(),
                project_id: pid,
                project: pname,
                article_id,
                added,
            },
            summary,
        ))
    })
}

// ── Tools ────────────────────────────────────────────────────

pub fn link_tool(
    dir: &Path,
    org: &Org,
    project: &str,
    name: &str,
    url: Option<&str>,
) -> R<ToolResult> {
    let name = required(name, "Name")?;
    let url = url
        .map(|u| capped(u, "URL"))
        .transpose()?
        .map(str::trim)
        .filter(|u| !u.is_empty())
        .map(str::to_string);
    write(dir, org, "link_tool", |tx| {
        let pid = read::resolve_project(tx, project)?;
        let pname = project_name(tx, pid)?;
        let mut stmt = db(tx.prepare("SELECT id, name, url FROM resources ORDER BY id"))?;
        let rows: Vec<(i64, String, String)> = db(stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .and_then(|rows| rows.collect()))?;
        let wanted = fold(&name);
        let hits: Vec<&(i64, String, String)> = rows
            .iter()
            .filter(|(_, n, u)| {
                fold(n.trim()) == wanted || url.as_deref().is_some_and(|w| u.trim() == w)
            })
            .collect();
        let (rid, rname, rurl, created) = match hits.as_slice() {
            [] => {
                let u = url.clone().unwrap_or_default();
                db(tx.execute(
                    "INSERT INTO resources (name, url) VALUES (?1, ?2)",
                    params![name, u],
                ))?;
                let rid = tx.last_insert_rowid();
                db(tx.execute(
                    "INSERT INTO resource_tags (resource_id, tag) VALUES (?1, 'tool')",
                    [rid],
                ))?;
                (rid, name.clone(), u, true)
            }
            [(id, n, u)] => (*id, n.clone(), u.clone(), false),
            many => {
                let list: Vec<String> = many
                    .iter()
                    .map(|(id, n, _)| format!("{n} (id {id})"))
                    .collect();
                return Err(format!(
                    "Several tools match \"{name}\": {}. Pass the exact name or URL of one.",
                    list.join(", ")
                ));
            }
        };
        let linked = db(tx.execute(
            "INSERT OR IGNORE INTO resource_projects (resource_id, project_id) VALUES (?1, ?2)",
            [rid, pid],
        ))? > 0;
        let summary = (created || linked)
            .then(|| format!("Linked tool \"{rname}\" (id {rid}) to project \"{pname}\""));
        Ok((
            ToolResult {
                org: org.name.clone(),
                project_id: pid,
                project: pname,
                resource_id: rid,
                name: rname,
                url: rurl,
                created,
            },
            summary,
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::ready_dir;
    use rusqlite::Connection;
    use std::path::PathBuf;

    /// Fictional fixture: two clients, three projects, tasks, subtasks, a
    /// wiki folder and article, one tool.
    fn fixture() -> (PathBuf, Org, Connection) {
        let dir = ready_dir("org001", "Studio");
        let org = guard::resolve_org(&dir, None).unwrap();
        let conn = Connection::open(&org.db).unwrap();
        conn.execute_batch(
            "
            INSERT INTO clients (id, name, email, language) VALUES
              ('C-001', 'Atelier Lumen', 'hello@lumen.test', 'FR'),
              ('C-009', 'Éditions Boréale', 'info@boreale.test', 'EN');
            INSERT INTO projects (id, client_id, name, status, deadline, notes) VALUES
              (1, 'C-001', 'Identité Visuelle', 'active', '2026-11-05', 'Brand notes'),
              (2, 'C-001', 'Site Web', 'on_hold', NULL, ''),
              (3, 'C-009', 'Catalogue Printemps', 'active', NULL, '');
            INSERT INTO tasks (id, project_id, title, status, priority, due_date, sort_order) VALUES
              (1, 1, 'Logo variants', 'in_progress', 'high', '2026-10-29', 1),
              (2, 1, 'Final files', 'todo', 'low', NULL, 4);
            INSERT INTO subtasks (id, task_id, title, status, due_date, sort_order) VALUES
              (1, 1, 'Monochrome', 'todo', NULL, 2),
              (2, 1, 'Reversed', 'todo', NULL, 7);
            INSERT INTO wiki_folders (id, name, sort_order) VALUES (1, 'Other', 3);
            INSERT INTO resources (id, name, url) VALUES (1, 'Figma', 'https://figma.test');
            ",
        )
        .unwrap();
        (dir, org, conn)
    }

    /// A folder that exists, inside the test's allowed place (the temp dir).
    fn real_folder(dir: &Path, name: &str) -> String {
        let f = dir.join("work").join(name);
        std::fs::create_dir_all(&f).unwrap();
        f.to_string_lossy().into_owned()
    }

    fn one<T: rusqlite::types::FromSql>(conn: &Connection, sql: &str) -> T {
        conn.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    fn log_lines(dir: &Path) -> Vec<serde_json::Value> {
        std::fs::read_to_string(dir.join(crate::log::LOG_FILE))
            .unwrap_or_default()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }

    // ── Projects ─────────────────────────────────────────────

    #[test]
    fn link_folder_happy_path() {
        let (dir, org, conn) = fixture();
        let folder = dir.join("work").join("lumen").join("identity");
        std::fs::create_dir_all(&folder).unwrap();
        let folder = folder.to_string_lossy().into_owned();
        let r = link_folder(&dir, &org, "identite visuelle", &format!("{folder}//")).unwrap();
        assert_eq!(r.org, "Studio");
        assert_eq!(r.project.id, 1);
        assert_eq!(r.project.folder_path.as_deref(), Some(folder.as_str()));
        let fp: String = one(&conn, "SELECT folder_path FROM projects WHERE id = 1");
        assert_eq!(fp, folder);
        assert_eq!(
            link_folder(&dir, &org, "1", "work/lumen").unwrap_err(),
            "Use a full folder path."
        );
        assert_eq!(
            link_folder(&dir, &org, "1", "~/work").unwrap_err(),
            "Use a full folder path."
        );
    }

    #[test]
    fn create_project_happy_path() {
        let (dir, org, conn) = fixture();
        let r = create_project(
            &dir,
            &org,
            "editions boreale",
            "Catalogue Automne",
            None,
            Some("2027-02-01"),
            Some("Second edition"),
        )
        .unwrap();
        assert_eq!(r.org, "Studio");
        assert_eq!(r.project.name, "Catalogue Automne");
        assert_eq!(r.project.client_id, "C-009");
        assert_eq!(r.project.status, "active");
        assert_eq!(r.project.deadline.as_deref(), Some("2027-02-01"));
        let notes: String = one(
            &conn,
            &format!("SELECT notes FROM projects WHERE id = {}", r.project.id),
        );
        assert_eq!(notes, "Second edition");
        let err =
            create_project(&dir, &org, "C-001", "X", Some("in_progress"), None, None).unwrap_err();
        assert_eq!(
            err,
            "Status must be one of: active, completed, on_hold, cancelled."
        );
        let err =
            create_project(&dir, &org, "C-001", "X", None, Some("05.11.2026"), None).unwrap_err();
        assert_eq!(err, "Dates use YYYY-MM-DD.");
        let err = create_project(&dir, &org, "Nobody", "X", None, None, None).unwrap_err();
        assert!(err.starts_with("No client matches"), "{err}");
    }

    #[test]
    fn create_project_refuses_duplicate_name_for_client() {
        let (dir, org, _conn) = fixture();
        let err = create_project(&dir, &org, "C-001", "site web", None, None, None).unwrap_err();
        assert!(err.contains("already has a project"), "{err}");
        // Same name under another client is fine.
        create_project(&dir, &org, "C-009", "Site Web", None, None, None).unwrap();
    }

    #[test]
    fn update_project_happy_path() {
        let (dir, org, conn) = fixture();
        let r = update_project(
            &dir,
            &org,
            "Site Web",
            &ProjectChanges {
                status: Some("completed".into()),
                deadline: Some("2026-12-01".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(r.project.status, "completed");
        assert_eq!(r.project.deadline.as_deref(), Some("2026-12-01"));
        // Untouched fields keep their values.
        let notes: String = one(&conn, "SELECT notes FROM projects WHERE id = 1");
        assert_eq!(notes, "Brand notes");
        let folder = dir.join("work").join("lumen");
        std::fs::create_dir_all(&folder).unwrap();
        let folder = folder.to_string_lossy().into_owned();
        let r = update_project(
            &dir,
            &org,
            "1",
            &ProjectChanges {
                notes: Some("New notes".into()),
                folder_path: Some(format!("{folder}/")),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(r.project.status, "active");
        assert_eq!(r.project.deadline.as_deref(), Some("2026-11-05"));
        assert_eq!(r.project.folder_path.as_deref(), Some(folder.as_str()));
        let r = update_project(
            &dir,
            &org,
            "1",
            &ProjectChanges {
                deadline: Some(String::new()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(r.project.deadline, None);
        assert_eq!(
            update_project(&dir, &org, "1", &ProjectChanges::default()).unwrap_err(),
            "Nothing to update."
        );
    }

    #[test]
    fn ambiguous_project_lists_candidates() {
        let (dir, org, conn) = fixture();
        conn.execute(
            "INSERT INTO projects (id, client_id, name) VALUES (7, 'C-009', 'Site web')",
            [],
        )
        .unwrap();
        let err = create_task(&dir, &org, "SITE WEB", "x", None, None, None).unwrap_err();
        assert!(err.contains("(id 2)") && err.contains("(id 7)"), "{err}");
        let n: i64 = one(&conn, "SELECT COUNT(*) FROM tasks WHERE title = 'x'");
        assert_eq!(n, 0);
    }

    // ── Tasks and subtasks ───────────────────────────────────

    #[test]
    fn create_task_happy_path() {
        let (dir, org, conn) = fixture();
        let r = create_task(
            &dir,
            &org,
            "Identite Visuelle",
            "Print proofs",
            Some("2026-11-02"),
            Some("high"),
            Some("Check paper"),
        )
        .unwrap();
        assert_eq!(r.org, "Studio");
        assert_eq!(r.project_id, 1);
        assert_eq!(r.project, "Identité Visuelle");
        assert_eq!(r.status, "todo");
        assert_eq!(r.priority.as_deref(), Some("high"));
        assert_eq!(r.due_date.as_deref(), Some("2026-11-02"));
        let notes: String = one(
            &conn,
            &format!("SELECT notes FROM tasks WHERE id = {}", r.id),
        );
        assert_eq!(notes, "Check paper");
        let r = create_task(&dir, &org, "3", "Grid", None, None, None).unwrap();
        assert_eq!(r.priority.as_deref(), Some("medium"));
        assert_eq!(
            create_task(&dir, &org, "3", "Grid", None, Some("urgent"), None).unwrap_err(),
            "Priority must be low, medium or high."
        );
        assert_eq!(
            create_task(&dir, &org, "3", "  ", None, None, None).unwrap_err(),
            "Title can't be empty."
        );
    }

    #[test]
    fn sort_order_max_plus_one() {
        let (dir, org, conn) = fixture();
        let t = create_task(&dir, &org, "1", "Next", None, None, None).unwrap();
        let so: i64 = one(
            &conn,
            &format!("SELECT sort_order FROM tasks WHERE id = {}", t.id),
        );
        assert_eq!(so, 5);
        // Empty project: starts at 0, like the app.
        let t = create_task(&dir, &org, "3", "First", None, None, None).unwrap();
        let so: i64 = one(
            &conn,
            &format!("SELECT sort_order FROM tasks WHERE id = {}", t.id),
        );
        assert_eq!(so, 0);
        let s = create_subtask(&dir, &org, 1, "Gold foil", None).unwrap();
        let so: i64 = one(
            &conn,
            &format!("SELECT sort_order FROM subtasks WHERE id = {}", s.id),
        );
        assert_eq!(so, 8);
    }

    #[test]
    fn update_task_happy_path() {
        let (dir, org, conn) = fixture();
        let r = update_task(
            &dir,
            &org,
            2,
            &TaskChanges {
                status: Some("done".into()),
                priority: Some("medium".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(r.status, "done");
        assert_eq!(r.priority.as_deref(), Some("medium"));
        assert_eq!(r.title, "Final files");
        let r = update_task(
            &dir,
            &org,
            1,
            &TaskChanges {
                title: Some("Logo set".into()),
                due_date: Some(String::new()),
                notes: Some("n".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(r.title, "Logo set");
        assert_eq!(r.due_date, None);
        assert_eq!(r.status, "in_progress", "untouched status is kept");
        let notes: String = one(&conn, "SELECT notes FROM tasks WHERE id = 1");
        assert_eq!(notes, "n");
        assert_eq!(
            update_task(
                &dir,
                &org,
                99,
                &TaskChanges {
                    title: Some("x".into()),
                    ..Default::default()
                }
            )
            .unwrap_err(),
            "No task with id 99."
        );
    }

    #[test]
    fn status_in_progress_rejected() {
        let (dir, org, conn) = fixture();
        let err = update_task(
            &dir,
            &org,
            2,
            &TaskChanges {
                status: Some("in_progress".into()),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert_eq!(err, "Status must be \"todo\" or \"done\".");
        let err = update_subtask(
            &dir,
            &org,
            1,
            &SubtaskChanges {
                status: Some("in_progress".into()),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert_eq!(err, "Status must be \"todo\" or \"done\".");
        let s: String = one(&conn, "SELECT status FROM tasks WHERE id = 2");
        assert_eq!(s, "todo");
    }

    #[test]
    fn subtask_happy_path() {
        let (dir, org, conn) = fixture();
        let s = create_subtask(&dir, &org, 2, "Export PDF", Some("2026-11-01")).unwrap();
        assert_eq!(s.org, "Studio");
        assert_eq!(s.task_id, 2);
        assert_eq!(s.task, "Final files");
        assert_eq!(s.status, "todo");
        assert_eq!(s.due_date.as_deref(), Some("2026-11-01"));
        let so: i64 = one(
            &conn,
            &format!("SELECT sort_order FROM subtasks WHERE id = {}", s.id),
        );
        assert_eq!(so, 0);
        let u = update_subtask(
            &dir,
            &org,
            s.id,
            &SubtaskChanges {
                status: Some("done".into()),
                title: Some("Export PDF/X".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(u.status, "done");
        assert_eq!(u.title, "Export PDF/X");
        assert_eq!(u.due_date.as_deref(), Some("2026-11-01"));
        assert_eq!(
            create_subtask(&dir, &org, 99, "x", None).unwrap_err(),
            "No task with id 99."
        );
        assert_eq!(
            update_subtask(
                &dir,
                &org,
                99,
                &SubtaskChanges {
                    status: Some("done".into()),
                    ..Default::default()
                }
            )
            .unwrap_err(),
            "No subtask with id 99."
        );
    }

    #[test]
    fn never_touches_calendar_or_workload_columns() {
        let (dir, org, conn) = fixture();
        conn.execute_batch(
            "UPDATE projects SET calendar_deadline_id = 'cal-p', workload_columns = '[1]', \
               workload_template_id = 4, layout_config = '{\"a\":1}' WHERE id = 1;
             UPDATE tasks SET calendar_event_id = 'cal-t', workload_cells = '{\"x\":2}', \
               workload_sort_order = 6, tracked_minutes = 42, planned_minutes = 90 WHERE id = 1;
             UPDATE subtasks SET calendar_event_id = 'cal-s' WHERE id = 1;",
        )
        .unwrap();
        let snapshot = |conn: &Connection| -> Vec<String> {
            vec![
                one(conn, "SELECT calendar_deadline_id || workload_columns || workload_template_id || layout_config FROM projects WHERE id = 1"),
                one(conn, "SELECT calendar_event_id || workload_cells || workload_sort_order || tracked_minutes || planned_minutes FROM tasks WHERE id = 1"),
                one(conn, "SELECT calendar_event_id FROM subtasks WHERE id = 1"),
            ]
        };
        let before = snapshot(&conn);
        update_project(
            &dir,
            &org,
            "1",
            &ProjectChanges {
                status: Some("on_hold".into()),
                deadline: Some("2026-12-24".into()),
                notes: Some("x".into()),
                folder_path: Some(real_folder(&dir, "x")),
            },
        )
        .unwrap();
        link_folder(&dir, &org, "1", &real_folder(&dir, "y")).unwrap();
        update_task(
            &dir,
            &org,
            1,
            &TaskChanges {
                title: Some("t".into()),
                status: Some("done".into()),
                due_date: Some("2026-12-01".into()),
                priority: Some("low".into()),
                notes: Some("n".into()),
            },
        )
        .unwrap();
        update_subtask(
            &dir,
            &org,
            1,
            &SubtaskChanges {
                title: Some("s".into()),
                status: Some("done".into()),
                due_date: Some("2026-12-02".into()),
            },
        )
        .unwrap();
        assert_eq!(snapshot(&conn), before);
    }

    #[test]
    fn updated_at_bumped() {
        let (dir, org, conn) = fixture();
        conn.execute_batch(
            "UPDATE projects SET updated_at = '2000-01-01 00:00:00';
             UPDATE tasks SET updated_at = '2000-01-01 00:00:00';
             UPDATE subtasks SET updated_at = '2000-01-01 00:00:00';",
        )
        .unwrap();
        update_project(
            &dir,
            &org,
            "2",
            &ProjectChanges {
                notes: Some("n".into()),
                ..Default::default()
            },
        )
        .unwrap();
        link_folder(&dir, &org, "3", &real_folder(&dir, "c")).unwrap();
        update_task(
            &dir,
            &org,
            1,
            &TaskChanges {
                notes: Some("n".into()),
                ..Default::default()
            },
        )
        .unwrap();
        update_subtask(
            &dir,
            &org,
            1,
            &SubtaskChanges {
                title: Some("m".into()),
                ..Default::default()
            },
        )
        .unwrap();
        for (table, id) in [
            ("projects", 2),
            ("projects", 3),
            ("tasks", 1),
            ("subtasks", 1),
        ] {
            let at: String = one(
                &conn,
                &format!("SELECT updated_at FROM {table} WHERE id = {id}"),
            );
            assert_ne!(at, "2000-01-01 00:00:00", "{table} {id}");
        }
        // Rows not targeted keep their timestamp.
        let at: String = one(&conn, "SELECT updated_at FROM projects WHERE id = 1");
        assert_eq!(at, "2000-01-01 00:00:00");
    }

    #[test]
    fn invalid_dates_rejected() {
        let (dir, org, _conn) = fixture();
        for bad in ["2026-13-01", "2026-1-5", "tomorrow", "2026-02-30"] {
            assert_eq!(
                create_task(&dir, &org, "1", "x", Some(bad), None, None).unwrap_err(),
                "Dates use YYYY-MM-DD.",
                "{bad}"
            );
        }
        assert_eq!(
            create_subtask(&dir, &org, 1, "x", Some("01/02/2026")).unwrap_err(),
            "Dates use YYYY-MM-DD."
        );
    }

    // ── Clients ──────────────────────────────────────────────

    #[test]
    fn create_client_happy_path() {
        let (dir, org, conn) = fixture();
        let r = create_client(
            &dir,
            &org,
            "Studio Nord",
            Some("nord@studio.test"),
            Some("en"),
        )
        .unwrap();
        assert_eq!(r.org, "Studio");
        assert_eq!(r.name, "Studio Nord");
        assert_eq!(r.language, "EN");
        let (email, billing): (String, String) = conn
            .query_row(
                "SELECT email, billing_name FROM clients WHERE id = ?1",
                [&r.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(email, "nord@studio.test");
        assert_eq!(billing, "Studio Nord");
        let r = create_client(&dir, &org, "Studio Sud", None, None).unwrap();
        assert_eq!(r.language, "FR");
        assert_eq!(
            create_client(&dir, &org, "X", None, Some("DE")).unwrap_err(),
            "Language must be FR or EN."
        );
        let err = create_client(&dir, &org, "atelier lumen", None, None).unwrap_err();
        assert!(err.contains("C-001"), "{err}");
    }

    #[test]
    fn client_id_next() {
        let (dir, org, _conn) = fixture();
        let r = create_client(&dir, &org, "Studio Nord", None, None).unwrap();
        assert_eq!(r.id, "C-010");
        let r = create_client(&dir, &org, "Studio Sud", None, None).unwrap();
        assert_eq!(r.id, "C-011");
    }

    // ── Wiki ─────────────────────────────────────────────────

    #[test]
    fn wiki_article_sort_order_is_per_folder() {
        let (dir, org, conn) = fixture();
        let a = put_wiki_article(&dir, &org, "1", "Overview", "x").unwrap();
        let folder: i64 = one(
            &conn,
            &format!("SELECT folder_id FROM wiki_articles WHERE id = {}", a.id),
        );
        conn.execute(
            &format!(
                "INSERT INTO wiki_articles (folder_id, title, content, sort_order) \
                 VALUES ({folder}, 'Loose', '', 7)"
            ),
            [],
        )
        .unwrap();
        let b = put_wiki_article(&dir, &org, "1", "Next", "y").unwrap();
        let so: i64 = one(
            &conn,
            &format!("SELECT sort_order FROM wiki_articles WHERE id = {}", b.id),
        );
        assert_eq!(so, 8);
    }

    #[test]
    fn put_wiki_article_resolves_title_links() {
        let (dir, org, conn) = fixture();
        let dec = put_wiki_article(&dir, &org, "1", "Decisions", "- one").unwrap();
        let other = put_wiki_article(&dir, &org, "2", "Decisions", "- two").unwrap();
        let notes = put_wiki_article(&dir, &org, "2", "Launch notes", "x").unwrap();
        let r = put_wiki_article(
            &dir,
            &org,
            "1",
            "Overview",
            "See [[Decisions]], [[Site Web/Decisions|the site's]] and [[launch notes]].\n\n\
             Not `[[Decisions]]` in code, nor [[Missing page]].\n\n```\n[[Decisions]]\n```\n",
        )
        .unwrap();
        assert_eq!(r.unresolved_links, vec!["Missing page".to_string()]);
        let html: String = one(&conn, &format!("SELECT content FROM wiki_articles WHERE id = {}", r.id));
        // Same project first, then Project/Title, then a title unique in the organisation.
        assert!(html.contains(&format!("<a href=\"/wiki?article={}\">Decisions</a>", dec.id)), "{html}");
        assert!(html.contains(&format!("<a href=\"/wiki?article={}\">the site's</a>", other.id)), "{html}");
        assert!(html.contains(&format!("<a href=\"/wiki?article={}\">launch notes</a>", notes.id)), "{html}");
        assert!(html.contains("<code>[[Decisions]]</code>"), "{html}");
        assert!(html.contains("[[Missing page]]"), "{html}");
        assert!(html.contains("<pre><code>[[Decisions]]"), "{html}");
    }

    #[test]
    fn put_wiki_article_links_project_files() {
        let (dir, org, conn) = fixture();
        let folder = dir.join("site-folder");
        std::fs::create_dir_all(folder.join("docs")).unwrap();
        std::fs::write(folder.join("RELEASING.md"), "# Releasing").unwrap();
        std::fs::write(folder.join("docs/guide.md"), "# Guide").unwrap();
        conn.execute("UPDATE projects SET folder_path = ?1 WHERE id = 2", [folder.to_string_lossy()]).unwrap();
        let r = put_wiki_article(
            &dir,
            &org,
            "2",
            "Run",
            "See [[RELEASING.md]], [[docs/guide.md|the guide]] and [[Site Web/docs/guide.md]]; [[missing.md]].",
        )
        .unwrap();
        let html: String = one(&conn, &format!("SELECT content FROM wiki_articles WHERE id = {}", r.id));
        assert!(html.contains(r#"<a href="/wiki?file=2:RELEASING.md">RELEASING.md</a>"#), "{html}");
        assert!(html.contains(r#"<a href="/wiki?file=2:docs/guide.md">the guide</a>"#), "{html}");
        assert!(html.contains(r#"<a href="/wiki?file=2:docs/guide.md">guide.md</a>"#), "{html}");
        assert_eq!(r.unresolved_links, vec!["missing.md".to_string()]);
        // From another project, a file needs its project's name.
        let r = put_wiki_article(&dir, &org, "1", "Notes", "[[Site Web/RELEASING.md]] [[RELEASING.md]]").unwrap();
        assert_eq!(r.unresolved_links, vec!["RELEASING.md".to_string()]);
    }

    #[test]
    fn put_wiki_article_leaves_ambiguous_titles_unresolved() {
        let (dir, org, _conn) = fixture();
        put_wiki_article(&dir, &org, "1", "Brief", "a").unwrap();
        put_wiki_article(&dir, &org, "2", "Brief", "b").unwrap();
        // From project 3, "Brief" exists twice elsewhere: name the project.
        let r = put_wiki_article(&dir, &org, "3", "Overview", "[[Brief]] and [[Site Web/Brief]]").unwrap();
        assert_eq!(r.unresolved_links, vec!["Brief".to_string()]);
    }

    #[test]
    fn put_wiki_article_creates_folder_article_and_tags() {
        let (dir, org, conn) = fixture();
        let r = put_wiki_article(&dir, &org, "1", "Overview", "## Goals\n\nFresh & clear").unwrap();
        assert_eq!(r.org, "Studio");
        assert!(r.created);
        assert_eq!(r.project, "Identité Visuelle");
        let (folder, content, so): (i64, String, i64) = conn
            .query_row(
                "SELECT folder_id, content, sort_order FROM wiki_articles WHERE id = ?1",
                [r.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert!(content.contains("<h2>Goals</h2>"), "{content}");
        assert!(content.contains("Fresh &amp; clear"), "{content}");
        assert_eq!(so, 0);
        let (fname, fso): (String, i64) = conn
            .query_row(
                "SELECT name, sort_order FROM wiki_folders WHERE id = ?1",
                [folder],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(fname, "Identité Visuelle");
        assert_eq!(fso, 4);
        let mut tags: Vec<String> = conn
            .prepare("SELECT tag FROM wiki_article_tags WHERE article_id = ?1 ORDER BY tag")
            .unwrap()
            .query_map([r.id], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        tags.sort();
        assert_eq!(
            tags,
            vec!["Identité Visuelle".to_string(), "overview".to_string()]
        );

        // Any title; second article reuses the folder, sort_order per project.
        let r2 = put_wiki_article(&dir, &org, "1", "Print specs", "Paper: 120g").unwrap();
        assert!(r2.created);
        let (folder2, so2): (i64, i64) = conn
            .query_row(
                "SELECT folder_id, sort_order FROM wiki_articles WHERE id = ?1",
                [r2.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(folder2, folder);
        assert_eq!(so2, 1);
        let folders: i64 = one(&conn, "SELECT COUNT(*) FROM wiki_folders");
        assert_eq!(folders, 2);

        // Same title (folded): replaces the content in place.
        conn.execute(
            "UPDATE wiki_articles SET updated_at = '2000-01-01 00:00:00' WHERE id = ?1",
            [r.id],
        )
        .unwrap();
        let r3 = put_wiki_article(&dir, &org, "1", "overview", "New body").unwrap();
        assert!(!r3.created);
        assert_eq!(r3.id, r.id);
        assert_eq!(r3.title, "Overview");
        let (content, at): (String, String) = conn
            .query_row(
                "SELECT content, updated_at FROM wiki_articles WHERE id = ?1",
                [r.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(content, "<p>New body</p>\n");
        assert_ne!(at, "2000-01-01 00:00:00");
        let tags: i64 = one(&conn, "SELECT COUNT(*) FROM wiki_article_tags");
        assert_eq!(tags, 4);
    }

    #[test]
    fn put_wiki_article_reuses_folder_with_padded_name() {
        let (dir, org, conn) = fixture();
        conn.execute(
            "INSERT INTO wiki_folders (id, name, sort_order) VALUES (5, ' Site Web ', 0)",
            [],
        )
        .unwrap();
        let r = put_wiki_article(&dir, &org, "2", "Brief", "x").unwrap();
        let folder: i64 = one(
            &conn,
            &format!("SELECT folder_id FROM wiki_articles WHERE id = {}", r.id),
        );
        assert_eq!(folder, 5);
    }

    #[test]
    fn markdown_script_tag_escaped() {
        let (dir, org, conn) = fixture();
        let r = put_wiki_article(&dir, &org, "1", "Notes", "Hi <script>alert(1)</script>").unwrap();
        let content: String = one(
            &conn,
            &format!("SELECT content FROM wiki_articles WHERE id = {}", r.id),
        );
        assert!(!content.contains("<script"), "{content}");
        assert!(content.contains("&lt;script&gt;"), "{content}");
    }

    #[test]
    fn add_decision_creates_then_appends() {
        let (dir, org, conn) = fixture();
        let r = add_decision(&dir, &org, "1", "2026-10-01", "Use blue").unwrap();
        assert!(r.added);
        let content: String = one(
            &conn,
            &format!(
                "SELECT content FROM wiki_articles WHERE id = {}",
                r.article_id
            ),
        );
        assert_eq!(
            content,
            "<ul><li><p><strong>2026-10-01</strong> Use blue</p></li></ul>"
        );
        let title: String = one(
            &conn,
            &format!(
                "SELECT title FROM wiki_articles WHERE id = {}",
                r.article_id
            ),
        );
        assert_eq!(title, "Decisions");
        let r2 = add_decision(&dir, &org, "1", "2026-10-02", "Keep it <simple> & short").unwrap();
        assert_eq!(r2.article_id, r.article_id);
        let content: String = one(
            &conn,
            &format!(
                "SELECT content FROM wiki_articles WHERE id = {}",
                r.article_id
            ),
        );
        assert_eq!(
            content,
            "<ul><li><p><strong>2026-10-01</strong> Use blue</p></li>\
             <li><p><strong>2026-10-02</strong> Keep it &lt;simple&gt; &amp; short</p></li></ul>"
        );
        assert_eq!(
            add_decision(&dir, &org, "1", "01.10.2026", "x").unwrap_err(),
            "Dates use YYYY-MM-DD."
        );
    }

    #[test]
    fn decision_idempotent() {
        let (dir, org, conn) = fixture();
        add_decision(&dir, &org, "1", "2026-10-01", "Use blue").unwrap();
        let before: String = one(&conn, "SELECT content FROM wiki_articles");
        let logged = log_lines(&dir).len();
        let r = add_decision(&dir, &org, "1", "2026-10-01", "Use blue").unwrap();
        assert!(!r.added);
        let after: String = one(&conn, "SELECT content FROM wiki_articles");
        assert_eq!(before, after);
        assert_eq!(log_lines(&dir).len(), logged, "a no-op is not logged");
        let n: i64 = one(&conn, "SELECT COUNT(*) FROM wiki_articles");
        assert_eq!(n, 1);
    }

    #[test]
    fn decision_dedup_survives_a_round_trip() {
        let (dir, org, conn) = fixture();
        add_decision(&dir, &org, "1", "2026-10-01", "Use \"blue\" & grey").unwrap();
        add_decision(&dir, &org, "1", "2026-10-02", "Keep it short").unwrap();
        // An agent reads the article and writes it back unchanged: the
        // list comes back in its tight form, quotes as &quot;.
        let a = read::get_wiki_article(&guard::open_read(&org).unwrap(), "1", "Decisions").unwrap();
        put_wiki_article(&dir, &org, "1", "Decisions", &a.markdown).unwrap();
        let html: String = one(&conn, "SELECT content FROM wiki_articles");
        assert!(!html.contains("<li><p>"), "{html}");

        let r = add_decision(&dir, &org, "1", "2026-10-01", "Use \"blue\" & grey").unwrap();
        assert!(!r.added, "already recorded");
        assert!(!add_decision(&dir, &org, "1", "2026-10-02", "Keep it short").unwrap().added);
        // Same opening words, different decision.
        assert!(add_decision(&dir, &org, "1", "2026-10-02", "Keep it short and sweet").unwrap().added);
        let html: String = one(&conn, "SELECT content FROM wiki_articles");
        assert_eq!(html.matches("2026-10-01").count(), 1, "{html}");
        // The new item takes the list's form.
        assert!(!html.contains("<li><p>"), "{html}");
        assert!(
            html.contains("<li><strong>2026-10-02</strong> Keep it short and sweet</li>\n</ul>"),
            "{html}"
        );
    }

    #[test]
    fn file_links_resolved_outside_the_write_lock() {
        let (dir, org, conn) = fixture();
        let folder = dir.join("site-folder");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("RELEASING.md"), "# Releasing").unwrap();
        conn.execute("UPDATE projects SET folder_path = ?1 WHERE id = 2", [folder.to_string_lossy()])
            .unwrap();
        let db = org.db.clone();
        let probes = std::cell::Cell::new(0);
        // A slow or offline folder must not hold the database: while a file
        // is looked up, another connection can still start a write.
        let exists = |p: &Path| {
            let other = Connection::open(&db).unwrap();
            other.busy_timeout(std::time::Duration::ZERO).unwrap();
            other.execute_batch("BEGIN IMMEDIATE; ROLLBACK;").expect("write lock free during file lookup");
            probes.set(probes.get() + 1);
            p.is_file()
        };
        let r = put_wiki_article_with(&dir, &org, "2", "Run", "See [[RELEASING.md]] and [[gone.md]].", &exists)
            .unwrap();
        assert!(probes.get() >= 2);
        assert_eq!(r.unresolved_links, vec!["gone.md".to_string()]);
        let html: String = one(&conn, &format!("SELECT content FROM wiki_articles WHERE id = {}", r.id));
        assert!(html.contains(r#"<a href="/wiki?file=2:RELEASING.md">RELEASING.md</a>"#), "{html}");
    }

    #[test]
    fn oversized_text_refused() {
        let (dir, org, conn) = fixture();
        let big = "x".repeat(MAX_TEXT + 1);
        assert_eq!(
            put_wiki_article(&dir, &org, "1", "Notes", &big).unwrap_err(),
            "Content too long (over 1 MB)."
        );
        assert_eq!(
            create_task(&dir, &org, "1", &big, None, None, None).unwrap_err(),
            "Title too long (over 1 MB)."
        );
        assert_eq!(
            create_task(&dir, &org, "1", "ok", None, None, Some(&big)).unwrap_err(),
            "Notes too long (over 1 MB)."
        );
        let notes = ProjectChanges { notes: Some(big.clone()), ..Default::default() };
        assert!(update_project(&dir, &org, "1", &notes).is_err());
        assert!(add_decision(&dir, &org, "1", "2026-10-01", &big).is_err());
        let n: i64 = one(&conn, "SELECT COUNT(*) FROM wiki_articles");
        assert_eq!(n, 0);
        // Just under the cap is fine.
        put_wiki_article(&dir, &org, "1", "Notes", &"x".repeat(MAX_TEXT)).unwrap();
    }

    #[test]
    fn folder_must_be_an_existing_folder_in_the_allowed_places() {
        let (dir, org, conn) = fixture();
        let bundle = dir.join("Tool.app").join("Contents");
        std::fs::create_dir_all(&bundle).unwrap();
        std::fs::write(dir.join("file.txt"), "x").unwrap();
        let missing = dir.join("nowhere");
        let refused = [
            ("/Users".to_string(), FOLDER_OUTSIDE),
            ("/".to_string(), FOLDER_OUTSIDE),
            (std::env::temp_dir().to_string_lossy().into_owned(), FOLDER_OUTSIDE),
            (missing.to_string_lossy().into_owned(), FOLDER_MISSING),
            (dir.join("file.txt").to_string_lossy().into_owned(), FOLDER_MISSING),
            (dir.join("Tool.app").to_string_lossy().into_owned(), FOLDER_BUNDLE),
            (bundle.to_string_lossy().into_owned(), FOLDER_BUNDLE),
        ];
        for (path, err) in &refused {
            assert_eq!(link_folder(&dir, &org, "1", path).unwrap_err(), *err, "{path}");
            let change = ProjectChanges { folder_path: Some(path.clone()), ..Default::default() };
            assert_eq!(update_project(&dir, &org, "1", &change).unwrap_err(), *err, "{path}");
        }
        let fp: Option<String> = one(&conn, "SELECT folder_path FROM projects WHERE id = 1");
        assert_eq!(fp, None);
    }

    // ── Tools ────────────────────────────────────────────────

    #[test]
    fn link_tool_finds_or_creates() {
        let (dir, org, conn) = fixture();
        let r = link_tool(&dir, &org, "1", "figma", None).unwrap();
        assert_eq!(r.org, "Studio");
        assert_eq!(r.resource_id, 1);
        assert!(!r.created);
        // By exact URL under another name.
        let r = link_tool(&dir, &org, "2", "Figma app", Some("https://figma.test")).unwrap();
        assert_eq!(r.resource_id, 1);
        // Linking twice is harmless.
        link_tool(&dir, &org, "1", "Figma", None).unwrap();
        let links: i64 = one(&conn, "SELECT COUNT(*) FROM resource_projects");
        assert_eq!(links, 2);
        let r = link_tool(&dir, &org, "1", "Blender", Some("https://blender.test")).unwrap();
        assert!(r.created);
        assert_eq!(r.name, "Blender");
        assert_eq!(r.url, "https://blender.test");
        let n: i64 = one(&conn, "SELECT COUNT(*) FROM resources");
        assert_eq!(n, 2);
        let linked: i64 = one(
            &conn,
            &format!(
                "SELECT COUNT(*) FROM resource_projects WHERE resource_id = {} AND project_id = 1",
                r.resource_id
            ),
        );
        assert_eq!(linked, 1);
    }

    // ── Cross-cutting ────────────────────────────────────────

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
        let src = include_str!("write.rs").to_uppercase();
        assert!(!src.contains(concat!("DEL", "ETE ")));
        assert!(!src.contains(concat!("ALT", "ER ")));
    }
}
