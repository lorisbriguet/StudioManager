//! Schema migration runner that works on any database file (the SQL plugin
//! only migrates the one connection string it was configured with).
//! Progress lives in `schema_migrations`; files the plugin migrated earlier
//! are recognised through `_sqlx_migrations` and never re-run.

use std::path::Path;

pub struct SqlMigration {
    pub version: i64,
    pub sql: &'static str,
    /// Run statement by statement, skipping each `ALTER TABLE t ADD COLUMN c`
    /// whose column the file already has (SQLite has no ADD COLUMN IF NOT
    /// EXISTS). For 014, which takes over columns the app used to add itself,
    /// and for later files that only add columns, so a re-run is harmless.
    pub columns_if_missing: bool,
}

pub const MIGRATIONS: &[SqlMigration] = &[
    SqlMigration { version: 1, sql: include_str!("../migrations/001_initial_schema.sql"), columns_if_missing: false },
    SqlMigration { version: 2, sql: include_str!("../migrations/002_billing_name_task_status.sql"), columns_if_missing: false },
    SqlMigration { version: 3, sql: include_str!("../migrations/003_invoice_po_number.sql"), columns_if_missing: false },
    SqlMigration { version: 4, sql: include_str!("../migrations/004_subtasks.sql"), columns_if_missing: false },
    SqlMigration { version: 5, sql: include_str!("../migrations/005_consolidate_schema.sql"), columns_if_missing: false },
    SqlMigration { version: 6, sql: include_str!("../migrations/006_activities.sql"), columns_if_missing: false },
    SqlMigration { version: 7, sql: include_str!("../migrations/007_upkeep.sql"), columns_if_missing: false },
    SqlMigration { version: 8, sql: include_str!("../migrations/008_machine_linked_at.sql"), columns_if_missing: false },
    SqlMigration { version: 9, sql: include_str!("../migrations/009_paperless.sql"), columns_if_missing: false },
    SqlMigration { version: 10, sql: include_str!("../migrations/010_upkeep_backup.sql"), columns_if_missing: false },
    SqlMigration { version: 11, sql: include_str!("../migrations/011_client_archived.sql"), columns_if_missing: false },
    SqlMigration { version: 12, sql: include_str!("../migrations/012_meta.sql"), columns_if_missing: false },
    SqlMigration { version: 13, sql: include_str!("../migrations/013_expense_currency.sql"), columns_if_missing: false },
    SqlMigration { version: 14, sql: include_str!("../migrations/014_app_schema.sql"), columns_if_missing: true },
    SqlMigration { version: 15, sql: include_str!("../migrations/015_notification_keys.sql"), columns_if_missing: true },
    SqlMigration { version: 16, sql: include_str!("../migrations/016_captures.sql"), columns_if_missing: true },
];

// Only referenced from this module's own tests (as the expected "fully
// migrated" version); nothing in the production path needs it, since
// `migrate_db` derives what to apply from `MIGRATIONS` itself.
#[allow(dead_code)]
pub const LATEST_VERSION: i64 = 16;

pub(crate) fn table_exists(conn: &rusqlite::Connection, name: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        [name],
        |r| r.get::<_, i64>(0),
    )
    .map(|n| n == 1)
    .map_err(|e| format!("sqlite_master lookup failed: {e}"))
}

/// Put the file in WAL mode. The mode is stored in the file, so every later
/// connection (app, MCP server, `sm`) uses it too. Nothing sets it otherwise:
/// tauri-plugin-sql only asks for WAL when it creates the file, and
/// `migrate_db` always creates it first.
///
/// Best-effort: switching needs an exclusive lock that the busy timeout does
/// not wait for, so if another process has the file open right now the switch
/// is skipped and retried on the next open.
fn ensure_wal(conn: &rusqlite::Connection) {
    match conn.query_row("PRAGMA journal_mode=WAL", [], |r| r.get::<_, String>(0)) {
        Ok(mode) if mode.eq_ignore_ascii_case("wal") => {}
        Ok(mode) => log::warn!("[migrate] journal_mode is still {mode}; WAL will be retried on next open"),
        Err(e) => log::warn!("[migrate] could not switch to WAL: {e}"),
    }
}

