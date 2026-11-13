//! What the watcher reads from an organisation's database: its own open links, the items that
//! are Ready, and whether a link has an open question. It writes only what starting a worker
//! needs: the link and the Running stage (`add_link`) and a "Could not start" entry
//! (`add_entry`); the callers hold `crate::org_shared()`.

use super::super::links::{has_table, parse_utc_ms, ItemKind};
use chrono::NaiveDate;
use rusqlite::{params, Connection, OpenFlags, TransactionBehavior};
use std::cmp::Reverse;
use std::path::Path;
use std::time::Duration;

/// Opens an organisation's database to read only: no create, so a missing file is an error and
/// nothing is written to it.
fn open(db: &Path) -> Result<Connection, String> {
    let conn = Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(|e| format!("Failed to open DB: {e}"))?;
    conn.busy_timeout(Duration::from_millis(5000))
        .map_err(|e| format!("Failed to set busy_timeout: {e}"))?;
    Ok(conn)
}

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

/// The title prefix of the entry a failed start leaves.
pub const COULD_NOT_START: &str = "Could not start: ";
/// The entry of an agent that runs but whose link could not be written.
pub const NOT_LINKED: &str = "The agent started but could not be linked: ";

/// The items with an open "Could not start" entry (decide, open, no link): the watcher skips them.
pub fn open_could_not_start(db: &Path) -> Result<Vec<(ItemKind, i64)>, String> {
    let conn = open(db)?;
    let has = conn
        .query_row("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'needs_you'", [], |_| Ok(()))
        .is_ok();
    if !has {
        return Ok(vec![]);
    }
    let e = |e: rusqlite::Error| format!("Failed to read entries: {e}");
    let mut st = conn
        .prepare(
            "SELECT task_id, subtask_id FROM needs_you
             WHERE kind = 'decide' AND status = 'open' AND link_id IS NULL AND (title LIKE 'Could not start: %' OR title LIKE 'The agent started but could not be linked: %')",
        )
        .map_err(e)?;
    let rows = st
        .query_map([], |r| Ok((r.get::<_, Option<i64>>(0)?, r.get::<_, Option<i64>>(1)?)))
        .map_err(e)?;
    let mut out = Vec::new();
    for row in rows {
        match row.map_err(e)? {
            (Some(t), None) => out.push((ItemKind::Task, t)),
            (None, Some(s)) => out.push((ItemKind::Subtask, s)),
            _ => {}
        }
    }
    Ok(out)
}

fn table_of(kind: ItemKind) -> (&'static str, &'static str) {
    match kind {
        ItemKind::Task => ("tasks", "task_id"),
        ItemKind::Subtask => ("subtasks", "subtask_id"),
    }
}

/// A Decide entry on an item with no link (status open, no lead state). A Check entry is `add_check`.
pub fn add_entry(db: &Path, kind: ItemKind, item_id: i64, title: &str, body: &str) -> Result<i64, String> {
    let conn = super::super::capture::open(db)?;
    let (task, sub) = match kind {
        ItemKind::Task => (Some(item_id), None),
        ItemKind::Subtask => (None, Some(item_id)),
    };
    let title: String = title.chars().take(200).collect();
    let body: String = body.chars().take(2000).collect();
    conn.execute(
        "INSERT INTO needs_you (kind, task_id, subtask_id, link_id, title, body, status, lead_state)
         VALUES ('decide', ?1, ?2, NULL, ?3, ?4, 'open', NULL)",
        params![task, sub, title, body],
    )
    .map_err(|e| format!("Failed to write the entry: {e}"))?;
    Ok(conn.last_insert_rowid())
}

/// One of the counters of `task_agents`: each is bumped in the same transaction as the decision
/// it limits, before the message or the start.
// Only `CheckFails` is bumped yet (through `decide_send_back`); Tasks 11 and 12 bump the others.
#[allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Counter {
    Resumes,
    CheckFails,
    SentBack,
    QuestionSessions,
    CheckSessions,
}

impl Counter {
    fn column(self) -> &'static str {
        match self {
            Counter::Resumes => "resumes",
            Counter::CheckFails => "check_fails",
            Counter::SentBack => "sent_back",
            Counter::QuestionSessions => "question_sessions",
            Counter::CheckSessions => "check_sessions",
        }
    }
}

