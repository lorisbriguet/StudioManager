//! What the watcher reads from an organisation's database: its own open links, the items that
//! are Ready, and whether a link has an open question. It writes only what starting a worker
//! needs: the link and the Running stage (`add_link`) and a "Could not start" entry
//! (`add_entry`); the callers hold `crate::org_shared()`.

use super::super::links::{parse_utc_ms, ItemKind};
use chrono::NaiveDate;
use rusqlite::{params, Connection, OpenFlags, OptionalExtension, TransactionBehavior};
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
    // A file that cannot be read is an error (the pass pauses), not "no links": only a readable
    // database without the table has none.
    let has: Option<i64> = conn
        .query_row("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'task_agents'", [], |r| r.get(0))
        .optional()
        .map_err(|e| format!("Failed to read links: {e}"))?;
    if has.is_none() {
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

/// The title of the app's "idle without a result" entry.
pub const IDLE_ENTRY: &str = "Stopped without a result or a question";

/// The id of the open question of a link's worker, if it has one: an open `decide` entry written by
/// the MCP `ask` tool, which gives a watcher link's question a lead state (`waiting`, `running`,
/// `done`, `skipped`). The app's own entries have none or `prompt` and are not questions.
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
        "SELECT id FROM needs_you WHERE link_id = ?1 AND kind = 'decide' AND status = 'open'
           AND lead_state IN ('waiting', 'running', 'done', 'skipped') ORDER BY id LIMIT 1",
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

/// What an entry the app writes for a link says. `lead_state` is `prompt` for an agent waiting at a
/// prompt (the card offers only "Open the agent"), else None.
pub struct LinkEntry<'a> {
    pub kind: ItemKind,
    pub item_id: i64,
    pub link_id: i64,
    pub lead_state: Option<&'static str>,
    pub title: &'a str,
    pub body: &'a str,
    /// The link's `outcome` in the same transaction; the link stays open.
    pub outcome: Option<&'static str>,
}

/// A Decide entry on a link, in one transaction. A link has at most one open `decide` entry with
/// the same `lead_state`: with one open nothing is inserted and None comes back (the outcome is
/// still written).
pub fn add_link_entry(db: &Path, n: &LinkEntry) -> Result<Option<i64>, String> {
    let mut conn = super::super::capture::open(db)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| format!("Failed to lock the database: {e}"))?;
    let e = |e: rusqlite::Error| format!("Failed to write the entry: {e}");
    let open: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM needs_you WHERE link_id = ?1 AND kind = 'decide' AND status = 'open' AND lead_state IS ?2",
            params![n.link_id, n.lead_state],
            |r| r.get(0),
        )
        .map_err(e)?;
    let mut id = None;
    if open == 0 {
        let (task, sub) = match n.kind {
            ItemKind::Task => (Some(n.item_id), None),
            ItemKind::Subtask => (None, Some(n.item_id)),
        };
        let title: String = n.title.chars().take(200).collect();
        let body: String = n.body.chars().take(2000).collect();
        tx.execute(
            "INSERT INTO needs_you (kind, task_id, subtask_id, link_id, title, body, status, lead_state)
             VALUES ('decide', ?1, ?2, ?3, ?4, ?5, 'open', ?6)",
            params![task, sub, n.link_id, title, body, n.lead_state],
        )
        .map_err(e)?;
        id = Some(tx.last_insert_rowid());
    }
    if let Some(outcome) = n.outcome {
        tx.execute("UPDATE task_agents SET outcome = ?1 WHERE id = ?2 AND ended_at IS NULL", params![outcome, n.link_id])
            .map_err(e)?;
    }
    tx.commit().map_err(|e| format!("Failed to save the entry: {e}"))?;
    Ok(id)
}

