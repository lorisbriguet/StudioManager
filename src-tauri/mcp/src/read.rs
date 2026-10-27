//! Read tools: pure functions over a connection, returning serialisable
//! structs. Dates are `YYYY-MM-DD`. Names match accent- and case-insensitively;
//! more than one match returns the candidates, never a pick.

use crate::text::fold;
use chrono::NaiveDate;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;

type R<T> = Result<T, String>;

fn db<T>(r: rusqlite::Result<T>) -> R<T> {
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
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Task {
    pub id: i64,
    pub title: String,
    pub status: String,
    pub priority: Option<String>,
    pub due_date: Option<String>,
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
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct ClientRef {
    pub id: String,
    pub name: String,
    pub email: String,
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
    /// "task", "subtask" or "deadline".
    pub kind: String,
    pub date: String,
    /// Negative when late.
    pub days_left: i64,
    pub title: String,
    pub project: String,
    pub client: String,
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

fn is_digits(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_digit())
}

/// Pick one candidate by folded name: exact match first, else substring.
/// Zero matches and several matches are errors; `Err(None)`-style cases are
/// reported through the callers' messages.
fn pick<T: Clone>(
    kind: &str,
    key: &str,
    items: &[(T, String, String)], // (value, display id, name)
) -> R<T> {
    let k = fold(key.trim());
    let mut hits: Vec<&(T, String, String)> = items
        .iter()
        .filter(|(_, _, n)| fold(n.trim()) == k)
        .collect();
    if hits.is_empty() && !k.is_empty() {
        hits = items
            .iter()
            .filter(|(_, _, n)| fold(n).contains(&k))
            .collect();
    }
    match hits.len() {
        0 => Err(format!("No {kind} matches \"{key}\".")),
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

fn resolve_project(conn: &Connection, key: &str) -> R<i64> {
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

fn resolve_client(conn: &Connection, key: &str) -> R<String> {
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
    let mut stmt = db(conn.prepare("SELECT id, name FROM clients ORDER BY id"))?;
    let items: Vec<(String, String, String)> = db(stmt
        .query_map([], |r| {
            let id: String = r.get(0)?;
            Ok((id.clone(), id, r.get::<_, String>(1)?))
        })
        .and_then(|rows| rows.collect()))?;
    pick("client", key, &items)
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

// ── Projects ─────────────────────────────────────────────────

fn normalise_path(p: &str) -> String {
    let t = p.trim().trim_end_matches('/');
    if t.is_empty() {
        "/".to_string()
    } else {
        t.to_string()
    }
}

/// The project whose `folder_path` equals `path` or its nearest ancestor.
/// Paths are compared exactly (no case folding); trailing slashes ignored.
pub fn find_project_for_folder(conn: &Connection, path: &str) -> Option<ProjectRef> {
    let projects: Vec<(String, ProjectRef)> = all_projects(conn)
        .ok()?
        .into_iter()
        .filter_map(|p| {
            let fp = p.folder_path.as_deref()?.trim();
            if fp.is_empty() {
                None
            } else {
                Some((normalise_path(fp), p))
            }
        })
        .collect();
    let mut cur = normalise_path(path);
    loop {
        if let Some((_, p)) = projects.iter().find(|(fp, _)| *fp == cur) {
            return Some(p.clone());
        }
        if cur == "/" {
            return None;
        }
        cur = match cur.rfind('/') {
            Some(0) => "/".to_string(),
            Some(i) => cur[..i].to_string(),
            None => return None,
        };
    }
}

pub fn list_projects(
    conn: &Connection,
    status: Option<&str>,
    client: Option<&str>,
    text: Option<&str>,
) -> R<Vec<ProjectRef>> {
    let client_filter = client.map(|c| c.trim()).filter(|c| !c.is_empty());
    let text_f = text.map(fold).filter(|t| !t.trim().is_empty());
    let mut out: Vec<ProjectRef> = all_projects(conn)?
        .into_iter()
        .filter(|p| status.map(|s| p.status == s).unwrap_or(true))
        .filter(|p| match client_filter {
            None => true,
            Some(c) => {
                p.client_id.eq_ignore_ascii_case(c) || fold(&p.client_name).contains(&fold(c))
            }
        })
        .filter(|p| match &text_f {
            None => true,
            Some(t) => fold(&p.name).contains(t.trim()) || fold(&p.client_name).contains(t.trim()),
        })
        .collect();
    sort_by_name(&mut out, |p| &p.name);
    Ok(out)
}

fn project_ref(conn: &Connection, id: i64) -> R<ProjectRef> {
    db(conn.query_row(
        &format!("{PROJECT_SELECT} WHERE p.id = ?1"),
        [id],
        project_from_row,
    ))
}

fn wiki_for_project(conn: &Connection, id: i64) -> R<Vec<ArticleRef>> {
    let mut stmt = db(conn.prepare(
        "SELECT id, title, updated_at FROM wiki_articles WHERE project_id = ?1 \
         ORDER BY sort_order ASC, updated_at DESC, id ASC",
    ))?;
    let rows = db(stmt
        .query_map([id], |r| {
            Ok(ArticleRef {
                id: r.get(0)?,
                title: r.get(1)?,
                updated_at: r.get(2)?,
            })
        })
        .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>()))?;
    Ok(rows)
}

pub fn get_project(conn: &Connection, project: &str) -> R<ProjectDetail> {
    let id = resolve_project(conn, project)?;
    let pref = project_ref(conn, id)?;
    let notes: Option<String> = db(conn.query_row(
        "SELECT notes FROM projects WHERE id = ?1",
        [id],
        |r| r.get(0),
    ))?;

    let mut tstmt = db(conn.prepare(
        "SELECT id, title, status, priority, due_date FROM tasks WHERE project_id = ?1 \
         ORDER BY sort_order ASC, id ASC",
    ))?;
    let mut tasks: Vec<Task> = db(tstmt
        .query_map([id], |r| {
            Ok(Task {
                id: r.get(0)?,
                title: r.get(1)?,
                status: r.get(2)?,
                priority: r.get(3)?,
                due_date: r.get(4)?,
                subtasks: Vec::new(),
            })
        })
        .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>()))?;
    let mut sstmt = db(conn.prepare(
        "SELECT id, title, status, due_date FROM subtasks WHERE task_id = ?1 \
         ORDER BY sort_order ASC, id ASC",
    ))?;
    for t in &mut tasks {
        t.subtasks = db(sstmt
            .query_map([t.id], |r| {
                Ok(Subtask {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    status: r.get(2)?,
                    due_date: r.get(3)?,
                })
            })
            .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>()))?;
    }

    let mut rstmt = db(conn.prepare(
        "SELECT r.id, r.name, r.url FROM resources r \
         JOIN resource_projects rp ON rp.resource_id = r.id \
         WHERE rp.project_id = ?1 ORDER BY r.name COLLATE NOCASE, r.id",
    ))?;
    let tools = db(rstmt
        .query_map([id], |r| {
            Ok(Tool {
                id: r.get(0)?,
                name: r.get(1)?,
                url: r.get(2)?,
            })
        })
        .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>()))?;

    Ok(ProjectDetail {
        project: pref,
        notes: notes.unwrap_or_default(),
        tasks,
        wiki: wiki_for_project(conn, id)?,
        tools,
    })
}

// ── Tasks ────────────────────────────────────────────────────

/// `due_before` is inclusive: tasks due on or before that date.
pub fn list_tasks(
    conn: &Connection,
    project: Option<&str>,
    status: Option<&str>,
    due_before: Option<&str>,
) -> R<Vec<TaskRow>> {
    let project_id = match project.map(str::trim).filter(|p| !p.is_empty()) {
        Some(p) => Some(resolve_project(conn, p)?),
        None => None,
    };
    let mut stmt = db(conn.prepare(
        "SELECT t.id, t.title, t.status, t.priority, t.due_date, p.id, p.name, c.name \
         FROM tasks t JOIN projects p ON p.id = t.project_id JOIN clients c ON c.id = p.client_id \
         WHERE (?1 IS NULL OR t.project_id = ?1) \
           AND (?2 IS NULL OR t.status = ?2) \
           AND (?3 IS NULL OR (t.due_date IS NOT NULL AND substr(t.due_date, 1, 10) <= ?3)) \
         ORDER BY (t.due_date IS NULL), t.due_date, p.name COLLATE NOCASE, t.sort_order, t.id",
    ))?;
    let rows = db(stmt
        .query_map(params![project_id, status, due_before], |r| {
            Ok(TaskRow {
                id: r.get(0)?,
                title: r.get(1)?,
                status: r.get(2)?,
                priority: r.get(3)?,
                due_date: r.get(4)?,
                project_id: r.get(5)?,
                project: r.get(6)?,
                client: r.get(7)?,
            })
        })
        .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>()))?;
    Ok(rows)
}

// ── Clients ──────────────────────────────────────────────────

pub fn list_clients(conn: &Connection, text: Option<&str>) -> R<Vec<ClientRef>> {
    let mut stmt =
        db(conn.prepare("SELECT id, name, COALESCE(email, '') FROM clients ORDER BY id"))?;
    let mut rows = db(stmt
        .query_map([], |r| {
            Ok(ClientRef {
                id: r.get(0)?,
                name: r.get(1)?,
                email: r.get(2)?,
            })
        })
        .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>()))?;
    if let Some(t) = text.map(fold).filter(|t| !t.trim().is_empty()) {
        let t = t.trim();
        rows.retain(|c| fold(&c.name).contains(t) || fold(&c.email).contains(t));
    }
    sort_by_name(&mut rows, |c| &c.name);
    Ok(rows)
}

