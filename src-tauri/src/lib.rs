use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};
use serde_json::Value as JsonValue;
use std::path::PathBuf;

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
    let db_path: PathBuf = app_dir.join("studiomanager.db");

    let conn =
        rusqlite::Connection::open(&db_path).map_err(|e| format!("Failed to open DB: {e}"))?;

    conn.execute_batch("BEGIN")
        .map_err(|e| format!("BEGIN failed: {e}"))?;

    let mut last_insert_id: i64 = 0;

    for stmt in &statements {
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
                last_insert_id = conn.last_insert_rowid();
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
        .invoke_handler(tauri::generate_handler![execute_batch])
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