fn bump_in(conn: &Connection, link_id: i64, c: Counter) -> Result<i64, String> {
    let col = c.column();
    let e = |e: rusqlite::Error| format!("Failed to bump {col}: {e}");
    let n = conn.execute(&format!("UPDATE task_agents SET {col} = {col} + 1 WHERE id = ?1"), [link_id]).map_err(e)?;
    if n == 0 {
        return Err(format!("No link {link_id}"));
    }
    conn.query_row(&format!("SELECT {col} FROM task_agents WHERE id = ?1"), [link_id], |r| r.get(0)).map_err(e)
}

/// Adds one to a counter of a link and returns the new value. The callers hold `crate::org_shared()`.
#[allow(dead_code)] // Tasks 11 and 12 call it; Task 10 bumps inside `decide_send_back`.
pub fn bump(db: &Path, link_id: i64, c: Counter) -> Result<i64, String> {
    let mut conn = super::super::capture::open(db)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| format!("Failed to lock the database: {e}"))?;
    let n = bump_in(&tx, link_id, c)?;
    tx.commit().map_err(|e| format!("Failed to save the counter: {e}"))?;
    Ok(n)
}

/// `check_state` of a link (running, passed, failed, none, error; None clears it).
pub fn set_check_state(db: &Path, link_id: i64, state: Option<&str>) -> Result<(), String> {
    let conn = super::super::capture::open(db)?;
    conn.execute("UPDATE task_agents SET check_state = ?1 WHERE id = ?2", params![state, link_id])
        .map_err(|e| format!("Failed to write the check state: {e}"))?;
    Ok(())
}

/// The decision to send a failed check back to the worker, in one transaction: the failure is
/// counted and the check state cleared. Returns the new `check_fails`. The message is typed only
/// after this returned, so a crash in between loses the message and never allows a second one.
pub fn decide_send_back(db: &Path, link_id: i64) -> Result<i64, String> {
    let mut conn = super::super::capture::open(db)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| format!("Failed to lock the database: {e}"))?;
    let n = bump_in(&tx, link_id, Counter::CheckFails)?;
    tx.execute("UPDATE task_agents SET check_state = NULL WHERE id = ?1", [link_id])
        .map_err(|e| format!("Failed to write the check state: {e}"))?;
    tx.commit().map_err(|e| format!("Failed to save the decision: {e}"))?;
    Ok(n)
}

/// Forgets that the worker reported, so its next `report_result` is a new report (the MCP server
/// writes `reported_at` again).
pub fn clear_report(db: &Path, link_id: i64) -> Result<(), String> {
    let conn = super::super::capture::open(db)?;
    conn.execute("UPDATE task_agents SET reported_at = NULL WHERE id = ?1 AND ended_at IS NULL", [link_id])
        .map_err(|e| format!("Failed to clear the report: {e}"))?;
    Ok(())
}

/// Something the app did by itself that the owner should see: an answered `alone` entry decided
/// by the app, with its reason (the "Decided alone" group of the Needs you tab).
pub fn record_alone(
    db: &Path,
    kind: ItemKind,
    item_id: i64,
    link_id: Option<i64>,
    text: &str,
    reason: &str,
) -> Result<i64, String> {
    let conn = super::super::capture::open(db)?;
    let (task, sub) = match kind {
        ItemKind::Task => (Some(item_id), None),
        ItemKind::Subtask => (None, Some(item_id)),
    };
    let text: String = text.chars().take(200).collect();
    let reason: String = reason.chars().take(1000).collect();
    conn.execute(
        "INSERT INTO needs_you (kind, task_id, subtask_id, link_id, title, status, decided_by, reason, answered_at)
         VALUES ('alone', ?1, ?2, ?3, ?4, 'answered', 'app', ?5, datetime('now'))",
        params![task, sub, link_id, text, reason],
    )
    .map_err(|e| format!("Failed to write the entry: {e}"))?;
    Ok(conn.last_insert_rowid())
}

/// What a finished item tells the check: its title, the result its worker reported and the
/// project's check command.
#[derive(Clone, Debug, PartialEq)]
pub struct ItemFacts {
    pub title: String,
    pub result: String,
    pub check_command: Option<String>,
}

