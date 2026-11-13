use super::*;
use crate::guard::Org;
use std::io::Read;
use std::path::Path;

const LIMIT: i64 = 100;
/// The most of a stored diff `get_needs_you` reads.
pub const MAX_DIFF: u64 = 200 * 1024;

pub const NY_STATUS: &str = "Status must be open, answered or dismissed.";
pub const NY_DECIDED_BY: &str = "decided_by must be user, lead or app.";
pub const NY_SINCE: &str = "since uses YYYY-MM-DD.";

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct NeedsYouRow {
    pub id: i64,
    pub kind: String,
    pub task_id: Option<i64>,
    pub subtask_id: Option<i64>,
    pub title: String,
    pub body: String,
    pub recommendation: Option<String>,
    pub options: Vec<String>,
    pub is_decision: bool,
    pub status: String,
    pub answer: Option<String>,
    pub decided_by: Option<String>,
    pub reason: Option<String>,
    pub lead_state: Option<String>,
    pub check_passed: Option<bool>,
    pub check_output: Option<String>,
    pub change_lines: Option<i64>,
    pub touches: Vec<String>,
    pub created_at: String,
    pub answered_at: Option<String>,
}

const COLUMNS: &str = "SELECT id, kind, task_id, subtask_id, title, body, recommendation, options, \
    is_decision, status, answer, decided_by, reason, lead_state, check_passed, check_output, \
    change_lines, touches, created_at, answered_at FROM needs_you";