/// The open prompt entry of a link (`decide`, lead state `prompt`), if any.
pub fn open_prompt(db: &Path, link_id: i64) -> Result<Option<i64>, String> {
    let conn = open(db)?;
    match conn.query_row(
        "SELECT id FROM needs_you WHERE link_id = ?1 AND kind = 'decide' AND status = 'open' AND lead_state = 'prompt'
         ORDER BY id LIMIT 1",
        [link_id],
        |r| r.get(0),
    ) {
        Ok(id) => Ok(Some(id)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Failed to read entries: {e}")),
    }
}

/// Closes the open prompt entries of a link: the agent left the prompt by itself.
pub fn close_prompt(db: &Path, link_id: i64) -> Result<(), String> {
    let conn = super::super::capture::open(db)?;
    conn.execute(
        "UPDATE needs_you SET status = 'dismissed', decided_by = 'app', reason = 'The agent went on', answered_at = datetime('now')
         WHERE link_id = ?1 AND kind = 'decide' AND status = 'open' AND lead_state = 'prompt'",
        [link_id],
    )
    .map_err(|e| format!("Failed to close the entry: {e}"))?;
    Ok(())
}

/// The `outcome` of a link.
pub fn link_outcome(db: &Path, link_id: i64) -> Result<Option<String>, String> {
    let conn = open(db)?;
    conn.query_row("SELECT outcome FROM task_agents WHERE id = ?1", [link_id], |r| r.get(0))
        .map_err(|e| format!("Failed to read the link: {e}"))
}

/// The wrap-up request of a link, decided before the message is typed: `wrap_asked_at` is set and
/// the report forgotten (`reported_at` cleared), so a result reported after the request reads as
/// `reported` again, as after a failed check was sent back.
pub fn ask_wrap_up(db: &Path, link_id: i64, at_ms: i64) -> Result<(), String> {
    let at = chrono::DateTime::from_timestamp_millis(at_ms)
        .ok_or("Invalid time")?
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();
    let mut conn = super::super::capture::open(db)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| format!("Failed to lock the database: {e}"))?;
    let n = tx
        .execute(
            "UPDATE task_agents SET wrap_asked_at = ?2, reported_at = NULL
             WHERE id = ?1 AND ended_at IS NULL AND wrap_asked_at IS NULL",
            params![link_id, at],
        )
        .map_err(|e| format!("Failed to save the decision: {e}"))?;
    if n == 0 {
        return Err(format!("Link {link_id} was already asked to wrap up"));
    }
    tx.commit().map_err(|e| format!("Failed to save the decision: {e}"))?;
    Ok(())
}

/// One of the counters of `task_agents`: each is bumped in the same transaction as the decision
/// it limits, before the message or the start.
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
pub fn bump(db: &Path, link_id: i64, c: Counter) -> Result<i64, String> {
    let mut conn = super::super::capture::open(db)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| format!("Failed to lock the database: {e}"))?;
    let n = bump_in(&tx, link_id, c)?;
    tx.commit().map_err(|e| format!("Failed to save the counter: {e}"))?;
    Ok(n)
}

/// Fills a watcher link's `session_id` (only when it has none) and corrects its `short_id` from
/// the listed agent. Only an open watcher link is written: the tracker in `links.rs` never changes
/// these, and an ended link stays as it was. True when something changed. The caller holds
/// `crate::org_shared()`.
pub fn sync_ids(db: &Path, link_id: i64, session: Option<&str>, short: Option<&str>) -> Result<bool, String> {
    let conn = super::super::capture::open(db)?;
    let n = conn
        .execute(
            "UPDATE task_agents SET session_id = COALESCE(session_id, ?2), short_id = COALESCE(?3, short_id)
             WHERE id = ?1 AND ended_at IS NULL AND started_by = 'watcher'
               AND ((session_id IS NULL AND ?2 IS NOT NULL) OR (?3 IS NOT NULL AND short_id <> ?3))",
            params![link_id, session, short],
        )
        .map_err(|e| format!("Failed to write the agent ids: {e}"))?;
    Ok(n > 0)
}

/// The link follows the copy a resume made: its new short id is recorded and the session id is
/// forgotten (the copy has its own, filled again from the list). Errs when the link is not an
/// open watcher link. The caller holds `crate::org_shared()`.
pub fn follow_copy(db: &Path, link_id: i64, short: &str) -> Result<(), String> {
    let conn = super::super::capture::open(db)?;
    let n = conn
        .execute(
            "UPDATE task_agents SET short_id = ?2, session_id = NULL
             WHERE id = ?1 AND ended_at IS NULL AND started_by = 'watcher'",
            params![link_id, short],
        )
        .map_err(|e| format!("Failed to record the copy: {e}"))?;
    if n == 0 {
        return Err("The link is not open any more".to_string());
    }
    Ok(())
}

