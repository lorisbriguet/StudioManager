//! The tie between a hub and its projects: a project whose folder is inside a hub's folder is
//! never merged alone. The watcher asks `in_any_hub` before every merge; `mark_hub_projects`
//! writes the mark when a hub is saved, so removing the hub later does not free its projects.

use super::settings::{read_hubs, HubsRead};
use crate::agents::briefing::{in_mode, MODE_FILES};
use crate::orgs::Registry;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::time::Duration;

fn trim_slash(s: &str) -> &str {
    if s.len() > 1 {
        s.trim_end_matches('/')
    } else {
        s
    }
}

/// Canonical when the path exists (symlinks, `..`), as given otherwise.
fn canonical(p: &str) -> String {
    Path::new(p).canonicalize().map(|c: PathBuf| c.to_string_lossy().into_owned()).unwrap_or_else(|_| p.to_string())
}

/// Whether `folder` is `root` or inside it: the rule of `FolderIndex::label_for` (path
/// components, a trailing `/` ignored), on canonical paths when both exist, compared without
/// case (the Mac's default file system).
pub fn folder_in(folder: &str, root: &str) -> bool {
    let (folder, root) = if Path::new(folder).exists() && Path::new(root).exists() {
        (canonical(folder), canonical(root))
    } else {
        (folder.to_string(), root.to_string())
    };
    let folder = trim_slash(&folder).to_lowercase();
    let root = trim_slash(&root).to_lowercase();
    folder == root || (folder.starts_with(&root) && (root.ends_with('/') || folder[root.len()..].starts_with('/')))
}

/// Whether `folder` is inside a hub's folder. No hubs file, or no folder: false. An unreadable
/// file is an error: the merge treats it as a hub. `demo` reads nothing.
pub fn in_any_hub(app_dir: &Path, folder: Option<&str>, demo: bool) -> Result<bool, String> {
    match read_hubs(app_dir, demo) {
        HubsRead::Absent => Ok(false),
        HubsRead::Unreadable(e) => Err(e),
        HubsRead::Hubs(hubs) => Ok(folder.filter(|f| !f.is_empty()).is_some_and(|f| hubs.iter().any(|h| folder_in(f, &h.folder)))),
    }
}

/// The projects of one organisation that are in the folder and still need the mark.
struct Found {
    db: PathBuf,
    ids: Vec<i64>,
}

/// Whether `projects` has the columns the mark needs (migration 018).
fn has_mark_columns(conn: &Connection) -> bool {
    let Ok(mut stmt) = conn.prepare("PRAGMA table_info(projects)") else { return false };
    let Ok(rows) = stmt.query_map([], |r| r.get::<_, String>(1)) else { return false };
    let names: Vec<String> = rows.flatten().collect();
    names.iter().any(|n| n == "hub_project") && names.iter().any(|n| n == "merge_alone")
}

/// Reads, in every organisation, the projects inside `hub_folder` that are not marked yet. Takes
/// the organisations lock first and checks the modes and every database under it, so nothing
/// changes between this check and the writes (the lock is held by the caller).
fn find_projects(app_dir: &Path, hub_folder: &str) -> Result<Vec<Found>, String> {
    let reg = Registry::load(app_dir).map_err(|e| format!("Organisations unreadable, nothing marked: {e}"))?;
    let orgs: Vec<(String, PathBuf)> = reg
        .map(|r| r.organisations.into_iter().map(|o| (o.name.clone(), crate::orgs::org_dir(app_dir, &o.id).join(crate::orgs::DB_FILE))).collect())
        .unwrap_or_default();
    let orgs: Vec<(String, PathBuf)> = orgs.into_iter().filter(|(_, db)| db.exists()).collect();
    if orgs.iter().any(|(_, db)| in_mode(db)) {
        return Err(format!("An organisation is in test or presentation mode ({}): nothing marked.", MODE_FILES.join(", ")));
    }
    let mut found = Vec::new();
    for (name, db) in orgs {
        let conn = Connection::open(&db).map_err(|e| format!("Failed to open the database of {name}: {e}"))?;
        let _ = conn.busy_timeout(Duration::from_secs(5));
        if !has_mark_columns(&conn) {
            return Err(format!("Open {name} once in StudioManager so it is brought up to date, then try again. Nothing was marked."));
        }
        let mut stmt = conn
            .prepare("SELECT id, folder_path FROM projects WHERE folder_path IS NOT NULL AND folder_path != '' AND (hub_project = 0 OR merge_alone != 0)")
            .map_err(|e| format!("Failed to read the projects of {name}: {e}"))?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?)))
            .map_err(|e| format!("Failed to read the projects of {name}: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to read the projects of {name}: {e}"))?;
        let ids: Vec<i64> = rows.into_iter().filter(|(_, f)| f.as_deref().is_some_and(|f| folder_in(f, hub_folder))).map(|(id, _)| id).collect();
        found.push(Found { db, ids });
    }
    Ok(found)
}

