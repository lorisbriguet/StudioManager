use super::*;

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct CaptureRow {
    pub id: i64,
    pub text: String,
    pub source: String,
    pub status: String,
    pub project_id: Option<i64>,
    pub project: Option<String>,
    pub created_at: String,
    pub brief_tries: i64,
    pub inbox_reason: Option<String>,
}

pub const CAPTURE_STATUS: &str = "Status must be new, filed or dismissed.";
const LIMIT: i64 = 50;

/// The latest 50 captures of a status (default `new`), oldest first.
pub fn list_captures(conn: &Connection, status: Option<&str>) -> R<Vec<CaptureRow>> {
    let status = match status.map(str::trim).filter(|s| !s.is_empty()) {
        None => "new",
        Some(s @ ("new" | "filed" | "dismissed")) => s,
        Some(_) => return Err(CAPTURE_STATUS.to_string()),
    };
    let mut stmt = db(conn.prepare(
        "SELECT c.id, c.text, c.source, c.status, c.project_id, p.name, c.created_at, \
                c.brief_tries, c.inbox_reason \
         FROM captures c LEFT JOIN projects p ON p.id = c.project_id \
         WHERE c.status = ?1 ORDER BY c.id DESC LIMIT ?2",
    ))?;
    let mut rows = db(stmt
        .query_map(params![status, LIMIT], |r| {
            Ok(CaptureRow {
                id: r.get(0)?,
                text: r.get(1)?,
                source: r.get(2)?,
                status: r.get(3)?,
                project_id: r.get(4)?,
                project: r.get(5)?,
                created_at: r.get(6)?,
                brief_tries: r.get(7)?,
                inbox_reason: r.get(8)?,
            })
        })
        .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>()))?;
    rows.reverse();
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use crate::read::test_util::*;
    use super::*;

    #[test]
    fn list_captures_by_status_oldest_first() {
        let c = fixture();
        c.execute_batch(
            "INSERT INTO captures (id, text, source, status, project_id) VALUES
               (1, 'Try a wider grid', 'hotkey', 'filed', 1),
               (2, 'Call the printer', 'agent', 'new', NULL),
               (3, 'Check the poster tool', 'menubar', 'new', 1),
               (4, 'Old idea', 'menubar', 'dismissed', NULL);",
        )
        .unwrap();
        let new = list_captures(&c, None).unwrap();
        let ids: Vec<_> = new.iter().map(|r| r.id).collect();
        assert_eq!(ids, vec![2, 3]);
        assert_eq!(new[0].project, None);
        assert_eq!(new[1].project.as_deref(), Some("Identité Visuelle"));
        assert_eq!(new[1].source, "menubar");
        let filed = list_captures(&c, Some("filed")).unwrap();
        assert_eq!(filed.len(), 1);
        assert_eq!(list_captures(&c, Some("dismissed")).unwrap().len(), 1);
        assert_eq!(list_captures(&c, Some("open")).unwrap_err(), CAPTURE_STATUS);
    }

    #[test]
    fn list_captures_keeps_the_latest_fifty() {
        let c = fixture();
        for i in 1..=60 {
            c.execute("INSERT INTO captures (text, source) VALUES (?1, 'agent')", [format!("n{i}")])
                .unwrap();
        }
        let rows = list_captures(&c, None).unwrap();
        assert_eq!(rows.len(), 50);
        assert_eq!(rows[0].text, "n11");
        assert_eq!(rows[49].text, "n60");
    }

    #[test]
    fn brief_and_stage_show_only_when_set() {
        let c = fixture();
        c.execute(
            "UPDATE tasks SET brief = 'Do it', stage = 'ready' WHERE id = 1",
            [],
        )
        .unwrap();
        c.execute("UPDATE subtasks SET brief = 'Sub brief' WHERE id = 1", [])
            .unwrap();
        let p = get_project(&c, "1").unwrap();
        let v = serde_json::to_value(&p).unwrap();
        assert_eq!(v["tasks"][0]["brief"], "Do it");
        assert_eq!(v["tasks"][0]["stage"], "ready");
        assert!(v["tasks"][1].get("brief").is_none() && v["tasks"][1].get("stage").is_none());
        assert_eq!(v["tasks"][0]["subtasks"][0]["brief"], "Sub brief");
        assert!(v["tasks"][0]["subtasks"][0].get("stage").is_none());
        let rows = list_tasks(&c, Some("1"), None, None).unwrap();
        let v = serde_json::to_value(&rows).unwrap();
        let t1 = v.as_array().unwrap().iter().find(|t| t["id"] == 1).unwrap();
        assert_eq!(t1["brief"], "Do it");
        let t2 = v.as_array().unwrap().iter().find(|t| t["id"] == 2).unwrap();
        assert!(t2.get("brief").is_none() && t2.get("stage").is_none());
    }
}
