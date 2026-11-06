use super::*;

fn project_result(conn: &Connection, org: &Org, id: i64) -> R<ProjectResult> {
    Ok(ProjectResult {
        org: org.name.clone(),
        project: read::project_ref(conn, id)?,
    })
}

pub fn link_folder(dir: &Path, org: &Org, project: &str, folder: &str) -> R<ProjectResult> {
    let path = folder_path(folder)?;
    write(dir, org, "link_folder", |tx| {
        let id = read::resolve_project(tx, project)?;
        update_row(
            tx,
            "projects",
            id,
            vec![("folder_path", Value::Text(path.clone()))],
        )?;
        let r = project_result(tx, org, id)?;
        let summary = format!("Linked project \"{}\" (id {id}) to {path}", r.project.name);
        Ok((r, Some(summary)))
    })
}

pub fn create_project(
    dir: &Path,
    org: &Org,
    client: &str,
    name: &str,
    status: Option<&str>,
    deadline: Option<&str>,
    notes: Option<&str>,
) -> R<ProjectResult> {
    let name = required(name, "Name")?;
    let status = project_status(status.unwrap_or("active"))?;
    let deadline = optional_date(deadline)?;
    let notes = capped(notes.unwrap_or(""), "Notes")?.to_string();
    write(dir, org, "create_project", |tx| {
        let client_id = read::resolve_client(tx, client)?;
        let mut stmt = db(tx.prepare("SELECT id, name FROM projects WHERE client_id = ?1"))?;
        let existing: Vec<(i64, String)> = db(stmt
            .query_map([&client_id], |r| Ok((r.get(0)?, r.get(1)?)))
            .and_then(|rows| rows.collect()))?;
        if let Some((id, n)) = existing.iter().find(|(_, n)| fold(n.trim()) == fold(&name)) {
            return Err(format!(
                "Client {client_id} already has a project named \"{n}\" (id {id})."
            ));
        }
        db(tx.execute(
            "INSERT INTO projects (client_id, name, status, deadline, notes) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![client_id, name, status, deadline, notes],
        ))?;
        let id = tx.last_insert_rowid();
        let r = project_result(tx, org, id)?;
        let summary = format!(
            "Created project \"{name}\" (id {id}) for client \"{}\"",
            r.project.client_name
        );
        Ok((r, Some(summary)))
    })
}