/// How many projects, in every organisation, are inside `hub_folder` and would be marked. Reads
/// only; refused in the same cases as `mark_hub_projects`.
pub fn count_hub_projects(app_dir: &Path, hub_folder: &str) -> Result<usize, String> {
    let _shared = crate::org_shared();
    Ok(find_projects(app_dir, hub_folder)?.iter().map(|f| f.ids.len()).sum())
}

/// Marks every project, in every organisation, whose folder is inside `hub_folder`: hub project
/// on, merging alone off. Refused while any organisation is in test or presentation mode, the
/// organisations cannot be listed, or one of them is not up to date (nothing is written then).
/// Returns how many projects changed.
pub fn mark_hub_projects(app_dir: &Path, hub_folder: &str) -> Result<usize, String> {
    let _shared = crate::org_shared();
    let found = find_projects(app_dir, hub_folder)?;
    let mut changed = 0;
    for f in found.into_iter().filter(|f| !f.ids.is_empty()) {
        let mut conn = Connection::open(&f.db).map_err(|e| format!("Failed to open a database: {e}"))?;
        let _ = conn.busy_timeout(Duration::from_secs(5));
        let tx = conn.transaction().map_err(|e| format!("Failed to start a write: {e}"))?;
        for id in &f.ids {
            tx.execute("UPDATE projects SET hub_project = 1, merge_alone = 0 WHERE id = ?1", [id])
                .map_err(|e| format!("Failed to mark a project: {e}"))?;
            changed += 1;
        }
        tx.commit().map_err(|e| format!("Failed to save: {e}"))?;
    }
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::super::settings::{write_hubs, Hub, HUBS_FILE};
    use super::*;
    use crate::orgs::{org_dir, Organisation, DB_FILE};

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sm-hubtie-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// An app folder with one organisation per `(id, folders of its projects)`.
    fn app(name: &str, orgs: &[(&str, &[&str])]) -> PathBuf {
        let dir = tmp(name);
        Registry {
            version: 1,
            active_id: orgs[0].0.to_string(),
            organisations: orgs
                .iter()
                .map(|(id, _)| Organisation {
                    id: id.to_string(),
                    name: format!("Studio {id}"),
                    created_at: "2026-01-01T00:00:00Z".into(),
                    prefs: None,
                })
                .collect(),
        }
        .save(&dir)
        .unwrap();
        for (id, folders) in orgs {
            let odir = org_dir(&dir, id);
            std::fs::create_dir_all(&odir).unwrap();
            let c = Connection::open(odir.join(DB_FILE)).unwrap();
            c.execute_batch(
                "CREATE TABLE projects (id INTEGER PRIMARY KEY, folder_path TEXT, merge_alone INTEGER NOT NULL DEFAULT 0, hub_project INTEGER NOT NULL DEFAULT 0);",
            )
            .unwrap();
            for f in *folders {
                c.execute("INSERT INTO projects (folder_path, merge_alone) VALUES (?1, 1)", [f]).unwrap();
            }
        }
        dir
    }

    fn flags(dir: &Path, org: &str) -> Vec<(i64, i64)> {
        let c = Connection::open(org_dir(dir, org).join(DB_FILE)).unwrap();
        let mut s = c.prepare("SELECT hub_project, merge_alone FROM projects ORDER BY id").unwrap();
        let rows = s.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(|r| r.unwrap()).collect();
        rows
    }

    fn hub(folder: &str) -> Hub {
        Hub { id: "h00000001".into(), name: "Demo hub".into(), colour: "purple".into(), folder: folder.into(), program: "/bin/sh".into(), args: vec![] }
    }

    #[test]
    fn folder_in_follows_path_components() {
        assert!(folder_in("/w/hub", "/w/hub"));
        assert!(folder_in("/w/hub/notes/a", "/w/hub"));
        assert!(!folder_in("/w/hub-old", "/w/hub"));
        assert!(!folder_in("/w", "/w/hub"));
        assert!(folder_in("/w/hub/", "/w/hub"));
        assert!(folder_in("/w/hub", "/w/hub/"));
        assert!(folder_in("/W/Hub/x", "/w/hub"));
        assert!(folder_in("/anything", "/"));
    }

    #[test]
    fn folder_in_uses_canonical_paths_when_both_exist() {
        let dir = tmp("canon");
        let hub = dir.join("hub");
        std::fs::create_dir_all(hub.join("p")).unwrap();
        let link = dir.join("link");
        std::os::unix::fs::symlink(&hub, &link).unwrap();
        assert!(folder_in(&link.join("p").display().to_string(), &hub.display().to_string()));
        assert!(folder_in(&format!("{}/../hub/p", hub.display()), &hub.display().to_string()));
    }

    #[test]
    fn mark_hub_projects_marks_inside_and_leaves_outside() {
        let dir = app("mark", &[("a", &["/w/hub/one", "/w/elsewhere"]), ("b", &["/w/hub", "/w/hub-old"])]);
        let n = mark_hub_projects(&dir, "/w/hub").unwrap();
        assert_eq!(n, 2);
        assert_eq!(flags(&dir, "a"), vec![(1, 0), (0, 1)]);
        assert_eq!(flags(&dir, "b"), vec![(1, 0), (0, 1)]);
        // Again: nothing more changes.
        assert_eq!(mark_hub_projects(&dir, "/w/hub").unwrap(), 0);
    }

    #[test]
    fn a_percent_or_underscore_in_a_folder_name_matches_nothing_extra() {
        let dir = app("like", &[("a", &["/w/ab/x", "/w/a%/x", "/w/a_/x"])]);
        assert_eq!(mark_hub_projects(&dir, "/w/a%").unwrap(), 1);
        assert_eq!(flags(&dir, "a"), vec![(0, 1), (1, 0), (0, 1)]);
    }

    #[test]
    fn mark_is_refused_in_a_mode_and_writes_nothing() {
        let dir = app("mode", &[("a", &["/w/hub/one"]), ("b", &["/w/hub/two"])]);
        std::fs::write(org_dir(&dir, "b").join(MODE_FILES[0]), "").unwrap();
        assert!(mark_hub_projects(&dir, "/w/hub").is_err());
        assert_eq!(flags(&dir, "a"), vec![(0, 1)]);
        assert_eq!(flags(&dir, "b"), vec![(0, 1)]);
    }

    #[test]
    fn count_matches_mark_and_writes_nothing() {
        let dir = app("count", &[("a", &["/w/hub/one", "/w/elsewhere"]), ("b", &["/w/hub", "/w/hub-old"])]);
        assert_eq!(count_hub_projects(&dir, "/w/hub").unwrap(), 2);
        assert_eq!(count_hub_projects(&dir, "/w/none").unwrap(), 0);
        assert_eq!(flags(&dir, "a"), vec![(0, 1), (0, 1)]);
        assert_eq!(mark_hub_projects(&dir, "/w/hub").unwrap(), 2);
        assert_eq!(count_hub_projects(&dir, "/w/hub").unwrap(), 0);
        std::fs::write(org_dir(&dir, "b").join(MODE_FILES[0]), "").unwrap();
        assert!(count_hub_projects(&dir, "/w/hub").is_err());
    }

    #[test]
    fn an_organisation_not_brought_up_to_date_stops_everything_and_is_named() {
        let dir = app("old", &[("a", &["/w/hub/one"]), ("b", &["/w/hub/two"])]);
        // Organisation b has no `hub_project` column yet.
        let c = Connection::open(org_dir(&dir, "b").join(DB_FILE)).unwrap();
        c.execute_batch("DROP TABLE projects; CREATE TABLE projects (id INTEGER PRIMARY KEY, folder_path TEXT, merge_alone INTEGER NOT NULL DEFAULT 0); INSERT INTO projects (folder_path, merge_alone) VALUES ('/w/hub/two', 1);")
            .unwrap();
        drop(c);
        for err in [mark_hub_projects(&dir, "/w/hub").unwrap_err(), count_hub_projects(&dir, "/w/hub").unwrap_err()] {
            assert!(err.contains("Studio b") && err.contains("Open"), "{err}");
        }
        // Organisation a, listed first, was not written either.
        assert_eq!(flags(&dir, "a"), vec![(0, 1)]);
    }

    #[test]
    fn mark_is_refused_when_the_registry_is_unreadable() {
        let dir = app("badreg", &[("a", &["/w/hub/one"])]);
        for entry in std::fs::read_dir(&dir).unwrap().flatten() {
            if entry.path().is_file() {
                std::fs::write(entry.path(), "garbled").unwrap();
            }
        }
        assert!(mark_hub_projects(&dir, "/w/hub").is_err());
        assert_eq!(flags(&dir, "a"), vec![(0, 1)]);
    }

    #[test]
    fn in_any_hub_answers_for_absent_present_and_unreadable() {
        let dir = tmp("any");
        assert_eq!(in_any_hub(&dir, Some("/w/hub/x"), false), Ok(false));
        write_hubs(&dir, &[hub("/w/hub")]).unwrap();
        assert_eq!(in_any_hub(&dir, Some("/w/hub/x"), false), Ok(true));
        assert_eq!(in_any_hub(&dir, Some("/w/other"), false), Ok(false));
        assert_eq!(in_any_hub(&dir, None, false), Ok(false));
        assert_eq!(in_any_hub(&dir, Some("/w/hub/x"), true), Ok(false));
        std::fs::write(dir.join(HUBS_FILE), "garbled").unwrap();
        assert!(in_any_hub(&dir, Some("/w/other"), false).is_err());
    }
}
