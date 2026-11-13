mod agent_access;
mod agents;
mod apple;
mod backup;
mod connectors;
mod dbfiles;
mod finder;
mod host;
mod doc_roots;
mod menubar;
mod network;
mod migrate;
mod project_docs;
mod quit;
pub mod orgs;
mod seed;
pub mod upgrade;

use tauri::Manager;
use orgs::{OrgPrefs, Registry, DB_FILE};
use serde_json::Value as JsonValue;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, RwLock, RwLockReadGuard, RwLockWriteGuard};

/// Global state: the active organisation folder and which database file
/// inside it is live (production, test or presentation copy).
#[derive(Clone, Debug)]
pub struct ActiveOrg {
    pub id: String,
    pub dir: PathBuf,
    pub db_name: String,
}

impl ActiveOrg {
    pub fn db_path(&self) -> PathBuf { self.dir.join(&self.db_name) }
    pub fn prod_db_path(&self) -> PathBuf { self.dir.join(DB_FILE) }
    pub fn file(&self, name: &str) -> PathBuf { self.dir.join(name) }
    pub fn relative_db(&self) -> String { format!("{}/{}/{}", orgs::ORGS_DIR, self.id, self.db_name) }
    pub fn in_mode(&self) -> bool { self.db_name != DB_FILE }
}

struct ActiveOrgState(Mutex<ActiveOrg>);

/// Commands that touch files or the database run off the main thread (see
/// `run_blocking`), so they no longer queue behind each other. This lock
/// keeps the order that matters: batches share it, while a change of
/// organisation, mode, snapshot or registry takes it alone, so a batch never
/// writes into a database that is being swapped, copied or removed, and two
/// registry edits never overwrite each other.
static ORG_LOCK: RwLock<()> = RwLock::new(());

/// The guarded value is `()`, so a panic elsewhere leaves nothing broken:
/// a poisoned lock is still usable.
pub(crate) fn org_shared() -> RwLockReadGuard<'static, ()> {
    ORG_LOCK.read().unwrap_or_else(|e| e.into_inner())
}

fn org_exclusive() -> RwLockWriteGuard<'static, ()> {
    ORG_LOCK.write().unwrap_or_else(|e| e.into_inner())
}

/// Run blocking work (SQLite, file copies, the registry) on Tauri's blocking
/// thread pool. A plain `fn` command runs on the main thread and freezes the
/// window for as long as it takes: up to the 5 s busy timeout when the MCP
/// server or `sm` holds the write lock, or a whole `VACUUM INTO`.
pub(crate) async fn run_blocking<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("background task failed: {e}"))?
}

/// The startup error, when `init_organisations` failed. The app still starts
/// (with `ActiveOrgState` pointing at the legacy root) so no command panics;
/// the frontend reads this and shows the fatal overlay instead of opening a
/// database. `None` on a healthy launch.
struct InitError(Mutex<Option<String>>);

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| format!("Failed to get app data dir: {e}"))
}

pub(crate) fn active_org(app: &tauri::AppHandle) -> Result<ActiveOrg, String> {
    let state = app.state::<ActiveOrgState>();
    let guard = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
    Ok(guard.clone())
}

fn set_active_db_name(app: &tauri::AppHandle, name: &str) -> Result<(), String> {
    let state = app.state::<ActiveOrgState>();
    state.0.lock().map_err(|e| format!("Lock error: {e}"))?.db_name = name.to_string();
    Ok(())
}

/// A single SQL statement with optional bind parameters.
#[derive(serde::Deserialize)]
struct SqlStatement {
    sql: String,
    params: Vec<JsonValue>,
}

/// Execute multiple SQL statements in a single SQLite transaction.
/// This avoids the connection-pool issue with the Tauri SQL plugin
/// where each IPC call may get a different connection.
/// Upper bound on statements per batch — the largest legitimate batch is a
/// full backup restore (a few thousand rows); anything beyond this is a bug
/// or abuse, not a real workload.
const MAX_BATCH_STATEMENTS: usize = 10_000;

/// Refuse a write meant for another organisation. `expected` absent means no
/// check (existing callers).
fn check_expected_org(expected: Option<&str>, active_id: &str) -> Result<(), String> {
    match expected {
        Some(e) if e != active_id => Err(format!(
            "organisation changed: batch was for {e}, active is {active_id}"
        )),
        _ => Ok(()),
    }
}

/// The database a batch writes to: the open organisation's, or `target`'s
/// production database when an organisation borrows another's equipment.
/// Test and presentation copies never reach into another organisation.
fn batch_db_path(app: &tauri::AppHandle, org: &ActiveOrg, target: Option<&str>) -> Result<PathBuf, String> {
    resolve_batch_db(&app_data_dir(app)?, org, target)
}

fn resolve_batch_db(app_dir: &Path, org: &ActiveOrg, target: Option<&str>) -> Result<PathBuf, String> {
    let Some(target) = target.filter(|t| *t != org.id) else {
        return Ok(org.db_path());
    };
    if !orgs::is_plain_id(target) {
        return Err("invalid organisation id".into());
    }
    if org.in_mode() {
        return Err("another organisation's data is not available in test or presentation mode".into());
    }
    let db = orgs::org_dir(app_dir, target).join(DB_FILE);
    if !db.exists() {
        return Err(format!("unknown organisation: {target}"));
    }
    // Only the open organisation is migrated at startup or on a switch: bring
    // the lender up to date too, or its tables may lack a column we write.
    let _one_at_a_time = LENDER_MIGRATE.lock().unwrap_or_else(|e| e.into_inner());
    migrate::migrate_db(&db)?;
    Ok(db)
}

/// Batches run under the shared organisation lock, so two of them could reach
/// the same lender at once and both try to apply its pending migrations.
static LENDER_MIGRATE: Mutex<()> = Mutex::new(());

/// Bring a borrowed-equipment organisation's database up to date before the
/// window opens its own connection to it (see `getEquipmentDb`).
#[tauri::command]
async fn prepare_equipment_org(app: tauri::AppHandle, id: String) -> Result<(), String> {
    run_blocking(move || {
        let _guard = org_shared();
        let org = active_org(&app)?;
        batch_db_path(&app, &org, Some(&id)).map(|_| ())
    })
    .await
}

#[tauri::command]
async fn execute_batch(
    app: tauri::AppHandle,
    statements: Vec<SqlStatement>,
    expected_org: Option<String>,
    target_org: Option<String>,
) -> Result<serde_json::Value, String> {
    run_blocking(move || {
        let _guard = org_shared();
        execute_batch_now(app, statements, expected_org, target_org)
    })
    .await
}

fn execute_batch_now(
    app: tauri::AppHandle,
    statements: Vec<SqlStatement>,
    expected_org: Option<String>,
    target_org: Option<String>,
) -> Result<serde_json::Value, String> {
    if statements.len() > MAX_BATCH_STATEMENTS {
        return Err(format!(
            "batch too large: {} statements (max {MAX_BATCH_STATEMENTS})",
            statements.len()
        ));
    }
    let org = active_org(&app)?;
    check_expected_org(expected_org.as_deref(), &org.id)?;
    let db_path = batch_db_path(&app, &org, target_org.as_deref())?;

    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Failed to open DB: {e}"))?;

    // Enforce foreign keys (rusqlite default is OFF) and wait instead of
    // failing immediately if another connection holds the write lock.
    conn.pragma_update(None, "foreign_keys", true)
        .map_err(|e| format!("Failed to enable foreign_keys: {e}"))?;
    conn.busy_timeout(std::time::Duration::from_millis(5000))
        .map_err(|e| format!("Failed to set busy_timeout: {e}"))?;
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(|e| format!("Failed to set synchronous: {e}"))?;

    begin_batch(&conn)?;

    let mut last_insert_id: i64 = 0;

    for (i, stmt) in statements.iter().enumerate() {
        // Check if this statement references the parent insert ID
        let uses_parent_id = stmt.sql.contains("$LAST_INSERT_ID");
        // Allow referencing the last insert ID in subsequent statements
        let sql = stmt.sql.replace("$LAST_INSERT_ID", &last_insert_id.to_string());
        // Convert $1, $2, ... placeholders to ?1, ?2, ... for rusqlite
        let sql = convert_placeholders(&sql);
        let params: Vec<Box<dyn rusqlite::types::ToSql>> = stmt
            .params
            .iter()
            .map(|v| json_to_sql(v))
            .collect();
        let refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|b| &**b).collect();

        match conn.execute(&sql, refs.as_slice()) {
            Ok(_) => {
                // Only update last_insert_id for parent INSERTs (statements that
                // don't reference $LAST_INSERT_ID). This ensures child INSERTs
                // (e.g. line items) don't overwrite the parent's rowid.
                if !uses_parent_id {
                    last_insert_id = conn.last_insert_rowid();
                }
            }
            Err(e) => {
                let _ = conn.execute_batch("ROLLBACK");
                return Err(format!("statement {i} failed: {e}"));
            }
        }
    }

    if let Err(e) = conn.execute_batch("COMMIT") {
        // Self-documenting all-or-nothing: never leave a transaction open
        let _ = conn.execute_batch("ROLLBACK");
        return Err(format!("COMMIT failed: {e}"));
    }

    Ok(serde_json::json!({ "lastInsertId": last_insert_id }))
}

