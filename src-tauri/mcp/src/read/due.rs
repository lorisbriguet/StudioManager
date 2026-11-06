use super::*;

fn parse_date(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s.get(..10)?, "%Y-%m-%d").ok()
}

/// Active upkeep items of machines still in service, with their effective due
/// date (a later snooze wins over next_due_on; no date, no entry).
/// Returns `((item title, machine id, machine name), date)`.
type UpkeepDue = ((String, i64, String), String);

fn upkeep_dues(conn: &Connection) -> R<Vec<UpkeepDue>> {
    let mut stmt = db(conn.prepare(
        "SELECT i.title, m.id, m.name, \
                CASE WHEN i.snooze_until IS NOT NULL AND (i.next_due_on IS NULL OR i.snooze_until > i.next_due_on) \
                     THEN i.snooze_until ELSE i.next_due_on END \
         FROM upkeep_items i JOIN machines m ON m.id = i.machine_id \
         WHERE i.archived = 0 AND m.status != 'retired'",
    ))?;
    let rows: Vec<(String, i64, String, Option<String>)> = db(stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .and_then(|rows| rows.collect()))?;
    Ok(rows
        .into_iter()
        .filter_map(|(t, id, m, d)| d.map(|d| ((t, id, m), d)))
        .collect())
}

/// Every machine with its next upkeep (earliest effective due date). Nothing
/// else: no serial, notes, files, readings or connection.
pub fn list_machines(conn: &Connection) -> R<Vec<MachineRef>> {
    let mut stmt = db(conn.prepare(
        "SELECT id, name, kind, status, COALESCE(location, '') FROM machines ORDER BY name COLLATE NOCASE",
    ))?;
    let mut machines: Vec<MachineRef> = db(stmt
        .query_map([], |r| {
            Ok(MachineRef {
                id: r.get(0)?,
                name: r.get(1)?,
                kind: r.get(2)?,
                status: r.get(3)?,
                location: r.get(4)?,
                next_upkeep: None,
            })
        })
        .and_then(|rows| rows.collect()))?;
    for ((title, id, _), due) in upkeep_dues(conn)? {
        if let Some(m) = machines.iter_mut().find(|m| m.id == id) {
            let better = m.next_upkeep.as_ref().is_none_or(|n| due < n.due);
            if better {
                m.next_upkeep = Some(NextUpkeep { title, due: due[..10.min(due.len())].to_string() });
            }
        }
    }
    Ok(machines)
}

/// Late or due within `days` of `today`, not done. Deadlines: active projects.
/// Tasks and subtasks: active or on-hold projects.
pub fn whats_due(conn: &Connection, days: i64, today: NaiveDate) -> R<Vec<DueItem>> {
    let mut items: Vec<DueItem> = Vec::new();
    let mut push =
        |kind: &str, date: Option<String>, title: String, project: String, client: String| {
            if let Some(d) = date.as_deref().and_then(parse_date) {
                let left = (d - today).num_days();
                if left <= days {
                    items.push(DueItem {
                        kind: kind.to_string(),
                        date: d.format("%Y-%m-%d").to_string(),
                        days_left: left,
                        title,
                        project,
                        client,
                    });
                }
            }
        };

    let queries: [(&str, &str); 3] = [
        (
            "deadline",
            "SELECT p.deadline, p.name, p.name, c.name FROM projects p JOIN clients c ON c.id = p.client_id \
             WHERE p.status = 'active' AND p.deadline IS NOT NULL",
        ),
        (
            "task",
            "SELECT t.due_date, t.title, p.name, c.name FROM tasks t \
             JOIN projects p ON p.id = t.project_id JOIN clients c ON c.id = p.client_id \
             WHERE p.status IN ('active','on_hold') AND t.status != 'done' AND t.due_date IS NOT NULL",
        ),
        (
            "subtask",
            "SELECT s.due_date, s.title, p.name, c.name FROM subtasks s \
             JOIN tasks t ON t.id = s.task_id \
             JOIN projects p ON p.id = t.project_id JOIN clients c ON c.id = p.client_id \
             WHERE p.status IN ('active','on_hold') AND s.status != 'done' AND s.due_date IS NOT NULL",
        ),
    ];
    for (kind, sql) in queries {
        let mut stmt = db(conn.prepare(sql))?;
        let rows: Vec<(String, String, String, String)> = db(stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .and_then(|rows| rows.collect()))?;
        for (date, title, project, client) in rows {
            push(kind, Some(date), title, project, client);
        }
    }
    for ((title, _, machine), due) in upkeep_dues(conn)? {
        push("upkeep", Some(due), format!("{title} · {machine}"), String::new(), String::new());
    }
    items.sort_by(|a, b| {
        a.date
            .cmp(&b.date)
            .then_with(|| fold(&a.title).cmp(&fold(&b.title)))
    });
    Ok(items)
}

#[cfg(test)]
mod tests {
    use crate::read::test_util::*;
    use super::*;