/// True when the link still has something for a person or the lead: an open entry, or an answer
/// the lead wrote that the app has not carried out yet. A checked link is not closed while one
/// exists. The caller treats an error as "yes": nothing is closed on a failed read.
pub fn has_open_work(db: &Path, link_id: i64) -> Result<bool, String> {
    let conn = open(db)?;
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM needs_you WHERE link_id = ?1
               AND (status = 'open' OR (status = 'answered' AND decided_by = 'lead' AND delivered_at IS NULL))",
            [link_id],
            |r| r.get(0),
        )
        .map_err(|e| format!("Failed to read entries: {e}"))?;
    Ok(n > 0)
}

/// Ends an open watcher link whose check is done (`ended_at` and the outcome). True when it was
/// ended. A link whose `check_state` was cleared meanwhile (a Send back clicked while the link was
/// being closed) is left open: the worker has work again.
pub fn end_link(db: &Path, link_id: i64, outcome: &str) -> Result<bool, String> {
    let conn = super::super::capture::open(db)?;
    let n = conn
        .execute(
            "UPDATE task_agents SET ended_at = datetime('now'), outcome = ?2
             WHERE id = ?1 AND ended_at IS NULL AND started_by = 'watcher' AND check_state IS NOT NULL",
            params![link_id, outcome],
        )
        .map_err(|e| format!("Failed to end the link: {e}"))?;
    Ok(n > 0)
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
    let open: i64 = tx
        .query_row("SELECT COUNT(*) FROM task_agents WHERE id = ?1 AND ended_at IS NULL", [link_id], |r| r.get(0))
        .map_err(|e| format!("Failed to read the link: {e}"))?;
    if open == 0 {
        return Err("The link is ended".to_string());
    }
    let n = bump_in(&tx, link_id, Counter::CheckFails)?;
    // The report is forgotten here too (before the message is typed), so a fast worker's next
    // `report_result`, which writes `reported_at` again, is never erased.
    tx.execute("UPDATE task_agents SET check_state = NULL, reported_at = NULL WHERE id = ?1", [link_id])
        .map_err(|e| format!("Failed to write the check state: {e}"))?;
    tx.commit().map_err(|e| format!("Failed to save the decision: {e}"))?;
    Ok(n)
}

// ---------------------------------------------------------------- the lead's entries

/// A Decide or Check entry the lead works on, or whose resolution the app carries out.
#[derive(Clone, Debug, PartialEq)]
pub struct LeadEntry {
    pub id: i64,
    /// `decide` or `check`.
    pub kind: String,
    pub link_id: Option<i64>,
    pub item_kind: ItemKind,
    pub item_id: i64,
    pub title: String,
    pub status: String,
    pub lead_state: Option<String>,
    pub answer: Option<String>,
    pub reason: Option<String>,
    pub created_at: String,
}

/// The entries in play, oldest first: open ones waiting for the lead or with it (`waiting`,
/// `running`), and the ones the lead resolved that the app has not carried out yet (`done`,
/// answered, decided by the lead, not delivered).
pub fn lead_entries(db: &Path) -> Result<Vec<LeadEntry>, String> {
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
            "SELECT id, kind, link_id, task_id, subtask_id, title, status, lead_state, answer, reason, created_at
             FROM needs_you
             WHERE kind IN ('decide', 'check')
               AND ((lead_state IN ('waiting', 'running') AND status = 'open')
                 OR (lead_state = 'done' AND status = 'answered' AND decided_by = 'lead' AND delivered_at IS NULL))
             ORDER BY created_at, id",
        )
        .map_err(e)?;
    let rows = st
        .query_map([], |r| {
            let task: Option<i64> = r.get(3)?;
            let sub: Option<i64> = r.get(4)?;
            let (item_kind, item_id) = match (task, sub) {
                (Some(t), None) => (ItemKind::Task, t),
                (None, Some(s)) => (ItemKind::Subtask, s),
                _ => return Ok(None),
            };
            Ok(Some(LeadEntry {
                id: r.get(0)?,
                kind: r.get(1)?,
                link_id: r.get(2)?,
                item_kind,
                item_id,
                title: r.get(5)?,
                status: r.get(6)?,
                lead_state: r.get(7)?,
                answer: r.get(8)?,
                reason: r.get(9)?,
                created_at: r.get(10)?,
            }))
        })
        .map_err(e)?;
    let mut out = Vec::new();
    for row in rows {
        out.extend(row.map_err(e)?);
    }
    Ok(out)
}