/// Open the batch's transaction holding the write lock from the start.
/// A deferred `BEGIN` takes a read snapshot at the first read and upgrades
/// it at the first write; if another connection (the plugin pool, the MCP
/// server) commits in between, that upgrade fails at once with
/// `SQLITE_BUSY_SNAPSHOT`, which `busy_timeout` cannot retry. `IMMEDIATE`
/// waits (up to the busy timeout) for the lock instead.
fn begin_batch(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch("BEGIN IMMEDIATE")
        .map_err(|e| format!("BEGIN failed: {e}"))
}

/// Convert Tauri SQL plugin style $1, $2 placeholders to rusqlite ?1, ?2.
/// Text inside single-quoted SQL string literals is left untouched — a
/// literal like '$1 fee' must not become a placeholder.
fn convert_placeholders(sql: &str) -> String {
    let mut result = String::with_capacity(sql.len());
    let mut chars = sql.chars().peekable();
    let mut in_string = false;
    while let Some(c) = chars.next() {
        if c == '\'' {
            in_string = !in_string;
            result.push(c);
            continue;
        }
        if in_string {
            result.push(c);
            continue;
        }
        if c == '$' {
            // Check if followed by digits
            let mut digits = String::new();
            while let Some(&d) = chars.peek() {
                if d.is_ascii_digit() {
                    digits.push(d);
                    chars.next();
                } else {
                    break;
                }
            }
            if digits.is_empty() {
                result.push('$');
            } else {
                result.push('?');
                result.push_str(&digits);
            }
        } else {
            result.push(c);
        }
    }
    result
}

fn json_to_sql(v: &JsonValue) -> Box<dyn rusqlite::types::ToSql> {
    match v {
        JsonValue::Null => Box::new(Option::<String>::None),
        JsonValue::Bool(b) => Box::new(if *b { 1i64 } else { 0i64 }),
        JsonValue::Number(n) => {
            if let Some(i) = n.as_i64() {
                Box::new(i)
            } else {
                Box::new(n.as_f64().unwrap_or(0.0))
            }
        }
        JsonValue::String(s) => Box::new(s.clone()),
        _ => Box::new(v.to_string()),
    }
}

/// Snapshot production DB and copy to test DB. Returns the test DB path.
#[tauri::command]
async fn enter_test_mode(
    app: tauri::AppHandle,
) -> Result<String, String> {
    run_blocking(move || {
        let _guard = org_exclusive();
        enter_test_mode_now(app)
    })
    .await
}

fn enter_test_mode_now(app: tauri::AppHandle) -> Result<String, String> {
    let org = active_org(&app)?;
    let test_db = begin_mode_files(&org, TEST_DB, "test")?;
    set_active_db_name(&app, TEST_DB)?;
    Ok(test_db.to_string_lossy().to_string())
}

const TEST_DB: &str = "studiomanager_test.db";
const PRESENTATION_DB: &str = "studiomanager_presentation.db";
/// The manual snapshot (Settings > Snapshot). Test and presentation mode never touch it.
const SNAPSHOT_DB: &str = "studiomanager_snapshot.db";
/// The safety copy of production taken when a mode starts, removed when it ends.
const MODE_SNAPSHOT_DB: &str = "studiomanager_mode_snapshot.db";

/// Prepare a mode's files: a safety copy of production, the mode's database
/// (a copy of production, so the schema is intact) and an empty document
/// folder. Returns the mode database's path.
fn begin_mode_files(org: &ActiveOrg, mode_db: &str, folder: &str) -> Result<PathBuf, String> {
    let prod_db = org.prod_db_path();
    let db = org.file(mode_db);
    // WAL-safe consistent images
    dbfiles::snapshot_db_file(&prod_db, &org.file(MODE_SNAPSHOT_DB))
        .map_err(|e| format!("Failed to snapshot production DB: {e}"))?;
    dbfiles::snapshot_db_file(&prod_db, &db)
        .map_err(|e| format!("Failed to create {folder} DB: {e}"))?;
    // Start from an empty document folder (a crash may have left one behind)
    remove_mode_files(org, folder);
    Ok(db)
}

/// Remove a mode's database, its document folder and the safety copy.
fn end_mode_files(org: &ActiveOrg, mode_db: &str, folder: &str) {
    dbfiles::remove_db_files(&org.file(mode_db));
    dbfiles::remove_db_files(&org.file(MODE_SNAPSHOT_DB));
    remove_mode_files(org, folder);
}

/// Exit test mode: switch back to production DB and remove test DB.
#[tauri::command]
async fn exit_test_mode(
    app: tauri::AppHandle,
) -> Result<(), String> {
    run_blocking(move || {
        let _guard = org_exclusive();
        exit_test_mode_now(app)
    })
    .await
}

fn exit_test_mode_now(app: tauri::AppHandle) -> Result<(), String> {
    let org = active_org(&app)?;
    set_active_db_name(&app, DB_FILE)?;
    end_mode_files(&org, TEST_DB, "test");
    Ok(())
}

