//! A project's Markdown files (DESIGN-SYSTEM.md, docs/…), shown read-only in
//! the wiki straight from disk, so there is never a second copy to keep in
//! sync. Rendering happens here: raw HTML in a file is shown as text and only
//! web links and links to other Markdown files survive, so a file can't
//! inject script or navigation into the app.

use pulldown_cmark::{html, CowStr, Event, LinkType, Options, Parser, Tag, TagEnd};
use serde::Serialize;
use std::path::{Component, Path, PathBuf};

const SKIP_DIRS: [&str; 11] = [
    "node_modules", "target", "dist", "build", "vendor", "Pods", "venv", "__pycache__", "coverage", "out", "DerivedData",
];
const MAX_DEPTH: usize = 5;
const MAX_FILES: usize = 300;
const MAX_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct DocEntry {
    /// Path inside the project folder, with `/` separators.
    pub rel: String,
    /// The file's first `# ` heading, else its name.
    pub title: String,
    /// Last modified, in seconds since 1970.
    pub modified: u64,
    /// Other Markdown files of the folder it links to (paths like `rel`).
    pub links: Vec<String>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct DocContent {
    pub title: String,
    pub html: String,
}

/// Folders the app may read (the same roots as its file-system scope).
fn allowed_roots() -> Vec<PathBuf> {
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return Vec::new();
    };
    ["Documents", "Desktop", "Downloads", "Library/CloudStorage"]
        .iter()
        .filter_map(|d| std::fs::canonicalize(home.join(d)).ok())
        .collect()
}

fn checked_folder(folder: &str, roots: &[PathBuf]) -> Result<PathBuf, String> {
    let canonical = std::fs::canonicalize(folder).map_err(|e| format!("folder not found: {folder} ({e})"))?;
    if !canonical.is_dir() {
        return Err(format!("not a folder: {folder}"));
    }
    if !roots.iter().any(|r| canonical.starts_with(r)) {
        return Err(format!("folder outside the readable places: {folder}"));
    }
    Ok(canonical)
}

fn is_markdown(p: &Path) -> bool {
    p.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("md"))
}

fn rel_string(rel: &Path) -> String {
    rel.components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn title_of(text: &str, fallback: &str) -> String {
    text.lines()
        .find_map(|l| l.strip_prefix("# ").map(|t| t.trim().to_string()))
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

pub fn list_docs(folder: &Path) -> Vec<DocEntry> {
    let mut out = Vec::new();
    let mut stack = vec![(folder.to_path_buf(), 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        let mut entries: Vec<_> = entries.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let Ok(ft) = e.file_type() else { continue };
            let path = e.path();
            if ft.is_dir() {
                if depth < MAX_DEPTH && !SKIP_DIRS.contains(&name.as_str()) {
                    stack.push((path, depth + 1));
                }
            } else if ft.is_file() && is_markdown(&path) && out.len() < MAX_FILES {
                let meta = e.metadata().ok();
                if meta.as_ref().is_some_and(|m| m.len() > MAX_BYTES) {
                    continue;
                }
                let text = std::fs::read(&path).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
                let stem = path.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                let rel = rel_string(path.strip_prefix(folder).unwrap_or(&path));
                out.push(DocEntry {
                    links: doc_links(&text, &rel, folder),
                    rel,
                    title: title_of(&text, &stem),
                    modified: meta
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map_or(0, |d| d.as_secs()),
                });
            }
        }
    }
    // Top-level files first (README, DESIGN-SYSTEM…), then by path.
    out.sort_by(|a, b| (a.rel.contains('/'), a.rel.to_lowercase()).cmp(&(b.rel.contains('/'), b.rel.to_lowercase())));
    out
}

/// The Markdown file a link in `doc_rel` points to, as a path in the folder.
fn resolve_doc_link(url: &str, doc_rel: &str, folder: &Path) -> Option<String> {
    if url.contains(':') || url.starts_with('#') {
        return None;
    }
    let doc_dir = Path::new(doc_rel).parent().map(Path::to_path_buf).unwrap_or_default();
    let path = url.split('#').next().unwrap_or("");
    inside(folder, &doc_dir.join(path).to_string_lossy())
        .filter(|p| is_markdown(p))
        .and_then(|p| p.strip_prefix(folder).ok().map(rel_string))
}

/// Every other Markdown file of the folder that `text` links to, once each.
fn doc_links(text: &str, doc_rel: &str, folder: &Path) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for ev in Parser::new_ext(text, Options::ENABLE_TABLES) {
        if let Event::Start(Tag::Link { dest_url, .. }) = ev {
            if let Some(rel) = resolve_doc_link(&dest_url, doc_rel, folder) {
                if rel != doc_rel && !out.contains(&rel) && folder.join(&rel).is_file() {
                    out.push(rel);
                }
            }
        }
    }
    out
}

/// `rel` joined to `folder`, refusing anything that leaves it.
fn inside(folder: &Path, rel: &str) -> Option<PathBuf> {
    let mut out = folder.to_path_buf();
    for c in Path::new(rel).components() {
        match c {
            Component::Normal(s) => out.push(s),
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() || !out.starts_with(folder) {
                    return None;
                }
            }
            _ => return None,
        }
    }
    out.starts_with(folder).then_some(out)
}