pub fn get_client(conn: &Connection, client: &str) -> R<ClientDetail> {
    let id = resolve_client(conn, client)?;
    let (name, email, phone, a1, a2, lang, notes) = db(conn.query_row(
        "SELECT name, COALESCE(email,''), COALESCE(phone,''), COALESCE(address_line1,''), \
                COALESCE(address_line2,''), language, COALESCE(notes,'') FROM clients WHERE id = ?1",
        [&id],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
            ))
        },
    ))?;
    let mut cstmt = db(conn.prepare(
        "SELECT first_name, last_name, COALESCE(email,''), COALESCE(phone,''), COALESCE(role,'') \
         FROM client_contacts WHERE client_id = ?1 ORDER BY id",
    ))?;
    let contacts = db(cstmt
        .query_map([&id], |r| {
            Ok(Contact {
                first_name: r.get(0)?,
                last_name: r.get(1)?,
                email: r.get(2)?,
                phone: r.get(3)?,
                role: r.get(4)?,
            })
        })
        .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>()))?;
    let mut projects: Vec<ProjectRef> = all_projects(conn)?
        .into_iter()
        .filter(|p| p.client_id == id)
        .collect();
    sort_by_name(&mut projects, |p| &p.name);
    Ok(ClientDetail {
        id,
        name,
        email,
        phone,
        address_line1: a1,
        address_line2: a2,
        language: lang,
        notes,
        contacts,
        projects,
    })
}

