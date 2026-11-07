/// Every command in `generate_handler!` (src/lib.rs). Declaring them turns on Tauri's
/// per-window check: a window may call only the commands its capability allows
/// (permissions/windows.toml). A test in lib.rs keeps this list equal to the handler.
const COMMANDS: &[&str] = &[
    "execute_batch",
    "prepare_equipment_org",
    "enter_test_mode",
    "exit_test_mode",
    "enter_presentation_mode",
    "exit_presentation_mode",
    "snapshot_db",
    "create_backups",
    "restore_snapshot",
    "has_snapshot",
    "get_active_db",
    "get_init_error",
    "retry_init",
    "list_organisations",
    "create_organisation",
    "rename_organisation",
    "reorder_organisations",
    "delete_organisation",
    "switch_organisation",
    "set_organisation_prefs",
    "share_pdf_via_mail",
    "open_in_finder",
    "list_project_docs",
    "read_project_doc",
    "extract_pdf_text",
    "ocr_image_text",
    "calendar_list_writable",
    "calendar_create_event",
    "calendar_delete_event",
    "get_agent_access",
    "set_agent_access",
    "preview_claude_desktop",
    "install_claude_desktop",
    "recent_agent_changes",
    "connection_save_secret",
    "connection_delete_secret",
    "network_check",
    "open_remote_link",
    "time_machine_status",
    "tailscale_status",
    "connection_test",
    "connection_sync",
    "paperless_inbox",
    "paperless_download",
    "paperless_thumbnail",
    "paperless_mark_linked",
    "agents_get_enabled",
    "agents_get_settings",
    "agents_set_enabled",
    "agents_set_menu_bar",
    "agents_set_limit_alerts",
    "agents_status_line_preview",
    "agents_status_line_install",
    "agents_status_line_remove",
    "agents_usage_limits",
    "agents_usage_activity",
    "agents_start_folders",
    "agents_trust_folder",
    "agents_start",
    "agents_stop",
    "agents_delete",
    "agents_switch_model",
    "agents_dismiss",
    "agents_conversation",
    "agents_term_open",
    "agents_term_write",
    "agents_term_resize",
    "agents_term_close",
    "agents_send",
    "agents_prompt",
    "agents_answer",
    "agents_list",
    "agents_watch",
    "agents_login_status",
    "agents_login_check",
    "agents_save_image",
    "routines_get",
    "routines_save",
    "routines_run",
    "routines_runs",
    "routines_open_result",
    "routines_open_link",
    "routines_open_folder",
    "menubar_open_main",
    "menubar_hide",
    "main_ready",
    "quit_ready",
];

fn main() {
    // Tauri's externalBin needs the MCP server binary for the build target.
    // It is git-ignored, so a fresh clone lacks it; say how to create it.
    if let Ok(triple) = std::env::var("TARGET") {
        let dir = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap_or_default())
            .join("binaries");
        let bin = dir.join(format!("studiomanager-mcp-{triple}"));
        if !bin.exists() {
            println!(
                "cargo:warning=missing {}: run `bash scripts/build-mcp.sh` once before cargo commands in src-tauri",
                bin.display()
            );
        }
    }
    println!("cargo:rerun-if-changed=permissions");
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build")
}
