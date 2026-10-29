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
    /// Claude Code trusts it (itself or a folder above it). An untrusted one needs
    /// the person's yes (`trust_folder`) before an agent can start there.
    pub trusted: bool,
    /// It is the home folder: trusting it trusts every folder in it.
    pub home: bool,
}

/// `folder` is trusted when it, or a folder above it, is: Claude Code's own rule
/// (trust given to a folder covers everything inside it).
pub fn is_trusted(trusted: &[String], folder: &str) -> bool {
    let folder = trim_slash(folder);
    trusted.iter().any(|t| {
        let t = trim_slash(t);
        folder == t
            || (folder.starts_with(t) && (t.ends_with('/') || folder[t.len()..].starts_with('/')))
    })
}

/// Folders worth offering that Claude may not trust yet: the home folder, every linked
/// project folder, and the folder holding each trusted or linked folder (where a code
/// folder sits). Only folders inside `home` that exist.
fn suggestions(trusted: &[String], index: &FolderIndex, home: &Path) -> Vec<String> {
    let home_s = trim_slash(&home.to_string_lossy()).to_string();
    let inside = |p: &str| p == home_s || p.starts_with(&format!("{home_s}/"));
    let linked: Vec<String> = index.0.iter().map(|l| trim_slash(&l.folder).to_string()).collect();
    let mut out = vec![home_s.clone()];
    for f in trusted.iter().map(|t| trim_slash(t).to_string()).chain(linked.iter().cloned()) {
        if let Some(parent) = Path::new(&f).parent() {
            out.push(parent.to_string_lossy().to_string());
        }
    }
    out.extend(linked);
    out.retain(|p| inside(p) && Path::new(p).is_dir());
    out
}

/// Trusted folders first (linked ones by organisation, client, project, then the rest by
/// path), then the untrusted suggestions (home first, then by path). No duplicates.
pub fn start_folders(
    trusted: Vec<String>,
    index: &FolderIndex,
    home: Option<&Path>,
) -> Vec<StartFolder> {
    let extra = home.map(|h| suggestions(&trusted, index, h)).unwrap_or_default();
    let home_s = home.map(|h| trim_slash(&h.to_string_lossy()).to_string());
    let mut seen = std::collections::HashSet::new();
    let all: Vec<StartFolder> = trusted
        .iter()
        .cloned()
        .chain(extra)
        .filter(|p| seen.insert(trim_slash(p).to_string()))
        .map(|path| StartFolder {
            label: index.label_for(&path),
            trusted: is_trusted(&trusted, &path),
            home: home_s.as_deref() == Some(trim_slash(&path)),
            path,
        })
        .collect();
    let (yes, mut no): (Vec<_>, Vec<_>) = all.into_iter().partition(|f| f.trusted);
    let (mut linked, mut rest): (Vec<_>, Vec<_>) =
        yes.into_iter().partition(|f| f.label.is_some());
    linked.sort_by_key(|f| {
        let l = f.label.as_ref().unwrap();
        (l.org_name.clone(), l.client_name.clone(), l.project_name.clone(), f.path.clone())
    });
    rest.sort_by(|a, b| a.path.cmp(&b.path));
    no.sort_by_key(|f| (Some(trim_slash(&f.path).to_string()) != home_s, f.path.clone()));
    linked.extend(rest);
    linked.extend(no);
    linked
}

const LOCK_TRIES: u32 = 50;