/// Remove a mode's document folder (`<org>/test` or `<org>/presentation`),
/// where invoice PDFs, receipts and machine files go while the mode is on.
/// The folder name must match `orgPaths()` in src/lib/orgPaths.ts.
fn remove_mode_files(org: &ActiveOrg, folder: &str) {
    let dir = org.file(folder);
    if dir.is_dir() {
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// Enter presentation mode: snapshot prod DB, create empty presentation DB, switch to it.
#[tauri::command]
async fn enter_presentation_mode(
    app: tauri::AppHandle,
) -> Result<String, String> {
    run_blocking(move || {
        let _guard = org_exclusive();
        enter_presentation_mode_now(app)
    })
    .await
}

fn enter_presentation_mode_now(app: tauri::AppHandle) -> Result<String, String> {
    let org = active_org(&app)?;
    let pres_db = begin_mode_files(&org, PRESENTATION_DB, "presentation")?;
    set_active_db_name(&app, PRESENTATION_DB)?;
    Ok(pres_db.to_string_lossy().to_string())
}

/// Exit presentation mode: switch back to production DB and remove presentation DB.
#[tauri::command]
async fn exit_presentation_mode(
    app: tauri::AppHandle,
) -> Result<(), String> {
    run_blocking(move || {
        let _guard = org_exclusive();
        exit_presentation_mode_now(app)
    })
    .await
}

fn exit_presentation_mode_now(app: tauri::AppHandle) -> Result<(), String> {
    let org = active_org(&app)?;
    set_active_db_name(&app, DB_FILE)?;
    end_mode_files(&org, PRESENTATION_DB, "presentation");
    Ok(())
}

/// Create a manual snapshot of the production DB.
#[tauri::command]
async fn snapshot_db(
    app: tauri::AppHandle,
) -> Result<String, String> {
    run_blocking(move || {
        let _guard = org_exclusive();
        snapshot_db_now(app)
    })
    .await
}

fn snapshot_db_now(app: tauri::AppHandle) -> Result<String, String> {
    let org = active_org(&app)?;
    let prod_db = org.prod_db_path();
    let snapshot_db = org.file(SNAPSHOT_DB);

    dbfiles::snapshot_db_file(&prod_db, &snapshot_db)
        .map_err(|e| format!("Failed to snapshot DB: {e}"))?;

    Ok(snapshot_db.to_string_lossy().to_string())
}

/// Back up organisations: each target names an organisation and the folder
/// its backup goes to (see backup.rs). Runs every target even when one fails
/// and reports each outcome, so the caller rotates only the ones that worked.
/// `pre_restore` marks the safety backup taken before a restore: its folder
/// name ends in `-pre-restore`, which retention (src/lib/backup.ts) never drops.
#[tauri::command]
async fn create_backups(
    app: tauri::AppHandle,
    targets: Vec<backup::BackupTarget>,
    tables: Vec<String>,
    pre_restore: Option<bool>,
) -> Result<Vec<backup::BackupOutcome>, String> {
    run_blocking(move || {
        // Shared: batches keep running, but no organisation is switched,
        // removed or swapped into a mode while its files are read.
        let _guard = org_shared();
        create_backups_now(app, targets, tables, pre_restore.unwrap_or(false))
    })
    .await
}

fn create_backups_now(
    app: tauri::AppHandle,
    targets: Vec<backup::BackupTarget>,
    tables: Vec<String>,
    pre_restore: bool,
) -> Result<Vec<backup::BackupOutcome>, String> {
    let app_dir = app_data_dir(&app)?;
    let reg = load_registry(&app)?;
    let mut stamp = chrono::Local::now().format("%Y-%m-%d-%H-%M-%S").to_string();
    if pre_restore {
        stamp.push_str("-pre-restore");
    }
    Ok(targets
        .into_iter()
        .map(|t| {
            let result = match reg.find(&t.org_id) {
                Some(org) if orgs::is_plain_id(&org.id) => backup::backup_org(
                    &orgs::org_dir(&app_dir, &org.id),
                    &org.id,
                    &org.name,
                    Path::new(&t.dir),
                    &stamp,
                    &tables,
                ),
                _ => Err(format!("unknown organisation: {}", t.org_id)),
            };
            if let Err(e) = &result {
                log::warn!("backup of organisation {} failed: {e}", t.org_id);
            }
            backup::BackupOutcome {
                org_id: t.org_id,
                dir: t.dir,
                path: result.as_ref().ok().map(|p| p.to_string_lossy().to_string()),
                error: result.err(),
            }
        })
        .collect())
}

/// Restore production DB from snapshot.
#[tauri::command]
async fn restore_snapshot(
    app: tauri::AppHandle,
) -> Result<(), String> {
    run_blocking(move || {
        let _guard = org_exclusive();
        restore_snapshot_now(app)
    })
    .await
}

fn restore_snapshot_now(app: tauri::AppHandle) -> Result<(), String> {
    let org = active_org(&app)?;
    let prod_db = org.prod_db_path();
    let snapshot_db = org.file(SNAPSHOT_DB);

    if !snapshot_db.exists() {
        return Err("No snapshot found".to_string());
    }

    restore_snapshot_file(&snapshot_db, &prod_db)
}

/// The snapshot survives updates, so it can be older than the app (migrate it
/// after the restore) or, after a downgrade, newer (refuse it before).
fn restore_snapshot_file(snapshot_db: &Path, prod_db: &Path) -> Result<(), String> {
    migrate::refuse_newer_file(snapshot_db)?;
    // Online backup API: restores INTO the live DB with proper locking, so
    // open plugin connections keep working and see the restored content.
    dbfiles::restore_db_file(snapshot_db, prod_db)
        .map_err(|e| format!("Failed to restore snapshot: {e}"))?;
    migrate::migrate_db(prod_db)?;
    Ok(())
}

/// Check if a snapshot file exists.
#[tauri::command]
fn has_snapshot(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(active_org(&app)?.file(SNAPSHOT_DB).exists())
}

/// Get the currently active DB name.
#[tauri::command]
fn get_active_db(app: tauri::AppHandle) -> Result<String, String> {
    Ok(active_org(&app)?.relative_db())
}

/// The startup failure message, if the organisation layout could not be set
/// up. `None` on a healthy launch. The frontend calls this before it touches
/// the registry or any database.
#[tauri::command]
fn get_init_error(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let state = app.state::<InitError>();
    let guard = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
    Ok(guard.clone())
}

/// The fatal overlay's Retry: run the startup again (the disk is connected,
/// the file is readable again) instead of keeping the error saved at launch.
/// Returns the error that remains, `None` once startup succeeded. Does nothing
/// after a healthy launch.
#[tauri::command]
async fn retry_init(app: tauri::AppHandle) -> Result<Option<String>, String> {
    run_blocking(move || {
        let _guard = org_exclusive();
        retry_init_now(&app)
    })
    .await
}

fn retry_init_now(app: &tauri::AppHandle) -> Result<Option<String>, String> {
    let init_state = app.state::<InitError>();
    if init_state.0.lock().map_err(|e| format!("Lock error: {e}"))?.is_none() {
        return Ok(None);
    }
    let app_dir = app_data_dir(app).unwrap_or_default();
    let (active, error) = startup_state(&app_dir, init_organisations_in(&app_dir));
    *app.state::<ActiveOrgState>().0.lock().map_err(|e| format!("Lock error: {e}"))? = active;
    *init_state.0.lock().map_err(|e| format!("Lock error: {e}"))? = error.clone();
    Ok(error)
}

fn load_registry(app: &tauri::AppHandle) -> Result<Registry, String> {
    Registry::load(&app_data_dir(app)?)?.ok_or_else(|| "organisation registry missing".to_string())
}

fn save_registry(app: &tauri::AppHandle, reg: &Registry) -> Result<(), String> {
    reg.save(&app_data_dir(app)?)
}

#[tauri::command]
async fn list_organisations(
    app: tauri::AppHandle,
) -> Result<Registry, String> {
    run_blocking(move || {
        let _guard = org_shared();
        list_organisations_now(app)
    })
    .await
}

fn list_organisations_now(app: tauri::AppHandle) -> Result<Registry, String> {
    load_registry(&app)
}

#[tauri::command]
async fn create_organisation(
    app: tauri::AppHandle,
    name: String,
    seed_from_current: bool,
    prefs: OrgPrefs,
) -> Result<Registry, String> {
    run_blocking(move || {
        let _guard = org_exclusive();
        create_organisation_now(app, name, seed_from_current, prefs)
    })
    .await
}

fn create_organisation_now(app: tauri::AppHandle, name: String, seed_from_current: bool, prefs: OrgPrefs) -> Result<Registry, String> {
    let app_dir = app_data_dir(&app)?;
    let mut reg = load_registry(&app)?;
    let id = reg.add(&name, Some(prefs))?.id.clone();
    let dir = orgs::org_dir(&app_dir, &id);
    let result = (|| -> Result<(), String> {
        std::fs::create_dir_all(dir.join("invoices")).map_err(|e| format!("create folders: {e}"))?;
        std::fs::create_dir_all(dir.join("receipts")).map_err(|e| format!("create folders: {e}"))?;
        migrate::migrate_db(&dir.join(DB_FILE))?;
        if seed_from_current {
            let current = active_org(&app)?;
            if current.in_mode() {
                return Err("leave test or presentation mode before creating an organisation from it".to_string());
            }
            let copied = seed::copy_settings_tables(&current.prod_db_path(), &dir.join(DB_FILE))?;
            log::info!("seeded new organisation {id} from current: {copied:?}");
        }
        // Before the registry lists it, so agents never see it allowed.
        agent_access::withhold_new_org(&app_dir, &id)?;
        Ok(())
    })();
    if let Err(e) = result {
        let _ = std::fs::remove_dir_all(&dir);
        return Err(e);
    }
    save_registry(&app, &reg)?;
    Ok(reg)
}

#[tauri::command]
async fn rename_organisation(
    app: tauri::AppHandle,
    id: String,
    name: String,
) -> Result<Registry, String> {
    run_blocking(move || {
        let _guard = org_exclusive();
        rename_organisation_now(app, id, name)
    })
    .await
}

fn rename_organisation_now(app: tauri::AppHandle, id: String, name: String) -> Result<Registry, String> {
    let mut reg = load_registry(&app)?;
    reg.rename(&id, &name)?;
    save_registry(&app, &reg)?;
    Ok(reg)
}

#[tauri::command]
async fn reorder_organisations(
    app: tauri::AppHandle,
    ids: Vec<String>,
) -> Result<Registry, String> {
    run_blocking(move || {
        let _guard = org_exclusive();
        reorder_organisations_now(app, ids)
    })
    .await
}

fn reorder_organisations_now(app: tauri::AppHandle, ids: Vec<String>) -> Result<Registry, String> {
    let mut reg = load_registry(&app)?;
    reg.reorder(&ids)?;
    save_registry(&app, &reg)?;
    Ok(reg)
}

#[tauri::command]
async fn delete_organisation(
    app: tauri::AppHandle,
    id: String,
) -> Result<Registry, String> {
    run_blocking(move || {
        let _guard = org_exclusive();
        delete_organisation_now(app, id)
    })
    .await
}

fn delete_organisation_now(app: tauri::AppHandle, id: String) -> Result<Registry, String> {
    let app_dir = app_data_dir(&app)?;
    let mut reg = load_registry(&app)?;
    if id == active_org(&app)?.id {
        return Err("switch to another organisation before deleting this one".to_string());
    }
    reg.remove(&id)?;
    // Persist the registry BEFORE touching the folder. If the save fails here
    // nothing was lost — the folder is still on disk and still listed. The
    // reverse order can move the data to the Trash and then leave it listed
    // as a live organisation; an orphan folder under orgs/ is the safer of
    // the two failure modes.
    save_registry(&app, &reg)?;
    let dir = orgs::org_dir(&app_dir, &id);
    if dir.exists() {
        trash::delete(&dir).map_err(|e| format!("move organisation folder to Trash: {e}"))?;
    }
    Ok(reg)
}

#[tauri::command]
async fn switch_organisation(
    app: tauri::AppHandle,
    id: String,
) -> Result<Registry, String> {
    run_blocking(move || {
        let _guard = org_exclusive();
        switch_organisation_now(app, id)
    })
    .await
}

fn switch_organisation_now(app: tauri::AppHandle, id: String) -> Result<Registry, String> {
    let app_dir = app_data_dir(&app)?;
    if active_org(&app)?.in_mode() {
        return Err("leave test or presentation mode before switching organisation".to_string());
    }
    let mut reg = load_registry(&app)?;
    reg.set_active(&id)?;
    let dir = orgs::org_dir(&app_dir, &id);
    // migrate_db would happily create a fresh, empty database here. A missing
    // folder or database means the data was moved, removed, or sits on a disk
    // that is not connected: say so instead of switching into an empty one.
    require_org_data(&dir)?;
    migrate::migrate_db(&dir.join(DB_FILE))?;
    save_registry(&app, &reg)?;
    let state = app.state::<ActiveOrgState>();
    *state.0.lock().map_err(|e| format!("Lock error: {e}"))? = ActiveOrg { id, dir, db_name: DB_FILE.to_string() };
    Ok(reg)
}

#[tauri::command]
async fn set_organisation_prefs(
    app: tauri::AppHandle,
    id: String,
    prefs: OrgPrefs,
) -> Result<Registry, String> {
    run_blocking(move || {
        let _guard = org_exclusive();
        set_organisation_prefs_now(app, id, prefs)
    })
    .await
}

fn set_organisation_prefs_now(app: tauri::AppHandle, id: String, prefs: OrgPrefs) -> Result<Registry, String> {
    let mut reg = load_registry(&app)?;
    reg.set_prefs(&id, prefs)?;
    save_registry(&app, &reg)?;
    Ok(reg)
}

/// Does `orgs/` hold at least one organisation folder?
///
/// A missing `orgs/` is a legitimate "no" (fresh install). Every other
/// failure — permissions, an unreadable entry, `orgs` being a file — is
/// propagated: the caller must never read "could not look" as "nothing
/// there" and create an empty organisation next to data it failed to see.
fn orgs_dir_has_subfolders(app_dir: &Path) -> Result<bool, String> {
    let orgs_dir = app_dir.join(orgs::ORGS_DIR);
    let entries = match std::fs::read_dir(&orgs_dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(format!("read {}: {e}", orgs_dir.display())),
    };
    for entry in entries {
        let entry = entry.map_err(|e| format!("read an entry of {}: {e}", orgs_dir.display()))?;
        if entry.path().is_dir() {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Startup: upgrade the legacy layout if present, create a first
/// organisation on a fresh install, migrate the active database, and
/// return the ActiveOrg to install as state.
fn init_organisations(app: &tauri::AppHandle) -> Result<ActiveOrg, String> {
    init_organisations_in(&app_data_dir(app)?)
}

fn init_organisations_in(app_dir: &Path) -> Result<ActiveOrg, String> {
    let app_dir = app_dir.to_path_buf();
    std::fs::create_dir_all(&app_dir).map_err(|e| format!("create app dir: {e}"))?;
    // Only an organisation the registry already listed must have its data on
    // disk: the upgrade and a fresh install create theirs.
    let mut listed = false;
    let reg = if upgrade::needs_upgrade(&app_dir) {
        upgrade::run(&app_dir)?
    } else if let Some(reg) = Registry::load(&app_dir)? {
        upgrade::clear_finished_journal(&app_dir, &reg);
        upgrade::discard_snapshot(&app_dir);
        listed = true;
        reg
    } else {
        match orgs_dir_has_subfolders(&app_dir) {
            Ok(false) => {}
            Ok(true) => {
                return Err(
                    "organisation registry missing but orgs/ contains data; refusing to start to avoid creating an empty organisation next to existing data"
                        .to_string(),
                )
            }
            Err(e) => {
                return Err(format!(
                    "organisation registry missing and orgs/ could not be read ({e}); refusing to start to avoid creating an empty organisation next to existing data"
                ))
            }
        }
        let mut reg = Registry::empty();
        let id = reg.add("Studio", Some(OrgPrefs::default()))?.id.clone();
        reg.set_active(&id)?;
        let dir = orgs::org_dir(&app_dir, &id);
        std::fs::create_dir_all(dir.join("invoices")).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(dir.join("receipts")).map_err(|e| e.to_string())?;
        reg.save(&app_dir)?;
        reg
    };
    let active = reg.active().ok_or_else(|| "registry has no active organisation".to_string())?;
    let dir = orgs::org_dir(&app_dir, &active.id);
    if listed {
        require_org_data(&dir)?;
    }
    migrate::migrate_db(&dir.join(DB_FILE))?;
    Ok(ActiveOrg { id: active.id.clone(), dir, db_name: DB_FILE.to_string() })
}

/// Start of the error for an organisation whose data is not on disk. The
/// frontend matches it to show the "connect the disk" message.
const DATA_MISSING: &str = "data folder missing: ";

/// A listed organisation's folder and database must already exist:
/// `migrate_db` would otherwise create an empty one, and the user would work
/// in it while the real data sits on a disk that is not connected. Any other
/// failure to look (permissions) is reported as it is.
fn require_org_data(dir: &Path) -> Result<(), String> {
    for path in [dir.to_path_buf(), dir.join(DB_FILE)] {
        match std::fs::metadata(&path) {
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(format!("{DATA_MISSING}{}", path.display()))
            }
            Err(e) => return Err(format!("read {}: {e}", path.display())),
        }
    }
    Ok(())
}

/// The state to install at startup, from the outcome of `init_organisations`.
///
/// A failed init must never abort `setup`: the window is already up by then,
/// so returning an error kills the app with no way to tell the user why. The
/// app starts on the legacy root instead — every command keeps working
/// against a managed state rather than panicking on a missing one — and the
/// message (with the upgrade snapshot path appended when that snapshot
/// exists) travels to the frontend's fatal overlay via `get_init_error`.
fn startup_state(app_dir: &Path, init: Result<ActiveOrg, String>) -> (ActiveOrg, Option<String>) {
    match init {
        Ok(org) => (org, None),
        Err(e) => {
            let snapshot = app_dir.join(upgrade::UPGRADE_SNAPSHOT);
            let message = if snapshot.exists() {
                format!("{e}\n\nA copy of your database from before the upgrade is kept at: {}", snapshot.display())
            } else {
                e
            };
            let legacy = ActiveOrg { id: String::new(), dir: app_dir.to_path_buf(), db_name: DB_FILE.to_string() };
            (legacy, Some(message))
        }
    }
}

/// Open a directory in Finder, or reveal a file in its enclosing folder
/// (macOS `open` command). See `finder::path_open_args` for how the path is
/// resolved and what is refused. Does nothing in the demo: its paths are made up and
/// must never open anything of this Mac (`src/lib/openExternal.ts` skips it there too).
#[tauri::command]
async fn open_in_finder(app: tauri::AppHandle, path: String) -> Result<(), String> {
    if crate::host::is_demo(&app) {
        return Ok(());
    }
    let args = finder::path_open_args(&path)?;
    finder::run_open(&args).map_err(|e| format!("open failed for {path}: {e}"))
}

/// May a webview of this app load `url`? Only the app's own pages: the
/// `tauri://localhost` custom protocol (`http(s)://tauri.localhost` where
/// the platform serves it that way), blobs those pages create (PDF
/// previews in iframes), `about:blank`/`about:srcdoc`, and, in a debug
/// build, the Vite dev server (`dev_url`). Everything else is refused: a
/// link in an agent reply or a document must open in the browser, never
/// replace the app with someone else's page.
pub(crate) fn allow_navigation(url: &tauri::Url, dev_url: Option<&tauri::Url>) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" if url.host_str() == Some("tauri.localhost") => true,
        "about" => matches!(url.path(), "blank" | "srcdoc"),
        "blob" => tauri::Url::parse(url.path())
            .is_ok_and(|inner| inner.scheme() != "blob" && allow_navigation(&inner, dev_url)),
        _ => dev_url.is_some_and(|dev| {
            url.scheme() == dev.scheme()
                && url.host_str() == dev.host_str()
                && url.port_or_known_default() == dev.port_or_known_default()
        }),
    }
}

/// Applies `allow_navigation` to every webview, the main window and the
/// menu bar panel alike (a plugin's hook runs for all of them).
fn navigation_guard<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("navigation-guard")
        .on_navigation(|webview, url| {
            let dev_url = if cfg!(debug_assertions) { webview.config().build.dev_url.as_ref() } else { None };
            let allowed = allow_navigation(url, dev_url);
            if !allowed {
                log::warn!("blocked navigation of {} to {}", webview.label(), url.scheme());
            }
            allowed
        })
        .build()
}

/// Largest size of the log file before it rotates (one older file is kept).
const LOG_MAX_BYTES: u128 = 2 * 1024 * 1024;

/// The app log, in every build: `~/Library/Logs/<identifier>/StudioManager.log`
/// (Console.app reads it). Release keeps warnings and errors, debug also
/// keeps info and prints to the terminal. Front-end `logError`/`logWarn`
/// (`src/lib/log.ts`) and Rust `log::warn!` both end up here.
fn log_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
    let file = Target::new(TargetKind::LogDir { file_name: Some("StudioManager".into()) });
    let builder = tauri_plugin_log::Builder::new()
        .max_file_size(LOG_MAX_BYTES)
        .rotation_strategy(RotationStrategy::KeepSome(1))
        .clear_targets()
        .target(file);
    if cfg!(debug_assertions) {
        builder.level(log::LevelFilter::Info).target(Target::new(TargetKind::Stdout)).build()
    } else {
        builder.level(log::LevelFilter::Warn).build()
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // First plugin, so warnings logged while the others start are kept.
    let builder = tauri::Builder::default().plugin(log_plugin());
    // The menu bar panel is a non-activating NSPanel (see `menubar`).
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());
    builder
        .plugin(navigation_guard())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // The main window starts hidden (tauri.conf.json) and `setup` decides whether to show
        // it, so the plugin must not restore visibility. The menu bar panel places itself.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .with_denylist(&[menubar::PANEL_LABEL, menubar::capture::CAPTURE_LABEL])
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        // The capture shortcut is registered from Rust only (`menubar::capture`).
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![menubar::STARTUP_ARG]),
        ))
        .invoke_handler(tauri::generate_handler![
            execute_batch,
            prepare_equipment_org,
            enter_test_mode,
            exit_test_mode,
            enter_presentation_mode,
            exit_presentation_mode,
            snapshot_db,
            create_backups,
            restore_snapshot,
            has_snapshot,
            get_active_db,
            get_init_error,
            retry_init,
            list_organisations,
            create_organisation,
            rename_organisation,
            reorder_organisations,
            delete_organisation,
            switch_organisation,
            set_organisation_prefs,
            apple::share_pdf_via_mail,
            open_in_finder,
            project_docs::list_project_docs,
            project_docs::read_project_doc,
            apple::extract_pdf_text,
            apple::ocr_image_text,
            apple::calendar_list_writable,
            apple::calendar_create_event,
            apple::calendar_delete_event,
            agent_access::get_agent_access,
            agent_access::set_agent_access,
            agent_access::preview_claude_desktop,
            agent_access::install_claude_desktop,
            agent_access::recent_agent_changes,
            connectors::connection_save_secret,
            connectors::connection_delete_secret,
            network::network_check,
            network::open_remote_link,
            network::time_machine_status,
            network::tailscale_status,
            connectors::connection_test,
            connectors::connection_sync,
            connectors::paperless::paperless_inbox,
            connectors::paperless::paperless_download,
            connectors::paperless::paperless_thumbnail,
            connectors::paperless::paperless_mark_linked,
            agents::cli::agents_get_enabled,
            agents::cli::agents_get_settings,
            agents::cli::agents_set_enabled,
            agents::cli::agents_set_menu_bar,
            agents::cli::agents_set_limit_alerts,
            agents::cli::agents_set_briefing,
            agents::cli::agents_set_reminders,
            agents::briefing::agents_briefing_folder,
            agents::briefing::briefing_status,
            agents::statusline::agents_status_line_preview,
            agents::statusline::agents_status_line_install,
            agents::statusline::agents_status_line_remove,
            agents::usage::agents_usage_limits,
            agents::usage::activity::agents_usage_activity,
            agents::projects::agents_start_folders,
            agents::projects::agents_trust_folder,
            agents::actions::agents_start,
            agents::actions::agents_stop,
            agents::actions::agents_delete,
            agents::actions::agents_switch_model,
            agents::actions::agents_dismiss,
            agents::capture::capture_add,
            agents::capture::capture_projects,
            agents::transcript::agents_conversation,
            agents::pty::agents_term_open,
            agents::pty::agents_term_write,
            agents::pty::agents_term_resize,
            agents::pty::agents_term_close,
            agents::pty::agents_send,
            agents::prompt::agents_prompt,
            agents::prompt::agents_answer,
            agents::poller::agents_list,
            agents::poller::agents_watch,
            agents::login::agents_login_status,
            agents::login::agents_login_check,
            agents::uploads::agents_save_image,
            agents::routines::routines_get,
            agents::routines::routines_save,
            agents::routines::routines_run,
            agents::routines::routines_runs,
            agents::routines::routines_open_result,
            agents::routines::routines_open_link,
            agents::routines::routines_open_folder,
            menubar::menubar_open_main,
            menubar::menubar_hide,
            menubar::menubar_set_needs_count,
            menubar::capture::capture_hide,
            menubar::capture::capture_hotkey_status,
            menubar::main_ready,
            quit::quit_ready,
        ])
        // Tauri's default menu, with a Quit (Cmd+Q) that lets the window save first.
        .menu(quit::app_menu)
        .on_menu_event(|app, event| {
            if event.id() == quit::MENU_ID {
                quit::begin(app);
            }
        })
        .setup(|app| {
            // First: the demo gates (host.rs) read it.
            host::init(&app.config().identifier);
            let handle = app.handle();
            // app_data_dir() failing is itself an init error; default to an
            // empty path so the legacy-root fallback is still installable.
            let app_dir = app_data_dir(handle).unwrap_or_default();
            let (active, init_error) = startup_state(&app_dir, init_organisations(handle));
            if let Some(e) = &init_error {
                // Surface loudly: the frontend cannot open any database without this.
                log::error!("[organisations] startup failed: {e}");
            }
            handle.manage(ActiveOrgState(Mutex::new(active)));
            handle.manage(InitError(Mutex::new(init_error)));
            // Once: the organisations that existed while the MCP server
            // allowed missing ids keep their access now that it refuses them.
            if let Ok(Some(reg)) = Registry::load(&app_dir) {
                let ids: Vec<String> = reg.organisations.iter().map(|o| o.id.clone()).collect();
                if let Err(e) = agent_access::backfill_orgs(&app_dir, &ids) {
                    log::warn!("agent access backfill failed: {e}");
                }
            }
            agent_access::start_poller(handle);
            agents::init(handle);
            // The main window is created hidden (no flash at login). Started at login with
            // the menu bar on: it stays hidden; otherwise it opens once its page has painted.
            let keep_running = menubar::keep_running(handle);
            if !(menubar::started_hidden() && keep_running) {
                menubar::show_main_when_ready(handle);
            }
            // On the main thread, before any command can run: the lock is free.
            menubar::sync_tray(handle, keep_running, &agents::cli::lock_settings());
            // Control-Option-Space follows the Agents switch; a failure is logged and shown in
            // Settings, never fatal.
            menubar::capture::init_hotkey(handle, agents::cli::read_settings(&app_dir).enabled);
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Focused(true) = event {
                agent_access::check_for_changes(
                    window.app_handle(),
                    agent_access::Trigger::Focus,
                );
            }
            // With the menu bar on, closing the window only hides it: the app (and its
            // alerts) keep running. Cmd+Q still quits.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && menubar::keep_running(window.app_handle()) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // The app is about to exit on its own (no code): let the main window
            // write its pending saves first; quit::begin exits once it has.
            if let tauri::RunEvent::ExitRequested { code, api, .. } = &event {
                if quit::should_hold_exit(app, *code) {
                    api.prevent_exit();
                    quit::begin(app);
                }
            }
            // Cmd+Q: stop the command routines still running, so none outlives the app.
            if let tauri::RunEvent::Exit = event {
                let stopped = agents::routines::run::stop_all();
                if stopped > 0 {
                    log::info!("[routines] stopped {stopped} running command(s) on quit");
                }
            }
            // Dock click while the window is hidden: bring it back.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                menubar::show_main(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn active(id: &str, db_name: &str) -> ActiveOrg {
        ActiveOrg { id: id.into(), dir: PathBuf::from("/nowhere"), db_name: db_name.into() }
    }

    /// The quoted names between `start` and the `]` that follows it.
    fn quoted_after(src: &str, start: &str) -> Vec<String> {
        let rest = &src[src.find(start).unwrap_or_else(|| panic!("{start} not found")) + start.len()..];
        let block = &rest[..rest.find(']').unwrap()];
        block.split('"').skip(1).step_by(2).map(String::from).collect()
    }

    /// The commands each window may call stay in step with the handler: one declared in
    /// `generate_handler!` but not in build.rs would be refused everywhere, and the menu bar
    /// panel never gets the powerful ones.
    #[test]
    fn window_command_lists_match_the_handler() {
        let lib = include_str!("lib.rs");
        let block = &lib[lib.find("generate_handler![").unwrap() + 18..];
        let block = &block[..block.find("])").unwrap()];
        let mut handler: Vec<String> = block
            .split(',')
            .map(|s| s.trim().rsplit("::").next().unwrap().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        handler.sort();

        let mut declared = quoted_after(include_str!("../build.rs"), "const COMMANDS: &[&str] = &[");
        declared.sort();
        assert_eq!(declared, handler, "build.rs COMMANDS must list every command in generate_handler!");

        let sets = include_str!("../permissions/windows.toml");
        let allow = |c: &str| format!("allow-{}", c.replace('_', "-"));
        let mut main = quoted_after(sets, "identifier = \"main-window\"");
        main.retain(|p| p.starts_with("allow-"));
        main.sort();
        let mut every: Vec<String> = handler.iter().map(|c| allow(c)).collect();
        every.sort();
        assert_eq!(main, every, "the main window allows every command");

        let mut panel = quoted_after(sets, "identifier = \"menubar-window\"");
        panel.retain(|p| p.starts_with("allow-"));
        assert_eq!(panel.len(), 18, "{panel:?}");
        for p in &panel {
            assert!(every.contains(p), "{p} is not a command");
        }
        for never in ["execute_batch", "routines_save", "agents_term_write", "agents_send", "agents_start", "set_agent_access", "connection_save_secret"] {
            assert!(!panel.contains(&allow(never)), "the panel must not call {never}");
        }

        // The capture panel: its three commands and nothing else.
        let mut capture = quoted_after(sets, "identifier = \"capture-window\"");
        capture.retain(|p| p.starts_with("allow-"));
        capture.sort();
        assert_eq!(capture, ["allow-capture-add", "allow-capture-hide", "allow-capture-projects"]);
        for never in ["execute_batch", "agents_start", "routines_run", "agents_list", "capture_hotkey_status"] {
            assert!(!capture.contains(&allow(never)), "the capture panel must not call {never}");
        }
    }

    /// Tauri's own check, with the real capabilities: the panel is refused a command outside
    /// its set before any handler runs, the main window is not. No handlers are registered,
    /// so a command that passes the check answers "not found" instead.
    #[test]
    fn the_panel_window_is_refused_other_commands() {
        use tauri::test::{get_ipc_response, mock_builder, INVOKE_KEY};
        let app = mock_builder().build(tauri::generate_context!(test = true)).unwrap();
        let window = |label: &str| {
            app.get_webview_window(label).unwrap_or_else(|| {
                tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::App("index.html".into()))
                    .build()
                    .unwrap()
            })
        };
        let call = |label: &str, cmd: &str| {
            let req = tauri::webview::InvokeRequest {
                cmd: cmd.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "tauri://localhost".parse().unwrap(),
                body: tauri::ipc::InvokeBody::default(),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            };
            get_ipc_response(&window(label), req).unwrap_err().to_string()
        };
        let refused = |e: &str| e.contains("not allowed");
        for cmd in ["execute_batch", "routines_save", "agents_term_write", "set_agent_access"] {
            assert!(refused(&call("menubar", cmd)), "panel {cmd}: {}", call("menubar", cmd));
            assert!(!refused(&call("main", cmd)), "main {cmd}: {}", call("main", cmd));
        }
        for cmd in ["agents_list", "agents_watch", "routines_run", "menubar_open_main", "menubar_hide", "capture_add", "capture_projects"] {
            assert!(!refused(&call("menubar", cmd)), "panel {cmd}: {}", call("menubar", cmd));
        }
        // The capture panel (its own window, its own set).
        for cmd in ["execute_batch", "agents_list", "agents_start", "routines_run", "menubar_open_main", "capture_hotkey_status"] {
            assert!(refused(&call("capture", cmd)), "capture {cmd}: {}", call("capture", cmd));
        }
        for cmd in ["capture_add", "capture_projects", "capture_hide"] {
            assert!(!refused(&call("capture", cmd)), "capture {cmd}: {}", call("capture", cmd));
        }
    }

    #[test]
    fn a_batch_target_must_be_a_plain_organisation_id() {
        let app = std::env::temp_dir().join(format!("sm-batch-{}", std::process::id()));
        let own = active("abc123", DB_FILE);
        for bad in ["", "..", "../x", "a/b", "a\\b", "ABC", "a b", "ab.c", "/etc"] {
            let err = resolve_batch_db(&app, &own, Some(bad)).unwrap_err();
            assert!(err.contains("invalid organisation id"), "{bad:?}: {err}");
        }
        // a real organisation directory is found
        let dir = orgs::org_dir(&app, "xyz789");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(DB_FILE), b"").unwrap();
        assert_eq!(resolve_batch_db(&app, &own, Some("xyz789")).unwrap(), dir.join(DB_FILE));
        assert!(resolve_batch_db(&app, &own, Some("nope00")).unwrap_err().contains("unknown organisation"));
        // the open organisation itself needs no target
        assert_eq!(resolve_batch_db(&app, &own, Some("abc123")).unwrap(), own.db_path());
        std::fs::remove_dir_all(&app).ok();
    }

    #[test]
    fn a_lender_database_is_migrated_before_a_batch_reaches_it() {
        let app = std::env::temp_dir().join(format!("sm-lender-{}", std::process::id()));
        let own = active("abc123", DB_FILE);
        let dir = orgs::org_dir(&app, "xyz789");
        std::fs::create_dir_all(&dir).unwrap();
        // The lender was last opened by an older version: only the first migration ran.
        let conn = rusqlite::Connection::open(dir.join(DB_FILE)).unwrap();
        conn.execute_batch(migrate::MIGRATIONS[0].sql).unwrap();
        conn.execute_batch(
            "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
             INSERT INTO schema_migrations VALUES (1, 'x');",
        )
        .unwrap();
        drop(conn);

        resolve_batch_db(&app, &own, Some("xyz789")).unwrap();

        let conn = rusqlite::Connection::open(dir.join(DB_FILE)).unwrap();
        let version: i64 =
            conn.query_row("SELECT MAX(version) FROM schema_migrations", [], |r| r.get(0)).unwrap();
        assert_eq!(version, migrate::LATEST_VERSION);
        drop(conn);
        std::fs::remove_dir_all(&app).ok();
    }

    #[test]
    fn converts_dollar_placeholders_to_question_marks() {
        assert_eq!(
            convert_placeholders("SELECT * FROM t WHERE a = $1 AND b = $12"),
            "SELECT * FROM t WHERE a = ?1 AND b = ?12"
        );
    }

    #[test]
    fn leaves_a_bare_dollar_untouched() {
        assert_eq!(convert_placeholders("a $ b"), "a $ b");
    }

    #[test]
    fn does_not_convert_inside_string_literals() {
        assert_eq!(
            convert_placeholders("UPDATE t SET label = '$1 fee' WHERE id = $1"),
            "UPDATE t SET label = '$1 fee' WHERE id = ?1"
        );
        // '' is an escaped quote INSIDE the literal — $2 in the literal must
        // survive, the one outside must convert
        assert_eq!(
            convert_placeholders("SELECT 'it''s $2', $2"),
            "SELECT 'it''s $2', ?2"
        );
    }

    #[test]
    fn json_values_bind_with_their_sql_types() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        let q = |v: &JsonValue| -> rusqlite::types::Value {
            let boxed = json_to_sql(v);
            conn.query_row("SELECT ?1", [&*boxed], |r| r.get(0)).unwrap()
        };
        use rusqlite::types::Value;
        assert_eq!(q(&serde_json::json!("x")), Value::Text("x".into()));
        assert_eq!(q(&serde_json::json!(7)), Value::Integer(7));
        assert_eq!(q(&serde_json::json!(1.5)), Value::Real(1.5));
        assert_eq!(q(&serde_json::json!(true)), Value::Integer(1));
        assert_eq!(q(&serde_json::json!(null)), Value::Null);
    }

    fn tmp_dir(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("sm-lib-{nanos}-{name}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn orgs_dir_is_only_reported_as_populated_when_it_holds_a_folder() {
        let app = tmp_dir("orgs-guard");
        // absent orgs/ — a fresh install, not a failure
        assert_eq!(orgs_dir_has_subfolders(&app), Ok(false));
        // orgs/ with only files (stray .DS_Store and friends) is still empty
        let orgs = app.join(orgs::ORGS_DIR);
        std::fs::create_dir_all(&orgs).unwrap();
        std::fs::write(orgs.join(".DS_Store"), b"x").unwrap();
        assert_eq!(orgs_dir_has_subfolders(&app), Ok(false));
        // one organisation folder — refuse to start
        std::fs::create_dir_all(orgs.join("k3f9a2")).unwrap();
        assert_eq!(orgs_dir_has_subfolders(&app), Ok(true));
        std::fs::remove_dir_all(&app).unwrap();
    }

    #[test]
    fn a_failed_init_still_yields_a_state_to_manage() {
        let app = tmp_dir("startup-state");
        let (org, err) = startup_state(&app, Err("orgs/ could not be read".to_string()));
        // The app must start: a managed ActiveOrg on the legacy root, so no
        // command panics on missing state while the overlay is up.
        assert_eq!(org.id, "");
        assert_eq!(org.dir, app);
        assert_eq!(org.db_path(), app.join(DB_FILE));
        let message = err.expect("the failure must be kept for the frontend");
        assert!(message.contains("orgs/ could not be read"), "{message}");
        assert!(!message.contains(upgrade::UPGRADE_SNAPSHOT), "no snapshot on disk, none named: {message}");

        // With an upgrade snapshot on disk, the message points the user at it.
        std::fs::write(app.join(upgrade::UPGRADE_SNAPSHOT), b"x").unwrap();
        let (_, err) = startup_state(&app, Err("upgrade failed".to_string()));
        let message = err.unwrap();
        assert!(message.contains(app.join(upgrade::UPGRADE_SNAPSHOT).to_string_lossy().as_ref()), "{message}");

        // A healthy init passes its organisation through untouched.
        let good = ActiveOrg { id: "k3f9a2".into(), dir: app.join("orgs/k3f9a2"), db_name: DB_FILE.into() };
        let (org, err) = startup_state(&app, Ok(good.clone()));
        assert_eq!(org.id, good.id);
        assert_eq!(org.dir, good.dir);
        assert_eq!(err, None);
        std::fs::remove_dir_all(&app).unwrap();
    }

    #[test]
    fn execute_batch_refuses_a_batch_for_another_org() {
        assert!(check_expected_org(None, "abc123").is_ok());
        assert!(check_expected_org(Some("abc123"), "abc123").is_ok());
        let err = check_expected_org(Some("old111"), "abc123").unwrap_err();
        assert!(err.contains("old111") && err.contains("abc123"));
    }

    fn url(s: &str) -> tauri::Url {
        tauri::Url::parse(s).unwrap()
    }

    #[test]
    fn navigation_stays_on_the_apps_own_pages() {
        for ok in [
            "tauri://localhost/",
            "tauri://localhost/menubar",
            "tauri://localhost/projects/12?tab=wiki#notes",
            "https://tauri.localhost/",
            "http://tauri.localhost/menubar",
            "blob:tauri://localhost/6f1c1a54-2d6c-4f7e-9c1e-0b8c2e1d9a11",
            "about:blank",
            "about:srcdoc",
        ] {
            assert!(allow_navigation(&url(ok), None), "{ok} must be allowed");
        }
        for bad in [
            "https://evil.example/login",
            "http://localhost:1420/",
            "tauri://evil.example/",
            "https://tauri.localhost.evil.example/",
            "file:///Users/me/Downloads/page.html",
            "data:text/html,<h1>hi</h1>",
            "blob:https://evil.example/6f1c1a54",
            "blob:blob:tauri://localhost/x",
            "javascript:alert(1)",
            "mailto:me@example.com",
            "vscode://file/etc/passwd",
            "about:settings",
        ] {
            assert!(!allow_navigation(&url(bad), None), "{bad} must be refused");
        }
    }

    #[test]
    fn the_dev_server_is_allowed_only_when_given() {
        let dev = url("http://localhost:1420");
        assert!(allow_navigation(&url("http://localhost:1420/menubar"), Some(&dev)));
        assert!(allow_navigation(&url("blob:http://localhost:1420/abc"), Some(&dev)));
        assert!(!allow_navigation(&url("http://localhost:1421/"), Some(&dev)));
        assert!(!allow_navigation(&url("https://localhost:1420/"), Some(&dev)));
        assert!(!allow_navigation(&url("http://127.0.0.1:1420/"), Some(&dev)));
        assert!(!allow_navigation(&url("https://evil.example/"), Some(&dev)));
        // and the app's own origin still is
        assert!(allow_navigation(&url("tauri://localhost/"), Some(&dev)));
    }

    #[test]
    fn a_batch_holds_the_write_lock_from_begin() {
        let dir = tmp_dir("begin-immediate");
        let db = dir.join("t.db");
        let setup = rusqlite::Connection::open(&db).unwrap();
        setup.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE t (x INTEGER);").unwrap();
        let batch = rusqlite::Connection::open(&db).unwrap();
        begin_batch(&batch).unwrap();
        // Another writer cannot slip a commit in between the batch's reads
        // and writes (with a deferred BEGIN this insert would succeed and the
        // batch's first write would then fail with BUSY_SNAPSHOT).
        let other = rusqlite::Connection::open(&db).unwrap();
        other.busy_timeout(std::time::Duration::ZERO).unwrap();
        let err = other.execute("INSERT INTO t VALUES (1)", []).unwrap_err();
        assert_eq!(err.sqlite_error_code(), Some(rusqlite::ErrorCode::DatabaseBusy), "{err}");
        batch.execute("INSERT INTO t VALUES (2)", []).unwrap();
        batch.execute_batch("COMMIT").unwrap();
        let n: i64 = other.query_row("SELECT COUNT(*) FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        drop((setup, batch, other));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// Test and presentation mode keep their safety copy apart from the manual
    /// snapshot, and leave nothing behind once they end (UI test D2).
    #[test]
    fn modes_leave_the_manual_snapshot_alone_and_clean_up_after_themselves() {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("sm-modes-{nanos}"));
        std::fs::create_dir_all(&dir).unwrap();
        let org = ActiveOrg { id: "abc123".into(), dir: dir.clone(), db_name: DB_FILE.into() };
        let prod = rusqlite::Connection::open(org.prod_db_path()).unwrap();
        prod.execute_batch("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('prod');").unwrap();
        dbfiles::snapshot_db_file(&org.prod_db_path(), &org.file(SNAPSHOT_DB)).unwrap();
        let manual_before = std::fs::read(org.file(SNAPSHOT_DB)).unwrap();
        prod.execute("INSERT INTO t VALUES ('after the manual snapshot')", []).unwrap();

        for (mode_db, folder) in [(TEST_DB, "test"), (PRESENTATION_DB, "presentation")] {
            let db = begin_mode_files(&org, mode_db, folder).unwrap();
            assert!(db.exists());
            assert!(org.file(MODE_SNAPSHOT_DB).exists());
            std::fs::create_dir_all(org.file(folder)).unwrap();
            end_mode_files(&org, mode_db, folder);
            assert!(!db.exists(), "{mode_db} removed");
            assert!(!org.file(MODE_SNAPSHOT_DB).exists(), "safety copy removed after {folder}");
            assert!(!org.file(folder).exists(), "{folder} folder removed");
            assert_eq!(std::fs::read(org.file(SNAPSHOT_DB)).unwrap(), manual_before, "manual snapshot untouched by {folder}");
        }
        drop(prod);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn active_org_paths_are_inside_the_org_folder() {
        let a = ActiveOrg { id: "abc123".into(), dir: PathBuf::from("/tmp/app/orgs/abc123"), db_name: "studiomanager.db".into() };
        assert_eq!(a.db_path(), PathBuf::from("/tmp/app/orgs/abc123/studiomanager.db"));
        assert_eq!(a.prod_db_path(), PathBuf::from("/tmp/app/orgs/abc123/studiomanager.db"));
        assert_eq!(a.relative_db(), "orgs/abc123/studiomanager.db");
        let t = ActiveOrg { db_name: "studiomanager_test.db".into(), ..a.clone() };
        assert_eq!(t.db_path(), PathBuf::from("/tmp/app/orgs/abc123/studiomanager_test.db"));
        assert!(t.in_mode());
    }

    /// An app folder whose registry lists one active organisation, with no
    /// organisation folder on disk yet.
    fn app_with_listed_org(name: &str) -> (PathBuf, PathBuf) {
        let app = tmp_dir(name);
        let mut reg = Registry::empty();
        let id = reg.add("Atelier", Some(OrgPrefs::default())).unwrap().id.clone();
        reg.set_active(&id).unwrap();
        reg.save(&app).unwrap();
        let dir = orgs::org_dir(&app, &id);
        (app, dir)
    }

    #[test]
    fn a_listed_organisation_whose_folder_is_missing_is_never_recreated() {
        let (app, dir) = app_with_listed_org("missing-folder");
        let err = init_organisations_in(&app).unwrap_err();
        assert!(err.starts_with(DATA_MISSING), "{err}");
        assert!(err.ends_with(&dir.display().to_string()), "{err}");
        assert!(!dir.exists(), "startup created an empty organisation folder");
        std::fs::remove_dir_all(&app).unwrap();
    }

    #[test]
    fn a_listed_organisation_whose_database_is_missing_is_never_recreated() {
        let (app, dir) = app_with_listed_org("missing-db");
        std::fs::create_dir_all(dir.join("invoices")).unwrap();
        let err = init_organisations_in(&app).unwrap_err();
        assert_eq!(err, format!("{DATA_MISSING}{}", dir.join(DB_FILE).display()));
        assert!(!dir.join(DB_FILE).exists(), "startup created an empty database");
        std::fs::remove_dir_all(&app).unwrap();
    }

    #[test]
    fn startup_succeeds_once_the_missing_data_is_back() {
        let (app, dir) = app_with_listed_org("data-back");
        assert!(init_organisations_in(&app).is_err());
        // The disk is connected again: the same startup (what Retry runs) opens it.
        migrate::migrate_db(&dir.join(DB_FILE)).unwrap();
        let org = init_organisations_in(&app).unwrap();
        assert_eq!(org.dir, dir);
        assert_eq!(org.db_path(), dir.join(DB_FILE));
        std::fs::remove_dir_all(&app).unwrap();
    }

    /// A database as 3.4.0 left it: migrations up to 010, no `meta` table.
    fn db_at_version(path: &std::path::Path, version: i64) {
        let conn = rusqlite::Connection::open(path).unwrap();
        conn.execute_batch("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);").unwrap();
        for m in migrate::MIGRATIONS.iter().filter(|m| m.version <= version) {
            conn.execute_batch(m.sql).unwrap();
            conn.execute("INSERT INTO schema_migrations (version, applied_at) VALUES (?1, datetime('now'))", [m.version]).unwrap();
        }
    }

    fn schema_version(path: &std::path::Path) -> i64 {
        rusqlite::Connection::open(path)
            .unwrap()
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn restoring_a_snapshot_from_3_4_0_migrates_it() {
        let dir = tmp_dir("restore-old");
        let (snap, prod) = (dir.join(SNAPSHOT_DB), dir.join(DB_FILE));
        migrate::migrate_db(&prod).unwrap();
        db_at_version(&snap, 10);

        restore_snapshot_file(&snap, &prod).unwrap();

        assert_eq!(schema_version(&prod), migrate::LATEST_VERSION);
        let meta: i64 = rusqlite::Connection::open(&prod)
            .unwrap()
            .query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='meta'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(meta, 1, "the restored file is missing the meta table");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_snapshot_from_a_newer_app_is_refused_and_the_database_kept() {
        let dir = tmp_dir("restore-newer");
        let (snap, prod) = (dir.join(SNAPSHOT_DB), dir.join(DB_FILE));
        migrate::migrate_db(&prod).unwrap();
        db_at_version(&snap, migrate::LATEST_VERSION);
        rusqlite::Connection::open(&snap)
            .unwrap()
            .execute("INSERT INTO schema_migrations (version, applied_at) VALUES (?1, 'x')", [migrate::LATEST_VERSION + 1])
            .unwrap();
        rusqlite::Connection::open(&prod)
            .unwrap()
            .execute("INSERT INTO clients (id, name) VALUES ('c1', 'kept')", [])
            .unwrap();

        let err = restore_snapshot_file(&snap, &prod).unwrap_err();

        assert!(err.contains(migrate::DB_NEWER_THAN_APP), "{err}");
        assert_eq!(schema_version(&prod), migrate::LATEST_VERSION);
        let kept: i64 = rusqlite::Connection::open(&prod)
            .unwrap()
            .query_row("SELECT COUNT(*) FROM clients WHERE name = 'kept'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(kept, 1, "the live database was overwritten");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_fresh_install_still_creates_its_first_organisation() {
        let app = tmp_dir("fresh-install");
        let org = init_organisations_in(&app).unwrap();
        assert!(org.db_path().is_file());
        std::fs::remove_dir_all(&app).unwrap();
    }

    #[test]
    fn run_blocking_returns_the_work_result_off_the_calling_thread() {
        let caller = std::thread::current().id();
        let ran_on = tauri::async_runtime::block_on(run_blocking(|| Ok(std::thread::current().id()))).unwrap();
        assert_ne!(ran_on, caller);
        let err = tauri::async_runtime::block_on(run_blocking(|| Err::<(), _>("nope".to_string())));
        assert_eq!(err, Err("nope".to_string()));
    }

    /// A plain `fn` command runs on the main thread and freezes the window
    /// while it works. Commands here and in agent_access.rs touch SQLite or
    /// files, so they must be `async` (and use `run_blocking`); only these
    /// in-memory lookups may stay plain.
    #[test]
    fn commands_that_touch_disk_are_async() {
        const PLAIN_OK: &[&str] = &["has_snapshot", "get_active_db", "get_init_error"];
        for (file, src) in [("lib.rs", include_str!("lib.rs")), ("agent_access.rs", include_str!("agent_access.rs"))] {
            for chunk in src.split("#[tauri::command]\n").skip(1) {
                let sig = chunk.lines().next().unwrap();
                let name = sig.split("fn ").nth(1).unwrap().split('(').next().unwrap();
                assert!(
                    sig.contains("async fn") || PLAIN_OK.contains(&name),
                    "{file}: command `{name}` runs on the main thread; make it async with run_blocking"
                );
            }
        }
    }

    #[test]
    fn an_exclusive_org_change_waits_for_running_batches() {
        let shared = org_shared();
        let (tx, rx) = std::sync::mpsc::channel();
        let writer = std::thread::spawn(move || {
            let _g = org_exclusive();
            tx.send(()).unwrap();
        });
        assert!(rx.recv_timeout(std::time::Duration::from_millis(100)).is_err());
        drop(shared);
        rx.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
        writer.join().unwrap();
    }
}
