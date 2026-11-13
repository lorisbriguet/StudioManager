//! What the watcher reads from an organisation's database: its own open links, the items that
//! are Ready, and whether a link has an open question. Reads only: the watcher of this task
//! writes nothing.

use super::super::capture::open;
use super::super::links::{has_table, parse_utc_ms, ItemKind};
use chrono::NaiveDate;
use rusqlite::Connection;
use std::cmp::Reverse;
use std::path::Path;

/// An open link the watcher started (`task_agents.started_by = 'watcher'`). A hand-started link
/// (`started_by` null) belongs to part 2's tracker and is not here.
#[derive(Clone, Debug, PartialEq)]
pub struct WatcherLink {
    pub org: String,
    pub id: i64,
    pub kind: ItemKind,
    pub item_id: i64,
    pub short_id: String,
    pub session_id: Option<String>,
    pub worktree: Option<String>,
    pub base_ref: Option<String>,
    pub check_state: Option<String>,
    pub reported: bool,
    /// Epoch ms.
    pub started_at: i64,
    pub wrap_asked_at: Option<i64>,
    pub resumes: i64,
    pub check_fails: i64,
    pub sent_back: i64,
    pub question_sessions: i64,
    pub check_sessions: i64,
    /// Epoch ms: when the watcher first saw the agent in its current idle or needs-you state.
    /// Not stored in the database: the agent list carries no such time, so the watcher keeps it
    /// in memory and fills it in. None when unknown.
    pub seen_since: Option<i64>,
}

pub fn open_watcher_links(db: &Path, org: &str) -> Result<Vec<WatcherLink>, String> {
    let conn = open(db)?;
    if !has_table(&conn) {
        return Ok(vec![]);
    }
    let e = |e: rusqlite::Error| format!("Failed to read links: {e}");
    let mut st = conn
        .prepare(
            "SELECT id, task_id, subtask_id, short_id, session_id, worktree, base_ref, check_state,
                    reported_at IS NOT NULL, started_at, wrap_asked_at, resumes, check_fails, sent_back,
                    question_sessions, check_sessions
             FROM task_agents WHERE ended_at IS NULL AND started_by = 'watcher' ORDER BY id",
        )
        .map_err(e)?;
    let rows = st
        .query_map([], |r| {
            let task: Option<i64> = r.get(1)?;
            let sub: Option<i64> = r.get(2)?;
            let started: String = r.get(9)?;
            let wrap: Option<String> = r.get(10)?;
            let (kind, item_id) = match (task, sub) {
                (Some(t), None) => (ItemKind::Task, t),
                (None, Some(s)) => (ItemKind::Subtask, s),
                _ => return Ok(None),
            };
            Ok(Some(WatcherLink {
                org: org.to_string(),
                id: r.get(0)?,
                kind,
                item_id,
                short_id: r.get(3)?,
                session_id: r.get(4)?,
                worktree: r.get(5)?,
                base_ref: r.get(6)?,
                check_state: r.get(7)?,
                reported: r.get(8)?,
                started_at: parse_utc_ms(&started),
                wrap_asked_at: wrap.as_deref().map(parse_utc_ms),
                resumes: r.get(11)?,
                check_fails: r.get(12)?,
                sent_back: r.get(13)?,
                question_sessions: r.get(14)?,
                check_sessions: r.get(15)?,
                seen_since: None,
            }))
        })
        .map_err(e)?;
    let mut out = Vec::new();
    for row in rows {
        out.extend(row.map_err(e)?);
    }
    Ok(out)
}

/// The id of the open `decide` entry of a link, if it has one.
pub fn open_ask(db: &Path, link_id: i64) -> Result<Option<i64>, String> {
    let conn = open(db)?;
    open_ask_in(&conn, link_id)
}