/// The `lead_state` of one entry.
pub fn lead_state_of(db: &Path, entry_id: i64) -> Result<Option<String>, String> {
    let conn = open(db)?;
    match conn.query_row("SELECT lead_state FROM needs_you WHERE id = ?1", [entry_id], |r| r.get(0)) {
        Ok(s) => Ok(s),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("Failed to read the entry: {e}")),
    }
}

/// The decision to start a lead session, in one transaction before `claude` is started: the
/// link's session counter is bumped and the entry goes from `waiting` to `running`. Nothing is
/// written when the entry is no longer waiting.
pub fn begin_lead(db: &Path, entry_id: i64, link_id: i64, counter: Counter, cap: i64) -> Result<bool, String> {
    let mut conn = super::super::capture::open(db)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| format!("Failed to lock the database: {e}"))?;
    let n = tx
        .execute(
            "UPDATE needs_you SET lead_state = 'running' WHERE id = ?1 AND status = 'open' AND lead_state = 'waiting'",
            [entry_id],
        )
        .map_err(|e| format!("Failed to save the decision: {e}"))?;
    if n == 0 {
        return Err(format!("Entry {entry_id} is no longer waiting for the lead"));
    }
    let col = counter.column();
    let bumped = tx
        .execute(&format!("UPDATE task_agents SET {col} = {col} + 1 WHERE id = ?1 AND {col} < ?2"), params![link_id, cap])
        .map_err(|e| format!("Failed to bump {col}: {e}"))?;
    if bumped == 0 {
        // Past the cap (or no link): nothing is spent and the entry goes to the owner.
        tx.execute("UPDATE needs_you SET lead_state = 'skipped' WHERE id = ?1", [entry_id])
            .map_err(|e| format!("Failed to save the decision: {e}"))?;
    }
    tx.commit().map_err(|e| format!("Failed to save the decision: {e}"))?;
    Ok(bumped == 1)
}

/// `lead_state` from `from` to `to` on an open entry (one the lead did not settle goes from
/// `running` or `waiting` to `skipped`). True when it changed.
pub fn move_lead_state(db: &Path, entry_id: i64, from: &str, to: &str) -> Result<bool, String> {
    let conn = super::super::capture::open(db)?;
    let n = conn
        .execute(
            "UPDATE needs_you SET lead_state = ?3 WHERE id = ?1 AND lead_state = ?2 AND status = 'open'",
            params![entry_id, from, to],
        )
        .map_err(|e| format!("Failed to write the entry: {e}"))?;
    Ok(n == 1)
}

/// The lead's answer goes back to the owner: the entry is open again with nobody's decision on
/// it and `text` as its recommendation. Only an entry the lead answered is touched.
pub fn reopen_for_owner(db: &Path, entry_id: i64, text: &str, clear_reason: bool) -> Result<bool, String> {
    let text: String = text.chars().take(2000).collect();
    let conn = super::super::capture::open(db)?;
    let n = conn
        .execute(
            "UPDATE needs_you SET status = 'open', decided_by = NULL, answered_at = NULL, answer = NULL,
                    delivered_at = NULL, recommendation = ?2, lead_state = 'done',
                    reason = CASE WHEN ?3 = 1 THEN NULL ELSE reason END
             WHERE id = ?1 AND status = 'answered' AND decided_by = 'lead'",
            params![entry_id, text, clear_reason as i64],
        )
        .map_err(|e| format!("Failed to reopen the entry: {e}"))?;
    Ok(n == 1)
}

