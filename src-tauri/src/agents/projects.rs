//! Project labels (`Organisation › Client › Project`) across all organisations,
//! and the trusted folders an agent can be started in.

use crate::orgs;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectLabel {
    pub org_id: String,
    pub org_name: String,
    pub client_name: String,
    pub project_id: i64,
    pub project_name: String,
    pub folder: String,
}

/// Every project with a folder, in registry order.
#[derive(Clone, Debug, Default)]
pub struct FolderIndex(pub Vec<ProjectLabel>);

fn trim_slash(s: &str) -> &str {
    if s.len() > 1 {
        s.trim_end_matches('/')
    } else {
        s
    }
}

impl FolderIndex {
    /// The project whose folder is the longest path-component prefix of `cwd`;
    /// ties go to the first in index order.
    pub fn label_for(&self, cwd: &str) -> Option<ProjectLabel> {
        let cwd = trim_slash(cwd);
        let mut best: Option<(usize, &ProjectLabel)> = None;
        for l in &self.0 {
            let f = trim_slash(&l.folder);
            let hit = cwd == f
                || (cwd.starts_with(f) && (f.ends_with('/') || cwd[f.len()..].starts_with('/')));
            if hit && best.map_or(true, |(n, _)| f.len() > n) {
                best = Some((f.len(), l));
            }
        }
        best.map(|(_, l)| l.clone())
    }
}

fn org_projects(db: &Path, org_id: &str, org_name: &str) -> Option<Vec<ProjectLabel>> {
    let conn = Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.name, c.name, p.folder_path FROM projects p \
             JOIN clients c ON c.id = p.client_id \
             WHERE p.folder_path IS NOT NULL AND p.folder_path != ''",
        )
        .ok()?;
    let rows = stmt
        .query_map([], |r| {
            Ok(ProjectLabel {
                org_id: org_id.to_string(),
                org_name: org_name.to_string(),
                project_id: r.get(0)?,
                project_name: r.get(1)?,
                client_name: r.get(2)?,
                folder: r.get(3)?,
            })
        })
        .ok()?;
    Some(rows.filter_map(Result::ok).collect())
}

pub fn load_index(app_dir: &Path) -> FolderIndex {
    let Ok(Some(reg)) = orgs::Registry::load(app_dir) else {
        return FolderIndex::default();
    };
    let mut all = Vec::new();
    for org in &reg.organisations {
        let db = orgs::org_dir(app_dir, &org.id).join(orgs::DB_FILE);
        if let Some(mut v) = org_projects(&db, &org.id, &org.name) {
            all.append(&mut v);
        }
    }
    FolderIndex(all)
}

/// Keys of `projects` whose value has `hasTrustDialogAccepted == true`.
pub fn trusted_folders(claude_json: &str) -> Vec<String> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(claude_json) else {
        return Vec::new();
    };
    v.get("projects")
        .and_then(|p| p.as_object())
        .map(|m| {
            m.iter()
                .filter(|(_, e)| {
                    e.get("hasTrustDialogAccepted").and_then(|b| b.as_bool()) == Some(true)
                })
                .map(|(k, _)| k.clone())
                .collect()
        })
        .unwrap_or_default()
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StartFolder {
    pub path: String,
    pub label: Option<ProjectLabel>,
}

/// Linked folders first (by organisation, client, project), then the rest by path.
pub fn start_folders(trusted: Vec<String>, index: &FolderIndex) -> Vec<StartFolder> {
    let (mut linked, mut rest): (Vec<_>, Vec<_>) = trusted
        .into_iter()
        .map(|path| StartFolder { label: index.label_for(&path), path })
        .partition(|f| f.label.is_some());
    linked.sort_by_key(|f| {
        let l = f.label.as_ref().unwrap();
        (l.org_name.clone(), l.client_name.clone(), l.project_name.clone(), f.path.clone())
    });
    rest.sort_by(|a, b| a.path.cmp(&b.path));
    linked.extend(rest);
    linked
}

/// Reads `<home>/.claude.json` fresh (read-only).
pub fn read_trusted(home: &Path) -> Vec<String> {
    std::fs::read_to_string(home.join(".claude.json"))
        .map(|s| trusted_folders(&s))
        .unwrap_or_default()
}

