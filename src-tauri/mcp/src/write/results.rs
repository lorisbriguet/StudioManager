use super::captures::ONE_ID;
use super::tasks::{subtask_result, task_result};
use super::*;

const MAX_RESULT: usize = 4000;
const MAX_BRANCH: usize = 200;
const MAX_PR_URL: usize = 500;

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct ReportedResult {
    pub org: String,
    /// "task" or "subtask".
    pub kind: String,
    pub id: i64,
    pub title: String,
    /// True when an open agent link of the item got the branch and pull request link.
    pub linked: bool,
}

/// Write the result of a task or subtask, and the branch and pull request link on the
/// item's newest open agent link. Never writes the stage, the status or `ended_at`.
pub fn report_result(
    dir: &Path,
    org: &Org,
    task_id: Option<i64>,
    subtask_id: Option<i64>,
    result: &str,
    branch: Option<&str>,
    pr_url: Option<&str>,
) -> R<ReportedResult> {
    if task_id.is_some() == subtask_id.is_some() {
        return Err(ONE_ID.to_string());
    }
    let result = required(result, "Result")?;
    if result.chars().count() > MAX_RESULT {
        return Err(format!(
            "Result too long: keep it under {MAX_RESULT} characters (what was done, what is left open, how to check it)."
        ));
    }
    let branch = branch.map(str::trim).filter(|b| !b.is_empty());
    if let Some(b) = branch {
        if b.chars().count() > MAX_BRANCH || b.chars().any(char::is_whitespace) {
            return Err(format!(
                "Branch must be at most {MAX_BRANCH} characters, without spaces."
            ));
        }
    }
    let pr_url = pr_url.map(str::trim).filter(|u| !u.is_empty());
    if let Some(u) = pr_url {
        if !u.starts_with("https://") || u.chars().count() > MAX_PR_URL {
            return Err(format!(
                "pr_url must start with https:// and be at most {MAX_PR_URL} characters."
            ));
        }
    }
    write(dir, org, "report_result", |tx| {
        let (kind, table, link_col, id, title) = match (task_id, subtask_id) {
            (Some(id), None) => ("task", "tasks", "task_id", id, task_result(tx, org, id)?.title),
            (None, Some(id)) => {
                ("subtask", "subtasks", "subtask_id", id, subtask_result(tx, org, id)?.title)
            }
            _ => return Err(ONE_ID.to_string()),
        };
        update_row(tx, table, id, vec![("result", Value::Text(result))])?;
        let open: Option<i64> = db(tx
            .query_row(
                &format!(
                    "SELECT id FROM task_agents WHERE {link_col} = ?1 AND ended_at IS NULL \
                     ORDER BY started_at DESC, id DESC LIMIT 1"
                ),
                [id],
                |r| r.get(0),
            )
            .optional())?;
        if let Some(link) = open {
            db(tx.execute(
                "UPDATE task_agents SET reported_at = datetime('now'), \
                 branch = COALESCE(?2, branch), pr_url = COALESCE(?3, pr_url) WHERE id = ?1",
                params![link, branch, pr_url],
            ))?;
        }
        let summary = format!("Reported the result of {kind} \"{title}\" (id {id})");
        let r = ReportedResult {
            org: org.name.clone(),
            kind: kind.to_string(),
            id,
            title,
            linked: open.is_some(),
        };
        Ok((r, Some(summary)))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::write::test_util::*;

    fn link(conn: &Connection, col: &str, id: i64, started: &str, ended: Option<&str>) -> i64 {
        conn.execute(
            &format!(
                "INSERT INTO task_agents ({col}, short_id, name, started_at, ended_at) \
                 VALUES (?1, 'ab12cd', 'Poster tool', ?2, ?3)"
            ),
            params![id, started, ended],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    type LinkRow = (Option<String>, Option<String>, Option<String>);
    fn link_row(conn: &Connection, id: i64) -> LinkRow {
        conn.query_row(
            "SELECT reported_at, branch, pr_url FROM task_agents WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap()
    }

    #[test]
    fn writes_the_result_and_the_open_link_but_not_stage_or_status() {
        let (dir, org, conn) = fixture();
        conn.execute("UPDATE tasks SET stage = 'running' WHERE id = 1", []).unwrap();
        let l = link(&conn, "task_id", 1, "2026-11-13 09:00:00", None);
        let r = report_result(
            &dir,
            &org,
            Some(1),
            None,
            "  Done: contact sheet exported.  ",
            Some("feature/contact-sheet"),
            Some("https://example.test/pr/7"),
        )
        .unwrap();
        assert_eq!(
            r,
            ReportedResult {
                org: "Studio".into(),
                kind: "task".into(),
                id: 1,
                title: "Logo variants".into(),
                linked: true
            }
        );
        let res: String = one(&conn, "SELECT result FROM tasks WHERE id = 1");
        assert_eq!(res, "Done: contact sheet exported.");
        let (st, status, ended): (String, String, Option<String>) = conn
            .query_row(
                "SELECT t.stage, t.status, a.ended_at FROM tasks t, task_agents a WHERE t.id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!((st.as_str(), status.as_str(), ended), ("running", "in_progress", None));
        let (at, b, pr) = link_row(&conn, l);
        assert!(at.is_some());
        assert_eq!(b.as_deref(), Some("feature/contact-sheet"));
        assert_eq!(pr.as_deref(), Some("https://example.test/pr/7"));
        let lines = log_lines(&dir);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0]["tool"], "report_result");
        assert_eq!(lines[0]["summary"], "Reported the result of task \"Logo variants\" (id 1)");
        assert!(dir.join("backups").join("agent").exists());
    }

    #[test]
    fn only_the_newest_open_link_is_written() {
        let (dir, org, conn) = fixture();
        let closed = link(&conn, "task_id", 1, "2026-11-13 10:00:00", Some("2026-11-13 10:30:00"));
        let old = link(&conn, "task_id", 1, "2026-11-13 08:00:00", None);
        let new = link(&conn, "task_id", 1, "2026-11-13 09:00:00", None);
        let r = report_result(&dir, &org, Some(1), None, "Done", Some("work"), None).unwrap();
        assert!(r.linked);
        assert!(link_row(&conn, new).0.is_some());
        assert_eq!(link_row(&conn, new).1.as_deref(), Some("work"));
        assert_eq!(link_row(&conn, old), (None, None, None));
        assert_eq!(link_row(&conn, closed), (None, None, None));
    }

    #[test]
    fn no_open_link_writes_only_the_result() {
        let (dir, org, conn) = fixture();
        link(&conn, "task_id", 1, "2026-11-13 08:00:00", Some("2026-11-13 08:30:00"));
        let r = report_result(&dir, &org, Some(1), None, "Done", None, None).unwrap();
        assert!(!r.linked);
        let res: String = one(&conn, "SELECT result FROM tasks WHERE id = 1");
        assert_eq!(res, "Done");
        let n: i64 = one(&conn, "SELECT COUNT(*) FROM task_agents WHERE reported_at IS NOT NULL");
        assert_eq!(n, 0);
    }

    #[test]
    fn a_subtask_gets_its_result_and_its_link() {
        let (dir, org, conn) = fixture();
        let l = link(&conn, "subtask_id", 2, "2026-11-13 09:00:00", None);
        let other = link(&conn, "task_id", 1, "2026-11-13 09:00:00", None);
        let r = report_result(&dir, &org, None, Some(2), "Reversed logo done", None, None).unwrap();
        assert_eq!((r.kind.as_str(), r.id, r.title.as_str(), r.linked), ("subtask", 2, "Reversed", true));
        let res: String = one(&conn, "SELECT result FROM subtasks WHERE id = 2");
        assert_eq!(res, "Reversed logo done");
        assert!(link_row(&conn, l).0.is_some());
        assert_eq!(link_row(&conn, other).0, None);
        assert_eq!(
            log_lines(&dir)[0]["summary"],
            "Reported the result of subtask \"Reversed\" (id 2)"
        );
    }

    #[test]
    fn bad_input_writes_nothing() {
        let (dir, org, conn) = fixture();
        let l = link(&conn, "task_id", 1, "2026-11-13 09:00:00", None);
        let long = "x".repeat(4001);
        type Case<'a> = (Option<i64>, Option<i64>, &'a str, Option<&'a str>, Option<&'a str>, &'a str);
        let cases: Vec<Case> = vec![
            (Some(1), Some(1), "ok", None, None, ONE_ID),
            (None, None, "ok", None, None, ONE_ID),
            (Some(99), None, "ok", None, None, "No task with id 99."),
            (None, Some(99), "ok", None, None, "No subtask with id 99."),
            (Some(1), None, "  ", None, None, "Result can't be empty."),
            (Some(1), None, &long, None, None, "Result too long"),
            (Some(1), None, "ok", None, Some("http://example.test/pr"), "pr_url must start with https://"),
            (Some(1), None, "ok", Some("my branch"), None, "Branch must be"),
        ];
        for (t, s, res, b, pr, want) in cases {
            let e = report_result(&dir, &org, t, s, res, b, pr).unwrap_err();
            assert!(e.starts_with(want), "{e}");
        }
        let n: i64 = one(&conn, "SELECT COUNT(*) FROM tasks WHERE result IS NOT NULL");
        let m: i64 = one(&conn, "SELECT COUNT(*) FROM subtasks WHERE result IS NOT NULL");
        assert_eq!((n, m, link_row(&conn, l)), (0, 0, (None, None, None)));
        assert!(log_lines(&dir).is_empty());
        // The longest accepted result.
        report_result(&dir, &org, Some(1), None, &"x".repeat(4000), None, None).unwrap();
    }

    #[test]
    fn refused_in_test_mode() {
        let (dir, org, conn) = fixture();
        std::fs::write(org.db.with_file_name("studiomanager_test.db"), "").unwrap();
        let e = report_result(&dir, &org, Some(1), None, "Done", None, None).unwrap_err();
        assert_eq!(e, guard::MODE_ACTIVE);
        let n: i64 = one(&conn, "SELECT COUNT(*) FROM tasks WHERE result IS NOT NULL");
        assert_eq!(n, 0);
    }
}