/// Start of the error for a database saved by a newer app. The frontend
/// matches it to explain that the app needs updating.
pub const DB_NEWER_THAN_APP: &str = "database newer than this app: ";

/// The copy taken right before migrations run on a file that has data:
/// `studiomanager.db` -> `studiomanager.pre-migration.db`, next to it. Only
/// the latest one is kept.
pub fn pre_migration_snapshot_path(db: &Path) -> std::path::PathBuf {
    let stem = db.file_stem().and_then(|s| s.to_str()).unwrap_or("studiomanager");
    db.with_file_name(format!("{stem}.pre-migration.db"))
}

fn recorded_version(conn: &rusqlite::Connection) -> Result<i64, String> {
    conn.query_row("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", [], |r| r.get(0))
        .map_err(|e| format!("read schema_migrations: {e}"))
}

/// Refuse a file migrated by a newer app: this app's code and its
/// ensureSchema() would write to a schema they don't know.
fn refuse_newer(version: i64) -> Result<(), String> {
    let latest = MIGRATIONS.last().map(|m| m.version).unwrap_or(0);
    if version > latest {
        return Err(format!(
            "{DB_NEWER_THAN_APP}it is at schema version {version}, this app knows up to {latest}"
        ));
    }
    Ok(())
}

/// Refuse a file saved by a newer app without writing to it: checked on a
/// snapshot before it is restored over the live database.
pub fn refuse_newer_file(path: &Path) -> Result<(), String> {
    let conn = rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("open {}: {e}", path.display()))?;
    if table_exists(&conn, "schema_migrations")? {
        refuse_newer(recorded_version(&conn)?)?;
    }
    Ok(())
}

/// `VACUUM INTO` a temporary file, then rename it over the previous copy,
/// so a failed snapshot never loses the last good one.
fn snapshot_before_migrating(conn: &rusqlite::Connection, db: &Path) -> Result<(), String> {
    let dest = pre_migration_snapshot_path(db);
    let tmp = dest.with_extension("db.tmp");
    let _ = std::fs::remove_file(&tmp);
    conn.execute("VACUUM INTO ?1", [tmp.to_string_lossy().as_ref()])
        .map_err(|e| format!("snapshot before migrating failed: {e}"))?;
    std::fs::rename(&tmp, &dest).map_err(|e| format!("snapshot before migrating failed: {e}"))?;
    Ok(())
}

/// Note in `meta` which schema and app version last opened the file
/// (diagnostics only; the refusal reads `schema_migrations`). The MCP server
/// compiles this module too: only the app writes its version.
fn record_versions(conn: &rusqlite::Connection, schema: i64) -> Result<(), String> {
    if !table_exists(conn, "meta")? {
        return Ok(());
    }
    let mut rows = vec![("schema_version", schema.to_string())];
    if env!("CARGO_PKG_NAME") == "studiomanager" {
        rows.push(("app_version", env!("CARGO_PKG_VERSION").to_string()));
    }
    for (key, value) in rows {
        conn.execute(
            "INSERT INTO meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
             WHERE meta.value <> excluded.value",
            rusqlite::params![key, value],
        )
        .map_err(|e| format!("record {key}: {e}"))?;
    }
    Ok(())
}

/// Split a migration into statements at each `;` outside quotes and `--`
/// comments. Enough for plain DDL; not for triggers (`BEGIN ... END;`).
fn split_statements(sql: &str) -> Vec<&str> {
    let bytes = sql.as_bytes();
    let mut out = Vec::new();
    let (mut start, mut i) = (0, 0);
    let mut quote: Option<u8> = None;
    while i < bytes.len() {
        let c = bytes[i];
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => {}
            None if c == b'\'' || c == b'"' => quote = Some(c),
            None if c == b'-' && bytes.get(i + 1) == Some(&b'-') => {
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
                continue;
            }
            None if c == b';' => {
                out.push(&sql[start..i]);
                start = i + 1;
            }
            None => {}
        }
        i += 1;
    }
    out.push(&sql[start..]);
    out.into_iter().filter(|s| !strip_comments(s).trim().is_empty()).collect()
}

