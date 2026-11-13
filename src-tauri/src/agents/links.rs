//! The link tracker: follows the agents that were started from a task or subtask (the rows of
//! `task_agents` the app wrote) and, when one has finished, closes its link and moves the item
//! from Running to To check. It writes by itself every 30 s, so its limits are strict: only open
//! links; only `running` -> `to_check` on items not done; nothing while Agents is off, in the
//! demo build or for an organisation in test or presentation mode. It never calls `claude`: it
//! starts, stops and deletes no agent. Plan:
//! docs/superpowers/plans/2026-11-13-agent-orchestrator-2-task-agent.md (Task 4).

use super::actions::{read_state, CopyOf};
use super::briefing::{in_mode, list_is_fresh, LISTED_GRACE_MS};
use super::capture::open;
use super::cli::read_settings;
use super::model::{Agent, Group};
use super::usage::limits;
use crate::orgs::{org_dir, Registry, DB_FILE};
use chrono::NaiveDateTime;
use rusqlite::{params, Connection, TransactionBehavior};
use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// What `task_agents.outcome` holds in part 2 (part 3 adds its own values).
pub const OUTCOMES: [&str; 2] = ["result", "no_result"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ItemKind {
    Task,
    Subtask,
}

#[derive(Clone, Debug, PartialEq)]
pub struct OpenLink {
    pub id: i64,
    pub kind: ItemKind,
    pub item_id: i64,
    pub short_id: String,
    pub session_id: Option<String>,
    pub model: Option<String>,
    /// Epoch ms, parsed from SQLite's UTC text.
    pub started_at: i64,
    /// `report_result` wrote to this link.
    pub reported: bool,
    /// The item's result is not empty.
    pub item_has_result: bool,
    /// How many open links the item has (this one included).
    pub item_open_links: usize,
}

/// Per (organisation, link id): the time of the list that first lacked the link's agent. An agent
/// counts as gone only when a second list, made at another time, lacks it too.
pub type Misses = HashMap<(String, i64), i64>;

/// What the list knows that the row does not: only what differs.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Fill {
    pub session_id: Option<String>,
    pub short_id: Option<String>,
    pub model: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Judgement {
    Keep { fill: Option<Fill> },
    /// A fresh list lacks the agent, but it is the first one (or the same one again): keep the
    /// link and remember the miss.
    Missing,
    End(&'static str),
}

pub(super) fn parse_utc_ms(text: &str) -> i64 {
    NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S")
        .map(|t| t.and_utc().timestamp_millis())
        .unwrap_or(0)
}

pub(super) fn has_table(conn: &Connection) -> bool {
    conn.query_row("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'task_agents'", [], |_| Ok(()))
        .is_ok()
}

fn read_open(conn: &Connection) -> Result<Vec<OpenLink>, String> {
    if !has_table(conn) {
        return Ok(vec![]);
    }
    let mut st = conn
        .prepare(
            "SELECT id, task_id, subtask_id, short_id, session_id, model, started_at, reported_at IS NOT NULL,
                    COALESCE((SELECT TRIM(result) <> '' FROM tasks WHERE id = task_agents.task_id),
                             (SELECT TRIM(result) <> '' FROM subtasks WHERE id = task_agents.subtask_id), 0)
             FROM task_agents WHERE ended_at IS NULL AND started_by IS NULL ORDER BY id",
        )
        .map_err(|e| format!("Failed to read links: {e}"))?;
    let rows = st
        .query_map([], |r| {
            let task: Option<i64> = r.get(1)?;
            let sub: Option<i64> = r.get(2)?;
            let started: String = r.get(6)?;
            Ok((r.get::<_, i64>(0)?, task, sub, r.get(3)?, r.get(4)?, r.get(5)?, started, r.get::<_, bool>(7)?, r.get::<_, bool>(8)?))
        })
        .map_err(|e| format!("Failed to read links: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        let (id, task, sub, short_id, session_id, model, started, reported, has_result) =
            row.map_err(|e| format!("Failed to read links: {e}"))?;
        let (kind, item_id) = match (task, sub) {
            (Some(t), None) => (ItemKind::Task, t),
            (None, Some(s)) => (ItemKind::Subtask, s),
            _ => continue,
        };
        out.push(OpenLink {
            id,
            kind,
            item_id,
            short_id,
            session_id,
            model,
            started_at: parse_utc_ms(&started),
            reported,
            item_has_result: has_result,
            item_open_links: 0,
        });
    }
    let counts: Vec<usize> =
        out.iter().map(|l| out.iter().filter(|o| o.kind == l.kind && o.item_id == l.item_id).count()).collect();
    for (l, n) in out.iter_mut().zip(counts) {
        l.item_open_links = n;
    }
    Ok(out)
}

/// The open links of one organisation's database (none when it has no `task_agents` table yet).
pub fn open_links(db: &Path) -> Result<Vec<OpenLink>, String> {
    read_open(&open(db)?)
}

fn outcome(reported: bool) -> &'static str {
    if reported {
        OUTCOMES[0]
    } else {
        OUTCOMES[1]
    }
}

fn short_of(session_id: &str) -> String {
    session_id.chars().take(8).collect()
}

/// The short id of the newest copy of the link's agent (a model switch resumes the session as a
/// new agent, with a new session id and short id), following a chain of switches; None when
/// the agent was never switched.
fn follow_copies(link: &OpenLink, copies: &BTreeMap<String, CopyOf>) -> Option<String> {
    let mut current = link.session_id.as_deref().map(short_of).unwrap_or_else(|| link.short_id.clone());
    let mut followed = false;
    for _ in 0..8 {
        match copies.iter().find(|(_, c)| short_of(&c.session_id) == current) {
            Some((short, _)) if *short != current => {
                current = short.clone();
                followed = true;
            }
            _ => break,
        }
    }
    followed.then_some(current)
}

/// What to do with one open link, from the poller's list and the app's record of model-switch
/// copies. An idle agent without a result keeps its link (it may be waiting for the reply it
/// asked for). "Not listed" counts only after a list newer than the link's start plus the grace
/// and than this tracker's start, and only when a second list made at another time lacks the
/// agent too (`first_miss` is the time of the first one). After a model switch the copy is the
/// agent: the link follows it.
pub fn judge(
    link: &OpenLink,
    agents: &[Agent],
    copies: &BTreeMap<String, CopyOf>,
    listed_at: Option<i64>,
    tracker_started: i64,
    first_miss: Option<i64>,
) -> Judgement {
    let copy = follow_copies(link, copies);
    let found = match (&copy, &link.session_id) {
        (Some(short), _) => agents.iter().find(|a| a.short_id.as_deref() == Some(short.as_str()) || short_of(&a.session_id) == *short),
        (None, Some(s)) => agents.iter().find(|a| &a.session_id == s),
        (None, None) => agents.iter().find(|a| a.short_id.as_deref() == Some(link.short_id.as_str())),
    };
    let Some(a) = found else {
        if !list_is_fresh(listed_at, link.started_at + LISTED_GRACE_MS, tracker_started) {
            return Judgement::Keep { fill: None };
        }
        return match first_miss {
            Some(t) if Some(t) != listed_at => Judgement::End(outcome(link.reported)),
            _ => Judgement::Missing,
        };
    };
    if a.group == Group::Done {
        return Judgement::End(outcome(link.reported));
    }
    if link.reported && a.group != Group::Working {
        return Judgement::End(OUTCOMES[0]);
    }
    // Several agents on one item and a result written: the report could not be tied to one
    // link, so an idle agent's link closes (otherwise the item could stay Running for ever).
    if link.item_has_result && link.item_open_links > 1 && a.group == Group::Idle {
        return Judgement::End(OUTCOMES[0]);
    }
    let fill = Fill {
        session_id: (link.session_id.as_deref() != Some(a.session_id.as_str())).then(|| a.session_id.clone()),
        short_id: a.short_id.clone().filter(|s| *s != link.short_id),
        model: a.model.clone().filter(|m| link.model.as_deref() != Some(m.as_str())),
    };
    if fill == Fill::default() {
        Judgement::Keep { fill: None }
    } else {
        Judgement::Keep { fill: Some(fill) }
    }
}

/// Writes the judgement in one immediate transaction; every update is guarded so a second
/// tracker (or a second run) changes nothing. Returns whether anything changed.
pub fn apply(db: &Path, link: &OpenLink, j: &Judgement) -> Result<bool, String> {
    let mut conn = open(db)?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| format!("Failed to lock the database: {e}"))?;
    let e = |e: rusqlite::Error| format!("Failed to write the link: {e}");
    let changed = match j {
        Judgement::Keep { fill: None } | Judgement::Missing => false,
        Judgement::Keep { fill: Some(f) } => {
            let n = tx
                .execute(
                    "UPDATE task_agents SET session_id = COALESCE(?1, session_id), short_id = COALESCE(?2, short_id),
                     model = COALESCE(?3, model) WHERE id = ?4 AND ended_at IS NULL",
                    params![f.session_id, f.short_id, f.model, link.id],
                )
                .map_err(e)?;
            n > 0
        }
        Judgement::End(out) => {
            let n = tx
                .execute(
                    "UPDATE task_agents SET ended_at = datetime('now'), outcome = ?1 WHERE id = ?2 AND ended_at IS NULL",
                    params![out, link.id],
                )
                .map_err(e)?;
            if n > 0 {
                let (table, col) = match link.kind {
                    ItemKind::Task => ("tasks", "task_id"),
                    ItemKind::Subtask => ("subtasks", "subtask_id"),
                };
                let others: i64 = tx
                    .query_row(
                        &format!("SELECT COUNT(*) FROM task_agents WHERE {col} = ?1 AND ended_at IS NULL"),
                        [link.item_id],
                        |r| r.get(0),
                    )
                    .map_err(e)?;
                if others == 0 {
                    tx.execute(
                        &format!(
                            "UPDATE {table} SET stage = 'to_check', updated_at = datetime('now')
                             WHERE id = ?1 AND stage = 'running' AND status <> 'done'"
                        ),
                        [link.item_id],
                    )
                    .map_err(e)?;
                }
            }
            n > 0
        }
    };
    tx.commit().map_err(|e| format!("Failed to save the link: {e}"))?;
    Ok(changed)
}

/// One pass over every organisation with a database, not in a mode: per organisation, whether
/// something changed or why it failed. Holds the organisation lock (shared) while it writes.
pub fn pass_report(
    app_dir: &Path,
    agents: &[Agent],
    listed_at: Option<i64>,
    tracker_started: i64,
    misses: &mut Misses,
) -> Vec<(String, Result<bool, String>)> {
    let Ok(Some(reg)) = Registry::load(app_dir) else { return vec![] };
    let copies = read_state(app_dir).copies;
    let mut out = Vec::new();
    for org in reg.organisations {
        let db = org_dir(app_dir, &org.id).join(DB_FILE);
        if !db.exists() || in_mode(&db) {
            continue;
        }
        let _shared = crate::org_shared();
        let result = (|| -> Result<bool, String> {
            let mut changed = false;
            let links = open_links(&db)?;
            misses.retain(|(o, id), _| *o != org.id || links.iter().any(|l| l.id == *id));
            for link in links {
                let key = (org.id.clone(), link.id);
                let j = judge(&link, agents, &copies, listed_at, tracker_started, misses.get(&key).copied());
                match (&j, listed_at) {
                    (Judgement::Missing, Some(t)) => {
                        misses.entry(key).or_insert(t);
                    }
                    _ => {
                        misses.remove(&key);
                    }
                }
                changed |= apply(&db, &link, &j)?;
            }
            Ok(changed)
        })();
        out.push((org.id, result));
    }
    out
}

/// Whether anything changed; an error in one organisation is logged and the others go on.
pub fn pass(app_dir: &Path, agents: &[Agent], listed_at: Option<i64>, tracker_started: i64, misses: &mut Misses) -> bool {
    pass_report(app_dir, agents, listed_at, tracker_started, misses)
        .into_iter()
        .fold(false, |any, (org, r)| match r {
            Ok(c) => any || c,
            Err(e) => {
                log::warn!("[links] organisation {org}: {e}");
                any
            }
        })
}

/// One check: nothing in the demo build (decided before any file is read) or while Agents is off.
pub fn tick(
    app_dir: &Path,
    demo: bool,
    agents: &[Agent],
    listed_at: Option<i64>,
    tracker_started: i64,
    misses: &mut Misses,
) -> bool {
    if demo {
        return false;
    }
    if !read_settings(app_dir).enabled {
        return false;
    }
    pass(app_dir, agents, listed_at, tracker_started, misses)
}

fn check(app: &AppHandle, tracker_started: i64, misses: &mut Misses) {
    let demo = crate::host::is_demo(app);
    let state = app.state::<super::AgentsState>();
    if tick(&state.app_dir, demo, &state.cached(), state.listed_at(), tracker_started, misses) {
        if let Err(e) = app.emit(crate::agent_access::CHANGED_EVENT, ["task_links"]) {
            log::warn!("[links] emit {}: {e}", crate::agent_access::CHANGED_EVENT);
        }
    }
}

/// The tracker thread: a check every 30 s and right after a wake, the first after 30 s so the
/// poller has listed the agents (as the brief scheduler's).
pub fn start(app: &AppHandle) {
    use super::routines::schedule::{next_since_check, wall_ms, CHECK_EVERY, SLICE};
    let app = app.clone();
    std::thread::spawn(move || {
        let tracker_started = limits::now_ms();
        let mut misses = Misses::new();
        let mut last_wall = wall_ms();
        let mut since_check = Duration::ZERO;
        loop {
            if since_check >= CHECK_EVERY {
                if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| check(&app, tracker_started, &mut misses))).is_err() {
                    log::error!("[links] check panicked; continuing");
                }
                since_check = Duration::ZERO;
            }
            std::thread::sleep(SLICE);
            let wall = wall_ms();
            since_check = next_since_check(since_check, last_wall, wall);
            last_wall = wall;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::cli::{write_settings, AgentsSettings};
    use crate::agents::model::parse_agents;
    use crate::orgs::Organisation;
    use std::path::PathBuf;

    const T0: i64 = 1_800_000_000_000;
    const MIN: i64 = 60_000;
    const SCHED: i64 = T0 - 60 * MIN;
    const SESSION: &str = "00000000-1111-2222-3333-444444444444";

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("sm-links-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn app(name: &str, orgs: &[&str], agents_on: bool) -> PathBuf {
        let dir = tmp(name);
        Registry {
            version: 1,
            active_id: orgs[0].to_string(),
            organisations: orgs
                .iter()
                .map(|id| Organisation {
                    id: id.to_string(),
                    name: format!("Studio {id}"),
                    created_at: "2026-01-01T00:00:00Z".into(),
                    prefs: None,
                })
                .collect(),
        }
        .save(&dir)
        .unwrap();
        for id in orgs {
            let odir = org_dir(&dir, id);
            std::fs::create_dir_all(&odir).unwrap();
            let conn = Connection::open(odir.join(DB_FILE)).unwrap();
            for m in crate::migrate::MIGRATIONS {
                conn.execute_batch(m.sql).unwrap();
            }
            conn.execute_batch(
                "INSERT INTO clients (id, name) VALUES ('c1', 'Studio A');
                 INSERT INTO projects (id, client_id, name) VALUES (1, 'c1', 'Poster tool');",
            )
            .unwrap();
        }
        write_settings(&dir, &AgentsSettings { enabled: agents_on, ..Default::default() }).unwrap();
        dir
    }

    fn db_of(dir: &Path, org: &str) -> PathBuf {
        org_dir(dir, org).join(DB_FILE)
    }

    /// A running task (id 1) with an open link started at the epoch of the test clock.
    fn add_task(db: &Path, status: &str, stage: Option<&str>) -> i64 {
        let c = Connection::open(db).unwrap();
        c.execute(
            "INSERT INTO tasks (project_id, title, status, stage) VALUES (1, 'Poster tool', ?1, ?2)",
            params![status, stage],
        )
        .unwrap();
        c.last_insert_rowid()
    }

    fn add_subtask(db: &Path, task: i64, stage: Option<&str>) -> i64 {
        let c = Connection::open(db).unwrap();
        c.execute(
            "INSERT INTO subtasks (task_id, title, stage) VALUES (?1, 'Contact sheet export', ?2)",
            params![task, stage],
        )
        .unwrap();
        c.last_insert_rowid()
    }

    fn add_link(db: &Path, col: &str, item: i64, short: &str, session: Option<&str>, reported: bool) -> i64 {
        let c = Connection::open(db).unwrap();
        c.execute(
            &format!(
                "INSERT INTO task_agents ({col}, short_id, session_id, name, model, started_at, reported_at)
                 VALUES (?1, ?2, ?3, 'work', 'opus', '2027-01-15 08:00:00', {})",
                if reported { "'2027-01-15 08:05:00'" } else { "NULL" }
            ),
            params![item, short, session],
        )
        .unwrap();
        c.last_insert_rowid()
    }

    fn stage_of(db: &Path, table: &str, id: i64) -> Option<String> {
        Connection::open(db)
            .unwrap()
            .query_row(&format!("SELECT stage FROM {table} WHERE id = ?1"), [id], |r| r.get(0))
            .unwrap()
    }

    fn ended(db: &Path, id: i64) -> (bool, Option<String>) {
        Connection::open(db)
            .unwrap()
            .query_row("SELECT ended_at IS NOT NULL, outcome FROM task_agents WHERE id = ?1", [id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap()
    }

    fn agent(status: &str, state: Option<&str>, session: &str, short: &str, model: &str) -> Agent {
        let state = state.map(|s| format!(r#","state":"{s}""#)).unwrap_or_default();
        let json = format!(
            r#"[{{"sessionId":"{session}","id":"{short}","name":"work","cwd":"/x","kind":"bg","status":"{status}","model":"{model}"{state}}}]"#
        );
        parse_agents(&json).unwrap().remove(0)
    }

    fn link(reported: bool) -> OpenLink {
        OpenLink {
            id: 1,
            kind: ItemKind::Task,
            item_id: 1,
            short_id: "0a1b2c3d".into(),
            session_id: Some(SESSION.into()),
            model: Some("opus".into()),
            started_at: T0,
            reported,
            item_has_result: false,
            item_open_links: 1,
        }
    }

    /// `judge` with no copies and a miss already seen in an earlier list (so one fresh list that
    /// lacks the agent ends the link, as in the cases that are not about the miss count).
    fn judge4(link: &OpenLink, agents: &[Agent], listed_at: Option<i64>, tracker_started: i64) -> Judgement {
        judge(link, agents, &BTreeMap::new(), listed_at, tracker_started, Some(1))
    }

    /// The miss state after a first list (at T0 + 9 min) that lacks every agent.
    fn primed(dir: &Path) -> Misses {
        let mut m = Misses::new();
        pass_report(dir, &[], Some(T0 + 9 * MIN), SCHED, &mut m);
        m
    }

    fn listed() -> Option<i64> {
        Some(T0 + 10 * MIN)
    }

    #[test]
    fn working_without_a_result_keeps_the_link() {
        let a = agent("busy", None, SESSION, "0a1b2c3d", "opus");
        assert_eq!(judge4(&link(false), &[a], listed(), SCHED), Judgement::Keep { fill: None });
    }

    #[test]
    fn an_idle_agent_without_a_result_keeps_its_link() {
        let a = agent("idle", None, SESSION, "0a1b2c3d", "opus");
        assert_eq!(judge4(&link(false), &[a], listed(), SCHED), Judgement::Keep { fill: None });
    }

    #[test]
    fn idle_or_waiting_with_a_result_ends_with_result() {
        let idle = agent("idle", None, SESSION, "0a1b2c3d", "opus");
        assert_eq!(judge4(&link(true), &[idle], listed(), SCHED), Judgement::End("result"));
        let waiting = agent("waiting", None, SESSION, "0a1b2c3d", "opus");
        assert_eq!(judge4(&link(true), &[waiting], listed(), SCHED), Judgement::End("result"));
    }

    #[test]
    fn a_working_agent_with_a_result_keeps_its_link() {
        let a = agent("busy", None, SESSION, "0a1b2c3d", "opus");
        assert_eq!(judge4(&link(true), &[a], listed(), SCHED), Judgement::Keep { fill: None });
    }

    #[test]
    fn done_without_a_result_ends_with_no_result_and_with_one_with_result() {
        let a = agent("idle", Some("done"), SESSION, "0a1b2c3d", "opus");
        assert_eq!(judge4(&link(false), std::slice::from_ref(&a), listed(), SCHED), Judgement::End("no_result"));
        assert_eq!(judge4(&link(true), &[a], listed(), SCHED), Judgement::End("result"));
    }

    #[test]
    fn not_listed_counts_only_with_a_fresh_list() {
        let l = link(false);
        // before the start plus the grace
        assert_eq!(judge4(&l, &[], Some(T0 + LISTED_GRACE_MS), SCHED), Judgement::Keep { fill: None });
        // after the grace but before the tracker started
        assert_eq!(judge4(&l, &[], Some(T0 + LISTED_GRACE_MS + 1), T0 + 5 * MIN), Judgement::Keep { fill: None });
        // after both
        assert_eq!(judge4(&l, &[], Some(T0 + LISTED_GRACE_MS + 1), SCHED), Judgement::End("no_result"));
        assert_eq!(judge4(&link(true), &[], Some(T0 + LISTED_GRACE_MS + 1), SCHED), Judgement::End("result"));
        // never listed
        assert_eq!(judge4(&l, &[], None, SCHED), Judgement::Keep { fill: None });
    }

    #[test]
    fn a_clock_that_jumped_back_never_closes_a_link_early() {
        // The list time is earlier than the link's start: the tracker keeps waiting.
        assert_eq!(judge4(&link(false), &[], Some(T0 - 3 * MIN), SCHED), Judgement::Keep { fill: None });
        assert_eq!(judge4(&link(true), &[], Some(T0 - 3 * MIN), SCHED), Judgement::Keep { fill: None });
    }

    const COPY: &str = "11111111-aaaa-bbbb-cccc-dddddddddddd";
    const COPY2: &str = "22222222-aaaa-bbbb-cccc-dddddddddddd";

    fn copies(pairs: &[(&str, &str, &str)]) -> BTreeMap<String, CopyOf> {
        pairs
            .iter()
            .map(|(short, from, model)| (short.to_string(), CopyOf { session_id: from.to_string(), model: model.to_string() }))
            .collect()
    }

    #[test]
    fn after_a_model_switch_the_link_stays_open_and_follows_the_copy() {
        let c = copies(&[("11111111", SESSION, "sonnet")]);
        // the stopped original is still listed as done: the copy is what counts
        let original = agent("idle", Some("done"), SESSION, "0a1b2c3d", "opus");
        let copy = agent("busy", None, COPY, "11111111", "sonnet");
        let j = judge(&link(false), &[original, copy], &c, listed(), SCHED, None);
        assert_eq!(
            j,
            Judgement::Keep {
                fill: Some(Fill { session_id: Some(COPY.into()), short_id: Some("11111111".into()), model: Some("sonnet".into()) })
            }
        );
    }

    #[test]
    fn after_two_switches_the_link_follows_the_last_copy() {
        let c = copies(&[("11111111", SESSION, "sonnet"), ("22222222", COPY, "haiku")]);
        let last = agent("busy", None, COPY2, "22222222", "haiku");
        // the row still holds the original; the first copy is not even listed
        let j = judge(&link(false), std::slice::from_ref(&last), &c, listed(), SCHED, None);
        assert_eq!(
            j,
            Judgement::Keep {
                fill: Some(Fill { session_id: Some(COPY2.into()), short_id: Some("22222222".into()), model: Some("haiku".into()) })
            }
        );
        // once the row holds the first copy, the same
        let mut l = link(false);
        l.session_id = Some(COPY.into());
        l.short_id = "11111111".into();
        assert!(matches!(judge(&l, &[last], &c, listed(), SCHED, None), Judgement::Keep { fill: Some(_) }));
    }

    #[test]
    fn a_copy_not_listed_yet_waits_like_any_agent_not_listed() {
        let c = copies(&[("11111111", SESSION, "sonnet")]);
        let original = agent("idle", Some("done"), SESSION, "0a1b2c3d", "opus");
        let l = link(false);
        // the original is done, but it is not the agent any more: first miss, then two lists
        assert_eq!(judge(&l, std::slice::from_ref(&original), &c, listed(), SCHED, None), Judgement::Missing);
        assert_eq!(
            judge(&l, std::slice::from_ref(&original), &c, Some(T0 + 11 * MIN), SCHED, listed()),
            Judgement::End("no_result")
        );
        // a list older than the grace changes nothing
        assert_eq!(judge(&l, &[original], &c, Some(T0 + LISTED_GRACE_MS), SCHED, None), Judgement::Keep { fill: None });
    }

    #[test]
    fn a_link_that_followed_a_copy_is_found_by_the_copys_later_report() {
        // The row now holds the copy's ids: it is found directly, and a reported idle copy ends.
        let mut l = link(true);
        l.session_id = Some(COPY.into());
        l.short_id = "11111111".into();
        let c = copies(&[("11111111", SESSION, "sonnet")]);
        let copy = agent("idle", None, COPY, "11111111", "opus");
        assert_eq!(judge(&l, &[copy], &c, listed(), SCHED, None), Judgement::End("result"));
    }

    #[test]
    fn one_list_without_the_agent_closes_nothing() {
        // e.g. `claude agents` answered with an empty list
        assert_eq!(judge(&link(false), &[], &BTreeMap::new(), listed(), SCHED, None), Judgement::Missing);
        let dir = app("empty", &["a"], true);
        let db = db_of(&dir, "a");
        let t = add_task(&db, "todo", Some("running"));
        let id = add_link(&db, "task_id", t, "0a1b2c3d", Some(SESSION), false);
        let mut m = Misses::new();
        assert!(!pass(&dir, &[], Some(T0 + 10 * MIN), SCHED, &mut m));
        assert!(!ended(&db, id).0);
        // the same list read again is not a second list
        assert!(!pass(&dir, &[], Some(T0 + 10 * MIN), SCHED, &mut m));
        assert!(!ended(&db, id).0);
        assert_eq!(stage_of(&db, "tasks", t).as_deref(), Some("running"));
    }

    #[test]
    fn two_different_lists_without_the_agent_close_the_link() {
        let dir = app("twolists", &["a"], true);
        let db = db_of(&dir, "a");
        let t = add_task(&db, "todo", Some("running"));
        let id = add_link(&db, "task_id", t, "0a1b2c3d", Some(SESSION), false);
        let mut m = Misses::new();
        assert!(!pass(&dir, &[], Some(T0 + 10 * MIN), SCHED, &mut m));
        assert!(pass(&dir, &[], Some(T0 + 11 * MIN), SCHED, &mut m));
        assert_eq!(ended(&db, id), (true, Some("no_result".into())));
        assert_eq!(stage_of(&db, "tasks", t).as_deref(), Some("to_check"));
    }

    #[test]
    fn the_agent_reappearing_between_two_lists_resets_the_count() {
        let dir = app("reset", &["a"], true);
        let db = db_of(&dir, "a");
        let t = add_task(&db, "todo", Some("running"));
        let id = add_link(&db, "task_id", t, "0a1b2c3d", Some(SESSION), false);
        let mut m = Misses::new();
        let seen = [agent("busy", None, SESSION, "0a1b2c3d", "opus")];
        assert!(!pass(&dir, &[], Some(T0 + 10 * MIN), SCHED, &mut m));
        assert!(!pass(&dir, &seen, Some(T0 + 11 * MIN), SCHED, &mut m));
        assert!(m.is_empty());
        assert!(!pass(&dir, &[], Some(T0 + 12 * MIN), SCHED, &mut m));
        assert!(!ended(&db, id).0);
        assert!(pass(&dir, &[], Some(T0 + 13 * MIN), SCHED, &mut m));
        assert!(ended(&db, id).0);
    }

    fn two_links(name: &str, result: Option<&str>) -> (Vec<OpenLink>, PathBuf, i64) {
        let dir = app(name, &["a"], true);
        let db = db_of(&dir, "a");
        let t = add_task(&db, "todo", Some("running"));
        if let Some(r) = result {
            Connection::open(&db).unwrap().execute("UPDATE tasks SET result = ?1 WHERE id = ?2", params![r, t]).unwrap();
        }
        add_link(&db, "task_id", t, "0a1b2c3d", Some(SESSION), false);
        add_link(&db, "task_id", t, "1b2c3d4e", None, false);
        (open_links(&db).unwrap(), db, t)
    }

    #[test]
    fn two_open_links_and_one_report_end_the_idle_one_and_keep_the_working_one() {
        let (links, db, t) = two_links("several-a", Some("Done: sheet exported"));
        assert!(links.iter().all(|l| l.item_has_result && l.item_open_links == 2));
        let idle = agent("idle", None, SESSION, "0a1b2c3d", "opus");
        let worker = agent("busy", None, "1b2c3d4e-1111-2222-3333-444444444444", "1b2c3d4e", "opus");
        let all = [idle, worker];
        assert_eq!(judge(&links[0], &all, &BTreeMap::new(), listed(), SCHED, None), Judgement::End("result"));
        assert_eq!(judge(&links[1], &all, &BTreeMap::new(), listed(), SCHED, None), Judgement::Keep { fill: Some(Fill { session_id: Some("1b2c3d4e-1111-2222-3333-444444444444".into()), ..Default::default() }) });
        // the first one ends; the item stays Running while the worker's link is open
        assert!(apply(&db, &links[0], &Judgement::End("result")).unwrap());
        assert_eq!(stage_of(&db, "tasks", t).as_deref(), Some("running"));
        // the worker idles, now alone on the item: with no link-level report it keeps its link
        let l = open_links(&db).unwrap().remove(0);
        assert_eq!(l.item_open_links, 1);
    }

    #[test]
    fn two_open_links_without_a_result_keep_both_idle_links() {
        let (links, _, _) = two_links("several-b", None);
        let idle = agent("idle", None, SESSION, "0a1b2c3d", "opus");
        assert_eq!(judge(&links[0], &[idle], &BTreeMap::new(), listed(), SCHED, None), Judgement::Keep { fill: None });
        // an agent that needs the owner is never closed by this rule
        let (links, _, _) = two_links("several-c", Some("x"));
        let waiting = agent("waiting", None, SESSION, "0a1b2c3d", "opus");
        assert_eq!(judge(&links[0], &[waiting], &BTreeMap::new(), listed(), SCHED, None), Judgement::Keep { fill: None });
    }

    #[test]
    fn a_link_without_a_session_id_is_matched_by_short_id_and_filled() {
        let mut l = link(false);
        l.session_id = None;
        let a = agent("busy", None, SESSION, "0a1b2c3d", "opus");
        assert_eq!(
            judge4(&l, &[a], listed(), SCHED),
            Judgement::Keep { fill: Some(Fill { session_id: Some(SESSION.into()), ..Default::default() }) }
        );
        // another agent with another short id is not it
        let other = agent("busy", None, "99999999-1111-2222-3333-444444444444", "bbbbbbbb", "opus");
        // (not found, and no fresh list yet: the link waits)
        assert_eq!(judge4(&l, &[other], None, SCHED), Judgement::Keep { fill: None });
    }

    #[test]
    fn a_session_id_match_beats_a_look_alike_short_id() {
        let other = agent("idle", Some("done"), "99999999-1111-2222-3333-444444444444", "0a1b2c3d", "opus");
        // the look-alike is done, but it is not this session: no list yet that says otherwise
        assert_eq!(judge4(&link(false), &[other], None, SCHED), Judgement::Keep { fill: None });
    }

    #[test]
    fn open_links_reads_only_open_links_and_parses_the_start() {
        let dir = app("open", &["a"], true);
        let db = db_of(&dir, "a");
        let t = add_task(&db, "todo", Some("running"));
        let open = add_link(&db, "task_id", t, "0a1b2c3d", None, true);
        let closed = add_link(&db, "task_id", t, "1b2c3d4e", None, false);
        Connection::open(&db).unwrap().execute("UPDATE task_agents SET ended_at = datetime('now') WHERE id = ?1", [closed]).unwrap();
        let links = open_links(&db).unwrap();
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].id, open);
        assert!(links[0].reported);
        assert_eq!(links[0].kind, ItemKind::Task);
        assert_eq!(links[0].started_at, 1_800_000_000_000);
    }

    #[test]
    fn a_link_the_watcher_started_is_left_open_by_the_tracker() {
        let dir = app("watcher-owned", &["a"], true);
        let db = db_of(&dir, "a");
        let t = add_task(&db, "todo", Some("running"));
        let id = add_link(&db, "task_id", t, "0a1b2c3d", Some(SESSION), true);
        Connection::open(&db).unwrap().execute("UPDATE task_agents SET started_by = 'watcher' WHERE id = ?1", [id]).unwrap();
        assert_eq!(open_links(&db).unwrap(), vec![]);
        // A finished agent would end a hand link; this one is the watcher's.
        let done = agent("idle", Some("done"), SESSION, "0a1b2c3d", "opus");
        let mut m = Misses::new();
        assert!(!pass(&dir, &[done], Some(T0 + 13 * MIN), SCHED, &mut m));
        assert_eq!(ended(&db, id), (false, None));
        assert_eq!(stage_of(&db, "tasks", t).as_deref(), Some("running"));
    }

    #[test]
    fn a_database_without_the_table_has_no_links() {
        let dir = tmp("notable");
        let db = dir.join("x.db");
        Connection::open(&db).unwrap().execute_batch("CREATE TABLE tasks (id INTEGER)").unwrap();
        assert_eq!(open_links(&db).unwrap(), vec![]);
    }

    #[test]
    fn ending_a_link_moves_running_to_check_once_and_a_second_write_changes_nothing() {
        let dir = app("end", &["a"], true);
        let db = db_of(&dir, "a");
        let t = add_task(&db, "in_progress", Some("running"));
        let id = add_link(&db, "task_id", t, "0a1b2c3d", Some(SESSION), false);
        let l = open_links(&db).unwrap().remove(0);
        assert!(apply(&db, &l, &Judgement::End("no_result")).unwrap());
        assert_eq!(ended(&db, id), (true, Some("no_result".into())));
        assert_eq!(stage_of(&db, "tasks", t).as_deref(), Some("to_check"));
        // the stage changed by hand afterwards stays; the same write again does nothing
        Connection::open(&db).unwrap().execute("UPDATE tasks SET stage = 'briefed' WHERE id = ?1", [t]).unwrap();
        assert!(!apply(&db, &l, &Judgement::End("no_result")).unwrap());
        assert_eq!(stage_of(&db, "tasks", t).as_deref(), Some("briefed"));
    }

    #[test]
    fn a_subtask_goes_to_check_too() {
        let dir = app("sub", &["a"], true);
        let db = db_of(&dir, "a");
        let t = add_task(&db, "todo", None);
        let s = add_subtask(&db, t, Some("running"));
        add_link(&db, "subtask_id", s, "0a1b2c3d", None, true);
        let l = open_links(&db).unwrap().remove(0);
        assert_eq!(l.kind, ItemKind::Subtask);
        assert!(apply(&db, &l, &Judgement::End("result")).unwrap());
        assert_eq!(stage_of(&db, "subtasks", s).as_deref(), Some("to_check"));
        assert_eq!(stage_of(&db, "tasks", t), None);
    }

    #[test]
    fn a_done_item_keeps_its_stage_but_the_link_closes() {
        let dir = app("done", &["a"], true);
        let db = db_of(&dir, "a");
        let t = add_task(&db, "done", Some("running"));
        let id = add_link(&db, "task_id", t, "0a1b2c3d", None, false);
        let l = open_links(&db).unwrap().remove(0);
        assert!(apply(&db, &l, &Judgement::End("no_result")).unwrap());
        assert!(ended(&db, id).0);
        assert_eq!(stage_of(&db, "tasks", t).as_deref(), Some("running"));
    }

    #[test]
    fn an_item_with_a_second_open_link_keeps_running() {
        let dir = app("two", &["a"], true);
        let db = db_of(&dir, "a");
        let t = add_task(&db, "todo", Some("running"));
        let first = add_link(&db, "task_id", t, "0a1b2c3d", None, false);
        let second = add_link(&db, "task_id", t, "1b2c3d4e", None, false);
        let l = open_links(&db).unwrap().into_iter().find(|l| l.id == first).unwrap();
        assert!(apply(&db, &l, &Judgement::End("no_result")).unwrap());
        assert_eq!(stage_of(&db, "tasks", t).as_deref(), Some("running"));
        assert!(!ended(&db, second).0);
    }

    #[test]
    fn a_fill_updates_only_what_differs_and_is_idempotent() {
        let dir = app("fill", &["a"], true);
        let db = db_of(&dir, "a");
        let t = add_task(&db, "todo", Some("running"));
        let id = add_link(&db, "task_id", t, "0a1b2c3d", None, false);
        let l = open_links(&db).unwrap().remove(0);
        let j = Judgement::Keep { fill: Some(Fill { session_id: Some(SESSION.into()), short_id: Some("ffff0000".into()), model: None }) };
        assert!(apply(&db, &l, &j).unwrap());
        let (s, sh, m): (Option<String>, String, Option<String>) = Connection::open(&db)
            .unwrap()
            .query_row("SELECT session_id, short_id, model FROM task_agents WHERE id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap();
        assert_eq!((s.as_deref(), sh.as_str(), m.as_deref()), (Some(SESSION), "ffff0000", Some("opus")));
        assert_eq!(stage_of(&db, "tasks", t).as_deref(), Some("running"));
        // the link is still open, and a fill on a closed link writes nothing
        assert!(!ended(&db, id).0);
        Connection::open(&db).unwrap().execute("UPDATE task_agents SET ended_at = datetime('now') WHERE id = ?1", [id]).unwrap();
        assert!(!apply(&db, &l, &j).unwrap());
    }

    fn gone_pass(dir: &Path) -> bool {
        // Two empty lists made long after the link started: every open link ends.
        let mut misses = primed(dir);
        pass(dir, &[], Some(T0 + 10 * MIN), SCHED, &mut misses)
    }

    #[test]
    fn a_pass_ends_the_links_of_every_organisation_not_in_a_mode() {
        let dir = app("pass", &["a", "b"], true);
        let mut ids = vec![];
        for o in ["a", "b"] {
            let db = db_of(&dir, o);
            let t = add_task(&db, "todo", Some("running"));
            ids.push((db.clone(), t, add_link(&db, "task_id", t, "0a1b2c3d", None, false)));
        }
        assert!(gone_pass(&dir));
        for (db, t, id) in &ids {
            assert!(ended(db, *id).0);
            assert_eq!(stage_of(db, "tasks", *t).as_deref(), Some("to_check"));
        }
        assert!(!gone_pass(&dir), "a second pass changes nothing");
    }

    #[test]
    fn a_pass_skips_an_organisation_in_test_or_presentation_mode() {
        for mode in crate::agents::briefing::MODE_FILES {
            let dir = app(&format!("mode-{mode}"), &["a", "b"], true);
            let da = db_of(&dir, "a");
            let ta = add_task(&da, "todo", Some("running"));
            let la = add_link(&da, "task_id", ta, "0a1b2c3d", None, false);
            let db = db_of(&dir, "b");
            let tb = add_task(&db, "todo", Some("running"));
            let lb = add_link(&db, "task_id", tb, "0a1b2c3d", None, false);
            std::fs::write(da.with_file_name(mode), "").unwrap();
            assert!(gone_pass(&dir));
            assert!(!ended(&da, la).0);
            assert_eq!(stage_of(&da, "tasks", ta).as_deref(), Some("running"));
            assert!(ended(&db, lb).0);
        }
    }

    #[test]
    fn a_pass_skips_an_organisation_that_is_not_migrated_yet() {
        let dir = app("old", &["a", "b"], true);
        let da = db_of(&dir, "a");
        Connection::open(&da).unwrap().execute_batch("DROP TABLE task_agents").unwrap();
        let db = db_of(&dir, "b");
        let tb = add_task(&db, "todo", Some("running"));
        let lb = add_link(&db, "task_id", tb, "0a1b2c3d", None, false);
        let report = pass_report(&dir, &[], Some(T0 + 10 * MIN), SCHED, &mut primed(&dir));
        assert_eq!(report.len(), 2);
        assert!(report.iter().all(|(_, r)| r.is_ok()));
        assert!(ended(&db, lb).0);
    }

    #[test]
    fn the_tick_does_nothing_while_agents_is_off() {
        let dir = app("off", &["a"], false);
        let db = db_of(&dir, "a");
        let t = add_task(&db, "todo", Some("running"));
        let id = add_link(&db, "task_id", t, "0a1b2c3d", None, false);
        assert!(!tick(&dir, false, &[], Some(T0 + 10 * MIN), SCHED, &mut primed(&dir)));
        assert!(!ended(&db, id).0);
        write_settings(&dir, &AgentsSettings { enabled: true, ..Default::default() }).unwrap();
        assert!(tick(&dir, false, &[], Some(T0 + 10 * MIN), SCHED, &mut primed(&dir)));
        assert!(ended(&db, id).0);
    }

    #[test]
    fn a_tick_in_the_demo_reads_no_file() {
        let dir = std::env::temp_dir().join(format!("sm-links-demo-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        assert!(!tick(&dir, true, &[], Some(T0 + 10 * MIN), SCHED, &mut Misses::new()));
        assert!(!dir.exists(), "nothing was created or read");
    }

    #[test]
    fn a_locked_database_fails_after_about_five_seconds_and_the_others_are_still_handled() {
        let dir = app("busy", &["a", "b"], true);
        let da = db_of(&dir, "a");
        let ta = add_task(&da, "todo", Some("running"));
        let la = add_link(&da, "task_id", ta, "0a1b2c3d", None, false);
        let db = db_of(&dir, "b");
        let tb = add_task(&db, "todo", Some("running"));
        let lb = add_link(&db, "task_id", tb, "0a1b2c3d", None, false);
        let mut misses = primed(&dir);
        let (held_tx, held_rx) = std::sync::mpsc::channel::<()>();
        let (done_tx, done_rx) = std::sync::mpsc::channel::<()>();
        let da2 = da.clone();
        let holder = std::thread::spawn(move || {
            let c = Connection::open(&da2).unwrap();
            c.execute_batch("BEGIN IMMEDIATE").unwrap();
            held_tx.send(()).unwrap();
            done_rx.recv().unwrap();
            c.execute_batch("ROLLBACK").unwrap();
        });
        held_rx.recv().unwrap();
        let start = std::time::Instant::now();
        let report = pass_report(&dir, &[], Some(T0 + 10 * MIN), SCHED, &mut misses);
        let took = start.elapsed();
        done_tx.send(()).unwrap();
        holder.join().unwrap();
        // About five seconds for the busy timeout. The upper bound leaves room for one more wait:
        // when another test holds the organisation lock shared through its own busy timeout while
        // a third asks for it exclusively, the second organisation here queues behind them.
        assert!(took >= Duration::from_secs(4) && took < Duration::from_secs(20), "took {took:?}");
        let a = report.iter().find(|(o, _)| o == "a").unwrap();
        assert!(a.1.is_err());
        let b = report.iter().find(|(o, _)| o == "b").unwrap();
        assert_eq!(b.1, Ok(true));
        assert!(!ended(&da, la).0);
        assert!(ended(&db, lb).0);
    }

    #[test]
    fn the_tracker_never_touches_an_agent() {
        // The module has no CLI: it takes the poller's list as data and has no way to call
        // `claude`. A guard on the source keeps it so.
        let src = include_str!("links.rs");
        let code = src.split("#[cfg(test)]").next().unwrap();
        for word in ["Cli", "std::process", "Command::new", "\"stop\"", "\"rm\"", "\"kill\""] {
            assert!(!code.contains(word), "links.rs must not use {word}");
        }
        assert!(!code.contains("DELETE FROM"), "links.rs must not delete rows");
    }
}
