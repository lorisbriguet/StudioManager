//! Test fixtures: temp data dirs and databases shaped like ones the app has
//! opened (numbered migrations plus the tables `ensureSchema()` adds).

use crate::{migrate, orgs};
use std::path::{Path, PathBuf};

pub fn temp_data_dir() -> PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let n = N.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("sm-mcp-{nanos}-{n}"));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Mirrors the app-only definitions in `src/db/index.ts` `ensureSchema()`.
pub const APP_ONLY_SCHEMA: &str = "
    CREATE TABLE IF NOT EXISTS resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      price TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS resource_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      tag TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS resource_projects (
      resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      PRIMARY KEY (resource_id, project_id)
    );
    ALTER TABLE projects ADD COLUMN folder_path TEXT DEFAULT NULL;
    CREATE TABLE IF NOT EXISTS wiki_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS wiki_articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id INTEGER REFERENCES wiki_folders(id) ON DELETE SET NULL,
      project_id INTEGER DEFAULT NULL,
      title TEXT NOT NULL DEFAULT 'Untitled',
      content TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS wiki_article_tags (
      article_id INTEGER NOT NULL REFERENCES wiki_articles(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (article_id, tag)
    );
";

pub fn db_path(dir: &Path, org_id: &str) -> PathBuf {
    orgs::org_dir(dir, org_id).join(orgs::DB_FILE)
}

/// Numbered migrations only, as if the app never opened the file.
pub fn seed_migrated_only(dir: &Path, org_id: &str) -> PathBuf {
    let db = db_path(dir, org_id);
    migrate::migrate_db(&db).unwrap();
    db
}

pub fn seed_app_db(dir: &Path, org_id: &str) -> PathBuf {
    let db = seed_migrated_only(dir, org_id);
    let conn = rusqlite::Connection::open(&db).unwrap();
    conn.execute_batch(APP_ONLY_SCHEMA).unwrap();
    db
}

/// Write `organisations.json` with `(id, name)` pairs; the first is active.
pub fn write_registry(dir: &Path, orgs_list: &[(&str, &str)]) {
    let mut reg = orgs::Registry::empty();
    for (id, name) in orgs_list {
        reg.organisations.push(orgs::Organisation {
            id: id.to_string(),
            name: name.to_string(),
            created_at: orgs::now_iso(),
            prefs: None,
        });
    }
    reg.active_id = orgs_list
        .first()
        .map(|o| o.0.to_string())
        .unwrap_or_default();
    reg.save(dir).unwrap();
}

pub fn write_access(dir: &Path, json: &str) {
    std::fs::write(dir.join("agent-access.json"), json).unwrap();
}

/// Data dir with one app-opened org and access fully on.
pub fn ready_dir(org_id: &str, name: &str) -> PathBuf {
    let dir = temp_data_dir();
    write_registry(&dir, &[(org_id, name)]);
    seed_app_db(&dir, org_id);
    write_access(
        &dir,
        r#"{"enabled": true, "allowMoney": false, "orgs": {}}"#,
    );
    dir
}
