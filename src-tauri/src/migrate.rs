#![allow(dead_code)]
//! Schema migration runner that works on any database file (the SQL plugin
//! only migrates the one connection string it was configured with).
//! Progress lives in `schema_migrations`; files the plugin migrated earlier
//! are recognised through `_sqlx_migrations` and never re-run.
//!
//! `#![allow(dead_code)]`: nothing outside `migrate.rs` uses this module yet.
//! Task 5 wires it into Tauri commands and this allow should be removed then.

use std::path::Path;

pub struct SqlMigration {
    pub version: i64,
    pub sql: &'static str,
}

pub const MIGRATIONS: &[SqlMigration] = &[
    SqlMigration { version: 1, sql: include_str!("../migrations/001_initial_schema.sql") },
    SqlMigration { version: 2, sql: include_str!("../migrations/002_billing_name_task_status.sql") },
    SqlMigration { version: 3, sql: include_str!("../migrations/003_invoice_po_number.sql") },
    SqlMigration { version: 4, sql: include_str!("../migrations/004_subtasks.sql") },
    SqlMigration { version: 5, sql: include_str!("../migrations/005_consolidate_schema.sql") },
    SqlMigration { version: 6, sql: include_str!("../migrations/006_activities.sql") },
];

pub const LATEST_VERSION: i64 = 6;

fn table_exists(conn: &rusqlite::Connection, name: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        [name],
        |r| r.get::<_, i64>(0),
    )
    .map(|n| n == 1)
    .map_err(|e| format!("sqlite_master lookup failed: {e}"))
}

/// Apply every migration newer than the file's recorded version.
/// Returns how many were applied.
pub fn migrate_db(path: &Path) -> Result<u32, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create db folder: {e}"))?;
    }
    let mut conn = rusqlite::Connection::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    conn.busy_timeout(std::time::Duration::from_millis(5000))
        .map_err(|e| format!("busy_timeout: {e}"))?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
    )
    .map_err(|e| format!("create schema_migrations: {e}"))?;

    let recorded: i64 = conn
        .query_row("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", [], |r| r.get(0))
        .map_err(|e| format!("read schema_migrations: {e}"))?;
    let mut current = recorded;
    if current == 0 && table_exists(&conn, "_sqlx_migrations")? {
        conn.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, applied_at)
             SELECT version, datetime('now') FROM _sqlx_migrations WHERE success = 1",
            [],
        )
        .map_err(|e| format!("adopt plugin migrations: {e}"))?;
        current = conn
            .query_row("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", [], |r| r.get(0))
            .map_err(|e| format!("read schema_migrations: {e}"))?;
    }

    let mut applied = 0u32;
    for m in MIGRATIONS.iter().filter(|m| m.version > current) {
        let tx = conn.transaction().map_err(|e| format!("begin migration {}: {e}", m.version))?;
        tx.execute_batch(m.sql).map_err(|e| format!("migration {} failed: {e}", m.version))?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, datetime('now'))",
            [m.version],
        )
        .map_err(|e| format!("record migration {}: {e}", m.version))?;
        tx.commit().map_err(|e| format!("commit migration {}: {e}", m.version))?;
        applied += 1;
    }
    Ok(applied)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn temp_db(name: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("sm-migrate-{nanos}-{name}.db"))
    }

    fn table_exists(path: &std::path::Path, table: &str) -> bool {
        let conn = Connection::open(path).unwrap();
        conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
            [table],
            |r| r.get::<_, i64>(0),
        )
        .unwrap()
            == 1
    }

    #[test]
    fn fresh_file_gets_full_schema_and_seed_rows() {
        let db = temp_db("fresh");
        let applied = migrate_db(&db).unwrap();
        assert_eq!(applied as i64, LATEST_VERSION);
        for t in ["business_profile", "clients", "invoices", "subtasks", "activities", "expense_categories"] {
            assert!(table_exists(&db, t), "{t}");
        }
        let conn = Connection::open(&db).unwrap();
        let cats: i64 = conn.query_row("SELECT COUNT(*) FROM expense_categories", [], |r| r.get(0)).unwrap();
        assert_eq!(cats, 6);
        let has_activity_id: i64 = conn
            .query_row("SELECT COUNT(*) FROM pragma_table_info('invoices') WHERE name='activity_id'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(has_activity_id, 1);
        assert_eq!(migrate_db(&db).unwrap(), 0, "second run is a no-op");
    }

    #[test]
    fn plugin_migrated_file_is_recognised_and_not_re_run() {
        let db = temp_db("plugin");
        // Simulate a database the tauri-plugin-sql migrated fully.
        migrate_db(&db).unwrap();
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch(
            "DROP TABLE schema_migrations;
             CREATE TABLE _sqlx_migrations (version BIGINT PRIMARY KEY, description TEXT NOT NULL, installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, success BOOLEAN NOT NULL, checksum BLOB NOT NULL, execution_time BIGINT NOT NULL);
             INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) VALUES (1,'a',1,x'00',0),(2,'b',1,x'00',0),(3,'c',1,x'00',0),(4,'d',1,x'00',0),(5,'e',1,x'00',0),(6,'f',1,x'00',0);",
        )
        .unwrap();
        drop(conn);
        assert_eq!(migrate_db(&db).unwrap(), 0);
        let conn = Connection::open(&db).unwrap();
        let max: i64 = conn.query_row("SELECT MAX(version) FROM schema_migrations", [], |r| r.get(0)).unwrap();
        assert_eq!(max, LATEST_VERSION);
    }

    #[test]
    fn partially_migrated_file_catches_up() {
        let db = temp_db("partial");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch(MIGRATIONS[0].sql).unwrap();
        conn.execute_batch("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES (1, 'x');").unwrap();
        drop(conn);
        assert_eq!(migrate_db(&db).unwrap() as i64, LATEST_VERSION - 1);
        assert!(table_exists(&db, "activities"));
    }
}
