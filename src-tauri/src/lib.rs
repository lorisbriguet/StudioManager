use tauri_plugin_sql::{Migration, MigrationKind};

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
