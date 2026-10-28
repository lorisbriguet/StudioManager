//! Menu bar part of the Agents feature: app lifetime (keep running with the window closed,
//! start hidden at login). The icon and panel come in later tasks.

use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;

use crate::agents::cli::read_settings;

/// Passed to the app when macOS starts it at login.
pub const STARTUP_ARG: &str = "--menubar";

/// Whether the app stays alive with its window closed: Agents on and the menu bar on.
pub fn keep_running(app: &AppHandle) -> bool {
    let Ok(dir) = crate::app_data_dir(app) else { return false };
    let s = read_settings(&dir);
    s.enabled && s.menu_bar
}

/// True when the process was started with `--menubar` (login item).
pub fn started_hidden() -> bool {
    std::env::args().any(|a| a == STARTUP_ARG)
}

/// Show and focus the main window (Dock click, panel "open app").
pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Start the app at login (with `--menubar`) or stop doing so. Best effort: a failure only
/// means no login item, never a failed settings change.
pub fn set_autostart(app: &AppHandle, on: bool) {
    let launcher = app.autolaunch();
    let r = if on { launcher.enable() } else { launcher.disable() };
    if let Err(e) = r {
        eprintln!("[menubar] start at login {}: {e}", if on { "enable" } else { "disable" });
    }
}
