use super::*;

pub(super) fn task_result(conn: &Connection, org: &Org, id: i64) -> R<TaskResult> {
    db(conn
        .query_row(
            "SELECT t.id, t.title, t.status, t.priority, t.due_date, t.project_id, p.name \
             FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ?1",
            [id],
            |r| {
                Ok(TaskResult {
                    org: org.name.clone(),
                    id: r.get(0)?,
                    title: r.get(1)?,
                    status: r.get(2)?,
                    priority: r.get(3)?,
                    due_date: r.get(4)?,
                    project_id: r.get(5)?,
                    project: r.get(6)?,
                })
            },
        )
        .optional())?
    .ok_or_else(|| format!("No task with id {id}."))
}

pub(super) fn subtask_result(conn: &Connection, org: &Org, id: i64) -> R<SubtaskResult> {
    db(conn
        .query_row(
            "SELECT s.id, s.title, s.status, s.due_date, s.task_id, t.title \
             FROM subtasks s JOIN tasks t ON t.id = s.task_id WHERE s.id = ?1",
            [id],
            |r| {
                Ok(SubtaskResult {
                    org: org.name.clone(),
                    id: r.get(0)?,
                    title: r.get(1)?,
                    status: r.get(2)?,
                    due_date: r.get(3)?,
                    task_id: r.get(4)?,
                    task: r.get(5)?,
                })
            },
        )
        .optional())?
    .ok_or_else(|| format!("No subtask with id {id}."))
}

pub fn create_task(
    dir: &Path,
    org: &Org,
    project: &str,
    title: &str,
    due_date: Option<&str>,
    priority: Option<&str>,
    notes: Option<&str>,
) -> R<TaskResult> {
    let title = required(title, "Title")?;
    let due = optional_date(due_date)?;
    let prio = parse_priority(priority.unwrap_or("medium"))?;
    let notes = capped(notes.unwrap_or(""), "Notes")?.to_string();
    write(dir, org, "create_task", |tx| {
        let pid = read::resolve_project(tx, project)?;
        let order = next_sort_order(tx, "tasks", "project_id", pid)?;
        db(tx.execute(
            "INSERT INTO tasks (project_id, title, status, priority, due_date, notes, sort_order) \
             VALUES (?1, ?2, 'todo', ?3, ?4, ?5, ?6)",
            params![pid, title, prio, due, notes, order],
        ))?;
        let r = task_result(tx, org, tx.last_insert_rowid())?;
        let summary = format!(
            "Created task \"{title}\" (id {}) in project \"{}\"",
            r.id, r.project
        );
        Ok((r, Some(summary)))
    })
}

