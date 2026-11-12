use super::tasks::{subtask_result, task_result};
use super::*;

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct CaptureResult {
    pub org: String,
    pub id: i64,
    pub status: String,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct FiledCapture {
    pub org: String,
    pub capture_id: i64,
    /// "filed", or "new" when it was left in the inbox.
    pub status: String,
    /// The reason it stayed in the inbox.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inbox_reason: Option<String>,
    /// "task" or "subtask".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<String>,
}

/// What `file_capture` does with a capture: leave it in the inbox with a
/// `reason` (no `project`), or file it under `project` as a task, or as a
/// subtask of `task`.
#[derive(Deserialize, Default, Debug, Clone)]
pub struct Filing {
    pub project: Option<String>,
    pub task: Option<i64>,
    pub title: Option<String>,
    pub brief: Option<String>,
    pub outcome: Option<String>,
    pub reason: Option<String>,
}

/// Either row `set_brief` may have changed.
#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(untagged)]
pub enum BriefResult {
    Task(TaskResult),
    Subtask(SubtaskResult),
}

pub const OUTCOME: &str = "Outcome must be note, needs_word or ready.";
pub const ONE_ID: &str = "Give either task_id or subtask_id.";
const MAX_TITLE: usize = 200;

fn outcome(s: &str) -> R<&'static str> {
    match s.trim() {
        "note" => Ok("note"),
        "needs_word" => Ok("needs_word"),
        "ready" => Ok("ready"),
        _ => Err(OUTCOME.to_string()),
    }
}

/// The stage a new row starts in: only a note has none.
fn stage_of(outcome: &str) -> Option<&'static str> {
    match outcome {
        "needs_word" => Some("briefed"),
        "ready" => Some("ready"),
        _ => None,
    }
}

pub fn capture(dir: &Path, org: &Org, text: &str, project: Option<&str>) -> R<CaptureResult> {
    let text = required(text, "Text")?;
    let project = project.map(str::trim).filter(|p| !p.is_empty());
    write(dir, org, "capture", |tx| {
        let pid = match project {
            Some(p) => Some(read::resolve_project(tx, p)?),
            None => None,
        };
        db(tx.execute(
            "INSERT INTO captures (text, source, project_id) VALUES (?1, 'agent', ?2)",
            params![text, pid],
        ))?;
        let id = tx.last_insert_rowid();
        let head: String = text.chars().take(60).collect();
        let summary = format!("Captured \"{head}\" (id {id})");
        let r = CaptureResult {
            org: org.name.clone(),
            id,
            status: "new".into(),
        };
        Ok((r, Some(summary)))
    })
}

