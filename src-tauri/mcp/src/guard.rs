//! Access and database guards every tool goes through: the access settings
//! (re-read on each call), organisation resolution, the schema check and
//! the test/presentation mode check for writes.

use crate::orgs::{self, Registry};
use crate::text::fold;
use rusqlite::{Connection, OpenFlags};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const ACCESS_FILE: &str = "agent-access.json";
pub const MODE_FILES: [&str; 2] = ["studiomanager_test.db", "studiomanager_presentation.db"];

pub const OFF_OVERALL: &str = "Agent access is off in StudioManager (Settings > Agent access).";
pub const MODE_ACTIVE: &str =
    "StudioManager is in test or presentation mode; changes are paused until it leaves that mode.";
pub const NOT_OPENED: &str = "Open StudioManager once with this organisation, then try again.";
pub const DB_NEWER: &str = "This database is newer than the agent tools. Update StudioManager.";

pub fn org_off(name: &str) -> String {
    format!("Agent access is off for the organisation \"{name}\".")
}

/// Tables and columns the tools rely on that only the app's `ensureSchema()`
/// creates (not the numbered migrations).
const APP_TABLES: [&str; 5] = [
    "resources",
    "resource_projects",
    "wiki_folders",
    "wiki_articles",
    "wiki_article_tags",
];
const APP_COLUMNS: [(&str, &str); 1] = [("projects", "folder_path")];

#[derive(Deserialize, Default, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AccessConfig {
    pub enabled: bool,
    pub allow_money: bool,
    pub orgs: HashMap<String, bool>,
}