fn strings(raw: Option<String>) -> Vec<String> {
    raw.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn needs_you_row(r: &Row) -> rusqlite::Result<NeedsYouRow> {
    Ok(NeedsYouRow {
        id: r.get(0)?,
        kind: r.get(1)?,
        task_id: r.get(2)?,
        subtask_id: r.get(3)?,
        title: r.get(4)?,
        body: r.get(5)?,
        recommendation: r.get(6)?,
        options: strings(r.get(7)?),
        is_decision: r.get::<_, i64>(8)? != 0,
        status: r.get(9)?,
        answer: r.get(10)?,
        decided_by: r.get(11)?,
        reason: r.get(12)?,
        lead_state: r.get(13)?,
        check_passed: r.get::<_, Option<i64>>(14)?.map(|v| v != 0),
        check_output: r.get(15)?,
        change_lines: r.get(16)?,
        touches: strings(r.get(17)?),
        created_at: r.get(18)?,
        answered_at: r.get(19)?,
    })
}

/// At most 100 entries, newest first. `since` (YYYY-MM-DD) keeps the entries answered or
/// created on or after that day.
pub fn list_needs_you(
    conn: &Connection,
    status: Option<&str>,
    decided_by: Option<&str>,
    since: Option<&str>,
) -> R<Vec<NeedsYouRow>> {
    let clean = |s: Option<&str>| s.map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    let status = clean(status);
    if let Some(s) = &status {
        if !["open", "answered", "dismissed"].contains(&s.as_str()) {
            return Err(NY_STATUS.to_string());
        }
    }
    let decided_by = clean(decided_by);
    if let Some(s) = &decided_by {
        if !["user", "lead", "app"].contains(&s.as_str()) {
            return Err(NY_DECIDED_BY.to_string());
        }
    }
    let since = clean(since);
    if let Some(s) = &since {
        if NaiveDate::parse_from_str(s, "%Y-%m-%d").is_err() {
            return Err(NY_SINCE.to_string());
        }
    }
    let mut stmt = db(conn.prepare(&format!(
        "{COLUMNS} WHERE (?1 IS NULL OR status = ?1) AND (?2 IS NULL OR decided_by = ?2) \
         AND (?3 IS NULL OR date(COALESCE(answered_at, created_at)) >= ?3) \
         ORDER BY id DESC LIMIT ?4"
    )))?;
    db(stmt
        .query_map(params![status, decided_by, since, LIMIT], needs_you_row)
        .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>()))
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct NeedsYouDetail {
    #[serde(flatten)]
    pub row: NeedsYouRow,
    pub item_title: String,
    pub item_brief: Option<String>,
    pub item_result: Option<String>,
    pub project_id: i64,
    pub project: String,
    /// The stored diff of a check (at most 200 KB), when a file exists.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff: Option<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub diff_truncated: bool,
}

type Item = (String, Option<String>, Option<String>, i64, String);

/// One entry with its item's title, brief and result, its project and, for a check, the stored
/// diff `<data dir>/lead/checks/<org id>-<id>.diff` (a missing file is no diff). The file name
/// is built from the validated organisation id and the numeric entry id only.
pub fn get_needs_you(conn: &Connection, dir: &Path, org: &Org, id: i64) -> R<NeedsYouDetail> {
    let row = db(conn
        .query_row(&format!("{COLUMNS} WHERE id = ?1"), [id], needs_you_row)
        .optional())?
    .ok_or_else(|| format!("No entry with id {id}."))?;
    let item: Item = match (row.task_id, row.subtask_id) {
        (Some(t), _) => db(conn.query_row(
            "SELECT t.title, t.brief, t.result, p.id, p.name FROM tasks t \
             JOIN projects p ON p.id = t.project_id WHERE t.id = ?1",
            [t],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        ))?,
        (None, Some(s)) => db(conn.query_row(
            "SELECT s.title, s.brief, s.result, p.id, p.name FROM subtasks s \
             JOIN tasks t ON t.id = s.task_id JOIN projects p ON p.id = t.project_id \
             WHERE s.id = ?1",
            [s],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        ))?,
        _ => return Err(format!("Entry {id} has no task or subtask.")),
    };
    let (item_title, item_brief, item_result, project_id, project) = item;
    let (diff, diff_truncated) = if row.kind == "check" {
        read_diff(&dir.join("lead").join("checks").join(format!("{}-{}.diff", org.id, id)))
    } else {
        (None, false)
    };
    Ok(NeedsYouDetail {
        row,
        item_title,
        item_brief,
        item_result,
        project_id,
        project,
        diff,
        diff_truncated,
    })
}

fn read_diff(path: &Path) -> (Option<String>, bool) {
    let Ok(file) = std::fs::File::open(path) else { return (None, false) };
    let mut buf = Vec::new();
    if file.take(MAX_DIFF + 1).read_to_end(&mut buf).is_err() {
        return (None, false);
    }
    let truncated = buf.len() as u64 > MAX_DIFF;
    buf.truncate(MAX_DIFF as usize);
    (Some(String::from_utf8_lossy(&buf).into_owned()), truncated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::ready_dir;
    use std::path::PathBuf;

    fn fixture() -> (PathBuf, Org, Connection) {
        let dir = ready_dir("org001", "Studio");
        let org = crate::guard::resolve_org(&dir, None).unwrap();
        let conn = Connection::open(&org.db).unwrap();
        conn.execute_batch(
            "INSERT INTO clients (id, name, email, language) VALUES ('C-001', 'Atelier Lumen', 'a@b.test', 'FR');
             INSERT INTO projects (id, client_id, name, status) VALUES (1, 'C-001', 'Identité Visuelle', 'active');
             INSERT INTO tasks (id, project_id, title, status, sort_order) VALUES (1, 1, 'Logo variants', 'in_progress', 1);",
        )
        .unwrap();
        (dir, org, conn)
    }

    fn insert(conn: &Connection, kind: &str, status: &str, by: Option<&str>, created: &str) -> i64 {
        conn.execute(
            "INSERT INTO needs_you (kind, task_id, title, body, status, decided_by, created_at) \
             VALUES (?1, 1, 'Logo variants', 'q', ?2, ?3, ?4)",
            params![kind, status, by, created],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn lists_newest_first_with_filters() {
        let (_dir, _org, conn) = fixture();
        let a = insert(&conn, "decide", "open", None, "2026-11-10 09:00:00");
        let b = insert(&conn, "decide", "answered", Some("lead"), "2026-11-12 09:00:00");
        let c = insert(&conn, "check", "answered", Some("user"), "2026-11-13 09:00:00");
        let ids = |s, d, since| -> Vec<i64> {
            list_needs_you(&conn, s, d, since).unwrap().iter().map(|r| r.id).collect()
        };
        assert_eq!(ids(None, None, None), vec![c, b, a]);
        assert_eq!(ids(Some("open"), None, None), vec![a]);
        assert_eq!(ids(None, Some("lead"), None), vec![b]);
        assert_eq!(ids(None, None, Some("2026-11-12")), vec![c, b]);
        assert!(list_needs_you(&conn, Some("x"), None, None).is_err());
        assert!(list_needs_you(&conn, None, Some("x"), None).is_err());
        assert!(list_needs_you(&conn, None, None, Some("12/11")).is_err());
    }

    #[test]
    fn lists_at_most_100() {
        let (_dir, _org, conn) = fixture();
        for _ in 0..105 {
            insert(&conn, "decide", "open", None, "2026-11-10 09:00:00");
        }
        assert_eq!(list_needs_you(&conn, None, None, None).unwrap().len(), 100);
    }

    #[test]
    fn get_reads_only_its_own_diff_file() {
        let (dir, org, conn) = fixture();
        conn.execute("UPDATE tasks SET brief = 'Export it', result = 'Done' WHERE id = 1", []).unwrap();
        let id = insert(&conn, "check", "open", None, "2026-11-13 09:00:00");
        let other = insert(&conn, "check", "open", None, "2026-11-13 09:00:00");
        // No file yet: no diff, no error.
        let d = get_needs_you(&conn, &dir, &org, id).unwrap();
        assert_eq!(d.diff, None);
        assert_eq!(
            (d.item_title.as_str(), d.item_brief.as_deref(), d.item_result.as_deref(), d.project_id, d.project.as_str()),
            ("Logo variants", Some("Export it"), Some("Done"), 1, "Identité Visuelle")
        );
        let checks = dir.join("lead").join("checks");
        std::fs::create_dir_all(&checks).unwrap();
        std::fs::write(checks.join(format!("{}-{id}.diff", org.id)), "+added line\n").unwrap();
        std::fs::write(checks.join(format!("{}-{other}.diff", org.id)), "other").unwrap();
        let d = get_needs_you(&conn, &dir, &org, id).unwrap();
        assert_eq!(d.diff.as_deref(), Some("+added line\n"));
        assert!(!d.diff_truncated);
        let json = serde_json::to_value(&d).unwrap();
        assert_eq!(json["id"], id);
        assert_eq!(json["diff"], "+added line\n");
    }

    #[test]
    fn the_diff_is_capped_at_200_kb() {
        let (dir, org, conn) = fixture();
        let id = insert(&conn, "check", "open", None, "2026-11-13 09:00:00");
        let checks = dir.join("lead").join("checks");
        std::fs::create_dir_all(&checks).unwrap();
        std::fs::write(checks.join(format!("{}-{id}.diff", org.id)), "x".repeat(300 * 1024)).unwrap();
        let d = get_needs_you(&conn, &dir, &org, id).unwrap();
        assert_eq!(d.diff.unwrap().len(), 200 * 1024);
        assert!(d.diff_truncated);
    }

    #[test]
    fn a_decide_entry_reads_no_diff_and_an_unknown_id_fails() {
        let (dir, org, conn) = fixture();
        let id = insert(&conn, "decide", "open", None, "2026-11-13 09:00:00");
        let checks = dir.join("lead").join("checks");
        std::fs::create_dir_all(&checks).unwrap();
        std::fs::write(checks.join(format!("{}-{id}.diff", org.id)), "x").unwrap();
        assert_eq!(get_needs_you(&conn, &dir, &org, id).unwrap().diff, None);
        assert_eq!(get_needs_you(&conn, &dir, &org, 99).unwrap_err(), "No entry with id 99.");
    }
}