/// Marks the lead's answer as delivered before it is typed, so a crash in between never types
/// it twice. False when it was already delivered or is no longer the lead's answer.
pub fn claim_delivery(db: &Path, entry_id: i64) -> Result<bool, String> {
    let conn = super::super::capture::open(db)?;
    let n = conn
        .execute(
            "UPDATE needs_you SET delivered_at = datetime('now')
             WHERE id = ?1 AND status = 'answered' AND decided_by = 'lead' AND delivered_at IS NULL",
            [entry_id],
        )
        .map_err(|e| format!("Failed to save the delivery: {e}"))?;
    Ok(n == 1)
}

/// The lead's send back of a Check entry, decided in one transaction before the notes are typed:
/// the delivery is marked, the send back counted (`sent_back` was 0), the check forgotten
/// (`check_state` and `reported_at` cleared, as `decide_send_back`) and the item back to Running.
/// False, with nothing written, when the link already sent a result back, has ended, or the
/// entry was handled.
pub fn claim_send_back(db: &Path, entry_id: i64, link_id: i64, kind: ItemKind, item_id: i64) -> Result<bool, String> {
    let mut conn = super::super::capture::open(db)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| format!("Failed to lock the database: {e}"))?;
    let e = |e: rusqlite::Error| format!("Failed to save the decision: {e}");
    let sent: Option<i64> = match tx.query_row(
        "SELECT sent_back FROM task_agents WHERE id = ?1 AND ended_at IS NULL",
        [link_id],
        |r| r.get(0),
    ) {
        Ok(n) => Some(n),
        Err(rusqlite::Error::QueryReturnedNoRows) => None,
        Err(err) => return Err(e(err)),
    };
    if sent != Some(0) {
        return Ok(false);
    }
    let claimed = tx
        .execute(
            "UPDATE needs_you SET delivered_at = datetime('now')
             WHERE id = ?1 AND status = 'answered' AND decided_by = 'lead' AND delivered_at IS NULL",
            [entry_id],
        )
        .map_err(e)?;
    if claimed == 0 {
        return Ok(false);
    }
    bump_in(&tx, link_id, Counter::SentBack)?;
    tx.execute("UPDATE task_agents SET check_state = NULL, reported_at = NULL WHERE id = ?1", [link_id]).map_err(e)?;
    let (table, _) = table_of(kind);
    tx.execute(
        &format!(
            "UPDATE {table} SET stage = 'running', updated_at = datetime('now')
             WHERE id = ?1 AND stage = 'to_check' AND status <> 'done'"
        ),
        [item_id],
    )
    .map_err(e)?;
    tx.commit().map_err(|err| format!("Failed to save the decision: {err}"))?;
    Ok(true)
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

/// What merging alone reads again, fresh, just before it acts: the project's switches and check
/// command, the link's pull request and the Check entry's stored verdict.
#[derive(Clone, Debug, PartialEq)]
pub struct MergeFacts {
    pub merge_alone: bool,
    pub hub_project: bool,
    /// None when the project has no check command (an empty one counts as none).
    pub check_command: Option<String>,
    /// The entry's link is an open watcher link.
    pub link_open: bool,
    /// What the worker reported with `report_result`.
    pub pr_url: Option<String>,
    /// The entry's `check_passed`: None when no check ran.
    pub check_passed: Option<bool>,
}