/// Marks `folder` trusted in Claude Code's config (`projects[folder].hasTrustDialogAccepted`),
/// what Claude's own trust question does on Yes. Only after the person said yes in the app.
/// Takes Claude's lock (`<config>.lock`, a directory, as Claude Code does), reads the file
/// fresh, changes that one flag, and writes it back atomically keeping its permissions.
/// Hands back the folder as written (absolute, symlinks resolved).
pub fn trust_folder(config: &Path, folder: &str) -> Result<String, String> {
    if !Path::new(folder).is_absolute() {
        return Err("Folder must be an absolute path".into());
    }
    let dir = std::fs::canonicalize(folder).map_err(|_| "Folder not found".to_string())?;
    if !dir.is_dir() {
        return Err("Not a folder".into());
    }
    let key = dir.to_string_lossy().to_string();
    let name = config.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let lock = config.with_file_name(format!("{name}.lock"));
    let mut tries = 0;
    while std::fs::create_dir(&lock).is_err() {
        tries += 1;
        if tries >= LOCK_TRIES {
            return Err("Claude Code is saving its settings: try again".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    let result = set_trust_flag(config, &key);
    let _ = std::fs::remove_dir(&lock);
    result.map(|_| key)
}

fn set_trust_flag(config: &Path, key: &str) -> Result<(), String> {
    let raw = match std::fs::read_to_string(config) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => "{}".into(),
        Err(e) => return Err(format!("Couldn't read Claude's settings: {e}")),
    };
    let mut v: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|_| "Claude's settings file is not valid JSON".to_string())?;
    let root = v.as_object_mut().ok_or("Claude's settings file is not a JSON object")?;
    let projects = root
        .entry("projects")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or("Claude's settings: \"projects\" is not an object")?;
    let entry = projects
        .entry(key.to_string())
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or("Claude's settings: the folder's entry is not an object")?;
    entry.insert("hasTrustDialogAccepted".into(), serde_json::Value::Bool(true));
    let json = serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?;
    write_keeping_mode(config, &format!("{json}\n"))
}

/// Atomic write (temp file + rename) that keeps the file's permissions: Claude's config
/// is private (0600), a plain write would leave the new file readable by others.
fn write_keeping_mode(path: &Path, contents: &str) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let mode = std::fs::metadata(path).map(|m| m.permissions().mode() & 0o777).unwrap_or(0o600);
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let tmp = path.with_file_name(format!("{name}.sm-{}.tmp", std::process::id()));
    let write = || -> std::io::Result<()> {
        let mut f =
            std::fs::OpenOptions::new().write(true).create_new(true).mode(mode).open(&tmp)?;
        f.set_permissions(std::fs::Permissions::from_mode(mode))?;
        f.write_all(contents.as_bytes())?;
        f.sync_all()?;
        std::fs::rename(&tmp, path)
    };
    write().map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Couldn't save Claude's settings: {e}")
    })
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
    let home_opt = (!home.as_os_str().is_empty()).then_some(home.as_path());
    Ok(start_folders(read_trusted(&home), &load_index(&state.app_dir), home_opt))
}

