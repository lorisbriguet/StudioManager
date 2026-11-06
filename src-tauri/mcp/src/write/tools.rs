use super::wiki::project_name;
use super::*;

pub fn link_tool(
    dir: &Path,
    org: &Org,
    project: &str,
    name: &str,
    url: Option<&str>,
) -> R<ToolResult> {
    let name = required(name, "Name")?;
    let url = url
        .map(|u| capped(u, "URL"))
        .transpose()?
        .map(str::trim)
        .filter(|u| !u.is_empty())
        .map(str::to_string);
    write(dir, org, "link_tool", |tx| {
        let pid = read::resolve_project(tx, project)?;
        let pname = project_name(tx, pid)?;
        let mut stmt = db(tx.prepare("SELECT id, name, url FROM resources ORDER BY id"))?;
        let rows: Vec<(i64, String, String)> = db(stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .and_then(|rows| rows.collect()))?;
        let wanted = fold(&name);
        let hits: Vec<&(i64, String, String)> = rows
            .iter()
            .filter(|(_, n, u)| {
                fold(n.trim()) == wanted || url.as_deref().is_some_and(|w| u.trim() == w)
            })
            .collect();
        let (rid, rname, rurl, created) = match hits.as_slice() {
            [] => {
                let u = url.clone().unwrap_or_default();
                db(tx.execute(
                    "INSERT INTO resources (name, url) VALUES (?1, ?2)",
                    params![name, u],
                ))?;
                let rid = tx.last_insert_rowid();
                db(tx.execute(
                    "INSERT INTO resource_tags (resource_id, tag) VALUES (?1, 'tool')",
                    [rid],
                ))?;
                (rid, name.clone(), u, true)
            }
            [(id, n, u)] => (*id, n.clone(), u.clone(), false),
            many => {
                let list: Vec<String> = many
                    .iter()
                    .map(|(id, n, _)| format!("{n} (id {id})"))
                    .collect();
                return Err(format!(
                    "Several tools match \"{name}\": {}. Pass the exact name or URL of one.",
                    list.join(", ")
                ));
            }
        };
        let linked = db(tx.execute(
            "INSERT OR IGNORE INTO resource_projects (resource_id, project_id) VALUES (?1, ?2)",
            [rid, pid],
        ))? > 0;
        let summary = (created || linked)
            .then(|| format!("Linked tool \"{rname}\" (id {rid}) to project \"{pname}\""));
        Ok((
            ToolResult {
                org: org.name.clone(),
                project_id: pid,
                project: pname,
                resource_id: rid,
                name: rname,
                url: rurl,
                created,
            },
            summary,
        ))
    })
}

#[cfg(test)]
mod tests {
    use crate::write::test_util::*;
    use super::*;

    #[test]
    fn link_tool_finds_or_creates() {
        let (dir, org, conn) = fixture();
        let r = link_tool(&dir, &org, "1", "figma", None).unwrap();
        assert_eq!(r.org, "Studio");
        assert_eq!(r.resource_id, 1);
        assert!(!r.created);
        // By exact URL under another name.
        let r = link_tool(&dir, &org, "2", "Figma app", Some("https://figma.test")).unwrap();
        assert_eq!(r.resource_id, 1);
        // Linking twice is harmless.
        link_tool(&dir, &org, "1", "Figma", None).unwrap();
        let links: i64 = one(&conn, "SELECT COUNT(*) FROM resource_projects");
        assert_eq!(links, 2);
        let r = link_tool(&dir, &org, "1", "Blender", Some("https://blender.test")).unwrap();
        assert!(r.created);
        assert_eq!(r.name, "Blender");
        assert_eq!(r.url, "https://blender.test");
        let n: i64 = one(&conn, "SELECT COUNT(*) FROM resources");
        assert_eq!(n, 2);
        let linked: i64 = one(
            &conn,
            &format!(
                "SELECT COUNT(*) FROM resource_projects WHERE resource_id = {} AND project_id = 1",
                r.resource_id
            ),
        );
        assert_eq!(linked, 1);
    }

}