/// Reads `MergeFacts` of an entry (its item's project, its link, its stored verdict). None when
/// the entry or its item is gone.
pub fn merge_facts(db: &Path, entry_id: i64, kind: ItemKind) -> Result<Option<MergeFacts>, String> {
    let conn = open(db)?;
    let from = match kind {
        ItemKind::Task => "needs_you n JOIN tasks t ON t.id = n.task_id JOIN projects p ON p.id = t.project_id",
        ItemKind::Subtask => {
            "needs_you n JOIN subtasks s ON s.id = n.subtask_id JOIN tasks t ON t.id = s.task_id JOIN projects p ON p.id = t.project_id"
        }
    };
    conn.query_row(
        &format!(
            "SELECT p.merge_alone, p.hub_project, p.check_command, a.id IS NOT NULL, a.pr_url, n.check_passed
             FROM {from} LEFT JOIN task_agents a ON a.id = n.link_id AND a.ended_at IS NULL AND a.started_by = 'watcher'
             WHERE n.id = ?1"
        ),
        [entry_id],
        |r| {
            let command: Option<String> = r.get(2)?;
            let url: Option<String> = r.get(4)?;
            let passed: Option<i64> = r.get(5)?;
            Ok(MergeFacts {
                merge_alone: r.get::<_, i64>(0)? != 0,
                hub_project: r.get::<_, i64>(1)? != 0,
                check_command: command.filter(|c| !c.trim().is_empty()),
                link_open: r.get(3)?,
                pr_url: url.map(|u| u.trim().to_string()).filter(|u| !u.is_empty()),
                check_passed: passed.map(|p| p != 0),
            })
        },
    )
    .optional()
    .map_err(|e| format!("Failed to read the merge facts: {e}"))
}

