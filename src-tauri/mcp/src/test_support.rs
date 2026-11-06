//! Test fixtures: temp data dirs and databases shaped like ones the app has
//! opened (the numbered migrations create the whole schema).

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

pub fn db_path(dir: &Path, org_id: &str) -> PathBuf {
    orgs::org_dir(dir, org_id).join(orgs::DB_FILE)
}

/// A database at the latest migration, as the app leaves it.
pub fn seed_migrated_only(dir: &Path, org_id: &str) -> PathBuf {
    let db = db_path(dir, org_id);
    migrate::migrate_db(&db).unwrap();
    db
}

/// Same as [`seed_migrated_only`]: kept for the tests that read better with it.
pub fn seed_app_db(dir: &Path, org_id: &str) -> PathBuf {
    seed_migrated_only(dir, org_id)
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
