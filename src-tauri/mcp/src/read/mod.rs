//! Read tools: pure functions over a connection, returning serialisable
//! structs. Dates are `YYYY-MM-DD`. Names match accent- and case-insensitively;
//! more than one match returns the candidates, never a pick.

use crate::text::fold;
use chrono::NaiveDate;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;

type R<T> = Result<T, String>;

pub(crate) fn db<T>(r: rusqlite::Result<T>) -> R<T> {
    r.map_err(|e| format!("Database error: {e}"))
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct ProjectRef {
    pub id: i64,
    pub name: String,
    pub client_id: String,
    pub client_name: String,
    pub status: String,
    pub deadline: Option<String>,
    pub folder_path: Option<String>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Subtask {
    pub id: i64,
    pub title: String,
    pub status: String,
    pub due_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brief: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage: Option<String>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Task {
    pub id: i64,
    pub title: String,
    pub status: String,
    pub priority: Option<String>,
    pub due_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brief: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage: Option<String>,
    pub subtasks: Vec<Subtask>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct ArticleRef {
    pub id: i64,
    pub title: String,
    pub updated_at: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Tool {
    pub id: i64,
    pub name: String,
    pub url: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct ProjectDetail {
    pub project: ProjectRef,
    pub notes: String,
    pub tasks: Vec<Task>,
    pub wiki: Vec<ArticleRef>,
    pub tools: Vec<Tool>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct TaskRow {
    pub id: i64,
    pub title: String,
    pub status: String,
    pub priority: Option<String>,
    pub due_date: Option<String>,
    pub project_id: i64,
    pub project: String,
    pub client: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brief: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage: Option<String>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct ClientRef {
    pub id: String,
    pub name: String,
    pub email: String,
    /// Set only when the client is archived (and so only with include_archived).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archived_at: Option<String>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Contact {
    pub first_name: String,
    pub last_name: String,
    pub email: String,
    pub phone: String,
    pub role: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct ClientDetail {
    pub id: String,
    pub name: String,
    pub email: String,
    pub phone: String,
    pub address_line1: String,
    pub address_line2: String,
    pub language: String,
    pub notes: String,
    /// Set only when the client is archived: hidden from lists and name matching.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archived_at: Option<String>,
    pub contacts: Vec<Contact>,
    pub projects: Vec<ProjectRef>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Article {
    pub title: String,
    pub html: String,
    pub markdown: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct DueItem {
    /// "task", "subtask", "deadline" or "upkeep".
    pub kind: String,
    pub date: String,
    /// Negative when late.
    pub days_left: i64,
    pub title: String,
    pub project: String,
    pub client: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct NextUpkeep {
    pub title: String,
    pub due: String,
}

/// A machine, without serial, files, readings, connection or notes.
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct MachineRef {
    pub id: i64,
    pub name: String,
    pub kind: String,
    pub status: String,
    pub location: String,
    pub next_upkeep: Option<NextUpkeep>,
}

// ── Helpers ──────────────────────────────────────────────────

const PROJECT_SELECT: &str =
    "SELECT p.id, p.name, p.client_id, c.name, p.status, p.deadline, p.folder_path \
     FROM projects p JOIN clients c ON c.id = p.client_id";

fn project_from_row(r: &Row) -> rusqlite::Result<ProjectRef> {
    Ok(ProjectRef {
        id: r.get(0)?,
        name: r.get(1)?,
        client_id: r.get(2)?,
        client_name: r.get(3)?,
        status: r.get(4)?,
        deadline: r.get(5)?,
        folder_path: r.get(6)?,
    })
}

pub(crate) fn is_digits(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_digit())
}

/// Pick one candidate by exact folded name. Several exact hits list the
/// candidates; no exact hit suggests partial matches but never picks one.
pub(crate) fn pick<T: Clone>(
    kind: &str,
    key: &str,
    items: &[(T, String, String)], // (value, display id, name)
) -> R<T> {
    let k = fold(key.trim());
    let hits: Vec<&(T, String, String)> = items
        .iter()
        .filter(|(_, _, n)| fold(n.trim()) == k)
        .collect();
    match hits.len() {
        0 => {
            let near: Vec<String> = if k.is_empty() {
                Vec::new()
            } else {
                items
                    .iter()
                    .filter(|(_, _, n)| fold(n).contains(&k))
                    .take(5)
                    .map(|(_, id, n)| format!("{n} (id {id})"))
                    .collect()
            };
            if near.is_empty() {
                Err(format!("No {kind} matches \"{key}\"."))
            } else {
                Err(format!(
                    "No {kind} matches \"{key}\". Did you mean: {}? Use the id.",
                    near.join(", ")
                ))
            }
        }
        1 => Ok(hits[0].0.clone()),
        _ => {
            let list: Vec<String> = hits
                .iter()
                .map(|(_, id, n)| format!("{n} (id {id})"))
                .collect();
            Err(format!(
                "Several {kind}s match \"{key}\": {}. Use the id.",
                list.join(", ")
            ))
        }
    }
}

pub(crate) fn resolve_project(conn: &Connection, key: &str) -> R<i64> {
    let key = key.trim();
    if is_digits(key) {
        let id: i64 = key
            .parse()
            .map_err(|_| format!("No project matches \"{key}\"."))?;
        let found: Option<i64> = db(conn
            .query_row("SELECT id FROM projects WHERE id = ?1", [id], |r| r.get(0))
            .optional())?;
        return found.ok_or_else(|| format!("No project matches \"{key}\"."));
    }
    let mut stmt = db(conn.prepare("SELECT id, name FROM projects ORDER BY id"))?;
    let items: Vec<(i64, String, String)> = db(stmt
        .query_map([], |r| {
            let id: i64 = r.get(0)?;
            Ok((id, id.to_string(), r.get::<_, String>(1)?))
        })
        .and_then(|rows| rows.collect()))?;
    pick("project", key, &items)
}

pub(crate) fn resolve_client(conn: &Connection, key: &str) -> R<String> {
    let key = key.trim();
    let by_id = |id: &str| -> R<Option<String>> {
        db(conn
            .query_row("SELECT id FROM clients WHERE id = ?1", [id], |r| r.get(0))
            .optional())
    };
    let upper = key.to_uppercase();
    let looks_like_id = upper.strip_prefix("C-").map(is_digits).unwrap_or(false);
    if looks_like_id {
        return by_id(&upper)?.ok_or_else(|| format!("No client matches \"{key}\"."));
    }
    if is_digits(key) {
        let n: u64 = key
            .parse()
            .map_err(|_| format!("No client matches \"{key}\"."))?;
        return by_id(&format!("C-{n:03}"))?.ok_or_else(|| format!("No client matches \"{key}\"."));
    }
    // Names match active clients only (an id, above, still reaches an archived
    // one), like the app's pickers.
    let mut stmt = db(conn.prepare(
        "SELECT id, name FROM clients WHERE archived_at IS NULL ORDER BY id",
    ))?;
    let items: Vec<(String, String, String)> = db(stmt
        .query_map([], |r| {
            let id: String = r.get(0)?;
            Ok((id.clone(), id, r.get::<_, String>(1)?))
        })
        .and_then(|rows| rows.collect()))?;
    pick("client", key, &items).map_err(|e| {
        let k = fold(key.trim());
        let archived = conn
            .prepare("SELECT name FROM clients WHERE archived_at IS NOT NULL")
            .and_then(|mut st| {
                st.query_map([], |r| r.get::<_, String>(0))
                    .map(|rows| rows.flatten().filter(|n| !k.is_empty() && fold(n).contains(&k)).count())
            })
            .unwrap_or(0);
        if archived > 0 && e.starts_with("No client matches") {
            format!("{e} An archived client matches the name; use its id to reach it.")
        } else {
            e
        }
    })
}

fn sort_by_name<T>(v: &mut [T], name: impl Fn(&T) -> &str) {
    v.sort_by_key(|x| fold(name(x)));
}

fn all_projects(conn: &Connection) -> R<Vec<ProjectRef>> {
    let mut stmt = db(conn.prepare(&format!("{PROJECT_SELECT} ORDER BY p.id")))?;
    let rows = db(stmt
        .query_map([], project_from_row)
        .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>()))?;
    Ok(rows)
}

mod captures;
mod clients;
mod due;
mod projects;
mod tasks;
mod wiki;

pub use captures::list_captures;
pub use clients::{get_client, list_clients};
pub use due::{list_machines, whats_due};
pub use projects::{find_project_for_folder, get_project, list_projects};
pub(crate) use projects::project_ref;
pub use tasks::list_tasks;
pub use wiki::{get_wiki_article, html_to_markdown, list_wiki};

#[cfg(test)]
mod test_util;

#[cfg(test)]
mod tests {
    use super::test_util::*;
    use super::*;

    #[test]
    fn accent_insensitive_match() {
        let c = fixture();
        let d1 = get_project(&c, "identite visuelle").unwrap();
        assert_eq!(d1.project.id, 1);
        let d2 = get_project(&c, "SITE web").unwrap();
        assert_eq!(d2.project.id, 2);
        assert_eq!(get_client(&c, "editions boreale").unwrap().id, "C-002");
    }


    #[test]
    fn ambiguous_name_lists_candidates() {
        let c = fixture();
        c.execute(
            "INSERT INTO projects (id, client_id, name) VALUES (12, 'C-002', 'catalogue printemps')",
            [],
        )
        .unwrap();
        let e = get_project(&c, "Catalogue Printemps").unwrap_err();
        assert_eq!(
            e,
            "Several projects match \"Catalogue Printemps\": Catalogue Printemps (id 3), catalogue printemps (id 12). Use the id."
        );
        assert_eq!(
            get_project(&c, "9").unwrap().project.name,
            "Catalogue Automne"
        );
        c.execute("INSERT INTO clients (id, name) VALUES ('C-003', 'atelier lumen')", [])
            .unwrap();
        let e = get_client(&c, "Atelier Lumen").unwrap_err();
        assert!(e.starts_with("Several clients match \"Atelier Lumen\": "), "{e}");
        assert!(
            e.contains("(id C-001)") && e.ends_with("Use the id."),
            "{e}"
        );
    }

    #[test]
    fn partial_name_does_not_resolve() {
        let c = fixture();
        assert_eq!(
            get_project(&c, "site").unwrap_err(),
            "No project matches \"site\". Did you mean: Site Web (id 2)? Use the id."
        );
        let e = get_project(&c, "catalogue").unwrap_err();
        assert_eq!(
            e,
            "No project matches \"catalogue\". Did you mean: Catalogue Printemps (id 3), Catalogue Automne (id 9)? Use the id."
        );
        assert!(get_client(&c, "lumen").unwrap_err().contains("Did you mean: Atelier Lumen (id C-001)"));
        assert!(list_tasks(&c, Some("site"), None, None).is_err());
    }

    #[test]
    fn no_match_messages() {
        let c = fixture();
        assert_eq!(
            get_project(&c, "nope").unwrap_err(),
            "No project matches \"nope\"."
        );
        assert_eq!(
            get_project(&c, "404").unwrap_err(),
            "No project matches \"404\"."
        );
        assert_eq!(
            get_client(&c, "C-099").unwrap_err(),
            "No client matches \"C-099\"."
        );
    }

}