/// Markdown to HTML for the wiki: raw HTML becomes text, images their alt
/// text, links to other Markdown files `/wiki?file=<project>:<path>`, web
/// links stay, every other link keeps only its text.
pub fn render(md: &str, project_id: i64, doc_rel: &str, folder: &Path) -> String {
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_SUBSCRIPT
        | Options::ENABLE_TASKLISTS;
    let mut dropped_links: Vec<bool> = Vec::new();
    let mut in_image = 0usize;
    let events = Parser::new_ext(md, options).filter_map(|ev| match ev {
        Event::Html(raw) | Event::InlineHtml(raw) => Some(Event::Text(raw)),
        // Single ~ is plain text (see the agent server's markdown.rs).
        Event::Start(Tag::Subscript) | Event::End(TagEnd::Subscript) => Some(Event::Text("~".into())),
        Event::Start(Tag::Image { .. }) => {
            in_image += 1;
            None
        }
        Event::End(TagEnd::Image) => {
            in_image = in_image.saturating_sub(1);
            None
        }
        Event::Start(Tag::Link { dest_url, title, id, .. }) => {
            let url = dest_url.to_string();
            let target = if url.starts_with("https://") || url.starts_with("http://") {
                Some(url)
            } else {
                resolve_doc_link(&url, doc_rel, folder).map(|rel| format!("/wiki?file={project_id}:{}", encode(&rel)))
            };
            dropped_links.push(target.is_none());
            target.map(|t| Event::Start(Tag::Link { link_type: LinkType::Inline, dest_url: CowStr::from(t), title, id }))
        }
        Event::End(TagEnd::Link) => {
            if dropped_links.pop().unwrap_or(true) {
                None
            } else {
                Some(Event::End(TagEnd::Link))
            }
        }
        other if in_image > 0 => match other {
            Event::Text(t) => Some(Event::Text(t)),
            _ => None,
        },
        other => Some(other),
    });
    let mut out = String::new();
    html::push_html(&mut out, events);
    out
}