#[tauri::command]
pub async fn agents_start_folders(
    state: tauri::State<'_, super::AgentsState>,
) -> Result<Vec<StartFolder>, String> {
    if !super::cli::read_settings(&state.app_dir).enabled {
        return Err("Agents are switched off".into());
    }
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from).unwrap_or_default();
    Ok(start_folders(read_trusted(&home), &load_index(&state.app_dir)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("sm-agents-proj-{nanos}-{name}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    type Spec<'a> = &'a [(&'a str, &'a [(&'a str, &'a str, &'a str)])];

    /// Registry with the given orgs in order; each org is (name, [(client, project, folder)]).
    fn make_app(name: &str, orgs_spec: Spec) -> std::path::PathBuf {
        let app = temp_dir(name);
        let mut reg = orgs::Registry::empty();
        for (org, projects) in orgs_spec {
            let id = reg.add(org, None).unwrap().id.clone();
            let dir = orgs::org_dir(&app, &id);
            std::fs::create_dir_all(&dir).unwrap();
            let conn = Connection::open(dir.join(orgs::DB_FILE)).unwrap();
            conn.execute_batch(
                "CREATE TABLE clients(id INTEGER PRIMARY KEY, name TEXT);
                 CREATE TABLE projects(id INTEGER PRIMARY KEY, name TEXT, client_id INTEGER, folder_path TEXT);",
            )
            .unwrap();
            for (i, (client, project, folder)) in projects.iter().enumerate() {
                let n = i as i64 + 1;
                conn.execute("INSERT INTO clients(id, name) VALUES (?1, ?2)", (n, client)).unwrap();
                let f: Option<&str> = if folder.is_empty() { None } else { Some(folder) };
                conn.execute(
                    "INSERT INTO projects(id, name, client_id, folder_path) VALUES (?1, ?2, ?1, ?3)",
                    (n, project, f),
                )
                .unwrap();
            }
        }
        reg.save(&app).unwrap();
        app
    }

    #[test]
    fn label_exact_and_child() {
        let app = make_app("exact", &[("Studio", &[("Acme", "Site", "/a/b/")])]);
        let idx = load_index(&app);
        let l = idx.label_for("/a/b").unwrap();
        assert_eq!(
            (l.org_name.as_str(), l.client_name.as_str(), l.project_name.as_str()),
            ("Studio", "Acme", "Site")
        );
        assert_eq!(idx.label_for("/a/b/c/d").unwrap().project_name, "Site");
        assert_eq!(idx.label_for("/a/b/").unwrap().project_name, "Site");
    }

    #[test]
    fn no_match_for_sibling_prefix() {
        let app = make_app("sibling", &[("Studio", &[("Acme", "Site", "/a/b")])]);
        let idx = load_index(&app);
        assert_eq!(idx.label_for("/a/bc"), None);
        assert_eq!(idx.label_for("/a"), None);
    }

    #[test]
    fn nested_and_duplicate_folders() {
        let app = make_app(
            "nested",
            &[
                ("A", &[("c", "a-root", "/w"), ("c", "a-x", "/w/x")]),
                ("B", &[("c", "b-x", "/w/x")]),
            ],
        );
        let idx = load_index(&app);
        let xy = idx.label_for("/w/x/y").unwrap();
        assert_eq!((xy.org_name.as_str(), xy.project_name.as_str()), ("A", "a-x"));
        assert_eq!(idx.label_for("/w/z").unwrap().project_name, "a-root");
    }

    #[test]
    fn missing_db_skipped() {
        let app = make_app("missing", &[("A", &[("c", "p", "/a")]), ("B", &[("c", "q", "/b")])]);
        let reg = orgs::Registry::load(&app).unwrap().unwrap();
        let a = &reg.organisations[0].id;
        std::fs::remove_file(orgs::org_dir(&app, a).join(orgs::DB_FILE)).unwrap();
        let idx = load_index(&app);
        assert_eq!(idx.label_for("/a"), None);
        assert_eq!(idx.label_for("/b").unwrap().project_name, "q");
        assert!(load_index(&temp_dir("noreg")).0.is_empty());
    }

    #[test]
    fn empty_folder_ignored() {
        let app = make_app("empty", &[("A", &[("c", "p", "")])]);
        assert!(load_index(&app).0.is_empty());
    }

    #[test]
    fn trusted_folders_filters_flag() {
        let json = r#"{"projects":{"/t":{"hasTrustDialogAccepted":true},"/f":{"hasTrustDialogAccepted":false},"/n":{}}}"#;
        assert_eq!(trusted_folders(json), vec!["/t".to_string()]);
        assert!(trusted_folders("not json").is_empty());
        assert!(trusted_folders("{}").is_empty());
    }

    #[test]
    fn read_trusted_reads_home_file() {
        let home = temp_dir("home");
        assert!(read_trusted(&home).is_empty());
        std::fs::write(
            home.join(".claude.json"),
            r#"{"projects":{"/t":{"hasTrustDialogAccepted":true}}}"#,
        )
        .unwrap();
        assert_eq!(read_trusted(&home), vec!["/t".to_string()]);
    }

    #[test]
    fn start_folders_linked_first() {
        let app = make_app("start", &[("Beta", &[("c", "p", "/lb")]), ("Alpha", &[("c", "p", "/la")])]);
        let idx = load_index(&app);
        let out = start_folders(vec!["/z".into(), "/lb/sub".into(), "/a".into(), "/la".into()], &idx);
        let paths: Vec<_> = out.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, vec!["/la", "/lb/sub", "/a", "/z"]);
        assert!(out[2].label.is_none());
    }
}