pub fn file_capture(dir: &Path, org: &Org, capture_id: i64, filing: &Filing) -> R<FiledCapture> {
    let project = filing.project.as_deref().map(str::trim).filter(|p| !p.is_empty());
    let outcome = filing.outcome.as_deref().map(outcome).transpose()?;
    // Checked before the write, so a refusal leaves no backup and no log line.
    let reason = match project {
        None => Some(required(filing.reason.as_deref().unwrap_or(""), "Reason")?),
        Some(_) => None,
    };
    let filed = match project {
        Some(_) => {
            let title = required(filing.title.as_deref().unwrap_or(""), "Title")?;
            if title.chars().count() > MAX_TITLE {
                return Err(format!("Title too long (over {MAX_TITLE} characters)."));
            }
            let brief = capped(
                filing.brief.as_deref().ok_or("Brief is required.")?,
                "Brief",
            )?
            .to_string();
            let outcome = outcome.ok_or(OUTCOME)?;
            Some((title, brief, outcome))
        }
        None => None,
    };
    write(dir, org, "file_capture", |tx| {
        let (text, status, created_at): (String, String, String) = db(tx
            .query_row(
                "SELECT text, status, created_at FROM captures WHERE id = ?1",
                [capture_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional())?
        .ok_or_else(|| format!("No capture with id {capture_id}."))?;
        match status.as_str() {
            "filed" => return Err(format!("Capture {capture_id} is already filed.")),
            "dismissed" => return Err(format!("Capture {capture_id} is already dismissed.")),
            _ => {}
        }
        let (Some(project), Some((title, brief, outcome))) = (project, filed) else {
            let reason = reason.unwrap_or_default();
            update_row(tx, "captures", capture_id, vec![("inbox_reason", Value::Text(reason.clone()))])?;
            let summary = format!("Left capture {capture_id} in the inbox: {reason}");
            let r = FiledCapture {
                org: org.name.clone(),
                capture_id,
                status: "new".into(),
                inbox_reason: Some(reason),
                kind: None,
                id: None,
                title: None,
                project: None,
                outcome: None,
            };
            return Ok((r, Some(summary)));
        };
        let pid = read::resolve_project(tx, project)?;
        let stage = stage_of(outcome).map(str::to_string);
        let mut sets: Vec<(&'static str, Value)> = vec![
            ("status", Value::Text("filed".into())),
            ("project_id", Value::Integer(pid)),
            ("outcome", Value::Text(outcome.to_string())),
        ];
        let (kind, id, project_name) = match filing.task {
            Some(task_id) => {
                let t = task_result(tx, org, task_id)?;
                if t.project_id != pid || t.status == "done" {
                    let name: String = db(tx.query_row(
                        "SELECT name FROM projects WHERE id = ?1",
                        [pid],
                        |r| r.get(0),
                    ))?;
                    return Err(format!(
                        "Task {task_id} is not an open task of project \"{name}\"."
                    ));
                }
                let order = next_sort_order(tx, "subtasks", "task_id", task_id)?;
                db(tx.execute(
                    "INSERT INTO subtasks (task_id, title, status, sort_order, brief, stage) \
                     VALUES (?1, ?2, 'todo', ?3, ?4, ?5)",
                    params![task_id, title, order, brief, stage],
                ))?;
                let id = tx.last_insert_rowid();
                sets.push(("task_id", Value::Integer(task_id)));
                sets.push(("subtask_id", Value::Integer(id)));
                ("subtask", id, t.project)
            }
            None => {
                let order = next_sort_order(tx, "tasks", "project_id", pid)?;
                let notes = format!("Captured {}: {text}", created_at.get(..10).unwrap_or(&created_at));
                db(tx.execute(
                    "INSERT INTO tasks (project_id, title, status, priority, notes, sort_order, brief, stage) \
                     VALUES (?1, ?2, 'todo', 'medium', ?3, ?4, ?5, ?6)",
                    params![pid, title, notes, order, brief, stage],
                ))?;
                let id = tx.last_insert_rowid();
                sets.push(("task_id", Value::Integer(id)));
                ("task", id, task_result(tx, org, id)?.project)
            }
        };
        update_row(tx, "captures", capture_id, sets)?;
        let summary = format!(
            "Filed capture {capture_id} as {kind} \"{title}\" (id {id}) in project \"{project_name}\", {outcome}"
        );
        let r = FiledCapture {
            org: org.name.clone(),
            capture_id,
            status: "filed".into(),
            inbox_reason: None,
            kind: Some(kind.to_string()),
            id: Some(id),
            title: Some(title),
            project: Some(project_name),
            outcome: Some(outcome.to_string()),
        };
        Ok((r, Some(summary)))
    })
}

pub fn set_brief(
    dir: &Path,
    org: &Org,
    task_id: Option<i64>,
    subtask_id: Option<i64>,
    brief: &str,
) -> R<BriefResult> {
    let brief = capped(brief, "Brief")?.to_string();
    if task_id.is_some() == subtask_id.is_some() {
        return Err(ONE_ID.to_string());
    }
    write(dir, org, "set_brief", |tx| {
        let sets = vec![("brief", Value::Text(brief))];
        match (task_id, subtask_id) {
            (Some(id), None) => {
                task_result(tx, org, id)?;
                update_row(tx, "tasks", id, sets)?;
                let r = task_result(tx, org, id)?;
                let summary = format!("Set the brief of task \"{}\" (id {id})", r.title);
                Ok((BriefResult::Task(r), Some(summary)))
            }
            (None, Some(id)) => {
                subtask_result(tx, org, id)?;
                update_row(tx, "subtasks", id, sets)?;
                let r = subtask_result(tx, org, id)?;
                let summary = format!("Set the brief of subtask \"{}\" (id {id})", r.title);
                Ok((BriefResult::Subtask(r), Some(summary)))
            }
            _ => Err(ONE_ID.to_string()),
        }
    })
}

#[cfg(test)]
mod tests {
    use crate::write::test_util::*;
    use crate::write::*;
    use super::*;

    fn filing(project: &str, outcome: &str) -> Filing {
        Filing {
            project: Some(project.into()),
            title: Some("Poster tool".into()),
            brief: Some("Build it. Done when it prints.".into()),
            outcome: Some(outcome.into()),
            ..Default::default()
        }
    }

    #[test]
    fn capture_adds_a_new_row() {
        let (dir, org, conn) = fixture();
        let r = capture(&dir, &org, "  Try a wider grid  ", Some("Identite Visuelle")).unwrap();
        assert_eq!((r.org.as_str(), r.status.as_str()), ("Studio", "new"));
        let (text, source, status, pid): (String, String, String, Option<i64>) = conn
            .query_row(
                "SELECT text, source, status, project_id FROM captures WHERE id = ?1",
                [r.id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!((text.as_str(), source.as_str(), status.as_str()), ("Try a wider grid", "agent", "new"));
        assert_eq!(pid, Some(1));
        let r = capture(&dir, &org, "No hint", None).unwrap();
        let pid: Option<i64> = one(&conn, &format!("SELECT project_id FROM captures WHERE id = {}", r.id));
        assert_eq!(pid, None);
        assert_eq!(capture(&dir, &org, "  ", None).unwrap_err(), "Text can't be empty.");
        assert!(capture(&dir, &org, "x", Some("Nope")).is_err());
        let lines = log_lines(&dir);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0]["tool"], "capture");
        assert!(lines[0]["summary"].as_str().unwrap().starts_with("Captured \"Try a wider grid\" (id "));
        // The first write took the backup.
        assert!(dir.join("backups").join("agent").exists());
    }

    #[test]
    fn capture_refused_in_test_mode() {
        let (dir, org, conn) = fixture();
        std::fs::write(org.db.with_file_name("studiomanager_test.db"), "").unwrap();
        assert_eq!(capture(&dir, &org, "x", None).unwrap_err(), guard::MODE_ACTIVE);
        let n: i64 = one(&conn, "SELECT COUNT(*) FROM captures");
        assert_eq!(n, 0);
    }

    #[test]
    fn file_to_a_new_task() {
        let (dir, org, conn) = fixture();
        for (outcome, stage) in [("needs_word", Some("briefed")), ("ready", Some("ready")), ("note", None)] {
            let c = capture(&dir, &org, "Try a wider grid", None).unwrap();
            let r = file_capture(&dir, &org, c.id, &filing("Identite Visuelle", outcome)).unwrap();
            assert_eq!((r.kind.as_deref(), r.status.as_str()), (Some("task"), "filed"));
            assert_eq!(r.project.as_deref(), Some("Identité Visuelle"));
            assert_eq!(r.outcome.as_deref(), Some(outcome));
            let (title, notes, brief, st, status): (String, String, String, Option<String>, String) = conn
                .query_row(
                    "SELECT title, notes, brief, stage, status FROM tasks WHERE id = ?1",
                    [r.id.unwrap()],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
                )
                .unwrap();
            assert_eq!(title, "Poster tool");
            let today: String = one(&conn, "SELECT date('now')");
            assert_eq!(notes, format!("Captured {today}: Try a wider grid"));
            assert_eq!(brief, "Build it. Done when it prints.");
            assert_eq!(st.as_deref(), stage);
            assert_eq!(status, "todo");
            let (cs, tid, sid, out, pid): (String, Option<i64>, Option<i64>, String, Option<i64>) = conn
                .query_row(
                    "SELECT status, task_id, subtask_id, outcome, project_id FROM captures WHERE id = ?1",
                    [c.id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
                )
                .unwrap();
            assert_eq!((cs.as_str(), tid, sid, out.as_str(), pid), ("filed", r.id, None, outcome, Some(1)));
        }
        let lines = log_lines(&dir);
        assert_eq!(lines.iter().filter(|l| l["tool"] == "file_capture").count(), 3);
    }

    #[test]
    fn file_to_a_subtask() {
        let (dir, org, conn) = fixture();
        let c = capture(&dir, &org, "Add a gold foil version", None).unwrap();
        let mut f = filing("1", "ready");
        f.task = Some(1);
        let r = file_capture(&dir, &org, c.id, &f).unwrap();
        assert_eq!(r.kind.as_deref(), Some("subtask"));
        let (task_id, brief, stage, order): (i64, String, Option<String>, i64) = conn
            .query_row(
                "SELECT task_id, brief, stage, sort_order FROM subtasks WHERE id = ?1",
                [r.id.unwrap()],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!((task_id, order), (1, 8));
        assert_eq!((brief.as_str(), stage.as_deref()), ("Build it. Done when it prints.", Some("ready")));
        let (tid, sid): (Option<i64>, Option<i64>) = conn
            .query_row("SELECT task_id, subtask_id FROM captures WHERE id = ?1", [c.id], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!((tid, sid), (Some(1), r.id));
    }

    #[test]
    fn a_task_of_another_project_or_a_done_one_is_refused() {
        let (dir, org, conn) = fixture();
        conn.execute("UPDATE tasks SET status = 'done' WHERE id = 2", []).unwrap();
        let c = capture(&dir, &org, "x", None).unwrap();
        let before: i64 = one(&conn, "SELECT COUNT(*) FROM subtasks");
        let mut f = filing("Catalogue Printemps", "note");
        f.task = Some(1);
        assert_eq!(
            file_capture(&dir, &org, c.id, &f).unwrap_err(),
            "Task 1 is not an open task of project \"Catalogue Printemps\"."
        );
        let mut f = filing("Identite Visuelle", "note");
        f.task = Some(2);
        assert!(file_capture(&dir, &org, c.id, &f).unwrap_err().contains("not an open task"));
        f.task = Some(99);
        assert_eq!(file_capture(&dir, &org, c.id, &f).unwrap_err(), "No task with id 99.");
        let after: i64 = one(&conn, "SELECT COUNT(*) FROM subtasks");
        let tasks: i64 = one(&conn, "SELECT COUNT(*) FROM tasks");
        let status: String = one(&conn, &format!("SELECT status FROM captures WHERE id = {}", c.id));
        assert_eq!((before, tasks, status.as_str()), (after, 2, "new"));
    }

    #[test]
    fn no_project_needs_a_reason_and_stays_new() {
        let (dir, org, conn) = fixture();
        let c = capture(&dir, &org, "Something vague", None).unwrap();
        let none = Filing::default();
        assert_eq!(file_capture(&dir, &org, c.id, &none).unwrap_err(), "Reason can't be empty.");
        let f = Filing { reason: Some("No project fits".into()), ..Default::default() };
        let r = file_capture(&dir, &org, c.id, &f).unwrap();
        assert_eq!((r.status.as_str(), r.inbox_reason.as_deref()), ("new", Some("No project fits")));
        let (status, reason): (String, Option<String>) = conn
            .query_row("SELECT status, inbox_reason FROM captures WHERE id = ?1", [c.id], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!((status.as_str(), reason.as_deref()), ("new", Some("No project fits")));
        let last = log_lines(&dir).pop().unwrap();
        assert_eq!(last["summary"], format!("Left capture {} in the inbox: No project fits", c.id));
        let n: i64 = one(&conn, "SELECT COUNT(*) FROM tasks");
        assert_eq!(n, 2);
    }

    #[test]
    fn a_capture_no_longer_new_is_refused() {
        let (dir, org, conn) = fixture();
        let c = capture(&dir, &org, "x", None).unwrap();
        file_capture(&dir, &org, c.id, &filing("1", "note")).unwrap();
        let tasks: i64 = one(&conn, "SELECT COUNT(*) FROM tasks");
        let lines = log_lines(&dir).len();
        assert_eq!(
            file_capture(&dir, &org, c.id, &filing("1", "note")).unwrap_err(),
            format!("Capture {} is already filed.", c.id)
        );
        let d = capture(&dir, &org, "y", None).unwrap();
        conn.execute("UPDATE captures SET status = 'dismissed' WHERE id = ?1", [d.id]).unwrap();
        assert_eq!(
            file_capture(&dir, &org, d.id, &filing("1", "note")).unwrap_err(),
            format!("Capture {} is already dismissed.", d.id)
        );
        let reason = Filing { reason: Some("r".into()), ..Default::default() };
        assert!(file_capture(&dir, &org, d.id, &reason).is_err());
        assert_eq!(file_capture(&dir, &org, 99, &reason).unwrap_err(), "No capture with id 99.");
        let after: i64 = one(&conn, "SELECT COUNT(*) FROM tasks");
        assert_eq!((tasks, lines + 1), (after, log_lines(&dir).len()));
    }

    #[test]
    fn bad_outcome_title_or_brief_is_refused() {
        let (dir, org, conn) = fixture();
        let c = capture(&dir, &org, "x", None).unwrap();
        for o in ["running", "to_check", "briefed"] {
            assert_eq!(file_capture(&dir, &org, c.id, &filing("1", o)).unwrap_err(), OUTCOME);
        }
        let mut f = filing("1", "note");
        f.outcome = None;
        assert_eq!(file_capture(&dir, &org, c.id, &f).unwrap_err(), OUTCOME);
        let mut f = filing("1", "note");
        f.title = Some("t".repeat(201));
        assert!(file_capture(&dir, &org, c.id, &f).unwrap_err().contains("too long"));
        f.title = Some(" ".into());
        assert_eq!(file_capture(&dir, &org, c.id, &f).unwrap_err(), "Title can't be empty.");
        let mut f = filing("1", "note");
        f.brief = None;
        assert_eq!(file_capture(&dir, &org, c.id, &f).unwrap_err(), "Brief is required.");
        let status: String = one(&conn, &format!("SELECT status FROM captures WHERE id = {}", c.id));
        assert_eq!(status, "new");
    }

    #[test]
    fn set_brief_writes_only_the_brief() {
        let (dir, org, conn) = fixture();
        conn.execute("UPDATE tasks SET stage = 'ready' WHERE id = 1", []).unwrap();
        let row = |sql: &str| -> String {
            conn.query_row(sql, [], |r| Ok(format!("{:?}", (r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, Option<String>>(3)?))))
                .unwrap()
        };
        let t_sql = "SELECT title, status, due_date, stage FROM tasks WHERE id = 1";
        let s_sql = "SELECT title, status, due_date, stage FROM subtasks WHERE id = 1";
        let (t_before, s_before) = (row(t_sql), row(s_sql));
        let r = set_brief(&dir, &org, Some(1), None, "New task brief").unwrap();
        assert!(matches!(r, BriefResult::Task(ref t) if t.id == 1));
        let r = set_brief(&dir, &org, None, Some(1), "New subtask brief").unwrap();
        assert!(matches!(r, BriefResult::Subtask(ref s) if s.id == 1 && s.task_id == 1));
        assert_eq!((row(t_sql), row(s_sql)), (t_before, s_before));
        let b: String = one(&conn, "SELECT brief FROM tasks WHERE id = 1");
        assert_eq!(b, "New task brief");
        let b: String = one(&conn, "SELECT brief FROM subtasks WHERE id = 1");
        assert_eq!(b, "New subtask brief");
        assert_eq!(set_brief(&dir, &org, Some(1), Some(1), "x").unwrap_err(), ONE_ID);
        assert_eq!(set_brief(&dir, &org, None, None, "x").unwrap_err(), ONE_ID);
        assert_eq!(set_brief(&dir, &org, Some(99), None, "x").unwrap_err(), "No task with id 99.");
        assert_eq!(log_lines(&dir).len(), 2);
    }
}