pub fn item_facts(db: &Path, kind: ItemKind, item_id: i64) -> Result<ItemFacts, String> {
    let conn = open(db)?;
    let sql = match kind {
        ItemKind::Task => {
            "SELECT t.title, t.result, p.check_command FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ?1"
        }
        ItemKind::Subtask => {
            "SELECT s.title, s.result, p.check_command FROM subtasks s JOIN tasks t ON t.id = s.task_id
             JOIN projects p ON p.id = t.project_id WHERE s.id = ?1"
        }
    };
    conn.query_row(sql, [item_id], |r| {
        let result: Option<String> = r.get(1)?;
        let command: Option<String> = r.get(2)?;
        Ok(ItemFacts {
            title: r.get(0)?,
            result: result.unwrap_or_default(),
            check_command: command.filter(|c| !c.trim().is_empty()),
        })
    })
    .map_err(|e| format!("Failed to read the item: {e}"))
}

/// A Check entry (kind `check`, open, `lead_state` waiting) for a link, with what the check found.
#[derive(Clone, Debug, PartialEq)]
pub struct NewCheck {
    pub kind: ItemKind,
    pub item_id: i64,
    pub link_id: i64,
    pub title: String,
    pub body: String,
    /// None: no check command, or not run.
    pub check_passed: Option<bool>,
    pub check_output: Option<String>,
    pub change_lines: Option<i64>,
    /// JSON array of the always-asks rules the change touches; None when the change was not measured.
    pub touches: Option<String>,
    /// What the link's `check_state` becomes in the same transaction.
    pub check_state: Option<&'static str>,
    /// Close the link with this outcome (`no_result`).
    pub close: Option<&'static str>,
}

/// Writes a Check entry in one transaction: the entry, the link's check state (and its end, when
/// closing) and the item's stage To check. A link has at most one open Check entry: with one
/// already open nothing is inserted and None comes back (the state is still written, so the same
/// finished state is not handled again).
pub fn add_check(db: &Path, c: &NewCheck) -> Result<Option<i64>, String> {
    let mut conn = super::super::capture::open(db)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| format!("Failed to lock the database: {e}"))?;
    let e = |e: rusqlite::Error| format!("Failed to write the entry: {e}");
    let open: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM needs_you WHERE link_id = ?1 AND kind = 'check' AND status = 'open'",
            [c.link_id],
            |r| r.get(0),
        )
        .map_err(e)?;
    let mut id = None;
    if open == 0 {
        let (task, sub) = match c.kind {
            ItemKind::Task => (Some(c.item_id), None),
            ItemKind::Subtask => (None, Some(c.item_id)),
        };
        let title: String = c.title.chars().take(200).collect();
        let body: String = c.body.chars().take(8000).collect();
        tx.execute(
            "INSERT INTO needs_you (kind, task_id, subtask_id, link_id, title, body, status, lead_state,
                                    check_passed, check_output, change_lines, touches)
             VALUES ('check', ?1, ?2, ?3, ?4, ?5, 'open', 'waiting', ?6, ?7, ?8, ?9)",
            params![task, sub, c.link_id, title, body, c.check_passed, c.check_output, c.change_lines, c.touches],
        )
        .map_err(e)?;
        id = Some(tx.last_insert_rowid());
    }
    if c.check_state.is_some() {
        tx.execute("UPDATE task_agents SET check_state = ?1 WHERE id = ?2", params![c.check_state, c.link_id])
            .map_err(e)?;
    }
    let (table, col) = table_of(c.kind);
    if let Some(outcome) = c.close {
        tx.execute(
            "UPDATE task_agents SET ended_at = datetime('now'), outcome = ?1 WHERE id = ?2 AND ended_at IS NULL",
            params![outcome, c.link_id],
        )
        .map_err(e)?;
    }
    let others: i64 = tx
        .query_row(
            &format!("SELECT COUNT(*) FROM task_agents WHERE {col} = ?1 AND ended_at IS NULL AND id <> ?2"),
            params![c.item_id, c.link_id],
            |r| r.get(0),
        )
        .map_err(e)?;
    // With another open link the item keeps running when this one closes.
    if c.close.is_none() || others == 0 {
        tx.execute(
            &format!(
                "UPDATE {table} SET stage = 'to_check', updated_at = datetime('now')
                 WHERE id = ?1 AND stage = 'running' AND status <> 'done'"
            ),
            [c.item_id],
        )
        .map_err(e)?;
    }
    tx.commit().map_err(|e| format!("Failed to save the entry: {e}"))?;
    Ok(id)
}