fn strip_comments(stmt: &str) -> String {
    stmt.lines()
        .map(|l| l.split("--").next().unwrap_or(""))
        .collect::<Vec<_>>()
        .join("\n")
}

/// `ALTER TABLE <table> ADD COLUMN <column> ...` → (table, column).
fn added_column(stmt: &str) -> Option<(String, String)> {
    let code = strip_comments(stmt);
    let words: Vec<&str> = code.split_whitespace().take(6).collect();
    let is = |i: usize, w: &str| words.get(i).is_some_and(|x| x.eq_ignore_ascii_case(w));
    if words.len() == 6 && is(0, "ALTER") && is(1, "TABLE") && is(3, "ADD") && is(4, "COLUMN") {
        Some((words[2].to_string(), words[5].to_string()))
    } else {
        None
    }
}

fn run_skipping_existing_columns(conn: &rusqlite::Connection, sql: &str) -> Result<(), String> {
    for stmt in split_statements(sql) {
        if let Some((table, column)) = added_column(stmt) {
            let has: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2",
                    [&table, &column],
                    |r| r.get(0),
                )
                .map_err(|e| format!("columns of {table}: {e}"))?;
            if has > 0 {
                continue;
            }
        }
        conn.execute_batch(stmt).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Apply every migration newer than the file's recorded version.
/// Returns how many were applied.
///
/// A file from a newer app is refused before anything is written to it. A
/// file that has data is copied to [`pre_migration_snapshot_path`] before
/// the first pending migration runs.
pub fn migrate_db(path: &Path) -> Result<u32, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create db folder: {e}"))?;
    }
    let mut conn = rusqlite::Connection::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    conn.busy_timeout(std::time::Duration::from_millis(5000))
        .map_err(|e| format!("busy_timeout: {e}"))?;
    if table_exists(&conn, "schema_migrations")? {
        refuse_newer(recorded_version(&conn)?)?;
    }
    ensure_wal(&conn);
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
    )
    .map_err(|e| format!("create schema_migrations: {e}"))?;

    let mut current = recorded_version(&conn)?;
    if current == 0 && table_exists(&conn, "_sqlx_migrations")? {
        conn.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, applied_at)
             SELECT version, datetime('now') FROM _sqlx_migrations WHERE success = 1",
            [],
        )
        .map_err(|e| format!("adopt plugin migrations: {e}"))?;
        current = recorded_version(&conn)?;
        refuse_newer(current)?;
    }

    let pending: Vec<&SqlMigration> = MIGRATIONS.iter().filter(|m| m.version > current).collect();
    if current > 0 && !pending.is_empty() {
        snapshot_before_migrating(&conn, path)?;
    }

    let mut applied = 0u32;
    for m in pending {
        let tx = conn.transaction().map_err(|e| format!("begin migration {}: {e}", m.version))?;
        if m.columns_if_missing {
            run_skipping_existing_columns(&tx, m.sql)
        } else {
            tx.execute_batch(m.sql).map_err(|e| e.to_string())
        }
        .map_err(|e| format!("migration {} failed: {e}", m.version))?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, datetime('now'))",
            [m.version],
        )
        .map_err(|e| format!("record migration {}: {e}", m.version))?;
        tx.commit().map_err(|e| format!("commit migration {}: {e}", m.version))?;
        applied += 1;
        current = m.version;
    }
    record_versions(&conn, current)?;
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

    fn journal_mode(path: &std::path::Path) -> String {
        Connection::open(path)
            .unwrap()
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn fresh_file_is_in_wal_mode() {
        let db = temp_db("wal-fresh");
        migrate_db(&db).unwrap();
        assert_eq!(journal_mode(&db), "wal");
        crate::dbfiles::remove_db_files(&db);
    }

    #[test]
    fn rollback_journal_file_is_switched_to_wal() {
        let db = temp_db("wal-existing");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch("PRAGMA journal_mode=DELETE; CREATE TABLE t (x)").unwrap();
        drop(conn);
        assert_eq!(journal_mode(&db), "delete");
        migrate_db(&db).unwrap();
        assert_eq!(journal_mode(&db), "wal");
        crate::dbfiles::remove_db_files(&db);
    }

    /// The bundled SQLite is built with SQLITE_DEFAULT_WAL_SYNCHRONOUS=1
    /// (src-tauri/.cargo/config.toml), so every WAL connection, including the
    /// tauri-plugin-sql pool, starts at synchronous=NORMAL.
    #[test]
    fn wal_connections_default_to_synchronous_normal() {
        let db = temp_db("wal-sync");
        migrate_db(&db).unwrap();
        let sync: i64 = Connection::open(&db)
            .unwrap()
            .query_row("PRAGMA synchronous", [], |r| r.get(0))
            .unwrap();
        assert_eq!(sync, 1, "LIBSQLITE3_FLAGS did not reach the bundled SQLite build");
        crate::dbfiles::remove_db_files(&db);
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
    fn migrates_to_007_creates_upkeep_tables() {
        let db = temp_db("upkeep");
        migrate_db(&db).unwrap();
        for t in [
            "connections", "machines", "machine_files", "machine_projects", "upkeep_items",
            "service_log", "consumables", "consumable_usage", "subscriptions",
            "subscription_renewals", "machine_readings", "machine_disks",
        ] {
            assert!(table_exists(&db, t), "{t}");
        }
        let conn = Connection::open(&db).unwrap();
        let max: i64 = conn.query_row("SELECT MAX(version) FROM schema_migrations", [], |r| r.get(0)).unwrap();
        assert_eq!(max, LATEST_VERSION);
    }

    #[test]
    fn migrates_to_008_adds_machine_linked_at() {
        let db = temp_db("linked_at");
        migrate_db(&db).unwrap();
        let conn = Connection::open(&db).unwrap();
        let has: i64 = conn
            .query_row("SELECT COUNT(*) FROM pragma_table_info('machines') WHERE name='linked_at'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(has, 1);
        const { assert!(LATEST_VERSION >= 8) };
    }

    #[test]
    fn migrates_to_009_adds_paperless() {
        let path = temp_db("m009");
        migrate_db(&path).unwrap();
        assert!(table_exists(&path, "paperless_links"));
        let conn = Connection::open(&path).unwrap();
        conn.execute("INSERT INTO connections (kind, label) VALUES ('paperless', 'P')", []).unwrap();
        assert!(conn.execute("INSERT INTO connections (kind, label) VALUES ('nope', 'X')", []).is_err());
    }

    #[test]
    fn migrates_to_010_adds_is_backup() {
        let path = temp_db("m010");
        migrate_db(&path).unwrap();
        let conn = Connection::open(&path).unwrap();
        let has: i64 = conn
            .query_row("SELECT COUNT(*) FROM pragma_table_info('upkeep_items') WHERE name='is_backup'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(has, 1);
        conn.execute("INSERT INTO machines (name, kind) VALUES ('M', 'server')", []).unwrap();
        conn.execute("INSERT INTO upkeep_items (machine_id, title, schedule) VALUES (1, 'Copy', 'interval')", []).unwrap();
        let v: i64 = conn.query_row("SELECT is_backup FROM upkeep_items", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 0);
    }

    #[test]
    fn migrates_to_011_adds_client_archived_at() {
        let path = temp_db("m011");
        migrate_db(&path).unwrap();
        let conn = Connection::open(&path).unwrap();
        conn.execute("INSERT INTO clients (id, name) VALUES ('C-001', 'Acme')", []).unwrap();
        let v: Option<String> = conn.query_row("SELECT archived_at FROM clients", [], |r| r.get(0)).unwrap();
        assert_eq!(v, None);
    }

    #[test]
    fn migrates_to_012_adds_meta() {
        let path = temp_db("m012");
        migrate_db(&path).unwrap();
        assert!(table_exists(&path, "meta"));
        let conn = Connection::open(&path).unwrap();
        conn.execute("INSERT INTO meta (key, value) VALUES ('seeded:resources', '1')", []).unwrap();
        assert!(conn.execute("INSERT INTO meta (key, value) VALUES ('seeded:resources', '1')", []).is_err());
    }

    #[test]
    fn migrates_to_013_adds_expense_currency() {
        let db = temp_db("m013");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);").unwrap();
        for m in MIGRATIONS.iter().filter(|m| m.version <= 12) {
            conn.execute_batch(m.sql).unwrap();
            conn.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (?1, datetime('now'))", [m.version]).unwrap();
        }
        conn.execute(
            "INSERT INTO expenses (reference, supplier, category_code, invoice_date, amount) VALUES ('F-26-001','X','FA','2026-01-01',42.5)",
            [],
        )
        .unwrap();
        drop(conn);
        migrate_db(&db).unwrap();
        let conn = Connection::open(&db).unwrap();
        let (cur, rate, orig, amount): (String, f64, Option<f64>, f64) = conn
            .query_row("SELECT currency, exchange_rate, original_amount, amount FROM expenses", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })
            .unwrap();
        assert_eq!((cur.as_str(), rate, orig, amount), ("CHF", 1.0, None, 42.5), "existing rows stay CHF");
    }

    #[test]
    fn file_at_010_applies_011_then_012() {
        let db = temp_db("m010to012");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);").unwrap();
        for m in MIGRATIONS.iter().filter(|m| m.version <= 10) {
            conn.execute_batch(m.sql).unwrap();
            conn.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (?1, datetime('now'))", [m.version]).unwrap();
        }
        drop(conn);
        assert_eq!(migrate_db(&db).unwrap() as i64, LATEST_VERSION - 10);
        let conn = Connection::open(&db).unwrap();
        let versions: Vec<i64> = conn
            .prepare("SELECT version FROM schema_migrations WHERE version IN (11, 12) ORDER BY rowid")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(versions, vec![11, 12]);
        let archived: i64 = conn
            .query_row("SELECT COUNT(*) FROM pragma_table_info('clients') WHERE name='archived_at'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(archived, 1);
        assert!(table_exists(&db, "meta"));
    }

    #[test]
    fn migration_009_keeps_machine_connection_links() {
        let db = temp_db("m009keep");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);").unwrap();
        for m in MIGRATIONS.iter().filter(|m| m.version <= 8) {
            conn.execute_batch(m.sql).unwrap();
            conn.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (?1, datetime('now'))", [m.version]).unwrap();
        }
        conn.execute("INSERT INTO connections (kind, label) VALUES ('synology', 'NAS')", []).unwrap();
        let cid: i64 = conn.last_insert_rowid();
        conn.execute("INSERT INTO machines (name, connection_id) VALUES ('M', ?1)", [cid]).unwrap();
        drop(conn);
        assert_eq!(migrate_db(&db).unwrap() as i64, LATEST_VERSION - 8);
        let conn = Connection::open(&db).unwrap();
        let (mcid, kind, label): (i64, String, String) = conn
            .query_row(
                "SELECT m.connection_id, c.kind, c.label FROM machines m JOIN connections c ON c.id = m.connection_id",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!((mcid, kind.as_str(), label.as_str()), (cid, "synology", "NAS"));
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
             INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) VALUES (1,'a',1,x'00',0),(2,'b',1,x'00',0),(3,'c',1,x'00',0),(4,'d',1,x'00',0),(5,'e',1,x'00',0),(6,'f',1,x'00',0),(7,'g',1,x'00',0),(8,'h',1,x'00',0),(9,'i',1,x'00',0),(10,'j',1,x'00',0),(11,'k',1,x'00',0),(12,'l',1,x'00',0),(13,'m',1,x'00',0);",
        )
        .unwrap();
        drop(conn);
        // The plugin knew up to 013: 014 and later run, on a file that has their schema.
        assert_eq!(migrate_db(&db).unwrap() as i64, LATEST_VERSION - 13);
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

    /// A file migrated up to `version` the way the app would have left it.
    fn db_at(name: &str, version: i64) -> std::path::PathBuf {
        let db = temp_db(name);
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);").unwrap();
        for m in MIGRATIONS.iter().filter(|m| m.version <= version) {
            conn.execute_batch(m.sql).unwrap();
            conn.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (?1, datetime('now'))", [m.version]).unwrap();
        }
        db
    }

    fn cleanup(db: &std::path::Path) {
        crate::dbfiles::remove_db_files(db);
        crate::dbfiles::remove_db_files(&pre_migration_snapshot_path(db));
    }

    fn meta(db: &std::path::Path, key: &str) -> Option<String> {
        Connection::open(db)
            .unwrap()
            .query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0))
            .ok()
    }

    #[test]
    fn newer_file_is_refused_and_left_untouched() {
        let db = db_at("newer", LATEST_VERSION);
        let conn = Connection::open(&db).unwrap();
        conn.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (?1, 'x')", [LATEST_VERSION + 1]).unwrap();
        conn.execute_batch("PRAGMA journal_mode=DELETE").unwrap();
        drop(conn);
        let before = std::fs::read(&db).unwrap();

        let err = migrate_db(&db).unwrap_err();
        assert!(err.starts_with(DB_NEWER_THAN_APP), "{err}");
        assert!(err.contains(&format!("version {}", LATEST_VERSION + 1)), "{err}");
        assert_eq!(std::fs::read(&db).unwrap(), before);
        assert_eq!(journal_mode(&db), "delete");
        assert!(!pre_migration_snapshot_path(&db).exists());
        cleanup(&db);
    }

    #[test]
    fn snapshot_is_taken_before_migrating_a_file_with_data() {
        let db = db_at("snap", LATEST_VERSION - 1);
        Connection::open(&db)
            .unwrap()
            .execute("INSERT INTO meta (key, value) VALUES ('marker', 'before')", [])
            .unwrap();
        assert_eq!(migrate_db(&db).unwrap(), 1);

        let snap = pre_migration_snapshot_path(&db);
        assert_eq!(snap.file_name().unwrap().to_str().unwrap(), format!("{}.pre-migration.db", db.file_stem().unwrap().to_str().unwrap()));
        let conn = Connection::open(&snap).unwrap();
        let v: i64 = conn.query_row("SELECT MAX(version) FROM schema_migrations", [], |r| r.get(0)).unwrap();
        assert_eq!(v, LATEST_VERSION - 1);
        assert_eq!(meta(&snap, "marker").as_deref(), Some("before"));
        assert!(!snap.with_extension("db.tmp").exists());
        cleanup(&db);
    }

    #[test]
    fn only_the_latest_snapshot_is_kept() {
        let db = db_at("snap-latest", LATEST_VERSION - 1);
        migrate_db(&db).unwrap();
        // A later migration run must replace the first copy, not add one.
        let conn = Connection::open(&db).unwrap();
        conn.execute("INSERT INTO meta (key, value) VALUES ('marker', 'second')", []).unwrap();
        snapshot_before_migrating(&conn, &db).unwrap();
        drop(conn);
        assert_eq!(meta(&pre_migration_snapshot_path(&db), "marker").as_deref(), Some("second"));
        let siblings = std::fs::read_dir(db.parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with(db.file_stem().unwrap().to_str().unwrap()))
            .filter(|e| e.file_name().to_string_lossy().contains("pre-migration"))
            .count();
        assert_eq!(siblings, 1);
        cleanup(&db);
    }

    #[test]
    fn fresh_file_gets_no_snapshot() {
        let db = temp_db("snap-fresh");
        migrate_db(&db).unwrap();
        assert!(!pre_migration_snapshot_path(&db).exists());
        cleanup(&db);
    }

    #[test]
    fn up_to_date_file_gets_no_snapshot() {
        let db = db_at("snap-current", LATEST_VERSION);
        assert_eq!(migrate_db(&db).unwrap(), 0);
        assert!(!pre_migration_snapshot_path(&db).exists());
        cleanup(&db);
    }

    #[test]
    fn versions_are_recorded_in_meta() {
        let db = temp_db("meta-versions");
        migrate_db(&db).unwrap();
        assert_eq!(meta(&db, "schema_version"), Some(LATEST_VERSION.to_string()));
        // The MCP crate runs these tests too, and never writes its own version.
        let expected = (env!("CARGO_PKG_NAME") == "studiomanager").then(|| env!("CARGO_PKG_VERSION").to_string());
        assert_eq!(meta(&db, "app_version"), expected);
        cleanup(&db);
    }

    /// Every column (type, NOT NULL, default) and index of the file, sorted.
    fn shape(db: &std::path::Path) -> Vec<String> {
        let conn = Connection::open(db).unwrap();
        let mut out: Vec<String> = conn
            .prepare(
                "SELECT m.name || '.' || p.name || ' ' || p.type || ' ' || p.\"notnull\" || ' ' || COALESCE(p.dflt_value, 'NULL')
                 FROM sqlite_master m JOIN pragma_table_info(m.name) p
                 WHERE m.type = 'table' AND m.name NOT IN ('schema_migrations', 'sqlite_sequence')
                 UNION ALL
                 SELECT 'index ' || name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL",
            )
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        out.sort();
        out
    }

    /// The columns migrations after 014 add, which a v3.4.0 file lacks.
    const AFTER_014: [&str; 3] = [
        "notifications.message_key TEXT 0 NULL",
        "notifications.params TEXT 0 NULL",
        "notifications.title_key TEXT 0 NULL",
    ];

    /// The shape without what migrations after 014 add.
    fn shape_014(db: &std::path::Path) -> Vec<String> {
        shape(db)
            .into_iter()
            .filter(|c| {
                !AFTER_014.contains(&c.as_str())
                    // 016: the captures table and the brief and stage columns.
                    && !c.starts_with("captures.")
                    && !c.starts_with("index idx_captures_")
                    && !["tasks.brief ", "tasks.stage ", "subtasks.brief ", "subtasks.stage "].iter().any(|p| c.starts_with(p))
            })
            .collect()
    }

    /// A file as v3.4.0 left it: migrations up to 013 plus what its
    /// ensureSchema() created.
    fn v3_4_app_file(name: &str) -> std::path::PathBuf {
        let db = temp_db(name);
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch(include_str!("../tests/fixtures/app_schema_v3_4.sql")).unwrap();
        conn.execute_batch("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);").unwrap();
        for v in 1..=13 {
            conn.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (?1, 'x')", [v]).unwrap();
        }
        conn.execute("INSERT INTO meta (key, value) VALUES ('schema_fixups', '1/13')", []).unwrap();
        db
    }

    #[test]
    fn new_file_has_the_schema_the_app_used_to_add() {
        let fresh = temp_db("m014-fresh");
        migrate_db(&fresh).unwrap();
        let old = v3_4_app_file("m014-shape");
        assert_eq!(shape_014(&fresh), shape(&old));
        cleanup(&fresh);
        cleanup(&old);
    }

    #[test]
    fn file_the_app_already_shaped_migrates_to_014() {
        let db = v3_4_app_file("m014-old");
        let before = shape(&db);
        assert_eq!(migrate_db(&db).unwrap() as i64, LATEST_VERSION - 13);
        assert_eq!(shape_014(&db), before, "014 adds nothing to a file the app shaped");
        // It had the seeded tables: their starter rows were dealt with already.
        for t in ["client_addresses", "resources", "dashboard_presets", "wiki_folders", "invoice_templates"] {
            assert_eq!(meta(&db, &format!("before_014:{t}")), Some("1".into()), "{t}");
        }
        assert_eq!(meta(&db, "schema_fixups"), None);
        cleanup(&db);
    }

    #[test]
    fn file_missing_some_app_columns_gets_them() {
        let db = v3_4_app_file("m014-partial");
        let expected = shape(&db);
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch(
            "ALTER TABLE invoices DROP COLUMN last_reminder_date;
             ALTER TABLE tasks DROP COLUMN workload_sort_order;
             DROP INDEX idx_tasks_due;
             DROP TABLE custom_list_items;",
        )
        .unwrap();
        drop(conn);
        migrate_db(&db).unwrap();
        assert_eq!(shape_014(&db), expected);
        cleanup(&db);
    }

    #[test]
    fn notifications_get_their_label_keys() {
        let db = v3_4_app_file("m015");
        Connection::open(&db)
            .unwrap()
            .execute("INSERT INTO notifications (type, title, message, read) VALUES ('info', 'Old', '', 0)", [])
            .unwrap();
        migrate_db(&db).unwrap();
        let s = shape(&db);
        for c in AFTER_014 {
            assert!(s.contains(&c.to_string()), "{c}");
        }
        // Rows from before keep their text and get no keys.
        let (title, key): (String, Option<String>) = Connection::open(&db)
            .unwrap()
            .query_row("SELECT title, title_key FROM notifications", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!((title.as_str(), key), ("Old", None));
        cleanup(&db);
    }

    #[test]
    fn new_file_records_no_seeded_table_from_before() {
        let db = temp_db("m014-new-meta");
        migrate_db(&db).unwrap();
        let n: i64 = Connection::open(&db)
            .unwrap()
            .query_row("SELECT COUNT(*) FROM meta WHERE key LIKE 'before_014:%'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
        cleanup(&db);
    }

    #[test]
    fn m016_adds_captures_brief_and_stage() {
        let db = temp_db("m016");
        migrate_db(&db).unwrap();
        let conn = Connection::open(&db).unwrap();
        assert!(table_exists(&db, "captures"));
        let cols = |t: &str| -> Vec<String> {
            conn.prepare(&format!("SELECT name FROM pragma_table_info('{t}')"))
                .unwrap()
                .query_map([], |r| r.get::<_, String>(0))
                .unwrap()
                .map(Result::unwrap)
                .collect()
        };
        for c in [
            "id", "text", "source", "status", "project_id", "task_id", "subtask_id", "outcome",
            "inbox_reason", "brief_tries", "reminder_id", "created_at", "updated_at",
        ] {
            assert!(cols("captures").contains(&c.to_string()), "captures.{c}");
        }
        for t in ["tasks", "subtasks"] {
            for c in ["brief", "stage"] {
                assert!(cols(t).contains(&c.to_string()), "{t}.{c}");
            }
        }
        conn.execute("INSERT INTO clients (id, name) VALUES ('c1', 'Studio A')", []).unwrap();
        conn.execute("INSERT INTO projects (id, client_id, name) VALUES (1, 'c1', 'Identity')", []).unwrap();
        let task = |stage: &str| {
            conn.execute("INSERT INTO tasks (project_id, title, stage) VALUES (1, 'T', ?1)", [stage])
        };
        assert!(task("shipped").is_err(), "unknown stage refused");
        task("briefed").unwrap();
        task("to_check").unwrap();
        conn.execute("INSERT INTO tasks (project_id, title) VALUES (1, 'No stage')", []).unwrap();
        assert!(
            conn.execute("INSERT INTO captures (text, source) VALUES ('x', 'email')", []).is_err(),
            "unknown source refused"
        );
        conn.execute("INSERT INTO captures (text, source, reminder_id) VALUES ('x', 'reminders', 'r1')", []).unwrap();
        assert!(
            conn.execute("INSERT INTO captures (text, source, reminder_id) VALUES ('y', 'reminders', 'r1')", []).is_err(),
            "reminder_id is unique"
        );
        let (status, tries): (String, i64) = conn
            .query_row("SELECT status, brief_tries FROM captures WHERE reminder_id = 'r1'", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!((status.as_str(), tries), ("new", 0));
        drop(conn);
        cleanup(&db);
    }

    #[test]
    fn m016_runs_twice_without_error() {
        let db = temp_db("m016-twice");
        migrate_db(&db).unwrap();
        let conn = Connection::open(&db).unwrap();
        let sql = MIGRATIONS.iter().find(|m| m.version == 16).expect("016 listed").sql;
        assert!(run_skipping_existing_columns(&conn, sql).is_ok());
        drop(conn);
        cleanup(&db);
    }

    #[test]
    fn statements_split_outside_quotes_and_comments() {
        let sql = "-- a; comment\nCREATE TABLE a (x TEXT DEFAULT ';');\n\nALTER TABLE a ADD COLUMN y TEXT; -- trailing;\n";
        let parts: Vec<String> = split_statements(sql).iter().map(|s| strip_comments(s).trim().to_string()).collect();
        assert_eq!(parts, vec!["CREATE TABLE a (x TEXT DEFAULT ';')", "ALTER TABLE a ADD COLUMN y TEXT"]);
        assert_eq!(added_column(split_statements(sql)[1]), Some(("a".into(), "y".into())));
        assert_eq!(added_column("ALTER TABLE a RENAME COLUMN y TO z"), None);
    }
}