// ── Wiki ─────────────────────────────────────────────────────

pub fn list_wiki(conn: &Connection, project: &str) -> R<Vec<ArticleRef>> {
    let id = resolve_project(conn, project)?;
    wiki_for_project(conn, id)
}

pub fn get_wiki_article(conn: &Connection, project: &str, title: &str) -> R<Article> {
    let id = resolve_project(conn, project)?;
    let mut stmt = db(conn.prepare(
        "SELECT id, title, content FROM wiki_articles WHERE project_id = ?1 \
         ORDER BY sort_order ASC, id ASC",
    ))?;
    let rows: Vec<(i64, String, String)> = db(stmt
        .query_map([id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .and_then(|rows| rows.collect()))?;
    let items: Vec<(usize, String, String)> = rows
        .iter()
        .enumerate()
        .map(|(i, (aid, t, _))| (i, aid.to_string(), t.clone()))
        .collect();
    let i = pick("article", title, &items)?;
    let (_, t, html) = &rows[i];
    Ok(Article {
        title: t.clone(),
        markdown: html_to_markdown(html),
        html: html.clone(),
    })
}

fn decode_entities(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
}

/// Make `out` end with exactly `n` newlines (no-op when empty).
fn end_with_newlines(out: &mut String, n: usize) {
    if out.is_empty() {
        return;
    }
    let trimmed = out.trim_end_matches([' ', '\n']).len();
    out.truncate(trimmed);
    for _ in 0..n {
        out.push('\n');
    }
}

/// Plain-text rendering of the editor's HTML: headings and list bullets kept,
/// paragraphs and breaks become newlines, other tags dropped.
pub fn html_to_markdown(html: &str) -> String {
    let mut out = String::new();
    let mut li_depth = 0usize;
    let mut rest = html;
    while let Some(lt) = rest.find('<') {
        out.push_str(&decode_entities(&rest[..lt]));
        let after = &rest[lt + 1..];
        let Some(gt) = after.find('>') else {
            rest = "";
            break;
        };
        let tag = after[..gt].trim();
        rest = &after[gt + 1..];
        let closing = tag.starts_with('/');
        let name: String = tag
            .trim_start_matches('/')
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric())
            .collect::<String>()
            .to_lowercase();
        match (name.as_str(), closing) {
            ("h1" | "h2" | "h3", false) => {
                end_with_newlines(&mut out, 2);
                out.push_str(&"#".repeat(name[1..].parse::<usize>().unwrap_or(1)));
                out.push(' ');
            }
            ("h1" | "h2" | "h3", true) => end_with_newlines(&mut out, 2),
            ("li", false) => {
                li_depth += 1;
                end_with_newlines(&mut out, 1);
                out.push_str("- ");
            }
            ("li", true) => {
                li_depth = li_depth.saturating_sub(1);
                end_with_newlines(&mut out, 1);
            }
            ("p", true) => end_with_newlines(&mut out, if li_depth > 0 { 1 } else { 2 }),
            ("br", _) => out.push('\n'),
            ("ul" | "ol", _) => end_with_newlines(&mut out, 1),
            _ => {}
        }
    }
    out.push_str(&decode_entities(rest));
    out.trim().to_string()
}

// ── Due list ─────────────────────────────────────────────────

fn parse_date(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s.get(..10)?, "%Y-%m-%d").ok()
}