fn open_ask_in(conn: &Connection, link_id: i64) -> Result<Option<i64>, String> {
    let has = conn
        .query_row("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'needs_you'", [], |_| Ok(()))
        .is_ok();
    if !has {
        return Ok(None);
    }
    match conn.query_row(
        "SELECT id FROM needs_you WHERE link_id = ?1 AND kind = 'decide' AND status = 'open' ORDER BY id LIMIT 1",
        [link_id],
        |r| r.get(0),
    ) {
        Ok(id) => Ok(Some(id)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Failed to read questions: {e}")),
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ReadyItem {
    pub kind: ItemKind,
    pub id: i64,
    pub title: String,
    pub project_id: i64,
    pub folder: Option<String>,
    /// The effective priority: `low`, `medium` or `high`.
    pub priority: String,
    /// The deadline the priority was judged on: the end date, else the due date.
    pub due: Option<String>,
}

fn rank(priority: &str) -> usize {
    match priority {
        "high" => 2,
        "medium" => 1,
        _ => 0,
    }
}

/// `effectivePriority` of `src/types/task.ts`: a deadline today or past makes it high, tomorrow
/// at least medium, otherwise the stored priority. A deadline that is not a date changes nothing.
pub fn effective_priority(stored: &str, deadline: Option<&str>, today: NaiveDate) -> String {
    let Some(due) = deadline.filter(|d| !d.is_empty()).and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
    else {
        return stored.to_string();
    };
    let days = (due - today).num_days();
    let by_date = if days <= 0 {
        2
    } else if days == 1 {
        1
    } else {
        0
    };
    ["low", "medium", "high"][rank(stored).max(by_date)].to_string()
}

/// Ready items (stage `ready`, not done): effective priority first, then deadline (none last),
/// then id. Subtasks take their task's priority. "Today" is the local date.
pub fn ready_items(db: &Path) -> Result<Vec<ReadyItem>, String> {
    ready_items_on(db, chrono::Local::now().date_naive())
}

pub fn ready_items_on(db: &Path, today: NaiveDate) -> Result<Vec<ReadyItem>, String> {
    let conn = open(db)?;
    let e = |e: rusqlite::Error| format!("Failed to read tasks: {e}");
    let mut st = conn
        .prepare(
            "SELECT 0, t.id, t.title, t.project_id, p.folder_path, t.priority,
                    COALESCE(NULLIF(t.end_date, ''), NULLIF(t.due_date, ''))
             FROM tasks t JOIN projects p ON p.id = t.project_id
             WHERE t.stage = 'ready' AND t.status <> 'done'
             UNION ALL
             SELECT 1, s.id, s.title, t.project_id, p.folder_path, t.priority,
                    COALESCE(NULLIF(s.end_date, ''), NULLIF(s.due_date, ''))
             FROM subtasks s JOIN tasks t ON t.id = s.task_id JOIN projects p ON p.id = t.project_id
             WHERE s.stage = 'ready' AND s.status <> 'done'",
        )
        .map_err(e)?;
    let rows = st
        .query_map([], |r| {
            let sub: i64 = r.get(0)?;
            let stored: Option<String> = r.get(5)?;
            let due: Option<String> = r.get(6)?;
            let priority = effective_priority(stored.as_deref().unwrap_or("medium"), due.as_deref(), today);
            Ok(ReadyItem {
                kind: if sub == 1 { ItemKind::Subtask } else { ItemKind::Task },
                id: r.get(1)?,
                title: r.get(2)?,
                project_id: r.get(3)?,
                folder: r.get(4)?,
                priority,
                due,
            })
        })
        .map_err(e)?;
    let mut out: Vec<ReadyItem> = rows.collect::<Result<_, _>>().map_err(e)?;
    out.sort_by(order);
    Ok(out)
}

/// The order of `ready_items`, usable to compare items of several organisations.
pub fn order(a: &ReadyItem, b: &ReadyItem) -> std::cmp::Ordering {
    let key = |i: &ReadyItem| (Reverse(rank(&i.priority)), i.due.is_none(), i.due.clone(), i.id);
    key(a).cmp(&key(b))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;
    use std::path::PathBuf;

    fn migrated(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("sm-watcher-store-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let db = d.join("studiomanager.db");
        let conn = Connection::open(&db).unwrap();
        for m in crate::migrate::MIGRATIONS {
            conn.execute_batch(m.sql).unwrap();
        }
        conn.execute_batch(
            "INSERT INTO clients (id, name) VALUES ('c1', 'Studio A');
             INSERT INTO projects (id, client_id, name, folder_path) VALUES (1, 'c1', 'Poster tool', '/tmp/poster');",
        )
        .unwrap();
        db
    }

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 11, 13).unwrap()
    }

    // The cases of the rule in `src/types/task.ts`.
    #[test]
    fn effective_priority_follows_the_task_rule() {
        let p = |stored: &str, due: Option<&str>| effective_priority(stored, due, today());
        assert_eq!(p("low", None), "low");
        assert_eq!(p("medium", None), "medium");
        assert_eq!(p("low", Some("2026-11-13")), "high", "due today");
        assert_eq!(p("low", Some("2026-11-01")), "high", "past");
        assert_eq!(p("low", Some("2026-11-14")), "medium", "tomorrow");
        assert_eq!(p("high", Some("2026-11-14")), "high", "tomorrow keeps a higher stored one");
        assert_eq!(p("medium", Some("2026-11-14")), "medium");
        assert_eq!(p("low", Some("2026-11-15")), "low", "the day after tomorrow");
        assert_eq!(p("medium", Some("2026-12-24")), "medium");
        assert_eq!(p("low", Some("not a date")), "low");
        assert_eq!(p("low", Some("")), "low");
    }

    #[test]
    fn ready_items_order_by_priority_then_due_then_id_and_leave_out_done() {
        let db = migrated("order");
        let c = Connection::open(&db).unwrap();
        let add = |title: &str, prio: &str, due: Option<&str>, stage: &str, status: &str| {
            c.execute(
                "INSERT INTO tasks (project_id, title, priority, due_date, stage, status) VALUES (1, ?1, ?2, ?3, ?4, ?5)",
                params![title, prio, due, stage, status],
            )
            .unwrap();
            c.last_insert_rowid()
        };
        add("Low, no date", "low", None, "ready", "todo");
        add("Medium, far", "medium", Some("2027-03-01"), "ready", "todo");
        add("Medium, sooner", "medium", Some("2027-02-01"), "ready", "todo");
        add("High, no date", "high", None, "ready", "todo");
        add("Low but due today", "low", Some("2026-11-13"), "ready", "todo");
        add("Done", "high", None, "ready", "done");
        add("Not ready", "high", None, "briefed", "todo");
        let parent = add("Parent", "high", None, "running", "todo");
        c.execute("INSERT INTO subtasks (task_id, title, stage) VALUES (?1, 'Contact sheet export', 'ready')", [parent])
            .unwrap();
        let titles: Vec<String> = ready_items_on(&db, today()).unwrap().into_iter().map(|i| i.title).collect();
        assert_eq!(
            titles,
            vec![
                "Low but due today",     // high through its date, and dated
                "Contact sheet export",  // high through its task, no date, lower id
                "High, no date",
                "Medium, sooner",
                "Medium, far",
                "Low, no date",
            ]
        );
    }

    #[test]
    fn a_hand_link_is_not_a_watcher_link() {
        let db = migrated("links");
        let c = Connection::open(&db).unwrap();
        c.execute("INSERT INTO tasks (project_id, title, stage) VALUES (1, 'Poster tool', 'running')", []).unwrap();
        for by in [None, Some("watcher")] {
            c.execute(
                "INSERT INTO task_agents (task_id, short_id, name, started_at, started_by, resumes)
                 VALUES (1, 'abc12345', 'work', '2027-01-15 08:00:00', ?1, 2)",
                params![by],
            )
            .unwrap();
        }
        let links = open_watcher_links(&db, "org1").unwrap();
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].id, 2);
        assert_eq!(links[0].resumes, 2);
        assert_eq!(links[0].org, "org1");
        assert_eq!(links[0].kind, ItemKind::Task);
    }

    #[test]
    fn open_ask_finds_only_an_open_decide_entry_of_the_link() {
        let db = migrated("ask");
        let c = Connection::open(&db).unwrap();
        c.execute("INSERT INTO tasks (project_id, title, stage) VALUES (1, 'Poster tool', 'running')", []).unwrap();
        c.execute(
            "INSERT INTO task_agents (task_id, short_id, name, started_at, started_by)
             VALUES (1, 'abc12345', 'work', '2027-01-15 08:00:00', 'watcher')",
            [],
        )
        .unwrap();
        assert_eq!(open_ask(&db, 1).unwrap(), None);
        c.execute("INSERT INTO needs_you (kind, task_id, link_id, title, status) VALUES ('decide', 1, 1, 'Which size?', 'answered')", []).unwrap();
        c.execute("INSERT INTO needs_you (kind, task_id, link_id, title) VALUES ('check', 1, 1, 'Done')", []).unwrap();
        assert_eq!(open_ask(&db, 1).unwrap(), None);
        c.execute("INSERT INTO needs_you (kind, task_id, link_id, title) VALUES ('decide', 1, 1, 'Which size?')", []).unwrap();
        assert_eq!(open_ask(&db, 1).unwrap(), Some(3));
    }
}
