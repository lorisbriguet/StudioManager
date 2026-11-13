use super::captures::ONE_ID;
use super::tasks::{subtask_result, task_result};
use super::*;

const MAX_QUESTION: usize = 2000;
const MAX_RECOMMENDATION: usize = 2000;
const MAX_REASON: usize = 2000;
const MAX_ANSWER: usize = 4000;
const MAX_OPTIONS: usize = 6;
const MAX_OPTION: usize = 80;

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Asked {
    pub org: String,
    pub id: i64,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Settled {
    pub org: String,
    pub id: i64,
    pub status: String,
}

fn bounded(s: &str, what: &str, max: usize) -> R<String> {
    let s = required(s, what)?;
    if s.chars().count() > max {
        return Err(format!("{what} too long: keep it under {max} characters."));
    }
    Ok(s)
}

/// The options as stored: a JSON array of strings, or None for no options.
fn options_json(options: Option<&[String]>) -> R<Option<String>> {
    let Some(options) = options else { return Ok(None) };
    let cleaned: Vec<&str> = options.iter().map(|o| o.trim()).filter(|o| !o.is_empty()).collect();
    if cleaned.len() > MAX_OPTIONS {
        return Err(format!("Give at most {MAX_OPTIONS} options."));
    }
    if cleaned.iter().any(|o| o.chars().count() > MAX_OPTION) {
        return Err(format!("Each option must be at most {MAX_OPTION} characters."));
    }
    if cleaned.is_empty() {
        return Ok(None);
    }
    serde_json::to_string(&cleaned)
        .map(Some)
        .map_err(|e| format!("Could not encode the options: {e}"))
}

/// Ask a question on a task or subtask: a `decide` row for the user (or the lead).
/// Needs an open agent link on the item: the answer is typed into that agent.
pub fn ask(
    dir: &Path,
    org: &Org,
    task_id: Option<i64>,
    subtask_id: Option<i64>,
    question: &str,
    recommendation: &str,
    options: Option<&[String]>,
) -> R<Asked> {
    if task_id.is_some() == subtask_id.is_some() {
        return Err(ONE_ID.to_string());
    }
    let question = bounded(question, "Question", MAX_QUESTION)?;
    let recommendation = bounded(recommendation, "Recommendation", MAX_RECOMMENDATION)?;
    let options = options_json(options)?;
    write(dir, org, "ask", |tx| {
        let (kind, link_col, id, title) = match (task_id, subtask_id) {
            (Some(id), None) => ("task", "task_id", id, task_result(tx, org, id)?.title),
            (None, Some(id)) => ("subtask", "subtask_id", id, subtask_result(tx, org, id)?.title),
            _ => return Err(ONE_ID.to_string()),
        };
        // The newest open link of the item: the answer is typed into that agent.
        let link: Option<(i64, Option<String>)> = db(tx
            .query_row(
                &format!(
                    "SELECT id, started_by FROM task_agents \
                     WHERE {link_col} = ?1 AND ended_at IS NULL ORDER BY id DESC LIMIT 1"
                ),
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional())?;
        let Some((link_id, started_by)) = link else {
            return Err(
                "No agent is working on this item from StudioManager: ask the user in the conversation instead."
                    .to_string(),
            );
        };
        let open: i64 = db(tx.query_row(
            "SELECT COUNT(*) FROM needs_you WHERE link_id = ?1 AND kind = 'decide' AND status = 'open'",
            [link_id],
            |r| r.get(0),
        ))?;
        if open > 0 {
            return Err("A question is already waiting on this item.".to_string());
        }
        let lead_state = match started_by.as_deref() {
            Some("watcher") => Some("waiting"),
            _ => None,
        };
        db(tx.execute(
            &format!(
                "INSERT INTO needs_you ({link_col}, link_id, kind, title, body, recommendation, \
                 options, lead_state) VALUES (?1, ?2, 'decide', ?3, ?4, ?5, ?6, ?7)"
            ),
            params![id, link_id, title, question, recommendation, options, lead_state],
        ))?;
        let nid = tx.last_insert_rowid();
        let summary = format!("Asked a question on {kind} \"{title}\" (id {id})");
        Ok((Asked { org: org.name.clone(), id: nid }, Some(summary)))
    })
}

/// The row a lead tool may settle: open and running on the lead. Returns its kind.
fn lead_row(tx: &Transaction, id: i64) -> R<String> {
    let row: Option<(String, String, Option<String>)> = db(tx
        .query_row(
            "SELECT kind, status, lead_state FROM needs_you WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional())?;
    let (kind, status, lead_state) = row.ok_or_else(|| format!("No entry with id {id}."))?;
    if status != "open" {
        return Err(format!("Entry {id} is already {status}."));
    }
    if lead_state.as_deref() != Some("running") {
        return Err(format!("Entry {id} is not with the lead (lead_state must be running)."));
    }
    Ok(kind)
}

/// Answer an entry as the lead. Never writes a stage, a status or `delivered_at`.
pub fn resolve(
    dir: &Path,
    org: &Org,
    needs_you_id: i64,
    answer: &str,
    reason: &str,
) -> R<Settled> {
    let answer = bounded(answer, "Answer", MAX_ANSWER)?;
    let reason = bounded(reason, "Reason", MAX_REASON)?;
    write(dir, org, "resolve", |tx| {
        let kind = lead_row(tx, needs_you_id)?;
        if kind == "check" {
            let notes = answer.strip_prefix("send_back:").map(str::trim);
            if answer != "accept" && notes.is_none_or(str::is_empty) {
                return Err(
                    "For a check, the answer is \"accept\" or \"send_back: <notes>\".".to_string()
                );
            }
        }
        db(tx.execute(
            "UPDATE needs_you SET status = 'answered', answer = ?2, decided_by = 'lead', \
             reason = ?3, answered_at = datetime('now'), lead_state = 'done' WHERE id = ?1",
            params![needs_you_id, answer, reason],
        ))?;
        let summary = format!("Resolved entry {needs_you_id} as the lead");
        Ok((
            Settled { org: org.name.clone(), id: needs_you_id, status: "answered".into() },
            Some(summary),
        ))
    })
}

/// Hand an entry to the user with the lead's recommendation: it stays open.
pub fn hand_over(
    dir: &Path,
    org: &Org,
    needs_you_id: i64,
    recommendation: &str,
    reason: &str,
    options: Option<&[String]>,
    is_decision: Option<bool>,
) -> R<Settled> {
    let recommendation = bounded(recommendation, "Recommendation", MAX_RECOMMENDATION)?;
    let reason = bounded(reason, "Reason", MAX_REASON)?;
    let options = options_json(options)?;
    write(dir, org, "hand_over", |tx| {
        lead_row(tx, needs_you_id)?;
        db(tx.execute(
            "UPDATE needs_you SET recommendation = ?2, reason = ?3, \
             options = COALESCE(?4, options), is_decision = COALESCE(?5, is_decision), \
             lead_state = 'done' WHERE id = ?1",
            params![needs_you_id, recommendation, reason, options, is_decision.map(i64::from)],
        ))?;
        let summary = format!("Handed entry {needs_you_id} over to the user");
        Ok((
            Settled { org: org.name.clone(), id: needs_you_id, status: "open".into() },
            Some(summary),
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::write::test_util::*;

    fn link(conn: &Connection, col: &str, id: i64, by: Option<&str>, ended: Option<&str>) -> i64 {
        conn.execute(
            &format!(
                "INSERT INTO task_agents ({col}, short_id, name, started_at, ended_at, started_by) \
                 VALUES (?1, 'ab12cd', 'Poster tool', '2026-11-13 09:00:00', ?2, ?3)"
            ),
            params![id, ended, by],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn entry(conn: &Connection, kind: &str, lead_state: Option<&str>) -> i64 {
        conn.execute(
            "INSERT INTO needs_you (kind, task_id, title, body, lead_state) \
             VALUES (?1, 1, 'Logo variants', 'q', ?2)",
            params![kind, lead_state],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    type Row = (Option<i64>, Option<String>, String, String, Option<String>);
    fn row(conn: &Connection, id: i64) -> Row {
        conn.query_row(
            "SELECT link_id, lead_state, kind, body, options FROM needs_you WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .unwrap()
    }

    fn opts(n: usize) -> Vec<String> {
        (0..n).map(|i| format!("Option {i}")).collect()
    }

    #[test]
    fn ask_on_a_watcher_link_waits_for_the_lead() {
        let (dir, org, conn) = fixture();
        link(&conn, "task_id", 1, Some("watcher"), Some("2026-11-13 08:00:00"));
        let l = link(&conn, "task_id", 1, Some("watcher"), None);
        let r = ask(&dir, &org, Some(1), None, " Which size? ", "A4", Some(&opts(2))).unwrap();
        assert_eq!(r.org, "Studio");
        let (link_id, state, kind, body, options) = row(&conn, r.id);
        assert_eq!(
            (link_id, state.as_deref(), kind.as_str(), body.as_str()),
            (Some(l), Some("waiting"), "decide", "Which size?")
        );
        assert_eq!(options.as_deref(), Some(r#"["Option 0","Option 1"]"#));
        let lines = log_lines(&dir);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0]["tool"], "ask");
        assert!(dir.join("backups").join("agent").exists());
    }

    #[test]
    fn ask_with_no_open_link_is_refused_and_writes_nothing() {
        let (dir, org, conn) = fixture();
        let e = ask(&dir, &org, None, Some(2), "Q?", "R", None).unwrap_err();
        assert!(e.contains("ask the user in the conversation"), "{e}");
        link(&conn, "task_id", 1, None, Some("2026-11-13 08:00:00"));
        assert!(ask(&dir, &org, Some(1), None, "Q?", "R", None).is_err());
        assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM needs_you"), 0);
        assert!(log_lines(&dir).is_empty());
    }

    #[test]
    fn ask_on_a_watcher_link_of_a_subtask_waits_for_the_lead() {
        let (dir, org, conn) = fixture();
        link(&conn, "subtask_id", 2, Some("watcher"), None);
        let a = ask(&dir, &org, None, Some(2), "Q?", "R", None).unwrap();
        assert_eq!(row(&conn, a.id).1.as_deref(), Some("waiting"));
    }

    #[test]
    fn a_second_open_question_on_the_same_link_is_refused() {
        let (dir, org, conn) = fixture();
        link(&conn, "task_id", 1, None, None);
        let a = ask(&dir, &org, Some(1), None, "Q?", "R", None).unwrap();
        let e = ask(&dir, &org, Some(1), None, "Q2?", "R", None).unwrap_err();
        assert_eq!(e, "A question is already waiting on this item.");
        assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM needs_you"), 1);
        conn.execute("UPDATE needs_you SET status = 'answered' WHERE id = ?1", [a.id]).unwrap();
        ask(&dir, &org, Some(1), None, "Q3?", "R", None).unwrap();
    }

    #[test]
    fn ask_on_a_hand_link_has_no_lead_state() {
        let (dir, org, conn) = fixture();
        let l = link(&conn, "task_id", 1, None, None);
        let b = ask(&dir, &org, Some(1), None, "Q?", "R", None).unwrap();
        let (link_id, state, ..) = row(&conn, b.id);
        assert_eq!((link_id, state), (Some(l), None));
    }

    #[test]
    fn ask_bad_input_writes_nothing() {
        let (dir, org, conn) = fixture();
        let long = "x".repeat(2001);
        let too_long_option = vec!["y".repeat(81)];
        type Case<'a> = (Option<i64>, Option<i64>, &'a str, &'a str, Option<Vec<String>>, &'a str);
        let cases: Vec<Case> = vec![
            (Some(1), Some(1), "Q", "R", None, ONE_ID),
            (None, None, "Q", "R", None, ONE_ID),
            (Some(99), None, "Q", "R", None, "No task with id 99."),
            (None, Some(99), "Q", "R", None, "No subtask with id 99."),
            (Some(1), None, &long, "R", None, "Question too long"),
            (Some(1), None, " ", "R", None, "Question can't be empty."),
            (Some(1), None, "Q", " ", None, "Recommendation can't be empty."),
            (Some(1), None, "Q", &long, None, "Recommendation too long"),
            (Some(1), None, "Q", "R", Some(opts(7)), "Give at most 6 options."),
            (Some(1), None, "Q", "R", Some(too_long_option), "Each option must be"),
        ];
        for (t, s, q, r, o, want) in cases {
            let e = ask(&dir, &org, t, s, q, r, o.as_deref()).unwrap_err();
            assert!(e.starts_with(want), "{e}");
        }
        let n: i64 = one(&conn, "SELECT COUNT(*) FROM needs_you");
        assert_eq!(n, 0);
        assert!(log_lines(&dir).is_empty());
        link(&conn, "task_id", 1, None, None);
        ask(&dir, &org, Some(1), None, &"x".repeat(2000), "R", Some(&opts(6))).unwrap();
    }

    #[test]
    fn ask_is_refused_in_test_mode() {
        let (dir, org, conn) = fixture();
        std::fs::write(org.db.with_file_name("studiomanager_test.db"), "").unwrap();
        let e = ask(&dir, &org, Some(1), None, "Q", "R", None).unwrap_err();
        assert_eq!(e, guard::MODE_ACTIVE);
        assert_eq!(one::<i64>(&conn, "SELECT COUNT(*) FROM needs_you"), 0);
    }

    #[test]
    fn resolve_answers_but_never_touches_the_task() {
        let (dir, org, conn) = fixture();
        conn.execute("UPDATE tasks SET stage = 'running' WHERE id = 1", []).unwrap();
        let id = entry(&conn, "decide", Some("running"));
        let r = resolve(&dir, &org, id, "Use A4", "Brief says print").unwrap();
        assert_eq!((r.id, r.status.as_str()), (id, "answered"));
        type Got = (String, String, String, String, Option<String>, String);
        let got: Got = conn
            .query_row(
                "SELECT status, decided_by, answer, reason, delivered_at, lead_state FROM needs_you WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
            )
            .unwrap();
        assert_eq!(
            got,
            ("answered".into(), "lead".into(), "Use A4".into(), "Brief says print".into(), None, "done".into())
        );
        let at: Option<String> =
            one(&conn, &format!("SELECT answered_at FROM needs_you WHERE id = {id}"));
        assert!(at.is_some());
        let (stage, status): (String, String) = conn
            .query_row("SELECT stage, status FROM tasks WHERE id = 1", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!((stage.as_str(), status.as_str()), ("running", "in_progress"));
        assert_eq!(log_lines(&dir)[0]["tool"], "resolve");
    }

    #[test]
    fn resolve_refuses_answered_or_not_running_rows() {
        let (dir, org, conn) = fixture();
        let waiting = entry(&conn, "decide", Some("waiting"));
        let none = entry(&conn, "decide", None);
        let done = entry(&conn, "decide", Some("running"));
        conn.execute("UPDATE needs_you SET status = 'answered' WHERE id = ?1", [done]).unwrap();
        for id in [waiting, none, done] {
            assert!(resolve(&dir, &org, id, "A", "R").is_err());
        }
        assert!(resolve(&dir, &org, 999, "A", "R").unwrap_err().starts_with("No entry"));
        let n: i64 = one(&conn, "SELECT COUNT(*) FROM needs_you WHERE decided_by IS NOT NULL");
        assert_eq!(n, 0);
        assert!(log_lines(&dir).is_empty());
    }

    #[test]
    fn resolve_a_check_takes_accept_or_send_back() {
        let (dir, org, conn) = fixture();
        let id = entry(&conn, "check", Some("running"));
        for bad in ["fine", "send_back:", "send_back:  "] {
            assert!(resolve(&dir, &org, id, bad, "R").unwrap_err().starts_with("For a check"), "{bad}");
        }
        resolve(&dir, &org, id, "send_back: fix the margins", "R").unwrap();
        let id2 = entry(&conn, "check", Some("running"));
        resolve(&dir, &org, id2, "accept", "R").unwrap();
        let long = "x".repeat(4001);
        let id3 = entry(&conn, "decide", Some("running"));
        assert!(resolve(&dir, &org, id3, &long, "R").unwrap_err().starts_with("Answer too long"));
        resolve(&dir, &org, id3, &"x".repeat(4000), "R").unwrap();
    }

    #[test]
    fn hand_over_keeps_the_entry_open_for_loris() {
        let (dir, org, conn) = fixture();
        let id = entry(&conn, "decide", Some("running"));
        let r = hand_over(&dir, &org, id, "Go with B", "Touches pricing", Some(&opts(2)), Some(true)).unwrap();
        assert_eq!(r.status, "open");
        type Got = (String, Option<String>, String, String, String, i64, Option<String>);
        let got: Got = conn
            .query_row(
                "SELECT status, answer, recommendation, reason, lead_state, is_decision, decided_by FROM needs_you WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
            )
            .unwrap();
        assert_eq!(
            got,
            ("open".into(), None, "Go with B".into(), "Touches pricing".into(), "done".into(), 1, None)
        );
        // Not running any more: a second hand over is refused.
        assert!(hand_over(&dir, &org, id, "x", "y", None, None).is_err());
        assert_eq!(log_lines(&dir)[0]["tool"], "hand_over");
    }

    #[test]
    fn lead_tools_are_refused_in_test_mode() {
        let (dir, org, conn) = fixture();
        let id = entry(&conn, "decide", Some("running"));
        std::fs::write(org.db.with_file_name("studiomanager_test.db"), "").unwrap();
        assert_eq!(resolve(&dir, &org, id, "A", "R").unwrap_err(), guard::MODE_ACTIVE);
        assert_eq!(hand_over(&dir, &org, id, "A", "R", None, None).unwrap_err(), guard::MODE_ACTIVE);
    }
}