pub fn update_project(
    dir: &Path,
    org: &Org,
    project: &str,
    changes: &ProjectChanges,
) -> R<ProjectResult> {
    let mut sets: Vec<(&'static str, Value)> = Vec::new();
    if let Some(s) = &changes.status {
        sets.push(("status", Value::Text(project_status(s)?.to_string())));
    }
    if let Some(d) = &changes.deadline {
        sets.push(("deadline", date_value(d)?));
    }
    if let Some(n) = &changes.notes {
        sets.push(("notes", Value::Text(capped(n, "Notes")?.to_string())));
    }
    if let Some(f) = &changes.folder_path {
        let v = if f.trim().is_empty() {
            Value::Null
        } else {
            Value::Text(folder_path(f)?)
        };
        sets.push(("folder_path", v));
    }
    if sets.is_empty() {
        return Err(NOTHING.to_string());
    }
    write(dir, org, "update_project", |tx| {
        let id = read::resolve_project(tx, project)?;
        let changed = columns(&sets);
        update_row(tx, "projects", id, sets)?;
        let r = project_result(tx, org, id)?;
        let summary = format!(
            "Updated project \"{}\" (id {id}): {changed}",
            r.project.name
        );
        Ok((r, Some(summary)))
    })
}


#[cfg(test)]
mod tests {
    use crate::write::test_util::*;
    use super::*;

    #[test]
    fn link_folder_happy_path() {
        let (dir, org, conn) = fixture();
        let folder = dir.join("work").join("lumen").join("identity");
        std::fs::create_dir_all(&folder).unwrap();
        let folder = folder.to_string_lossy().into_owned();
        let r = link_folder(&dir, &org, "identite visuelle", &format!("{folder}//")).unwrap();
        assert_eq!(r.org, "Studio");
        assert_eq!(r.project.id, 1);
        assert_eq!(r.project.folder_path.as_deref(), Some(folder.as_str()));
        let fp: String = one(&conn, "SELECT folder_path FROM projects WHERE id = 1");
        assert_eq!(fp, folder);
        assert_eq!(
            link_folder(&dir, &org, "1", "work/lumen").unwrap_err(),
            "Use a full folder path."
        );
        assert_eq!(
            link_folder(&dir, &org, "1", "~/work").unwrap_err(),
            "Use a full folder path."
        );
    }

    #[test]
    fn create_project_happy_path() {
        let (dir, org, conn) = fixture();
        let r = create_project(
            &dir,
            &org,
            "editions boreale",
            "Catalogue Automne",
            None,
            Some("2027-02-01"),
            Some("Second edition"),
        )
        .unwrap();
        assert_eq!(r.org, "Studio");
        assert_eq!(r.project.name, "Catalogue Automne");
        assert_eq!(r.project.client_id, "C-009");
        assert_eq!(r.project.status, "active");
        assert_eq!(r.project.deadline.as_deref(), Some("2027-02-01"));
        let notes: String = one(
            &conn,
            &format!("SELECT notes FROM projects WHERE id = {}", r.project.id),
        );
        assert_eq!(notes, "Second edition");
        let err =
            create_project(&dir, &org, "C-001", "X", Some("in_progress"), None, None).unwrap_err();
        assert_eq!(
            err,
            "Status must be one of: active, completed, on_hold, cancelled."
        );
        let err =
            create_project(&dir, &org, "C-001", "X", None, Some("05.11.2026"), None).unwrap_err();
        assert_eq!(err, "Dates use YYYY-MM-DD.");
        let err = create_project(&dir, &org, "Nobody", "X", None, None, None).unwrap_err();
        assert!(err.starts_with("No client matches"), "{err}");
    }

    #[test]
    fn create_project_refuses_duplicate_name_for_client() {
        let (dir, org, _conn) = fixture();
        let err = create_project(&dir, &org, "C-001", "site web", None, None, None).unwrap_err();
        assert!(err.contains("already has a project"), "{err}");
        // Same name under another client is fine.
        create_project(&dir, &org, "C-009", "Site Web", None, None, None).unwrap();
    }

    #[test]
    fn update_project_happy_path() {
        let (dir, org, conn) = fixture();
        let r = update_project(
            &dir,
            &org,
            "Site Web",
            &ProjectChanges {
                status: Some("completed".into()),
                deadline: Some("2026-12-01".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(r.project.status, "completed");
        assert_eq!(r.project.deadline.as_deref(), Some("2026-12-01"));
        // Untouched fields keep their values.
        let notes: String = one(&conn, "SELECT notes FROM projects WHERE id = 1");
        assert_eq!(notes, "Brand notes");
        let folder = dir.join("work").join("lumen");
        std::fs::create_dir_all(&folder).unwrap();
        let folder = folder.to_string_lossy().into_owned();
        let r = update_project(
            &dir,
            &org,
            "1",
            &ProjectChanges {
                notes: Some("New notes".into()),
                folder_path: Some(format!("{folder}/")),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(r.project.status, "active");
        assert_eq!(r.project.deadline.as_deref(), Some("2026-11-05"));
        assert_eq!(r.project.folder_path.as_deref(), Some(folder.as_str()));
        let r = update_project(
            &dir,
            &org,
            "1",
            &ProjectChanges {
                deadline: Some(String::new()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(r.project.deadline, None);
        assert_eq!(
            update_project(&dir, &org, "1", &ProjectChanges::default()).unwrap_err(),
            "Nothing to update."
        );
    }

    #[test]
    fn ambiguous_project_lists_candidates() {
        let (dir, org, conn) = fixture();
        conn.execute(
            "INSERT INTO projects (id, client_id, name) VALUES (7, 'C-009', 'Site web')",
            [],
        )
        .unwrap();
        let err = create_task(&dir, &org, "SITE WEB", "x", None, None, None).unwrap_err();
        assert!(err.contains("(id 2)") && err.contains("(id 7)"), "{err}");
        let n: i64 = one(&conn, "SELECT COUNT(*) FROM tasks WHERE title = 'x'");
        assert_eq!(n, 0);
    }

}
