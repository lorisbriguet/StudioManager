use super::*;

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

#[cfg(test)]
mod tests {
    use crate::read::test_util::*;
    use super::*;

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

}