/// Percent-encodes a path for a URL query, keeping `/`.
fn encode(rel: &str) -> String {
    rel.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[tauri::command]
pub async fn list_project_docs(folder: String) -> Result<Vec<DocEntry>, String> {
    let folder = checked_folder(&folder, &allowed_roots())?;
    Ok(list_docs(&folder))
}

#[tauri::command]
pub async fn read_project_doc(folder: String, rel: String, project_id: i64) -> Result<DocContent, String> {
    let folder = checked_folder(&folder, &allowed_roots())?;
    let path = inside(&folder, &rel).filter(|p| is_markdown(p)).ok_or("not a Markdown file of this project")?;
    let canonical = std::fs::canonicalize(&path).map_err(|e| format!("file not found: {rel} ({e})"))?;
    if !canonical.starts_with(&folder) {
        return Err("not a Markdown file of this project".into());
    }
    if std::fs::metadata(&canonical).map_err(|e| e.to_string())?.len() > MAX_BYTES {
        return Err("file too large to show".into());
    }
    let text = std::fs::read_to_string(&canonical).map_err(|e| e.to_string())?;
    let name = canonical.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    Ok(DocContent { title: title_of(&text, &name), html: render(&text, project_id, &rel, &folder) })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "sm-docs-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::canonicalize(dir).unwrap()
    }

    #[test]
    fn lists_markdown_files_skipping_build_and_hidden_folders() {
        let d = tmp();
        std::fs::write(d.join("README.md"), "# Read me\nSee [the docs](docs/x.md), [design](DESIGN-SYSTEM.md#tokens), [gone](missing.md), [web](https://x.ch).\n").unwrap();
        std::fs::write(d.join("DESIGN-SYSTEM.md"), "intro\n# Design\n").unwrap();
        std::fs::write(d.join("notes.txt"), "x").unwrap();
        for sub in ["docs", "node_modules/pkg", ".git", "target"] {
            std::fs::create_dir_all(d.join(sub)).unwrap();
            std::fs::write(d.join(sub).join("x.md"), "# X").unwrap();
        }
        let rels: Vec<String> = list_docs(&d).into_iter().map(|e| e.rel).collect();
        assert_eq!(rels, ["DESIGN-SYSTEM.md", "README.md", "docs/x.md"]);
        assert_eq!(list_docs(&d)[0].title, "Design");
        assert_eq!(list_docs(&d)[1].links, ["docs/x.md", "DESIGN-SYSTEM.md"]);
    }

    #[test]
    fn only_reads_inside_the_folder() {
        let d = tmp();
        assert!(inside(&d, "docs/a.md").is_some());
        assert!(inside(&d, "docs/../a.md").is_some());
        assert!(inside(&d, "../a.md").is_none());
        assert!(inside(&d, "/etc/passwd").is_none());
        assert!(checked_folder(d.to_str().unwrap(), &[PathBuf::from("/nowhere")]).is_err());
    }

    #[test]
    fn render_escapes_html_and_filters_links() {
        let d = tmp();
        std::fs::create_dir_all(d.join("docs")).unwrap();
        let md = "<script>alert(1)</script>\n\n[guide](GUIDE.md) [site](https://x.ch) \
                  [bad](javascript:alert(1)) [up](../../outside.md) [root](../RELEASING.md) [anchor](#top)\n\n![logo](logo.png)\n\n\
                  Copy ~/a to ~/b, ~~old~~.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
        let html = render(md, 4, "docs/agent-access.md", &d);
        assert!(!html.contains("<script"), "{html}");
        assert!(html.contains("&lt;script&gt;"), "{html}");
        assert!(html.contains(r#"<a href="/wiki?file=4:docs/GUIDE.md">guide</a>"#), "{html}");
        assert!(html.contains(r#"<a href="https://x.ch">site</a>"#), "{html}");
        assert!(html.contains(r#"<a href="/wiki?file=4:RELEASING.md">root</a>"#), "{html}");
        assert!(!html.contains("javascript"), "{html}");
        assert!(html.contains(">up<") || html.contains(" up "), "{html}");
        assert!(!html.contains("outside.md"), "{html}");
        assert!(!html.contains("<img"), "{html}");
        assert!(html.contains("logo"), "{html}");
        assert!(html.contains("Copy ~/a to ~/b, <del>old</del>."), "{html}");
        assert!(html.contains("<table>"), "{html}");
    }
}
