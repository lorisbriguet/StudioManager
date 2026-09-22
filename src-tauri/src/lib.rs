mod apple;
mod dbfiles;
mod migrate;
mod orgs;
mod seed;
mod upgrade;

use tauri::Manager;
use orgs::{OrgPrefs, Registry, DB_FILE};
use serde_json::Value as JsonValue;
use std::path::PathBuf;
use std::sync::Mutex;

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

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| format!("Failed to get app data dir: {e}"))
}

fn active_org(app: &tauri::AppHandle) -> Result<ActiveOrg, String> {
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

#[tauri::command]
fn execute_batch(
    app: tauri::AppHandle,
    statements: Vec<SqlStatement>,
) -> Result<serde_json::Value, String> {
    if statements.len() > MAX_BATCH_STATEMENTS {
        return Err(format!(
            "batch too large: {} statements (max {MAX_BATCH_STATEMENTS})",
            statements.len()
        ));
    }
    let db_path = active_org(&app)?.db_path();

    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Failed to open DB: {e}"))?;

    // Enforce foreign keys (rusqlite default is OFF) and wait instead of
    // failing immediately if another connection holds the write lock.
    conn.pragma_update(None, "foreign_keys", true)
        .map_err(|e| format!("Failed to enable foreign_keys: {e}"))?;
    conn.busy_timeout(std::time::Duration::from_millis(5000))
        .map_err(|e| format!("Failed to set busy_timeout: {e}"))?;

    conn.execute_batch("BEGIN")
        .map_err(|e| format!("BEGIN failed: {e}"))?;

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
fn enter_test_mode(app: tauri::AppHandle) -> Result<String, String> {
    let org = active_org(&app)?;
    let prod_db = org.prod_db_path();
    let snapshot_db = org.file("studiomanager_snapshot.db");
    let test_db = org.file("studiomanager_test.db");

    // Snapshot production DB (safety net) — WAL-safe consistent image
    dbfiles::snapshot_db_file(&prod_db, &snapshot_db)
        .map_err(|e| format!("Failed to snapshot production DB: {e}"))?;

    // Copy production DB to test DB
    dbfiles::snapshot_db_file(&prod_db, &test_db)
        .map_err(|e| format!("Failed to create test DB: {e}"))?;

    // Switch active DB to test
    set_active_db_name(&app, "studiomanager_test.db")?;

    Ok(test_db.to_string_lossy().to_string())
}

/// Exit test mode: switch back to production DB and remove test DB.
#[tauri::command]
fn exit_test_mode(app: tauri::AppHandle) -> Result<(), String> {
    let org = active_org(&app)?;
    let test_db = org.file("studiomanager_test.db");

    // Switch back to production DB
    set_active_db_name(&app, DB_FILE)?;

    // Remove test DB together with its WAL/SHM companions
    dbfiles::remove_db_files(&test_db);

    Ok(())
}

/// Enter presentation mode: snapshot prod DB, create empty presentation DB, switch to it.
#[tauri::command]
fn enter_presentation_mode(app: tauri::AppHandle) -> Result<String, String> {
    let org = active_org(&app)?;
    let prod_db = org.prod_db_path();
    let snapshot_db = org.file("studiomanager_snapshot.db");
    let pres_db = org.file("studiomanager_presentation.db");

    // Snapshot production DB (safety net) — WAL-safe consistent image
    dbfiles::snapshot_db_file(&prod_db, &snapshot_db)
        .map_err(|e| format!("Failed to snapshot production DB: {e}"))?;

    // Copy production DB to presentation DB (so schema/migrations are intact)
    dbfiles::snapshot_db_file(&prod_db, &pres_db)
        .map_err(|e| format!("Failed to create presentation DB: {e}"))?;

    // Switch active DB to presentation
    set_active_db_name(&app, "studiomanager_presentation.db")?;

    Ok(pres_db.to_string_lossy().to_string())
}

/// Exit presentation mode: switch back to production DB and remove presentation DB.
#[tauri::command]
fn exit_presentation_mode(app: tauri::AppHandle) -> Result<(), String> {
    let org = active_org(&app)?;
    let pres_db = org.file("studiomanager_presentation.db");

    // Switch back to production DB
    set_active_db_name(&app, DB_FILE)?;

    // Remove presentation DB together with its WAL/SHM companions
    dbfiles::remove_db_files(&pres_db);

    Ok(())
}

/// Create a manual snapshot of the production DB.
#[tauri::command]
fn snapshot_db(app: tauri::AppHandle) -> Result<String, String> {
    let org = active_org(&app)?;
    let prod_db = org.prod_db_path();
    let snapshot_db = org.file("studiomanager_snapshot.db");

    dbfiles::snapshot_db_file(&prod_db, &snapshot_db)
        .map_err(|e| format!("Failed to snapshot DB: {e}"))?;

    Ok(snapshot_db.to_string_lossy().to_string())
}

/// Restore production DB from snapshot.
#[tauri::command]
fn restore_snapshot(app: tauri::AppHandle) -> Result<(), String> {
    let org = active_org(&app)?;
    let prod_db = org.prod_db_path();
    let snapshot_db = org.file("studiomanager_snapshot.db");

    if !snapshot_db.exists() {
        return Err("No snapshot found".to_string());
    }

    // Online backup API: restores INTO the live DB with proper locking, so
    // open plugin connections keep working and see the restored content.
    dbfiles::restore_db_file(&snapshot_db, &prod_db)
        .map_err(|e| format!("Failed to restore snapshot: {e}"))?;

    Ok(())
}

/// Check if a snapshot file exists.
#[tauri::command]
fn has_snapshot(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(active_org(&app)?.file("studiomanager_snapshot.db").exists())
}

/// Get the currently active DB name.
#[tauri::command]
fn get_active_db(app: tauri::AppHandle) -> Result<String, String> {
    Ok(active_org(&app)?.relative_db())
}

fn load_registry(app: &tauri::AppHandle) -> Result<Registry, String> {
    Registry::load(&app_data_dir(app)?)?.ok_or_else(|| "organisation registry missing".to_string())
}

fn save_registry(app: &tauri::AppHandle, reg: &Registry) -> Result<(), String> {
    reg.save(&app_data_dir(app)?)
}

#[tauri::command]
fn list_organisations(app: tauri::AppHandle) -> Result<Registry, String> {
    load_registry(&app)
}

#[tauri::command]
fn create_organisation(app: tauri::AppHandle, name: String, seed_from_current: bool, prefs: OrgPrefs) -> Result<Registry, String> {
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
fn rename_organisation(app: tauri::AppHandle, id: String, name: String) -> Result<Registry, String> {
    let mut reg = load_registry(&app)?;
    reg.rename(&id, &name)?;
    save_registry(&app, &reg)?;
    Ok(reg)
}

#[tauri::command]
fn reorder_organisations(app: tauri::AppHandle, ids: Vec<String>) -> Result<Registry, String> {
    let mut reg = load_registry(&app)?;
    reg.reorder(&ids)?;
    save_registry(&app, &reg)?;
    Ok(reg)
}

#[tauri::command]
fn delete_organisation(app: tauri::AppHandle, id: String) -> Result<Registry, String> {
    let app_dir = app_data_dir(&app)?;
    let mut reg = load_registry(&app)?;
    if id == active_org(&app)?.id {
        return Err("switch to another organisation before deleting this one".to_string());
    }
    reg.remove(&id)?;
    let dir = orgs::org_dir(&app_dir, &id);
    if dir.exists() {
        trash::delete(&dir).map_err(|e| format!("move organisation folder to Trash: {e}"))?;
    }
    save_registry(&app, &reg)?;
    Ok(reg)
}

#[tauri::command]
fn switch_organisation(app: tauri::AppHandle, id: String) -> Result<Registry, String> {
    let app_dir = app_data_dir(&app)?;
    if active_org(&app)?.in_mode() {
        return Err("leave test or presentation mode before switching organisation".to_string());
    }
    let mut reg = load_registry(&app)?;
    reg.set_active(&id)?;
    let dir = orgs::org_dir(&app_dir, &id);
    migrate::migrate_db(&dir.join(DB_FILE))?;
    save_registry(&app, &reg)?;
    let state = app.state::<ActiveOrgState>();
    *state.0.lock().map_err(|e| format!("Lock error: {e}"))? = ActiveOrg { id, dir, db_name: DB_FILE.to_string() };
    Ok(reg)
}

#[tauri::command]
fn set_organisation_prefs(app: tauri::AppHandle, id: String, prefs: OrgPrefs) -> Result<Registry, String> {
    let mut reg = load_registry(&app)?;
    reg.set_prefs(&id, prefs)?;
    save_registry(&app, &reg)?;
    Ok(reg)
}

/// Startup: upgrade the legacy layout if present, create a first
/// organisation on a fresh install, migrate the active database, and
/// install the ActiveOrg state.
fn init_organisations(app: &tauri::AppHandle) -> Result<(), String> {
    let app_dir = app_data_dir(app)?;
    std::fs::create_dir_all(&app_dir).map_err(|e| format!("create app dir: {e}"))?;
    let reg = if upgrade::needs_upgrade(&app_dir) {
        upgrade::run(&app_dir)?
    } else if let Some(reg) = Registry::load(&app_dir)? {
        upgrade::discard_snapshot(&app_dir);
        reg
    } else {
        let orgs_dir = app_dir.join(orgs::ORGS_DIR);
        let orgs_dir_has_subfolders = orgs_dir
            .read_dir()
            .map(|it| it.filter_map(Result::ok).any(|entry| entry.path().is_dir()))
            .unwrap_or(false);
        if orgs_dir_has_subfolders {
            return Err(
                "organisation registry missing but orgs/ contains data; refusing to start to avoid creating an empty organisation next to existing data"
                    .to_string(),
            );
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
    migrate::migrate_db(&dir.join(DB_FILE))?;
    app.manage(ActiveOrgState(Mutex::new(ActiveOrg { id: active.id.clone(), dir, db_name: DB_FILE.to_string() })));
    Ok(())
}

/// Open a directory in Finder, or reveal a file in its enclosing folder
/// (macOS `open` command). The path is canonicalized first: it must exist
/// and resolve to an absolute path, and a canonical path can never start
/// with `-`, so it cannot be misparsed as an `open` flag.
#[tauri::command]
async fn open_in_finder(path: String) -> Result<(), String> {
    let canonical =
        std::fs::canonicalize(&path).map_err(|e| format!("path not found: {path} ({e})"))?;
    if !canonical.is_absolute() {
        return Err(format!("path is not absolute: {path}"));
    }
    let mut cmd = std::process::Command::new("open");
    if canonical.is_file() {
        // Reveal files in their enclosing Finder window instead of
        // launching the default application for the file type.
        cmd.arg("-R");
    }
    let output = cmd.arg(&canonical).output().map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            Err(format!("open failed for {path}: status {}", output.status))
        } else {
            Err(format!("open failed for {path}: {stderr}"))
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            execute_batch,
            enter_test_mode,
            exit_test_mode,
            enter_presentation_mode,
            exit_presentation_mode,
            snapshot_db,
            restore_snapshot,
            has_snapshot,
            get_active_db,
            list_organisations,
            create_organisation,
            rename_organisation,
            reorder_organisations,
            delete_organisation,
            switch_organisation,
            set_organisation_prefs,
            apple::share_pdf_via_mail,
            open_in_finder,
            apple::extract_pdf_text,
            apple::ocr_image_text,
            apple::calendar_list_writable,
            apple::calendar_create_event,
            apple::calendar_delete_event,
        ])
        .setup(|app| {
            if let Err(e) = init_organisations(app.handle()) {
                // Surface loudly: the frontend cannot open any database without this.
                eprintln!("[organisations] startup failed: {e}");
                return Err(e.into());
            }
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