/// Records a merge that happened, in one transaction: the item done and its stage cleared (what
/// Accept in the UI writes: `status = 'done'`, `stage = NULL`, a due date moved to today), the
/// link ended with `outcome = 'merged'`, and an answered `alone` row decided by the app with
/// `text` and `reason`. The Check entry is left as it is (answered by the lead, delivered).
pub fn finish_merged(
    db: &Path,
    kind: ItemKind,
    item_id: i64,
    link_id: i64,
    text: &str,
    reason: &str,
) -> Result<(), String> {
    let mut conn = super::super::capture::open(db)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| format!("Failed to lock the database: {e}"))?;
    let e = |e: rusqlite::Error| format!("Failed to record the merge: {e}");
    let (table, _) = table_of(kind);
    tx.execute(
        &format!(
            "UPDATE {table} SET status = 'done', stage = NULL,
                    due_date = CASE WHEN due_date IS NOT NULL AND due_date <> date('now', 'localtime') THEN date('now', 'localtime') ELSE due_date END,
                    updated_at = datetime('now')
             WHERE id = ?1"
        ),
        [item_id],
    )
    .map_err(e)?;
    tx.execute("UPDATE task_agents SET ended_at = datetime('now'), outcome = 'merged' WHERE id = ?1 AND ended_at IS NULL", [link_id])
        .map_err(e)?;
    let (task, sub) = match kind {
        ItemKind::Task => (Some(item_id), None),
        ItemKind::Subtask => (None, Some(item_id)),
    };
    let text: String = text.chars().take(200).collect();
    let reason: String = reason.chars().take(1000).collect();
    tx.execute(
        "INSERT INTO needs_you (kind, task_id, subtask_id, link_id, title, status, decided_by, reason, answered_at)
         VALUES ('alone', ?1, ?2, ?3, ?4, 'answered', 'app', ?5, datetime('now'))",
        params![task, sub, link_id, text, reason],
    )
    .map_err(e)?;
    tx.commit().map_err(e)
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
    // The app's own idle and prompt entries of the link are stale beside the Check entry.
    let why = if c.close == Some("wrapped_up") { "The worker was wrapped up" } else { "The worker finished" };
    tx.execute(
        "UPDATE needs_you SET status = 'dismissed', decided_by = 'app', reason = ?2, answered_at = datetime('now')
         WHERE link_id = ?1 AND kind = 'decide' AND status = 'open'
           AND (lead_state = 'prompt' OR (lead_state IS NULL AND title IN (?3, ?4, ?5)))",
        params![c.link_id, why, IDLE_ENTRY, super::act::STUCK_ENTRY, super::act::WRAP_FAILED],
    )
    .map_err(e)?;
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

    /// A Send back clears `check_state`: a close that read the link before it must not end it.
    #[test]
    fn end_link_leaves_a_link_whose_check_was_cleared() {
        let db = migrated("end-link-cleared");
        let c = Connection::open(&db).unwrap();
        c.execute("INSERT INTO tasks (project_id, title, stage) VALUES (1, 'Poster tool', 'running')", []).unwrap();
        c.execute(
            "INSERT INTO task_agents (task_id, short_id, name, started_at, started_by, check_state)
             VALUES (1, 'abc12345', 'sm-w-task-1', '2027-01-15 08:00:00', 'watcher', NULL)",
            [],
        )
        .unwrap();
        assert_eq!(end_link(&db, 1, "result"), Ok(false));
        let open: i64 = c.query_row("SELECT ended_at IS NULL FROM task_agents", [], |r| r.get(0)).unwrap();
        assert_eq!(open, 1, "the link stays open");
        c.execute("UPDATE task_agents SET check_state = 'failed'", []).unwrap();
        assert_eq!(end_link(&db, 1, "result"), Ok(true));
        let outcome: String = c.query_row("SELECT outcome FROM task_agents WHERE ended_at IS NOT NULL", [], |r| r.get(0)).unwrap();
        assert_eq!(outcome, "result");
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
        // The app's own entries are not questions.
        c.execute("INSERT INTO needs_you (kind, task_id, link_id, title) VALUES ('decide', 1, 1, 'Idle')", []).unwrap();
        c.execute("INSERT INTO needs_you (kind, task_id, link_id, title, lead_state) VALUES ('decide', 1, 1, 'Prompt', 'prompt')", []).unwrap();
        assert_eq!(open_ask(&db, 1).unwrap(), None);
        c.execute("INSERT INTO needs_you (kind, task_id, link_id, title, lead_state) VALUES ('decide', 1, 1, 'Which size?', 'waiting')", []).unwrap();
        assert_eq!(open_ask(&db, 1).unwrap(), Some(5));
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
    fn a_send_back_is_decided_only_for_an_open_link() {
        let db = migrated("sendback-ended");
        let c = Connection::open(&db).unwrap();
        c.execute("INSERT INTO tasks (project_id, title, stage) VALUES (1, 'Poster tool', 'to_check')", []).unwrap();
        c.execute(
            "INSERT INTO task_agents (task_id, short_id, name, started_by, check_state, ended_at)
             VALUES (1, 'abc12345', 'work', 'watcher', 'failed', datetime('now'))",
            [],
        )
        .unwrap();
        assert!(decide_send_back(&db, 1).is_err(), "an ended link is not sent back");
        let (fails, state): (i64, Option<String>) =
            c.query_row("SELECT check_fails, check_state FROM task_agents", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((fails, state.as_deref()), (0, Some("failed")), "nothing was counted or cleared");
        c.execute("UPDATE task_agents SET ended_at = NULL", []).unwrap();
        assert_eq!(decide_send_back(&db, 1).unwrap(), 1);
    }

    #[test]
    fn the_session_and_a_followed_copy_are_written_only_to_an_open_link() {
        let db = migrated("ids");
        let c = Connection::open(&db).unwrap();
        c.execute("INSERT INTO tasks (project_id, title, stage) VALUES (1, 'Poster tool', 'running')", []).unwrap();
        c.execute("INSERT INTO task_agents (task_id, short_id, name, started_by) VALUES (1, 'abc12345', 'work', 'watcher')", []).unwrap();
        sync_ids(&db, 1, Some("sess-1"), None).unwrap();
        let row = |c: &Connection| -> (Option<String>, String) {
            c.query_row("SELECT session_id, short_id FROM task_agents", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap()
        };
        assert_eq!(row(&c), (Some("sess-1".into()), "abc12345".into()));
        sync_ids(&db, 1, Some("other"), Some("0a1b2c3d")).unwrap();
        assert_eq!(row(&c), (Some("sess-1".into()), "0a1b2c3d".into()), "a session already known is kept; the short id follows the list");
        follow_copy(&db, 1, "99999999").unwrap();
        assert_eq!(row(&c), (None, "99999999".into()), "the copy has its own session, filled in from the list later");
        c.execute("UPDATE task_agents SET ended_at = datetime('now')", []).unwrap();
        follow_copy(&db, 1, "11111111").unwrap_err();
        assert_eq!(row(&c).1, "99999999");
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
