use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};
use serde_json::Value as JsonValue;
use std::path::PathBuf;
use std::sync::Mutex;

/// Global state: the active DB filename (default: "studiomanager.db").
/// In test mode this switches to "studiomanager_test.db".
struct ActiveDb(Mutex<String>);

/// A single SQL statement with optional bind parameters.
#[derive(serde::Deserialize)]
struct SqlStatement {
    sql: String,
    params: Vec<JsonValue>,
}

/// Execute multiple SQL statements in a single SQLite transaction.
/// This avoids the connection-pool issue with the Tauri SQL plugin
/// where each IPC call may get a different connection.
#[tauri::command]
fn execute_batch(
    app: tauri::AppHandle,
    statements: Vec<SqlStatement>,
) -> Result<serde_json::Value, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    let active_db = app.state::<ActiveDb>();
    let db_name = active_db.0.lock().map_err(|e| format!("Lock error: {e}"))?.clone();
    let db_path: PathBuf = app_dir.join(&db_name);

    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Failed to open DB: {e}"))?;

    conn.execute_batch("BEGIN")
        .map_err(|e| format!("BEGIN failed: {e}"))?;

    let mut last_insert_id: i64 = 0;

    for stmt in &statements {
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
                return Err(format!("error returned from database: {e}"));
            }
        }
    }

    conn.execute_batch("COMMIT")
        .map_err(|e| format!("COMMIT failed: {e}"))?;

    Ok(serde_json::json!({ "lastInsertId": last_insert_id }))
}

/// Convert Tauri SQL plugin style $1, $2 placeholders to rusqlite ?1, ?2
fn convert_placeholders(sql: &str) -> String {
    let mut result = String::with_capacity(sql.len());
    let mut chars = sql.chars().peekable();
    while let Some(c) = chars.next() {
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
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    let prod_db = app_dir.join("studiomanager.db");
    let snapshot_db = app_dir.join("studiomanager_snapshot.db");
    let test_db = app_dir.join("studiomanager_test.db");

    // Snapshot production DB (safety net)
    std::fs::copy(&prod_db, &snapshot_db)
        .map_err(|e| format!("Failed to snapshot production DB: {e}"))?;

    // Copy production DB to test DB
    std::fs::copy(&prod_db, &test_db)
        .map_err(|e| format!("Failed to create test DB: {e}"))?;

    // Switch active DB to test
    let active_db = app.state::<ActiveDb>();
    *active_db.0.lock().map_err(|e| format!("Lock error: {e}"))? = "studiomanager_test.db".to_string();

    Ok(test_db.to_string_lossy().to_string())
}

/// Exit test mode: switch back to production DB and remove test DB.
#[tauri::command]
fn exit_test_mode(app: tauri::AppHandle) -> Result<(), String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    let test_db = app_dir.join("studiomanager_test.db");

    // Switch back to production DB
    let active_db = app.state::<ActiveDb>();
    *active_db.0.lock().map_err(|e| format!("Lock error: {e}"))? = "studiomanager.db".to_string();

    // Remove test DB
    if test_db.exists() {
        let _ = std::fs::remove_file(&test_db);
    }

    Ok(())
}

/// Create a manual snapshot of the production DB.
#[tauri::command]
fn snapshot_db(app: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    let prod_db = app_dir.join("studiomanager.db");
    let snapshot_db = app_dir.join("studiomanager_snapshot.db");

    std::fs::copy(&prod_db, &snapshot_db)
        .map_err(|e| format!("Failed to snapshot DB: {e}"))?;

    Ok(snapshot_db.to_string_lossy().to_string())
}

/// Restore production DB from snapshot.
#[tauri::command]
fn restore_snapshot(app: tauri::AppHandle) -> Result<(), String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    let prod_db = app_dir.join("studiomanager.db");
    let snapshot_db = app_dir.join("studiomanager_snapshot.db");

    if !snapshot_db.exists() {
        return Err("No snapshot found".to_string());
    }

    std::fs::copy(&snapshot_db, &prod_db)
        .map_err(|e| format!("Failed to restore snapshot: {e}"))?;

    Ok(())
}

/// Check if a snapshot file exists.
#[tauri::command]
fn has_snapshot(app: tauri::AppHandle) -> Result<bool, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    Ok(app_dir.join("studiomanager_snapshot.db").exists())
}

/// Get the currently active DB name.
#[tauri::command]
fn get_active_db(app: tauri::AppHandle) -> Result<String, String> {
    let active_db = app.state::<ActiveDb>();
    let name = active_db.0.lock().map_err(|e| format!("Lock error: {e}"))?.clone();
    Ok(name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_initial_schema",
            sql: include_str!("../migrations/001_initial_schema.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_billing_name_update_task_status",
            sql: include_str!("../migrations/002_billing_name_task_status.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add_invoice_po_number",
            sql: include_str!("../migrations/003_invoice_po_number.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "create_subtasks_table",
            sql: include_str!("../migrations/004_subtasks.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "consolidate_schema",
            sql: include_str!("../migrations/005_consolidate_schema.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .manage(ActiveDb(Mutex::new("studiomanager.db".to_string())))
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:studiomanager.db", migrations)
                .build(),
        )
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
            snapshot_db,
            restore_snapshot,
            has_snapshot,
            get_active_db,
        ])
        .setup(|app| {
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