    #[test]
    fn whats_due_excludes_done_and_cancelled() {
        let c = fixture();
        let due = whats_due(&c, 7, d("2026-10-27")).unwrap();
        let got: Vec<(&str, &str, i64)> = due
            .iter()
            .map(|i| (i.kind.as_str(), i.title.as_str(), i.days_left))
            .collect();
        assert_eq!(
            got,
            vec![
                ("task", "Wireframes", -2), // on-hold project, late
                ("subtask", "Monochrome", 1),
                ("task", "Logo variants", 2),
            ]
        );
        // done task/subtask, cancelled project's task + deadline, far-off task all excluded
        let wide = whats_due(&c, 10, d("2026-10-27")).unwrap();
        assert!(wide
            .iter()
            .any(|i| i.kind == "deadline" && i.title == "Identité Visuelle" && i.days_left == 9));
        // the on-hold project's deadline is not listed
        assert!(!wide
            .iter()
            .any(|i| i.kind == "deadline" && i.title == "Site Web"));
        assert!(wide.iter().all(|i| i.title != "Cancelled work"
            && i.title != "Final files"
            && i.title != "Reversed"));
    }

    #[test]
    fn whats_due_sorts_by_date_then_title() {
        let c = fixture();
        c.execute(
            "INSERT INTO tasks (project_id, title, status, due_date) VALUES (1, 'Alpha', 'todo', '2026-10-29')",
            [],
        )
        .unwrap();
        let due = whats_due(&c, 7, d("2026-10-27")).unwrap();
        let titles: Vec<_> = due.iter().map(|i| i.title.as_str()).collect();
        assert_eq!(
            titles,
            ["Wireframes", "Monochrome", "Alpha", "Logo variants"]
        );
    }

    #[test]
    fn whats_due_includes_upkeep_items() {
        let c = fixture();
        c.execute_batch(
            "INSERT INTO machines (id, name, status) VALUES (1, 'NAS', 'working');
             INSERT INTO upkeep_items (machine_id, title, schedule, next_due_on, snooze_until) VALUES
               (1, 'Scrub volume', 'interval', '2026-10-26', NULL),
               (1, 'Clean fans', 'interval', '2026-10-27', '2026-10-29'),
               (1, 'Far away', 'interval', '2027-05-01', NULL),
               (1, 'Usage only', 'usage', NULL, NULL),
               (1, 'Old', 'interval', '2026-10-26', NULL);
             UPDATE upkeep_items SET archived = 1 WHERE title = 'Old';",
        )
        .unwrap();
        let due = whats_due(&c, 7, d("2026-10-27")).unwrap();
        let up: Vec<_> = due.iter().filter(|i| i.kind == "upkeep").collect();
        let titles: Vec<_> = up.iter().map(|i| i.title.as_str()).collect();
        assert_eq!(titles, ["Scrub volume · NAS", "Clean fans · NAS"]);
        assert_eq!(up[0].days_left, -1);
        assert_eq!(up[1].date, "2026-10-29");
        assert_eq!(up[0].project, "");
        assert_eq!(up[0].client, "");
    }

    #[test]
    fn retired_machine_items_not_due() {
        let c = fixture();
        c.execute_batch(
            "INSERT INTO machines (id, name, status) VALUES (1, 'Old printer', 'retired');
             INSERT INTO upkeep_items (machine_id, title, schedule, next_due_on) VALUES
               (1, 'Oil rails', 'interval', '2026-10-20');",
        )
        .unwrap();
        let due = whats_due(&c, 7, d("2026-10-27")).unwrap();
        assert!(due.iter().all(|i| i.kind != "upkeep"));
    }

    #[test]
    fn list_machines_has_next_upkeep() {
        let c = fixture();
        c.execute_batch(
            "INSERT INTO machines (id, name, kind, status, location, serial, lent_to, notes) VALUES
               (1, 'NAS', 'nas', 'working', 'Rack', 'SN-SECRET', 'x', 'private'),
               (2, 'Camera', 'camera', 'lent', NULL, NULL, NULL, NULL);
             INSERT INTO upkeep_items (machine_id, title, schedule, next_due_on, snooze_until) VALUES
               (1, 'Later', 'interval', '2026-12-01', NULL),
               (1, 'Soon', 'interval', '2026-11-03', NULL),
               (1, 'Snoozed', 'interval', '2026-10-01', '2026-11-20');",
        )
        .unwrap();
        let ms = list_machines(&c).unwrap();
        assert_eq!(ms.len(), 2);
        let nas = ms.iter().find(|m| m.name == "NAS").unwrap();
        assert_eq!(nas.location, "Rack");
        let n = nas.next_upkeep.as_ref().unwrap();
        assert_eq!((n.title.as_str(), n.due.as_str()), ("Soon", "2026-11-03"));
        let cam = ms.iter().find(|m| m.name == "Camera").unwrap();
        assert_eq!(cam.status, "lent");
        assert!(cam.next_upkeep.is_none());
        let json = serde_json::to_string(&ms).unwrap();
        assert!(!json.contains("SN-SECRET") && !json.contains("private"));
    }
}