/// Late or due within `days` of `today`, not done. Deadlines: active projects.
/// Tasks and subtasks: active or on-hold projects.
pub fn whats_due(conn: &Connection, days: i64, today: NaiveDate) -> R<Vec<DueItem>> {
    let mut items: Vec<DueItem> = Vec::new();
    let mut push =
        |kind: &str, date: Option<String>, title: String, project: String, client: String| {
            if let Some(d) = date.as_deref().and_then(parse_date) {
                let left = (d - today).num_days();
                if left <= days {
                    items.push(DueItem {
                        kind: kind.to_string(),
                        date: d.format("%Y-%m-%d").to_string(),
                        days_left: left,
                        title,
                        project,
                        client,
                    });
                }
            }
        };

    let queries: [(&str, &str); 3] = [
        (
            "deadline",
            "SELECT p.deadline, p.name, p.name, c.name FROM projects p JOIN clients c ON c.id = p.client_id \
             WHERE p.status = 'active' AND p.deadline IS NOT NULL",
        ),
        (
            "task",
            "SELECT t.due_date, t.title, p.name, c.name FROM tasks t \
             JOIN projects p ON p.id = t.project_id JOIN clients c ON c.id = p.client_id \
             WHERE p.status IN ('active','on_hold') AND t.status != 'done' AND t.due_date IS NOT NULL",
        ),
        (
            "subtask",
            "SELECT s.due_date, s.title, p.name, c.name FROM subtasks s \
             JOIN tasks t ON t.id = s.task_id \
             JOIN projects p ON p.id = t.project_id JOIN clients c ON c.id = p.client_id \
             WHERE p.status IN ('active','on_hold') AND s.status != 'done' AND s.due_date IS NOT NULL",
        ),
    ];
    for (kind, sql) in queries {
        let mut stmt = db(conn.prepare(sql))?;
        let rows: Vec<(String, String, String, String)> = db(stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .and_then(|rows| rows.collect()))?;
        for (date, title, project, client) in rows {
            push(kind, Some(date), title, project, client);
        }
    }
    items.sort_by(|a, b| {
        a.date
            .cmp(&b.date)
            .then_with(|| fold(&a.title).cmp(&fold(&b.title)))
    });
    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{seed_app_db, temp_data_dir};

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    /// Fictional fixture: two clients, four projects, tasks, wiki, tools.
    fn fixture() -> Connection {
        let dir = temp_data_dir();
        let path = seed_app_db(&dir, "org1");
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "
            INSERT INTO clients (id, name, email, phone, language) VALUES
              ('C-001', 'Atelier Lumen', 'hello@lumen.test', '+41 00 000 00 00', 'FR'),
              ('C-002', 'Éditions Boréale', 'info@boreale.test', '', 'EN');
            INSERT INTO client_contacts (client_id, first_name, last_name, email, role)
              VALUES ('C-001', 'Ada', 'Moreau', 'ada@lumen.test', 'Director');
            INSERT INTO projects (id, client_id, name, status, deadline, notes, folder_path) VALUES
              (1, 'C-001', 'Identité Visuelle', 'active', '2026-11-05', 'Brand notes', '/work/lumen/identity/'),
              (2, 'C-001', 'Site Web', 'on_hold', '2026-10-01', '', '/work/lumen/site'),
              (3, 'C-002', 'Catalogue Printemps', 'active', NULL, '', NULL),
              (9, 'C-002', 'Catalogue Automne', 'cancelled', '2026-10-30', '', NULL);
            INSERT INTO tasks (id, project_id, title, status, priority, due_date, sort_order) VALUES
              (1, 1, 'Logo variants', 'in_progress', 'high', '2026-10-29', 1),
              (2, 1, 'Final files', 'done', 'low', '2026-10-20', 2),
              (3, 2, 'Wireframes', 'todo', 'medium', '2026-10-25', 1),
              (4, 3, 'Layout grid', 'todo', 'medium', '2027-01-01', 1),
              (5, 9, 'Cancelled work', 'todo', 'medium', '2026-10-28', 1);
            INSERT INTO subtasks (id, task_id, title, status, due_date, sort_order) VALUES
              (1, 1, 'Monochrome', 'todo', '2026-10-28', 1),
              (2, 1, 'Reversed', 'done', '2026-10-26', 2);
            INSERT INTO resources (id, name, url) VALUES (1, 'Figma', 'https://figma.test'), (2, 'Unused', 'x');
            INSERT INTO resource_projects (resource_id, project_id) VALUES (1, 1);
            INSERT INTO wiki_articles (id, project_id, title, content, sort_order) VALUES
              (1, 1, 'Brief', '<h2>Goals</h2><p>Fresh &amp; clear</p>', 1),
              (2, 1, 'Decisions', '<ul><li><p><strong>2026-10-01</strong> Use blue</p></li><li><p>Keep it &lt;simple&gt;</p></li></ul>', 2);
            ",
        )
        .unwrap();
        conn
    }

    #[test]
    fn folder_lookup_exact_and_trailing_slash() {
        let c = fixture();
        assert_eq!(
            find_project_for_folder(&c, "/work/lumen/identity")
                .unwrap()
                .id,
            1
        );
        assert_eq!(
            find_project_for_folder(&c, "/work/lumen/site/").unwrap().id,
            2
        );
        assert!(find_project_for_folder(&c, "/work/other").is_none());
        assert!(find_project_for_folder(&c, "/Work/lumen/site").is_none());
    }

    #[test]
    fn folder_lookup_walks_up_to_parent() {
        let c = fixture();
        let p = find_project_for_folder(&c, "/work/lumen/identity/assets/logos").unwrap();
        assert_eq!(p.id, 1);
        assert_eq!(p.client_name, "Atelier Lumen");
    }

    #[test]
    fn list_projects_filters() {
        let c = fixture();
        assert_eq!(list_projects(&c, None, None, None).unwrap().len(), 4);
        let active = list_projects(&c, Some("active"), None, None).unwrap();
        assert_eq!(active.len(), 2);
        let lumen = list_projects(&c, None, Some("lumen"), None).unwrap();
        assert_eq!(lumen.len(), 2);
        let by_id = list_projects(&c, None, Some("C-002"), None).unwrap();
        assert_eq!(by_id.len(), 2);
        let text = list_projects(&c, None, None, Some("CATALOGUE")).unwrap();
        assert_eq!(text.len(), 2);
    }

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
    fn get_project_detail_and_by_id() {
        let c = fixture();
        let p = get_project(&c, "1").unwrap();
        assert_eq!(p.notes, "Brand notes");
        assert_eq!(p.tasks.len(), 2);
        assert_eq!(p.tasks[0].subtasks.len(), 2);
        assert_eq!(p.tasks[0].subtasks[0].title, "Monochrome");
        assert_eq!(p.wiki.len(), 2);
        assert_eq!(
            p.tools,
            vec![Tool {
                id: 1,
                name: "Figma".into(),
                url: "https://figma.test".into()
            }]
        );
    }

    #[test]
    fn ambiguous_name_lists_candidates() {
        let c = fixture();
        let e = get_project(&c, "catalogue").unwrap_err();
        assert_eq!(
            e,
            "Several projects match \"catalogue\": Catalogue Printemps (id 3), Catalogue Automne (id 9). Use the id."
        );
        assert_eq!(
            get_project(&c, "9").unwrap().project.name,
            "Catalogue Automne"
        );
        let e = get_client(&c, "e").unwrap_err();
        assert!(e.starts_with("Several clients match \"e\": "), "{e}");
        assert!(
            e.contains("(id C-001)") && e.ends_with("Use the id."),
            "{e}"
        );
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

    #[test]
    fn list_tasks_filters() {
        let c = fixture();
        assert_eq!(list_tasks(&c, None, None, None).unwrap().len(), 5);
        let p1 = list_tasks(&c, Some("Identité visuelle"), None, None).unwrap();
        assert_eq!(p1.len(), 2);
        assert_eq!(p1[0].client, "Atelier Lumen");
        let todo = list_tasks(&c, None, Some("todo"), Some("2026-10-28")).unwrap();
        let titles: Vec<_> = todo.iter().map(|t| t.title.as_str()).collect();
        assert_eq!(titles, vec!["Wireframes", "Cancelled work"]);
    }

    #[test]
    fn clients() {
        let c = fixture();
        let all = list_clients(&c, None).unwrap();
        assert_eq!(
            all.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(),
            ["C-001", "C-002"]
        );
        assert_eq!(list_clients(&c, Some("BOREALE")).unwrap().len(), 1);
        let det = get_client(&c, "C-001").unwrap();
        assert_eq!(det.projects.len(), 2);
        assert_eq!(det.contacts[0].last_name, "Moreau");
        assert_eq!(det.language, "FR");
    }

    #[test]
    fn wiki_list_and_article() {
        let c = fixture();
        let l = list_wiki(&c, "1").unwrap();
        assert_eq!(
            l.iter().map(|a| a.title.as_str()).collect::<Vec<_>>(),
            ["Brief", "Decisions"]
        );
        let a = get_wiki_article(&c, "Identité Visuelle", "brief").unwrap();
        assert_eq!(a.title, "Brief");
        assert!(a.html.starts_with("<h2>"));
        assert_eq!(a.markdown, "## Goals\n\nFresh & clear");
        assert!(get_wiki_article(&c, "1", "missing")
            .unwrap_err()
            .starts_with("No article matches"));
    }

    #[test]
    fn wiki_markdown_rendering_of_list() {
        let c = fixture();
        let a = get_wiki_article(&c, "1", "Decisions").unwrap();
        assert_eq!(a.markdown, "- 2026-10-01 Use blue\n- Keep it <simple>");
        assert_eq!(
            html_to_markdown("a<br>b &quot;q&quot; &#39;s&#39;"),
            "a\nb \"q\" 's'"
        );
    }

    #[test]
    fn whats_due_excludes_done_and_cancelled() {
        let c = fixture();
        let due = whats_due(&c, 7, d("2026-10-27")).unwrap();
        let got: Vec<(&str, &str, i64)> = due
            .iter()
            .map(|i| (i.kind.as_str(), i.title.as_str(), i.days_left))
            .collect();
        assert_eq!(
            got,
            vec![
                ("task", "Wireframes", -2), // on-hold project, late
                ("subtask", "Monochrome", 1),
                ("task", "Logo variants", 2),
            ]
        );
        // done task/subtask, cancelled project's task + deadline, far-off task all excluded
        let wide = whats_due(&c, 10, d("2026-10-27")).unwrap();
        assert!(wide
            .iter()
            .any(|i| i.kind == "deadline" && i.title == "Identité Visuelle" && i.days_left == 9));
        // the on-hold project's deadline is not listed
        assert!(!wide
            .iter()
            .any(|i| i.kind == "deadline" && i.title == "Site Web"));
        assert!(wide.iter().all(|i| i.title != "Cancelled work"
            && i.title != "Final files"
            && i.title != "Reversed"));
    }

    #[test]
    fn whats_due_sorts_by_date_then_title() {
        let c = fixture();
        c.execute(
            "INSERT INTO tasks (project_id, title, status, due_date) VALUES (1, 'Alpha', 'todo', '2026-10-29')",
            [],
        )
        .unwrap();
        let due = whats_due(&c, 7, d("2026-10-27")).unwrap();
        let titles: Vec<_> = due.iter().map(|i| i.title.as_str()).collect();
        assert_eq!(
            titles,
            ["Wireframes", "Monochrome", "Alpha", "Logo variants"]
        );
    }
}