/// Trusts `folder` for Claude Code, after the person confirmed it in the app.
#[tauri::command]
pub async fn agents_trust_folder(
    state: tauri::State<'_, super::AgentsState>,
    folder: String,
) -> Result<String, String> {
    if !super::cli::read_settings(&state.app_dir).enabled {
        return Err("Agents are switched off".into());
    }
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from).ok_or("No home folder")?;
    super::pty::blocking(move || trust_folder(&home.join(".claude.json"), &folder)).await
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
        let out =
            start_folders(vec!["/z".into(), "/lb/sub".into(), "/a".into(), "/la".into()], &idx, None);
        let paths: Vec<_> = out.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, vec!["/la", "/lb/sub", "/a", "/z"]);
        assert!(out[2].label.is_none());
        assert!(out.iter().all(|f| f.trusted));
    }

    #[test]
    fn trust_covers_subfolders_only() {
        let t = vec!["/a/b".to_string(), "/c/".to_string()];
        assert!(is_trusted(&t, "/a/b"));
        assert!(is_trusted(&t, "/a/b/"));
        assert!(is_trusted(&t, "/a/b/x/y"));
        assert!(is_trusted(&t, "/c/d"));
        assert!(!is_trusted(&t, "/a"));
        assert!(!is_trusted(&t, "/a/bc"));
    }

    #[test]
    fn start_folders_suggests_home_and_parents() {
        let home = std::fs::canonicalize(temp_dir("sugg")).unwrap();
        let h = home.to_string_lossy().to_string();
        for d in ["Code/repo", "Code/other", "Clients/acme"] {
            std::fs::create_dir_all(home.join(d)).unwrap();
        }
        let linked = format!("{h}/Clients/acme");
        let app = make_app("sugg-app", &[("Studio", &[("Acme", "Site", linked.as_str())])]);
        let idx = load_index(&app);
        let trusted = vec![format!("{h}/Code/repo"), "/elsewhere/x".to_string()];
        let out = start_folders(trusted, &idx, Some(&home));
        let rows: Vec<_> = out.iter().map(|f| (f.path.clone(), f.trusted)).collect();
        assert_eq!(
            rows,
            vec![
                ("/elsewhere/x".to_string(), true),
                (format!("{h}/Code/repo"), true),
                (h.clone(), false),
                (format!("{h}/Clients"), false),
                (format!("{h}/Clients/acme"), false),
                (format!("{h}/Code"), false),
            ]
        );
        assert_eq!(out[4].label.as_ref().unwrap().project_name, "Site");
        assert!(out[2].home);
        assert_eq!(out.iter().filter(|f| f.home).count(), 1);
    }

    #[test]
    fn trust_folder_sets_flag_keeps_rest_and_mode() {
        use std::os::unix::fs::PermissionsExt;
        let home = temp_dir("trust");
        let cfg = home.join(".claude.json");
        std::fs::write(
            &cfg,
            r#"{"zeta":1,"projects":{"/other":{"hasTrustDialogAccepted":true,"allowedTools":["x"]}},"alpha":2}"#,
        )
        .unwrap();
        std::fs::set_permissions(&cfg, std::fs::Permissions::from_mode(0o600)).unwrap();
        let folder = home.join("Code");
        std::fs::create_dir_all(&folder).unwrap();
        let key = trust_folder(&cfg, folder.to_str().unwrap()).unwrap();
        assert_eq!(key, std::fs::canonicalize(&folder).unwrap().to_string_lossy());
        let raw = std::fs::read_to_string(&cfg).unwrap();
        assert!(raw.find("\"zeta\"").unwrap() < raw.find("\"alpha\"").unwrap(), "key order kept");
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(v["projects"][&key]["hasTrustDialogAccepted"], true);
        assert_eq!(v["projects"]["/other"]["allowedTools"][0], "x");
        assert_eq!(read_trusted(&home).len(), 2);
        assert_eq!(std::fs::metadata(&cfg).unwrap().permissions().mode() & 0o777, 0o600);
        assert!(!home.join(".claude.json.lock").exists());
    }

    #[test]
    fn trust_folder_refuses_bad_input() {
        let home = temp_dir("trust-bad");
        let cfg = home.join(".claude.json");
        assert!(trust_folder(&cfg, "relative/path").is_err());
        assert!(trust_folder(&cfg, "/no/such/folder/anywhere").is_err());
        let file = home.join("f.txt");
        std::fs::write(&file, "x").unwrap();
        assert!(trust_folder(&cfg, file.to_str().unwrap()).is_err());
        std::fs::write(&cfg, "not json").unwrap();
        assert!(trust_folder(&cfg, home.to_str().unwrap()).is_err());
        assert_eq!(std::fs::read_to_string(&cfg).unwrap(), "not json");
        assert!(!home.join(".claude.json.lock").exists());
    }

    #[test]
    fn trust_folder_waits_for_claude_lock() {
        let home = temp_dir("trust-lock");
        let cfg = home.join(".claude.json");
        std::fs::create_dir(home.join(".claude.json.lock")).unwrap();
        assert!(trust_folder(&cfg, home.to_str().unwrap()).unwrap_err().contains("try again"));
        assert!(!cfg.exists());
    }
}
