use super::*;

fn article_content(conn: &Connection, id: i64) -> R<String> {
    db(conn.query_row("SELECT content FROM wiki_articles WHERE id = ?1", [id], |r| r.get(0)))
}

pub(super) fn project_name(conn: &Connection, id: i64) -> R<String> {
    db(
        conn.query_row("SELECT name FROM projects WHERE id = ?1", [id], |r| {
            r.get(0)
        }),
    )
}

/// The project's wiki folder: the folder whose trimmed name equals the
/// project name, created at the end of the list if missing.
fn wiki_folder(conn: &Connection, project: &str) -> R<i64> {
    let name = project.trim();
    let found: Option<i64> = db(conn
        .query_row(
            "SELECT id FROM wiki_folders WHERE TRIM(name) = ?1 ORDER BY id LIMIT 1",
            [name],
            |r| r.get(0),
        )
        .optional())?;
    if let Some(id) = found {
        return Ok(id);
    }
    db(conn.execute(
        "INSERT INTO wiki_folders (name, sort_order) \
         VALUES (?1, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM wiki_folders))",
        [name],
    ))?;
    Ok(conn.last_insert_rowid())
}

/// The project's article with this title (accent/case-folded), as id and
/// stored title; several matches are listed, never picked. Titles only:
/// contents stay on disk.
fn find_article(conn: &Connection, project_id: i64, title: &str) -> R<Option<(i64, String)>> {
    let mut stmt =
        db(conn.prepare("SELECT id, title FROM wiki_articles WHERE project_id = ?1 ORDER BY id"))?;
    let rows: Vec<(i64, String)> = db(stmt
        .query_map([project_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .and_then(|rows| rows.collect()))?;
    let wanted = fold(title.trim());
    let hits: Vec<&(i64, String)> = rows
        .iter()
        .filter(|(_, t)| fold(t.trim()) == wanted)
        .collect();
    match hits.as_slice() {
        [] => Ok(None),
        [one] => Ok(Some((*one).clone())),
        many => {
            let list: Vec<String> = many
                .iter()
                .map(|(id, t)| format!("{t} (id {id})"))
                .collect();
            Err(format!(
                "Several articles match \"{title}\": {}. Rename one in StudioManager first.",
                list.join(", ")
            ))
        }
    }
}

/// Tags the app shows for a project article: the project name and the
/// lowercased title.
fn tag_article(conn: &Connection, article_id: i64, project: &str, title: &str) -> R<()> {
    for tag in [project.trim().to_string(), title.trim().to_lowercase()] {
        db(conn.execute(
            "INSERT OR IGNORE INTO wiki_article_tags (article_id, tag) VALUES (?1, ?2)",
            params![article_id, tag],
        ))?;
    }
    Ok(())
}

fn insert_article(
    conn: &Connection,
    project_id: i64,
    project: &str,
    title: &str,
    content: &str,
) -> R<i64> {
    let folder = wiki_folder(conn, project)?;
    let order = next_sort_order(conn, "wiki_articles", "folder_id", folder)?;
    db(conn.execute(
        "INSERT INTO wiki_articles (folder_id, project_id, title, content, sort_order) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![folder, project_id, title, content, order],
    ))?;
    let id = conn.last_insert_rowid();
    tag_article(conn, id, project, title)?;
    Ok(id)
}

/// What a `[[...]]` link points at: `Title` (this project first, then a
/// title unique in the organisation), or `Project/Title`.
fn find_link_target(articles: &[(i64, String, Option<i64>, String)], pid: i64, target: &str) -> Option<i64> {
    let target = target.trim();
    if let Some((project, title)) = target.rsplit_once('/') {
        let (fp, ft) = (fold(project.trim()), fold(title.trim()));
        let hits: Vec<i64> = articles
            .iter()
            .filter(|(_, t, _, p)| fold(t) == ft && fold(p) == fp)
            .map(|a| a.0)
            .collect();
        if hits.len() == 1 {
            return Some(hits[0]);
        }
    }
    let ft = fold(target);
    if let Some(a) = articles.iter().find(|(_, t, p, _)| *p == Some(pid) && fold(t) == ft) {
        return Some(a.0);
    }
    let hits: Vec<i64> = articles.iter().filter(|(_, t, _, _)| fold(t) == ft).map(|a| a.0).collect();
    (hits.len() == 1).then(|| hits[0])
}

/// Whether a file exists; `Path::is_file` outside tests.
type Exists<'a> = &'a dyn Fn(&Path) -> bool;

/// A Markdown file of a project's folder: `[[docs/guide.md]]` in this
/// project, or `[[Project/docs/guide.md]]`. Only files that exist count.
fn find_file_target(
    folders: &[(i64, String, String)],
    pid: i64,
    target: &str,
    is_file: Exists,
) -> Option<(i64, String)> {
    let target = target.trim().trim_start_matches("./");
    if !target.to_ascii_lowercase().ends_with(".md") || target.split('/').any(|p| p == ".." || p.is_empty()) {
        return None;
    }
    let exists = |folder: &str, rel: &str| is_file(&Path::new(folder).join(rel));
    if let Some((_, _, folder)) = folders.iter().find(|(id, _, _)| *id == pid) {
        if exists(folder, target) {
            return Some((pid, target.to_string()));
        }
    }
    let (project, rel) = target.split_once('/')?;
    folders
        .iter()
        .find(|(_, name, folder)| fold(name) == fold(project) && exists(folder, rel))
        .map(|(id, _, _)| (*id, rel.to_string()))
}

/// `[[...]]` links in Markdown, outside fenced blocks and `code spans`:
/// each one's inside goes through `f`, which returns its replacement.
fn map_links(md: &str, f: &mut dyn FnMut(&str) -> String) -> String {
    fn links_in(text: &str, f: &mut dyn FnMut(&str) -> String) -> String {
        let mut out = String::new();
        let mut rest = text;
        while let Some(start) = rest.find("[[") {
            let after = &rest[start + 2..];
            match after.find("]]") {
                Some(end) if !after[..end].contains(['[', '\n']) && !after[..end].trim().is_empty() => {
                    out.push_str(&rest[..start]);
                    out.push_str(&f(&after[..end]));
                    rest = &after[end + 2..];
                }
                _ => {
                    out.push_str(&rest[..start + 2]);
                    rest = after;
                }
            }
        }
        out.push_str(rest);
        out
    }

    // Walk line by line, leaving fenced blocks and `code spans` untouched.
    let mut out = String::with_capacity(md.len());
    let mut in_fence = false;
    for line in md.split_inclusive('\n') {
        let t = line.trim_start();
        if t.starts_with("```") || t.starts_with("~~~") {
            in_fence = !in_fence;
            out.push_str(line);
            continue;
        }
        if in_fence {
            out.push_str(line);
            continue;
        }
        let mut rest = line;
        while let Some(tick) = rest.find('`') {
            out.push_str(&links_in(&rest[..tick], f));
            let run = rest[tick..].chars().take_while(|&c| c == '`').count();
            let fence = &rest[tick..tick + run];
            match rest[tick + run..].find(fence) {
                Some(close) => {
                    let end = tick + run + close + run;
                    out.push_str(&rest[tick..end]);
                    rest = &rest[end..];
                }
                None => {
                    out.push_str(&rest[tick..]);
                    rest = "";
                }
            }
        }
        out.push_str(&links_in(rest, f));
    }
    out
}

/// The link's target: what comes before `|`, or all of it.
fn link_target(inner: &str) -> &str {
    inner.split_once('|').map_or(inner, |(t, _)| t)
}

/// File links found on disk, by link target. Run on a read connection
/// before the write transaction: looking files up in a slow or offline
/// project folder must never hold the database's write lock.
fn file_links(
    conn: &Connection,
    pid: i64,
    md: &str,
    is_file: Exists,
) -> R<HashMap<String, (i64, String)>> {
    let mut found = HashMap::new();
    if !md.contains("[[") {
        return Ok(found);
    }
    let mut stmt = db(conn.prepare("SELECT id, name, folder_path FROM projects WHERE folder_path IS NOT NULL"))?;
    let folders: Vec<(i64, String, String)> = db(stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .and_then(|rows| rows.collect()))?;
    let mut targets = Vec::new();
    map_links(md, &mut |inner| {
        targets.push(link_target(inner).to_string());
        String::new()
    });
    for target in targets {
        if found.contains_key(&target) {
            continue;
        }
        if let Some(hit) = find_file_target(&folders, pid, &target, is_file) {
            found.insert(target, hit);
        }
    }
    Ok(found)
}

/// Replaces `[[Target]]` and `[[Target|text]]` with Markdown links to the
/// article (`/wiki?article=<id>`), or to a project file found beforehand
/// by `file_links`, outside code. Targets that match nothing stay as
/// written and are reported in `unresolved`.
pub(crate) fn resolve_wiki_links(
    tx: &Connection,
    pid: i64,
    md: &str,
    files: &HashMap<String, (i64, String)>,
    unresolved: &mut Vec<String>,
) -> R<String> {
    if !md.contains("[[") {
        return Ok(md.to_string());
    }
    let mut stmt = db(tx.prepare(
        "SELECT a.id, a.title, a.project_id, COALESCE(p.name, '') FROM wiki_articles a \
         LEFT JOIN projects p ON p.id = a.project_id",
    ))?;
    let articles: Vec<(i64, String, Option<i64>, String)> = db(stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .and_then(|rows| rows.collect()))?;

    Ok(map_links(md, &mut |inner| {
        let target = link_target(inner);
        let text = match inner.split_once('|') {
            Some((_, x)) => x.trim().to_string(),
            None => inner.rsplit_once('/').map_or(inner, |(_, t)| t).trim().to_string(),
        };
        if let Some((fpid, rel)) = files.get(target) {
            let file_text = match inner.split_once('|') {
                Some((_, x)) => x.trim().to_string(),
                None => rel.rsplit('/').next().unwrap_or(rel).to_string(),
            };
            if !file_text.contains(']') {
                return format!("[{file_text}](/wiki?file={fpid}:{})", rel.replace(' ', "%20"));
            }
        }
        match find_link_target(&articles, pid, target) {
            Some(id) if !text.contains(']') => format!("[{text}](/wiki?article={id})"),
            _ => {
                unresolved.push(target.trim().to_string());
                format!("[[{inner}]]")
            }
        }
    }))
}

pub fn put_wiki_article(
    dir: &Path,
    org: &Org,
    project: &str,
    title: &str,
    markdown: &str,
) -> R<ArticleResult> {
    put_wiki_article_with(dir, org, project, title, markdown, &|p: &Path| p.is_file())
}

fn put_wiki_article_with(
    dir: &Path,
    org: &Org,
    project: &str,
    title: &str,
    markdown: &str,
    is_file: Exists,
) -> R<ArticleResult> {
    let title = required(title, "Title")?;
    capped(markdown, "Content")?;
    // Project files first, on a read connection (see `file_links`).
    let (pid, files) = {
        let conn = guard::open_read(org)?;
        let pid = read::resolve_project(&conn, project)?;
        (pid, file_links(&conn, pid, markdown, is_file)?)
    };
    write(dir, org, "put_wiki_article", |tx| {
        // By id: the project resolved above (it can't be deleted meanwhile
        // through these tools, but the app could).
        let pid = read::resolve_project(tx, &pid.to_string())?;
        let pname = project_name(tx, pid)?;
        let mut unresolved = Vec::new();
        let html = markdown::to_html(&resolve_wiki_links(tx, pid, markdown, &files, &mut unresolved)?);
        let (id, stored_title, created) = match find_article(tx, pid, &title)? {
            Some((id, t)) => {
                update_row(
                    tx,
                    "wiki_articles",
                    id,
                    vec![("content", Value::Text(html.clone()))],
                )?;
                tag_article(tx, id, &pname, &t)?;
                (id, t, false)
            }
            None => (
                insert_article(tx, pid, &pname, &title, &html)?,
                title.clone(),
                true,
            ),
        };
        let verb = if created { "Created" } else { "Replaced" };
        let summary =
            format!("{verb} wiki article \"{stored_title}\" (id {id}) of project \"{pname}\"");
        Ok((
            ArticleResult {
                org: org.name.clone(),
                project_id: pid,
                project: pname,
                id,
                title: stored_title,
                created,
                unresolved_links: unresolved,
            },
            Some(summary),
        ))
    })
}

pub fn add_decision(
    dir: &Path,
    org: &Org,
    project: &str,
    date: &str,
    text: &str,
) -> R<DecisionResult> {
    let day = parse_date(date)?;
    let text = required(text, "Text")?;
    let head = format!("<strong>{day}</strong> {}", escape_html(&text));
    // Already recorded: as written here or in the editor (`<li><p>…</p>`),
    // or after a get→put round trip (tight `<li>…</li>`, quotes as &quot;).
    let heads = [head.clone(), head.replace('"', "&quot;")];
    let recorded = |content: &str| {
        heads.iter().any(|h| {
            content.contains(&format!("{h}</p>")) || content.contains(&format!("{h}</li>"))
        })
    };
    write(dir, org, "add_decision", |tx| {
        let pid = read::resolve_project(tx, project)?;
        let pname = project_name(tx, pid)?;
        let found = match find_article(tx, pid, "Decisions")? {
            Some((id, _)) => Some((id, article_content(tx, id)?)),
            None => None,
        };
        let (article_id, added) = match found {
            None => (
                insert_article(tx, pid, &pname, "Decisions", &format!("<ul><li><p>{head}</p></li></ul>"))?,
                true,
            ),
            Some((id, content)) if recorded(&content) => (id, false),
            Some((id, content)) => {
                let new = match content.rfind("</ul>") {
                    Some(i) => {
                        // Same form as the list's last item.
                        let tight = content[..i]
                            .rfind("<li")
                            .is_some_and(|li| !content[li..].starts_with("<li><p>"));
                        let li = if tight {
                            format!("<li>{head}</li>\n")
                        } else {
                            format!("<li><p>{head}</p></li>")
                        };
                        format!("{}{li}{}", &content[..i], &content[i..])
                    }
                    None => format!("{content}<ul><li><p>{head}</p></li></ul>"),
                };
                update_row(tx, "wiki_articles", id, vec![("content", Value::Text(new))])?;
                (id, true)
            }
        };
        let summary =
            added.then(|| format!("Added decision {day} \"{text}\" to project \"{pname}\""));
        Ok((
            DecisionResult {
                org: org.name.clone(),
                project_id: pid,
                project: pname,
                article_id,
                added,
            },
            summary,
        ))
    })
}


#[cfg(test)]
mod tests {
    use crate::write::test_util::*;
    use crate::write::*;
    use super::*;

    #[test]
    fn wiki_article_sort_order_is_per_folder() {
        let (dir, org, conn) = fixture();
        let a = put_wiki_article(&dir, &org, "1", "Overview", "x").unwrap();
        let folder: i64 = one(
            &conn,
            &format!("SELECT folder_id FROM wiki_articles WHERE id = {}", a.id),
        );
        conn.execute(
            &format!(
                "INSERT INTO wiki_articles (folder_id, title, content, sort_order) \
                 VALUES ({folder}, 'Loose', '', 7)"
            ),
            [],
        )
        .unwrap();
        let b = put_wiki_article(&dir, &org, "1", "Next", "y").unwrap();
        let so: i64 = one(
            &conn,
            &format!("SELECT sort_order FROM wiki_articles WHERE id = {}", b.id),
        );
        assert_eq!(so, 8);
    }

    #[test]
    fn put_wiki_article_resolves_title_links() {
        let (dir, org, conn) = fixture();
        let dec = put_wiki_article(&dir, &org, "1", "Decisions", "- one").unwrap();
        let other = put_wiki_article(&dir, &org, "2", "Decisions", "- two").unwrap();
        let notes = put_wiki_article(&dir, &org, "2", "Launch notes", "x").unwrap();
        let r = put_wiki_article(
            &dir,
            &org,
            "1",
            "Overview",
            "See [[Decisions]], [[Site Web/Decisions|the site's]] and [[launch notes]].\n\n\
             Not `[[Decisions]]` in code, nor [[Missing page]].\n\n```\n[[Decisions]]\n```\n",
        )
        .unwrap();
        assert_eq!(r.unresolved_links, vec!["Missing page".to_string()]);
        let html: String = one(&conn, &format!("SELECT content FROM wiki_articles WHERE id = {}", r.id));
        // Same project first, then Project/Title, then a title unique in the organisation.
        assert!(html.contains(&format!("<a href=\"/wiki?article={}\">Decisions</a>", dec.id)), "{html}");
        assert!(html.contains(&format!("<a href=\"/wiki?article={}\">the site's</a>", other.id)), "{html}");
        assert!(html.contains(&format!("<a href=\"/wiki?article={}\">launch notes</a>", notes.id)), "{html}");
        assert!(html.contains("<code>[[Decisions]]</code>"), "{html}");
        assert!(html.contains("[[Missing page]]"), "{html}");
        assert!(html.contains("<pre><code>[[Decisions]]"), "{html}");
    }

    #[test]
    fn put_wiki_article_links_project_files() {
        let (dir, org, conn) = fixture();
        let folder = dir.join("site-folder");
        std::fs::create_dir_all(folder.join("docs")).unwrap();
        std::fs::write(folder.join("RELEASING.md"), "# Releasing").unwrap();
        std::fs::write(folder.join("docs/guide.md"), "# Guide").unwrap();
        conn.execute("UPDATE projects SET folder_path = ?1 WHERE id = 2", [folder.to_string_lossy()]).unwrap();
        let r = put_wiki_article(
            &dir,
            &org,
            "2",
            "Run",
            "See [[RELEASING.md]], [[docs/guide.md|the guide]] and [[Site Web/docs/guide.md]]; [[missing.md]].",
        )
        .unwrap();
        let html: String = one(&conn, &format!("SELECT content FROM wiki_articles WHERE id = {}", r.id));
        assert!(html.contains(r#"<a href="/wiki?file=2:RELEASING.md">RELEASING.md</a>"#), "{html}");
        assert!(html.contains(r#"<a href="/wiki?file=2:docs/guide.md">the guide</a>"#), "{html}");
        assert!(html.contains(r#"<a href="/wiki?file=2:docs/guide.md">guide.md</a>"#), "{html}");
        assert_eq!(r.unresolved_links, vec!["missing.md".to_string()]);
        // From another project, a file needs its project's name.
        let r = put_wiki_article(&dir, &org, "1", "Notes", "[[Site Web/RELEASING.md]] [[RELEASING.md]]").unwrap();
        assert_eq!(r.unresolved_links, vec!["RELEASING.md".to_string()]);
    }

    #[test]
    fn put_wiki_article_leaves_ambiguous_titles_unresolved() {
        let (dir, org, _conn) = fixture();
        put_wiki_article(&dir, &org, "1", "Brief", "a").unwrap();
        put_wiki_article(&dir, &org, "2", "Brief", "b").unwrap();
        // From project 3, "Brief" exists twice elsewhere: name the project.
        let r = put_wiki_article(&dir, &org, "3", "Overview", "[[Brief]] and [[Site Web/Brief]]").unwrap();
        assert_eq!(r.unresolved_links, vec!["Brief".to_string()]);
    }

    #[test]
    fn put_wiki_article_creates_folder_article_and_tags() {
        let (dir, org, conn) = fixture();
        let r = put_wiki_article(&dir, &org, "1", "Overview", "## Goals\n\nFresh & clear").unwrap();
        assert_eq!(r.org, "Studio");
        assert!(r.created);
        assert_eq!(r.project, "Identité Visuelle");
        let (folder, content, so): (i64, String, i64) = conn
            .query_row(
                "SELECT folder_id, content, sort_order FROM wiki_articles WHERE id = ?1",
                [r.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert!(content.contains("<h2>Goals</h2>"), "{content}");
        assert!(content.contains("Fresh &amp; clear"), "{content}");
        assert_eq!(so, 0);
        let (fname, fso): (String, i64) = conn
            .query_row(
                "SELECT name, sort_order FROM wiki_folders WHERE id = ?1",
                [folder],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(fname, "Identité Visuelle");
        assert_eq!(fso, 4);
        let mut tags: Vec<String> = conn
            .prepare("SELECT tag FROM wiki_article_tags WHERE article_id = ?1 ORDER BY tag")
            .unwrap()
            .query_map([r.id], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        tags.sort();
        assert_eq!(
            tags,
            vec!["Identité Visuelle".to_string(), "overview".to_string()]
        );

        // Any title; second article reuses the folder, sort_order per project.
        let r2 = put_wiki_article(&dir, &org, "1", "Print specs", "Paper: 120g").unwrap();
        assert!(r2.created);
        let (folder2, so2): (i64, i64) = conn
            .query_row(
                "SELECT folder_id, sort_order FROM wiki_articles WHERE id = ?1",
                [r2.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(folder2, folder);
        assert_eq!(so2, 1);
        let folders: i64 = one(&conn, "SELECT COUNT(*) FROM wiki_folders");
        assert_eq!(folders, 2);

        // Same title (folded): replaces the content in place.
        conn.execute(
            "UPDATE wiki_articles SET updated_at = '2000-01-01 00:00:00' WHERE id = ?1",
            [r.id],
        )
        .unwrap();
        let r3 = put_wiki_article(&dir, &org, "1", "overview", "New body").unwrap();
        assert!(!r3.created);
        assert_eq!(r3.id, r.id);
        assert_eq!(r3.title, "Overview");
        let (content, at): (String, String) = conn
            .query_row(
                "SELECT content, updated_at FROM wiki_articles WHERE id = ?1",
                [r.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(content, "<p>New body</p>\n");
        assert_ne!(at, "2000-01-01 00:00:00");
        let tags: i64 = one(&conn, "SELECT COUNT(*) FROM wiki_article_tags");
        assert_eq!(tags, 4);
    }

    #[test]
    fn put_wiki_article_reuses_folder_with_padded_name() {
        let (dir, org, conn) = fixture();
        conn.execute(
            "INSERT INTO wiki_folders (id, name, sort_order) VALUES (5, ' Site Web ', 0)",
            [],
        )
        .unwrap();
        let r = put_wiki_article(&dir, &org, "2", "Brief", "x").unwrap();
        let folder: i64 = one(
            &conn,
            &format!("SELECT folder_id FROM wiki_articles WHERE id = {}", r.id),
        );
        assert_eq!(folder, 5);
    }

    #[test]
    fn markdown_script_tag_escaped() {
        let (dir, org, conn) = fixture();
        let r = put_wiki_article(&dir, &org, "1", "Notes", "Hi <script>alert(1)</script>").unwrap();
        let content: String = one(
            &conn,
            &format!("SELECT content FROM wiki_articles WHERE id = {}", r.id),
        );
        assert!(!content.contains("<script"), "{content}");
        assert!(content.contains("&lt;script&gt;"), "{content}");
    }

    #[test]
    fn add_decision_creates_then_appends() {
        let (dir, org, conn) = fixture();
        let r = add_decision(&dir, &org, "1", "2026-10-01", "Use blue").unwrap();
        assert!(r.added);
        let content: String = one(
            &conn,
            &format!(
                "SELECT content FROM wiki_articles WHERE id = {}",
                r.article_id
            ),
        );
        assert_eq!(
            content,
            "<ul><li><p><strong>2026-10-01</strong> Use blue</p></li></ul>"
        );
        let title: String = one(
            &conn,
            &format!(
                "SELECT title FROM wiki_articles WHERE id = {}",
                r.article_id
            ),
        );
        assert_eq!(title, "Decisions");
        let r2 = add_decision(&dir, &org, "1", "2026-10-02", "Keep it <simple> & short").unwrap();
        assert_eq!(r2.article_id, r.article_id);
        let content: String = one(
            &conn,
            &format!(
                "SELECT content FROM wiki_articles WHERE id = {}",
                r.article_id
            ),
        );
        assert_eq!(
            content,
            "<ul><li><p><strong>2026-10-01</strong> Use blue</p></li>\
             <li><p><strong>2026-10-02</strong> Keep it &lt;simple&gt; &amp; short</p></li></ul>"
        );
        assert_eq!(
            add_decision(&dir, &org, "1", "01.10.2026", "x").unwrap_err(),
            "Dates use YYYY-MM-DD."
        );
    }

    #[test]
    fn decision_idempotent() {
        let (dir, org, conn) = fixture();
        add_decision(&dir, &org, "1", "2026-10-01", "Use blue").unwrap();
        let before: String = one(&conn, "SELECT content FROM wiki_articles");
        let logged = log_lines(&dir).len();
        let r = add_decision(&dir, &org, "1", "2026-10-01", "Use blue").unwrap();
        assert!(!r.added);
        let after: String = one(&conn, "SELECT content FROM wiki_articles");
        assert_eq!(before, after);
        assert_eq!(log_lines(&dir).len(), logged, "a no-op is not logged");
        let n: i64 = one(&conn, "SELECT COUNT(*) FROM wiki_articles");
        assert_eq!(n, 1);
    }

    #[test]
    fn decision_dedup_survives_a_round_trip() {
        let (dir, org, conn) = fixture();
        add_decision(&dir, &org, "1", "2026-10-01", "Use \"blue\" & grey").unwrap();
        add_decision(&dir, &org, "1", "2026-10-02", "Keep it short").unwrap();
        // An agent reads the article and writes it back unchanged: the
        // list comes back in its tight form, quotes as &quot;.
        let a = read::get_wiki_article(&guard::open_read(&org).unwrap(), "1", "Decisions").unwrap();
        put_wiki_article(&dir, &org, "1", "Decisions", &a.markdown).unwrap();
        let html: String = one(&conn, "SELECT content FROM wiki_articles");
        assert!(!html.contains("<li><p>"), "{html}");

        let r = add_decision(&dir, &org, "1", "2026-10-01", "Use \"blue\" & grey").unwrap();
        assert!(!r.added, "already recorded");
        assert!(!add_decision(&dir, &org, "1", "2026-10-02", "Keep it short").unwrap().added);
        // Same opening words, different decision.
        assert!(add_decision(&dir, &org, "1", "2026-10-02", "Keep it short and sweet").unwrap().added);
        let html: String = one(&conn, "SELECT content FROM wiki_articles");
        assert_eq!(html.matches("2026-10-01").count(), 1, "{html}");
        // The new item takes the list's form.
        assert!(!html.contains("<li><p>"), "{html}");
        assert!(
            html.contains("<li><strong>2026-10-02</strong> Keep it short and sweet</li>\n</ul>"),
            "{html}"
        );
    }

    #[test]
    fn file_links_resolved_outside_the_write_lock() {
        let (dir, org, conn) = fixture();
        let folder = dir.join("site-folder");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("RELEASING.md"), "# Releasing").unwrap();
        conn.execute("UPDATE projects SET folder_path = ?1 WHERE id = 2", [folder.to_string_lossy()])
            .unwrap();
        let db = org.db.clone();
        let probes = std::cell::Cell::new(0);
        // A slow or offline folder must not hold the database: while a file
        // is looked up, another connection can still start a write.
        let exists = |p: &Path| {
            let other = Connection::open(&db).unwrap();
            other.busy_timeout(std::time::Duration::ZERO).unwrap();
            other.execute_batch("BEGIN IMMEDIATE; ROLLBACK;").expect("write lock free during file lookup");
            probes.set(probes.get() + 1);
            p.is_file()
        };
        let r = put_wiki_article_with(&dir, &org, "2", "Run", "See [[RELEASING.md]] and [[gone.md]].", &exists)
            .unwrap();
        assert!(probes.get() >= 2);
        assert_eq!(r.unresolved_links, vec!["gone.md".to_string()]);
        let html: String = one(&conn, &format!("SELECT content FROM wiki_articles WHERE id = {}", r.id));
        assert!(html.contains(r#"<a href="/wiki?file=2:RELEASING.md">RELEASING.md</a>"#), "{html}");
    }

    #[test]
    fn oversized_text_refused() {
        let (dir, org, conn) = fixture();
        let big = "x".repeat(MAX_TEXT + 1);
        assert_eq!(
            put_wiki_article(&dir, &org, "1", "Notes", &big).unwrap_err(),
            "Content too long (over 1 MB)."
        );
        assert_eq!(
            create_task(&dir, &org, "1", &big, None, None, None).unwrap_err(),
            "Title too long (over 1 MB)."
        );
        assert_eq!(
            create_task(&dir, &org, "1", "ok", None, None, Some(&big)).unwrap_err(),
            "Notes too long (over 1 MB)."
        );
        let notes = ProjectChanges { notes: Some(big.clone()), ..Default::default() };
        assert!(update_project(&dir, &org, "1", &notes).is_err());
        assert!(add_decision(&dir, &org, "1", "2026-10-01", &big).is_err());
        let n: i64 = one(&conn, "SELECT COUNT(*) FROM wiki_articles");
        assert_eq!(n, 0);
        // Just under the cap is fine.
        put_wiki_article(&dir, &org, "1", "Notes", &"x".repeat(MAX_TEXT)).unwrap();
    }

    #[test]
    fn folder_must_be_an_existing_folder_in_the_allowed_places() {
        let (dir, org, conn) = fixture();
        let bundle = dir.join("Tool.app").join("Contents");
        std::fs::create_dir_all(&bundle).unwrap();
        std::fs::write(dir.join("file.txt"), "x").unwrap();
        let missing = dir.join("nowhere");
        let refused = [
            ("/Users".to_string(), FOLDER_OUTSIDE),
            ("/".to_string(), FOLDER_OUTSIDE),
            (std::env::temp_dir().to_string_lossy().into_owned(), FOLDER_OUTSIDE),
            (missing.to_string_lossy().into_owned(), FOLDER_MISSING),
            (dir.join("file.txt").to_string_lossy().into_owned(), FOLDER_MISSING),
            (dir.join("Tool.app").to_string_lossy().into_owned(), FOLDER_BUNDLE),
            (bundle.to_string_lossy().into_owned(), FOLDER_BUNDLE),
        ];
        for (path, err) in &refused {
            assert_eq!(link_folder(&dir, &org, "1", path).unwrap_err(), *err, "{path}");
            let change = ProjectChanges { folder_path: Some(path.clone()), ..Default::default() };
            assert_eq!(update_project(&dir, &org, "1", &change).unwrap_err(), *err, "{path}");
        }
        let fp: Option<String> = one(&conn, "SELECT folder_path FROM projects WHERE id = 1");
        assert_eq!(fp, None);
    }

}