impl AccessConfig {
    /// Missing or unreadable file: everything off.
    pub fn load(dir: &Path) -> AccessConfig {
        std::fs::read_to_string(dir.join(ACCESS_FILE))
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    /// An organisation missing from `orgs` is allowed when access is on.
    pub fn org_allowed(&self, id: &str) -> bool {
        self.enabled && self.orgs.get(id).copied().unwrap_or(true)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Org {
    pub id: String,
    pub name: String,
    pub db: PathBuf,
}

/// Find an organisation by id or by accent/case-folded name (`None`: the
/// app's active one) and check that agent access allows it.
pub fn resolve_org(dir: &Path, org: Option<&str>) -> Result<Org, String> {
    let access = AccessConfig::load(dir);
    if !access.enabled {
        return Err(OFF_OVERALL.to_string());
    }
    let registry = Registry::load(dir)?.ok_or_else(|| NOT_OPENED.to_string())?;
    let found = match org.map(str::trim) {
        None | Some("") => registry
            .active()
            .ok_or_else(|| "StudioManager has no active organisation.".to_string())?,
        Some(query) => match registry.find(query) {
            Some(o) => o,
            None => find_by_name(&registry, &access, query)?,
        },
    };
    if !access.org_allowed(&found.id) {
        return Err(org_off(&found.name));
    }
    Ok(Org {
        id: found.id.clone(),
        name: found.name.clone(),
        db: orgs::org_dir(dir, &found.id).join(orgs::DB_FILE),
    })
}

/// Accent/case-folded name match; several matches list the candidates
/// rather than picking one. The "no match" hint lists only organisations
/// agent access allows.
fn find_by_name<'a>(
    registry: &'a Registry,
    access: &AccessConfig,
    query: &str,
) -> Result<&'a orgs::Organisation, String> {
    let wanted = fold(query);
    let matches: Vec<&orgs::Organisation> = registry
        .organisations
        .iter()
        .filter(|o| fold(o.name.trim()) == wanted)
        .collect();
    match matches.as_slice() {
        [one] => Ok(*one),
        [] => {
            let names: Vec<&str> = registry
                .organisations
                .iter()
                .filter(|o| access.org_allowed(&o.id))
                .map(|o| o.name.as_str())
                .collect();
            Err(format!(
                "No organisation named \"{query}\". Organisations: {}.",
                names.join(", ")
            ))
        }
        many => {
            let names: Vec<String> = many
                .iter()
                .map(|o| format!("{} (id {})", o.name, o.id))
                .collect();
            Err(format!(
                "More than one organisation matches \"{query}\": {}. Use the id.",
                names.join(", ")
            ))
        }
    }
}

/// Read connection: query-only, after the schema check. Allowed in test
/// and presentation mode (the production file is untouched there).
pub fn open_read(org: &Org) -> Result<Connection, String> {
    let conn = open_checked(org)?;
    conn.pragma_update(None, "query_only", true)
        .map_err(|e| format!("query_only: {e}"))?;
    Ok(conn)
}

/// Write connection: refused while the app is in test or presentation
/// mode; the first one per process and organisation takes a backup.
pub fn open_write(dir: &Path, org: &Org) -> Result<Connection, String> {
    if in_special_mode(org) {
        return Err(MODE_ACTIVE.to_string());
    }
    let conn = open_checked(org)?;
    static BACKED_UP: Mutex<Option<HashSet<String>>> = Mutex::new(None);
    // Keyed by database path: one backup per organisation per process.
    let key = org.db.to_string_lossy().into_owned();
    let mut done = BACKED_UP.lock().unwrap_or_else(|p| p.into_inner());
    let set = done.get_or_insert_with(HashSet::new);
    if !set.contains(&key) {
        crate::backup::ensure(dir, org)?;
        set.insert(key);
    }
    Ok(conn)
}

/// Test/presentation mode leaves its own database beside the production one.
pub fn in_special_mode(org: &Org) -> bool {
    MODE_FILES.iter().any(|f| org.db.with_file_name(f).exists())
}

fn open_checked(org: &Org) -> Result<Connection, String> {
    if !org.db.is_file() {
        return Err(NOT_OPENED.to_string());
    }
    // No CREATE flag: never conjure an empty database.
    let flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn =
        Connection::open_with_flags(&org.db, flags).map_err(|e| format!("open database: {e}"))?;
    conn.busy_timeout(std::time::Duration::from_millis(5000))
        .map_err(|e| format!("busy_timeout: {e}"))?;
    conn.pragma_update(None, "foreign_keys", true)
        .map_err(|e| format!("foreign_keys: {e}"))?;
    check_schema(&conn)?;
    Ok(conn)
}

fn count(conn: &Connection, sql: &str, args: &[&str]) -> Result<i64, String> {
    conn.query_row(sql, rusqlite::params_from_iter(args), |r| r.get(0))
        .map_err(|e| format!("schema check: {e}"))
}

/// The database must be at exactly the app's latest migration and carry the
/// tables/columns `ensureSchema()` adds when the app opens it.
fn check_schema(conn: &Connection) -> Result<(), String> {
    let latest = crate::migrate::MIGRATIONS
        .last()
        .map(|m| m.version)
        .unwrap_or(0);
    let has_versions = count(
        conn,
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        &["schema_migrations"],
    )? == 1;
    if !has_versions {
        return Err(NOT_OPENED.to_string());
    }
    let version = count(
        conn,
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        &[],
    )?;
    if version > latest {
        return Err(DB_NEWER.to_string());
    }
    if version < latest {
        return Err(NOT_OPENED.to_string());
    }
    for table in APP_TABLES {
        if count(
            conn,
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
            &[table],
        )? != 1
        {
            return Err(NOT_OPENED.to_string());
        }
    }
    for (table, column) in APP_COLUMNS {
        if count(
            conn,
            "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name=?2",
            &[table, column],
        )? != 1
        {
            return Err(NOT_OPENED.to_string());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::*;

    #[test]
    fn access_missing_file_is_off() {
        let dir = temp_data_dir();
        let cfg = AccessConfig::load(&dir);
        assert!(!cfg.enabled && !cfg.allow_money && cfg.orgs.is_empty());
        write_registry(&dir, &[("org001", "Studio")]);
        seed_app_db(&dir, "org001");
        assert_eq!(resolve_org(&dir, None).unwrap_err(), OFF_OVERALL);
        write_access(&dir, "not json");
        assert!(!AccessConfig::load(&dir).enabled);
    }

    #[test]
    fn access_config_reads_fields() {
        let dir = temp_data_dir();
        write_access(
            &dir,
            r#"{"enabled": true, "allowMoney": true, "orgs": {"org001": false}}"#,
        );
        let cfg = AccessConfig::load(&dir);
        assert!(cfg.enabled && cfg.allow_money);
        assert_eq!(cfg.orgs.get("org001"), Some(&false));
    }

    #[test]
    fn access_reread_each_time() {
        let dir = ready_dir("org001", "Studio");
        assert_eq!(resolve_org(&dir, None).unwrap().id, "org001");
        write_access(
            &dir,
            r#"{"enabled": false, "allowMoney": false, "orgs": {}}"#,
        );
        assert_eq!(resolve_org(&dir, None).unwrap_err(), OFF_OVERALL);
    }

    #[test]
    fn org_off_refused() {
        let dir = ready_dir("org001", "Studio");
        write_access(
            &dir,
            r#"{"enabled": true, "allowMoney": false, "orgs": {"org001": false}}"#,
        );
        assert_eq!(
            resolve_org(&dir, Some("org001")).unwrap_err(),
            "Agent access is off for the organisation \"Studio\"."
        );
        assert!(resolve_org(&dir, None).is_err());
    }

    #[test]
    fn resolve_by_folded_name() {
        let dir = temp_data_dir();
        write_registry(&dir, &[("org001", "Studio"), ("org002", "Étude")]);
        write_access(
            &dir,
            r#"{"enabled": true, "allowMoney": false, "orgs": {}}"#,
        );
        let org = resolve_org(&dir, Some("Etude")).unwrap();
        assert_eq!(org.id, "org002");
        assert_eq!(org.name, "Étude");
        assert_eq!(
            org.db,
            dir.join("orgs").join("org002").join("studiomanager.db")
        );
        assert_eq!(resolve_org(&dir, Some("org001")).unwrap().name, "Studio");
        assert_eq!(resolve_org(&dir, None).unwrap().id, "org001");
        let err = resolve_org(&dir, Some("nope")).unwrap_err();
        assert!(err.contains("Studio"), "{err}");
        write_access(
            &dir,
            r#"{"enabled": true, "allowMoney": false, "orgs": {"org002": false}}"#,
        );
        let err = resolve_org(&dir, Some("nope")).unwrap_err();
        assert!(
            !err.contains("Étude"),
            "disabled organisations stay hidden: {err}"
        );
    }

    #[test]
    fn ambiguous_name_lists_candidates() {
        let dir = temp_data_dir();
        write_registry(&dir, &[("org001", "Étude"), ("org002", "etude")]);
        write_access(
            &dir,
            r#"{"enabled": true, "allowMoney": false, "orgs": {}}"#,
        );
        let err = resolve_org(&dir, Some("ETUDE")).unwrap_err();
        assert!(err.contains("Étude") && err.contains("etude"), "{err}");
    }

    #[test]
    fn write_refused_in_test_mode() {
        let dir = ready_dir("org001", "Studio");
        let org = resolve_org(&dir, None).unwrap();
        for mode_file in ["studiomanager_test.db", "studiomanager_presentation.db"] {
            let marker = org.db.with_file_name(mode_file);
            std::fs::write(&marker, "").unwrap();
            assert_eq!(open_write(&dir, &org).unwrap_err(), MODE_ACTIVE);
            std::fs::remove_file(&marker).unwrap();
        }
    }

    #[test]
    fn read_allowed_in_test_mode() {
        let dir = ready_dir("org001", "Studio");
        let org = resolve_org(&dir, None).unwrap();
        std::fs::write(org.db.with_file_name("studiomanager_test.db"), "").unwrap();
        let conn = open_read(&org).unwrap();
        let fk: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
            .unwrap();
        assert_eq!(fk, 1);
        assert!(
            conn.execute("INSERT INTO wiki_folders (name) VALUES ('x')", [])
                .is_err(),
            "read connections are query-only"
        );
    }

    #[test]
    fn write_connection_has_foreign_keys_and_can_write() {
        let dir = ready_dir("org001", "Studio");
        let org = resolve_org(&dir, None).unwrap();
        let conn = open_write(&dir, &org).unwrap();
        let fk: i64 = conn
            .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
            .unwrap();
        assert_eq!(fk, 1);
        conn.execute("INSERT INTO wiki_folders (name) VALUES ('x')", [])
            .unwrap();
    }

    #[test]
    fn unmigrated_db_refused() {
        let dir = temp_data_dir();
        write_registry(&dir, &[("org001", "Studio")]);
        seed_migrated_only(&dir, "org001");
        write_access(
            &dir,
            r#"{"enabled": true, "allowMoney": false, "orgs": {}}"#,
        );
        let org = resolve_org(&dir, None).unwrap();
        assert_eq!(open_read(&org).unwrap_err(), NOT_OPENED);
        assert_eq!(open_write(&dir, &org).unwrap_err(), NOT_OPENED);
    }

    #[test]
    fn missing_db_refused_and_not_created() {
        let dir = temp_data_dir();
        write_registry(&dir, &[("org001", "Studio")]);
        write_access(
            &dir,
            r#"{"enabled": true, "allowMoney": false, "orgs": {}}"#,
        );
        let org = resolve_org(&dir, None).unwrap();
        assert_eq!(open_read(&org).unwrap_err(), NOT_OPENED);
        assert_eq!(open_write(&dir, &org).unwrap_err(), NOT_OPENED);
        assert!(!org.db.exists());
    }

    #[test]
    fn newer_db_refused() {
        let dir = ready_dir("org001", "Studio");
        let org = resolve_org(&dir, None).unwrap();
        let conn = rusqlite::Connection::open(&org.db).unwrap();
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (999, 'x')",
            [],
        )
        .unwrap();
        drop(conn);
        assert_eq!(open_read(&org).unwrap_err(), DB_NEWER);
        assert_eq!(open_write(&dir, &org).unwrap_err(), DB_NEWER);
    }

    #[test]
    fn refusal_strings_are_exact() {
        assert_eq!(
            OFF_OVERALL,
            "Agent access is off in StudioManager (Settings > Agent access)."
        );
        assert_eq!(MODE_ACTIVE, "StudioManager is in test or presentation mode; changes are paused until it leaves that mode.");
        assert_eq!(
            NOT_OPENED,
            "Open StudioManager once with this organisation, then try again."
        );
        assert_eq!(
            DB_NEWER,
            "This database is newer than the agent tools. Update StudioManager."
        );
    }
}