/// What a started worker is recorded as.
#[derive(Clone, Debug, PartialEq)]
pub struct NewLink {
    pub kind: ItemKind,
    pub item_id: i64,
    pub short_id: String,
    pub name: String,
    pub worktree: String,
    pub base_ref: String,
}

/// One transaction: the link (`started_by = 'watcher'`, as part 2 writes its rows: the session id
/// comes later from the agent list) and the item's stage Running, only if it is still Ready and
/// not done. Returns the link id.
pub fn add_link(db: &Path, l: &NewLink) -> Result<i64, String> {
    let mut conn = super::super::capture::open(db)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| format!("Failed to lock the database: {e}"))?;
    let (table, col) = table_of(l.kind);
    let e = |e: rusqlite::Error| format!("Failed to write the link: {e}");
    tx.execute(
        &format!(
            "INSERT INTO task_agents ({col}, short_id, name, model, started_by, worktree, base_ref)
             VALUES (?1, ?2, ?3, 'opus', 'watcher', ?4, ?5)"
        ),
        params![l.item_id, l.short_id, l.name, l.worktree, l.base_ref],
    )
    .map_err(e)?;
    let id = tx.last_insert_rowid();
    tx.execute(
        &format!(
            "UPDATE {table} SET stage = 'running', updated_at = datetime('now')
             WHERE id = ?1 AND stage = 'ready' AND status <> 'done'"
        ),
        [l.item_id],
    )
    .map_err(e)?;
    tx.commit().map_err(e)?;
    Ok(id)
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

    #[test]
    fn the_readers_create_no_file_for_a_missing_database() {
        let d = std::env::temp_dir().join(format!("sm-watcher-store-missing-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let db = d.join("studiomanager.db");
        assert!(open_watcher_links(&db, "Studio A").is_err());
        assert!(open_ask(&db, 1).is_err());
        assert!(ready_items(&db).is_err());
        assert!(!db.exists());
        assert_eq!(std::fs::read_dir(&d).unwrap().count(), 0);
    }

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

    #[test]
    fn a_could_not_start_entry_is_found_only_while_open_and_without_a_link() {
        let db = migrated("cns");
        let c = Connection::open(&db).unwrap();
        c.execute("INSERT INTO tasks (project_id, title, stage) VALUES (1, 'Poster tool', 'ready')", []).unwrap();
        c.execute("INSERT INTO subtasks (task_id, title, stage) VALUES (1, 'Contact sheet export', 'ready')", []).unwrap();
        assert_eq!(open_could_not_start(&db).unwrap(), vec![]);
        add_entry(&db, ItemKind::Task, 1, "Could not start: No base branch", "body").unwrap();
        let sub = add_entry(&db, ItemKind::Subtask, 1, &format!("{COULD_NOT_START}{}", "x".repeat(400)), "body").unwrap();
        // Another decide entry of the item is not one.
        add_entry(&db, ItemKind::Task, 1, "Which size?", "").unwrap();
        assert_eq!(open_could_not_start(&db).unwrap(), vec![(ItemKind::Task, 1), (ItemKind::Subtask, 1)]);
        let (kind, link, status, lead, len): (String, Option<i64>, String, Option<String>, i64) = c
            .query_row("SELECT kind, link_id, status, lead_state, LENGTH(title) FROM needs_you WHERE id = ?1", [sub], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
            })
            .unwrap();
        assert_eq!((kind.as_str(), link, status.as_str(), lead, len), ("decide", None, "open", None, 200));
        c.execute("UPDATE needs_you SET status = 'dismissed'", []).unwrap();
        assert_eq!(open_could_not_start(&db).unwrap(), vec![]);
    }

    #[test]
    fn add_link_writes_the_link_and_moves_only_a_ready_item_to_running() {
        let db = migrated("addlink");
        let c = Connection::open(&db).unwrap();
        c.execute("INSERT INTO tasks (project_id, title, stage) VALUES (1, 'Poster tool', 'ready')", []).unwrap();
        c.execute("INSERT INTO tasks (project_id, title, stage, status) VALUES (1, 'Done one', 'ready', 'done')", []).unwrap();
        let link = |id| NewLink {
            kind: ItemKind::Task,
            item_id: id,
            short_id: "0a1b2c3d".into(),
            name: "sm-w-task-1".into(),
            worktree: "/x/.claude/worktrees/sm-task-1".into(),
            base_ref: "origin/main".into(),
        };
        assert_eq!(add_link(&db, &link(1)).unwrap(), 1);
        assert_eq!(add_link(&db, &link(2)).unwrap(), 2);
        let stage = |id: i64| -> String { c.query_row("SELECT stage FROM tasks WHERE id = ?1", [id], |r| r.get(0)).unwrap() };
        assert_eq!((stage(1).as_str(), stage(2).as_str()), ("running", "ready"));
        let links = open_watcher_links(&db, "o").unwrap();
        assert_eq!(links.len(), 2);
        assert_eq!(links[0].worktree.as_deref(), Some("/x/.claude/worktrees/sm-task-1"));
        assert_eq!(links[0].base_ref.as_deref(), Some("origin/main"));
        // A link that cannot be written leaves the stage alone (one transaction).
        let bad = NewLink { item_id: 99, ..link(1) };
        assert!(add_link(&db, &bad).is_err());
    }

    #[test]
    fn add_link_is_one_transaction_a_failing_stage_update_undoes_the_link() {
        let db = migrated("rollback");
        let c = Connection::open(&db).unwrap();
        c.execute("INSERT INTO tasks (project_id, title, stage) VALUES (1, 'Poster tool', 'ready')", []).unwrap();
        c.execute_batch("CREATE TRIGGER nostage BEFORE UPDATE ON tasks BEGIN SELECT RAISE(ABORT, 'no'); END;").unwrap();
        let link = NewLink {
            kind: ItemKind::Task,
            item_id: 1,
            short_id: "0a1b2c3d".into(),
            name: "sm-w-task-1".into(),
            worktree: "/x".into(),
            base_ref: "origin/main".into(),
        };
        assert!(add_link(&db, &link).is_err());
        let n: i64 = c.query_row("SELECT COUNT(*) FROM task_agents", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0, "the insert was rolled back");
        let stage: String = c.query_row("SELECT stage FROM tasks WHERE id = 1", [], |r| r.get(0)).unwrap();
        assert_eq!(stage, "ready");
    }

    #[test]
    fn add_link_on_a_subtask_writes_the_link_and_the_subtask_stage() {
        let db = migrated("addlink-sub");
        let c = Connection::open(&db).unwrap();
        c.execute("INSERT INTO tasks (project_id, title, stage) VALUES (1, 'Poster tool', 'ready')", []).unwrap();
        c.execute("INSERT INTO subtasks (task_id, title, stage) VALUES (1, 'Contact sheet export', 'ready')", []).unwrap();
        c.execute("INSERT INTO subtasks (task_id, title, stage, status) VALUES (1, 'Done sub', 'ready', 'done')", []).unwrap();
        let link = |id| NewLink {
            kind: ItemKind::Subtask,
            item_id: id,
            short_id: "0a1b2c3d".into(),
            name: format!("sm-w-subtask-{id}"),
            worktree: "/x".into(),
            base_ref: "origin/main".into(),
        };
        add_link(&db, &link(1)).unwrap();
        add_link(&db, &link(2)).unwrap();
        let stage = |id: i64| -> String { c.query_row("SELECT stage FROM subtasks WHERE id = ?1", [id], |r| r.get(0)).unwrap() };
        assert_eq!((stage(1).as_str(), stage(2).as_str()), ("running", "ready"), "a done subtask keeps its stage");
        let task_stage: String = c.query_row("SELECT stage FROM tasks WHERE id = 1", [], |r| r.get(0)).unwrap();
        assert_eq!(task_stage, "ready", "the parent task is not touched");
        let links = open_watcher_links(&db, "o").unwrap();
        assert_eq!(links.iter().map(|l| (l.kind, l.item_id)).collect::<Vec<_>>(), vec![(ItemKind::Subtask, 1), (ItemKind::Subtask, 2)]);
    }
}