pub fn update_task(dir: &Path, org: &Org, task_id: i64, changes: &TaskChanges) -> R<TaskResult> {
    let mut sets: Vec<(&'static str, Value)> = Vec::new();
    if let Some(t) = &changes.title {
        sets.push(("title", Value::Text(required(t, "Title")?)));
    }
    if let Some(s) = &changes.status {
        sets.push(("status", Value::Text(task_status(s)?.to_string())));
    }
    if let Some(d) = &changes.due_date {
        sets.push(("due_date", date_value(d)?));
    }
    if let Some(p) = &changes.priority {
        sets.push(("priority", Value::Text(parse_priority(p)?.to_string())));
    }
    if let Some(n) = &changes.notes {
        sets.push(("notes", Value::Text(capped(n, "Notes")?.to_string())));
    }
    if sets.is_empty() {
        return Err(NOTHING.to_string());
    }
    write(dir, org, "update_task", |tx| {
        task_result(tx, org, task_id)?;
        let changed = columns(&sets);
        update_row(tx, "tasks", task_id, sets)?;
        let r = task_result(tx, org, task_id)?;
        let summary = format!(
            "Updated task \"{}\" (id {task_id}) in project \"{}\": {changed}",
            r.title, r.project
        );
        Ok((r, Some(summary)))
    })
}

pub fn create_subtask(
    dir: &Path,
    org: &Org,
    task_id: i64,
    title: &str,
    due_date: Option<&str>,
) -> R<SubtaskResult> {
    let title = required(title, "Title")?;
    let due = optional_date(due_date)?;
    write(dir, org, "create_subtask", |tx| {
        task_result(tx, org, task_id)?;
        let order = next_sort_order(tx, "subtasks", "task_id", task_id)?;
        db(tx.execute(
            "INSERT INTO subtasks (task_id, title, status, due_date, sort_order) \
             VALUES (?1, ?2, 'todo', ?3, ?4)",
            params![task_id, title, due, order],
        ))?;
        let r = subtask_result(tx, org, tx.last_insert_rowid())?;
        let summary = format!(
            "Created subtask \"{title}\" (id {}) under task \"{}\" (id {task_id})",
            r.id, r.task
        );
        Ok((r, Some(summary)))
    })
}

pub fn update_subtask(
    dir: &Path,
    org: &Org,
    subtask_id: i64,
    changes: &SubtaskChanges,
) -> R<SubtaskResult> {
    let mut sets: Vec<(&'static str, Value)> = Vec::new();
    if let Some(t) = &changes.title {
        sets.push(("title", Value::Text(required(t, "Title")?)));
    }
    if let Some(s) = &changes.status {
        sets.push(("status", Value::Text(task_status(s)?.to_string())));
    }
    if let Some(d) = &changes.due_date {
        sets.push(("due_date", date_value(d)?));
    }
    if sets.is_empty() {
        return Err(NOTHING.to_string());
    }
    write(dir, org, "update_subtask", |tx| {
        subtask_result(tx, org, subtask_id)?;
        let changed = columns(&sets);
        update_row(tx, "subtasks", subtask_id, sets)?;
        let r = subtask_result(tx, org, subtask_id)?;
        let summary = format!(
            "Updated subtask \"{}\" (id {subtask_id}) under task \"{}\": {changed}",
            r.title, r.task
        );
        Ok((r, Some(summary)))
    })
}

// ── Clients ──────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use crate::write::test_util::*;
    use crate::write::*;
    use super::*;

    #[test]
    fn create_task_happy_path() {
        let (dir, org, conn) = fixture();
        let r = create_task(
            &dir,
            &org,
            "Identite Visuelle",
            "Print proofs",
            Some("2026-11-02"),
            Some("high"),
            Some("Check paper"),
        )
        .unwrap();
        assert_eq!(r.org, "Studio");
        assert_eq!(r.project_id, 1);
        assert_eq!(r.project, "Identité Visuelle");
        assert_eq!(r.status, "todo");
        assert_eq!(r.priority.as_deref(), Some("high"));
        assert_eq!(r.due_date.as_deref(), Some("2026-11-02"));
        let notes: String = one(
            &conn,
            &format!("SELECT notes FROM tasks WHERE id = {}", r.id),
        );
        assert_eq!(notes, "Check paper");
        let r = create_task(&dir, &org, "3", "Grid", None, None, None).unwrap();
        assert_eq!(r.priority.as_deref(), Some("medium"));
        assert_eq!(
            create_task(&dir, &org, "3", "Grid", None, Some("urgent"), None).unwrap_err(),
            "Priority must be low, medium or high."
        );
        assert_eq!(
            create_task(&dir, &org, "3", "  ", None, None, None).unwrap_err(),
            "Title can't be empty."
        );
    }

    #[test]
    fn sort_order_max_plus_one() {
        let (dir, org, conn) = fixture();
        let t = create_task(&dir, &org, "1", "Next", None, None, None).unwrap();
        let so: i64 = one(
            &conn,
            &format!("SELECT sort_order FROM tasks WHERE id = {}", t.id),
        );
        assert_eq!(so, 5);
        // Empty project: starts at 0, like the app.
        let t = create_task(&dir, &org, "3", "First", None, None, None).unwrap();
        let so: i64 = one(
            &conn,
            &format!("SELECT sort_order FROM tasks WHERE id = {}", t.id),
        );
        assert_eq!(so, 0);
        let s = create_subtask(&dir, &org, 1, "Gold foil", None).unwrap();
        let so: i64 = one(
            &conn,
            &format!("SELECT sort_order FROM subtasks WHERE id = {}", s.id),
        );
        assert_eq!(so, 8);
    }

    #[test]
    fn update_task_happy_path() {
        let (dir, org, conn) = fixture();
        let r = update_task(
            &dir,
            &org,
            2,
            &TaskChanges {
                status: Some("done".into()),
                priority: Some("medium".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(r.status, "done");
        assert_eq!(r.priority.as_deref(), Some("medium"));
        assert_eq!(r.title, "Final files");
        let r = update_task(
            &dir,
            &org,
            1,
            &TaskChanges {
                title: Some("Logo set".into()),
                due_date: Some(String::new()),
                notes: Some("n".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(r.title, "Logo set");
        assert_eq!(r.due_date, None);
        assert_eq!(r.status, "in_progress", "untouched status is kept");
        let notes: String = one(&conn, "SELECT notes FROM tasks WHERE id = 1");
        assert_eq!(notes, "n");
        assert_eq!(
            update_task(
                &dir,
                &org,
                99,
                &TaskChanges {
                    title: Some("x".into()),
                    ..Default::default()
                }
            )
            .unwrap_err(),
            "No task with id 99."
        );
    }

    #[test]
    fn status_in_progress_rejected() {
        let (dir, org, conn) = fixture();
        let err = update_task(
            &dir,
            &org,
            2,
            &TaskChanges {
                status: Some("in_progress".into()),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert_eq!(err, "Status must be \"todo\" or \"done\".");
        let err = update_subtask(
            &dir,
            &org,
            1,
            &SubtaskChanges {
                status: Some("in_progress".into()),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert_eq!(err, "Status must be \"todo\" or \"done\".");
        let s: String = one(&conn, "SELECT status FROM tasks WHERE id = 2");
        assert_eq!(s, "todo");
    }

    #[test]
    fn subtask_happy_path() {
        let (dir, org, conn) = fixture();
        let s = create_subtask(&dir, &org, 2, "Export PDF", Some("2026-11-01")).unwrap();
        assert_eq!(s.org, "Studio");
        assert_eq!(s.task_id, 2);
        assert_eq!(s.task, "Final files");
        assert_eq!(s.status, "todo");
        assert_eq!(s.due_date.as_deref(), Some("2026-11-01"));
        let so: i64 = one(
            &conn,
            &format!("SELECT sort_order FROM subtasks WHERE id = {}", s.id),
        );
        assert_eq!(so, 0);
        let u = update_subtask(
            &dir,
            &org,
            s.id,
            &SubtaskChanges {
                status: Some("done".into()),
                title: Some("Export PDF/X".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(u.status, "done");
        assert_eq!(u.title, "Export PDF/X");
        assert_eq!(u.due_date.as_deref(), Some("2026-11-01"));
        assert_eq!(
            create_subtask(&dir, &org, 99, "x", None).unwrap_err(),
            "No task with id 99."
        );
        assert_eq!(
            update_subtask(
                &dir,
                &org,
                99,
                &SubtaskChanges {
                    status: Some("done".into()),
                    ..Default::default()
                }
            )
            .unwrap_err(),
            "No subtask with id 99."
        );
    }

    #[test]
    fn never_touches_calendar_or_workload_columns() {
        let (dir, org, conn) = fixture();
        conn.execute_batch(
            "UPDATE projects SET calendar_deadline_id = 'cal-p', workload_columns = '[1]', \
               workload_template_id = 4, layout_config = '{\"a\":1}' WHERE id = 1;
             UPDATE tasks SET calendar_event_id = 'cal-t', workload_cells = '{\"x\":2}', \
               workload_sort_order = 6, tracked_minutes = 42, planned_minutes = 90 WHERE id = 1;
             UPDATE subtasks SET calendar_event_id = 'cal-s' WHERE id = 1;",
        )
        .unwrap();
        let snapshot = |conn: &Connection| -> Vec<String> {
            vec![
                one(conn, "SELECT calendar_deadline_id || workload_columns || workload_template_id || layout_config FROM projects WHERE id = 1"),
                one(conn, "SELECT calendar_event_id || workload_cells || workload_sort_order || tracked_minutes || planned_minutes FROM tasks WHERE id = 1"),
                one(conn, "SELECT calendar_event_id FROM subtasks WHERE id = 1"),
            ]
        };
        let before = snapshot(&conn);
        update_project(
            &dir,
            &org,
            "1",
            &ProjectChanges {
                status: Some("on_hold".into()),
                deadline: Some("2026-12-24".into()),
                notes: Some("x".into()),
                folder_path: Some(real_folder(&dir, "x")),
            },
        )
        .unwrap();
        link_folder(&dir, &org, "1", &real_folder(&dir, "y")).unwrap();
        update_task(
            &dir,
            &org,
            1,
            &TaskChanges {
                title: Some("t".into()),
                status: Some("done".into()),
                due_date: Some("2026-12-01".into()),
                priority: Some("low".into()),
                notes: Some("n".into()),
            },
        )
        .unwrap();
        update_subtask(
            &dir,
            &org,
            1,
            &SubtaskChanges {
                title: Some("s".into()),
                status: Some("done".into()),
                due_date: Some("2026-12-02".into()),
            },
        )
        .unwrap();
        assert_eq!(snapshot(&conn), before);
    }

    #[test]
    fn updated_at_bumped() {
        let (dir, org, conn) = fixture();
        conn.execute_batch(
            "UPDATE projects SET updated_at = '2000-01-01 00:00:00';
             UPDATE tasks SET updated_at = '2000-01-01 00:00:00';
             UPDATE subtasks SET updated_at = '2000-01-01 00:00:00';",
        )
        .unwrap();
        update_project(
            &dir,
            &org,
            "2",
            &ProjectChanges {
                notes: Some("n".into()),
                ..Default::default()
            },
        )
        .unwrap();
        link_folder(&dir, &org, "3", &real_folder(&dir, "c")).unwrap();
        update_task(
            &dir,
            &org,
            1,
            &TaskChanges {
                notes: Some("n".into()),
                ..Default::default()
            },
        )
        .unwrap();
        update_subtask(
            &dir,
            &org,
            1,
            &SubtaskChanges {
                title: Some("m".into()),
                ..Default::default()
            },
        )
        .unwrap();
        for (table, id) in [
            ("projects", 2),
            ("projects", 3),
            ("tasks", 1),
            ("subtasks", 1),
        ] {
            let at: String = one(
                &conn,
                &format!("SELECT updated_at FROM {table} WHERE id = {id}"),
            );
            assert_ne!(at, "2000-01-01 00:00:00", "{table} {id}");
        }
        // Rows not targeted keep their timestamp.
        let at: String = one(&conn, "SELECT updated_at FROM projects WHERE id = 1");
        assert_eq!(at, "2000-01-01 00:00:00");
    }

    #[test]
    fn invalid_dates_rejected() {
        let (dir, org, _conn) = fixture();
        for bad in ["2026-13-01", "2026-1-5", "tomorrow", "2026-02-30"] {
            assert_eq!(
                create_task(&dir, &org, "1", "x", Some(bad), None, None).unwrap_err(),
                "Dates use YYYY-MM-DD.",
                "{bad}"
            );
        }
        assert_eq!(
            create_subtask(&dir, &org, 1, "x", Some("01/02/2026")).unwrap_err(),
            "Dates use YYYY-MM-DD."
        );
    }

}
