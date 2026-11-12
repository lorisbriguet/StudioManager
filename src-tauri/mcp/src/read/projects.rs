use super::*;

fn normalise_path(p: &str) -> String {
    let t = p.trim().trim_end_matches('/');
    if t.is_empty() {
        "/".to_string()
    } else {
        t.to_string()
    }
}

/// The project whose `folder_path` equals `path` or its nearest ancestor.
/// Paths are compared exactly (no case folding); trailing slashes ignored.
pub fn find_project_for_folder(conn: &Connection, path: &str) -> Option<ProjectRef> {
    let projects: Vec<(String, ProjectRef)> = all_projects(conn)
        .ok()?
        .into_iter()
        .filter_map(|p| {
            let fp = p.folder_path.as_deref()?.trim();
            if fp.is_empty() {
                None
            } else {
                Some((normalise_path(fp), p))
            }
        })
        .collect();
    let mut cur = normalise_path(path);
    loop {
        if let Some((_, p)) = projects.iter().find(|(fp, _)| *fp == cur) {
            return Some(p.clone());
        }
        if cur == "/" {
            return None;
        }
        cur = match cur.rfind('/') {
            Some(0) => "/".to_string(),
            Some(i) => cur[..i].to_string(),
            None => return None,
        };
    }
}

pub fn list_projects(
    conn: &Connection,
    status: Option<&str>,
    client: Option<&str>,
    text: Option<&str>,
) -> R<Vec<ProjectRef>> {
    let client_filter = client.map(|c| c.trim()).filter(|c| !c.is_empty());
    let text_f = text.map(fold).filter(|t| !t.trim().is_empty());
    let mut out: Vec<ProjectRef> = all_projects(conn)?
        .into_iter()
        .filter(|p| status.map(|s| p.status == s).unwrap_or(true))
        .filter(|p| match client_filter {
            None => true,
            Some(c) => {
                p.client_id.eq_ignore_ascii_case(c) || fold(&p.client_name).contains(&fold(c))
            }
        })
        .filter(|p| match &text_f {
            None => true,
            Some(t) => fold(&p.name).contains(t.trim()) || fold(&p.client_name).contains(t.trim()),
        })
        .collect();
    sort_by_name(&mut out, |p| &p.name);
    Ok(out)
}

pub(crate) fn project_ref(conn: &Connection, id: i64) -> R<ProjectRef> {
    db(conn.query_row(
        &format!("{PROJECT_SELECT} WHERE p.id = ?1"),
        [id],
        project_from_row,
    ))
}

pub(super) fn wiki_for_project(conn: &Connection, id: i64) -> R<Vec<ArticleRef>> {
    let mut stmt = db(conn.prepare(
        "SELECT id, title, updated_at FROM wiki_articles WHERE project_id = ?1 \
         ORDER BY sort_order ASC, updated_at DESC, id ASC",
    ))?;
    let rows = db(stmt
        .query_map([id], |r| {
            Ok(ArticleRef {
                id: r.get(0)?,
                title: r.get(1)?,
                updated_at: r.get(2)?,
            })
        })
        .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>()))?;
    Ok(rows)
}

pub fn get_project(conn: &Connection, project: &str) -> R<ProjectDetail> {
    let id = resolve_project(conn, project)?;
    let pref = project_ref(conn, id)?;
    let notes: Option<String> = db(conn.query_row(
        "SELECT notes FROM projects WHERE id = ?1",
        [id],
        |r| r.get(0),
    ))?;

    let mut tstmt = db(conn.prepare(
        "SELECT id, title, status, priority, due_date, brief, stage FROM tasks WHERE project_id = ?1 \
         ORDER BY sort_order ASC, id ASC",
    ))?;
    let mut tasks: Vec<Task> = db(tstmt
        .query_map([id], |r| {
            Ok(Task {
                id: r.get(0)?,
                title: r.get(1)?,
                status: r.get(2)?,
                priority: r.get(3)?,
                due_date: r.get(4)?,
                brief: r.get(5)?,
                stage: r.get(6)?,
                subtasks: Vec::new(),
            })
        })
        .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>()))?;
    let mut sstmt = db(conn.prepare(
        "SELECT id, title, status, due_date, brief, stage FROM subtasks WHERE task_id = ?1 \
         ORDER BY sort_order ASC, id ASC",
    ))?;
    for t in &mut tasks {
        t.subtasks = db(sstmt
            .query_map([t.id], |r| {
                Ok(Subtask {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    status: r.get(2)?,
                    due_date: r.get(3)?,
                    brief: r.get(4)?,
                    stage: r.get(5)?,
                })
            })
            .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>()))?;
    }

    let mut rstmt = db(conn.prepare(
        "SELECT r.id, r.name, r.url FROM resources r \
         JOIN resource_projects rp ON rp.resource_id = r.id \
         WHERE rp.project_id = ?1 ORDER BY r.name COLLATE NOCASE, r.id",
    ))?;
    let tools = db(rstmt
        .query_map([id], |r| {
            Ok(Tool {
                id: r.get(0)?,
                name: r.get(1)?,
                url: r.get(2)?,
            })
        })
        .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>()))?;

    Ok(ProjectDetail {
        project: pref,
        notes: notes.unwrap_or_default(),
        tasks,
        wiki: wiki_for_project(conn, id)?,
        tools,
    })
}

#[cfg(test)]
mod tests {
    use crate::read::test_util::*;
    use super::*;

    #[test]
    fn folder_lookup_exact_and_trailing_slash() {
        let c = fixture();
        assert_eq!(
            find_project_for_folder(&c, "/work/lumen/identity")
                .unwrap()
                .id,
            1
        );
        assert_eq!(
            find_project_for_folder(&c, "/work/lumen/site/").unwrap().id,
            2
        );
        assert!(find_project_for_folder(&c, "/work/other").is_none());
        assert!(find_project_for_folder(&c, "/Work/lumen/site").is_none());
    }

    #[test]
    fn folder_lookup_walks_up_to_parent() {
        let c = fixture();
        let p = find_project_for_folder(&c, "/work/lumen/identity/assets/logos").unwrap();
        assert_eq!(p.id, 1);
        assert_eq!(p.client_name, "Atelier Lumen");
    }

    #[test]
    fn list_projects_filters() {
        let c = fixture();
        assert_eq!(list_projects(&c, None, None, None).unwrap().len(), 4);
        let active = list_projects(&c, Some("active"), None, None).unwrap();
        assert_eq!(active.len(), 2);
        let lumen = list_projects(&c, None, Some("lumen"), None).unwrap();
        assert_eq!(lumen.len(), 2);
        let by_id = list_projects(&c, None, Some("C-002"), None).unwrap();
        assert_eq!(by_id.len(), 2);
        let text = list_projects(&c, None, None, Some("CATALOGUE")).unwrap();
        assert_eq!(text.len(), 2);
    }

    #[test]
    fn get_project_detail_and_by_id() {
        let c = fixture();
        let p = get_project(&c, "1").unwrap();
        assert_eq!(p.notes, "Brand notes");
        assert_eq!(p.tasks.len(), 2);
        assert_eq!(p.tasks[0].subtasks.len(), 2);
        assert_eq!(p.tasks[0].subtasks[0].title, "Monochrome");
        assert_eq!(p.wiki.len(), 2);
        assert_eq!(
            p.tools,
            vec![Tool {
                id: 1,
                name: "Figma".into(),
                url: "https://figma.test".into()
            }]
        );
    }

}
