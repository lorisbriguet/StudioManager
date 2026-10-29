//! macOS: the menu bar panel window as a non-activating `NSPanel` (tauri-nspanel).
//!
//! A normal window activates StudioManager when it takes the focus, which brings the main
//! window forward and switches the menu bar to the app's menus. A non-activating panel takes
//! the keyboard focus without activating the app, like Spotlight or a menu bar extra.
//!
//! AppKit only allows these calls on the main thread: every caller in `menubar` runs there
//! (tray events, `apply_tray`, sync commands).

use tauri::{AppHandle, WebviewWindow};
use tauri_nspanel::panel::NSWindowCollectionBehavior;
use tauri_nspanel::{CollectionBehavior, ManagerExt, PanelLevel, StyleMask, WebviewWindowExt};

tauri_nspanel::tauri_panel! {
    panel!(MenuBarPanel {
        config: {
            // Takes the keyboard (answer buttons, tabs) but never becomes the main window.
            can_become_key_window: true,
            can_become_main_window: false,
            is_floating_panel: true,
            // Hidden on a click elsewhere (`Focused(false)` in `ensure_panel`), not on
            // deactivation: the app is usually inactive while the panel is open.
            hides_on_deactivate: false
        }
    })
}

/// Above other apps' windows and the menu bar itself, under pop-up menus and system alerts.
pub const LEVEL: PanelLevel = PanelLevel::Status;

/// Opens on the Space you are in, also over a full-screen app, instead of switching Spaces;
/// stays out of Mission Control and Cmd+` like a menu.
pub fn collection_behavior() -> NSWindowCollectionBehavior {
    CollectionBehavior::new()
        .can_join_all_spaces()
        .full_screen_auxiliary()
        .transient()
        .ignores_cycle()
        .into()
}

/// Turns the freshly built panel window into the panel. Tauri keeps the window (events,
/// `hide`, `set_position`, `destroy`); its delegate is untouched, so `Focused(false)` still
/// arrives when the panel resigns key.
pub fn convert(window: &WebviewWindow) -> Result<(), String> {
    let panel = window.to_panel::<MenuBarPanel>().map_err(|e| e.to_string())?;
    panel.set_level(LEVEL.value());
    panel
        .add_style_mask(StyleMask::empty().nonactivating_panel().into())
        .map_err(|e| e.to_string())?;
    panel.set_collection_behavior(collection_behavior());
    Ok(())
}

/// Brings the panel to the front and gives it the keyboard without activating the app.
/// False when the window is not a panel (conversion failed).
pub fn show(app: &AppHandle, label: &str) -> bool {
    let Ok(panel) = app.get_webview_panel(label) else { return false };
    // Not `show_and_make_key`: it makes the content view first responder, taking the
    // keyboard from the webview.
    panel.order_front_regardless();
    panel.make_key_window();
    true
}

/// Gives the window back to Tauri as a plain window before it is destroyed.
pub fn release(app: &AppHandle, label: &str) {
    if let Ok(panel) = app.get_webview_panel(label) {
        let _ = panel.to_window();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panel_joins_every_space_and_full_screen_apps_like_a_menu() {
        let b = collection_behavior();
        assert!(b.contains(NSWindowCollectionBehavior::CanJoinAllSpaces));
        assert!(b.contains(NSWindowCollectionBehavior::FullScreenAuxiliary));
        assert!(b.contains(NSWindowCollectionBehavior::Transient));
        assert!(b.contains(NSWindowCollectionBehavior::IgnoresCycle));
        // One Spaces option only: joining all Spaces excludes moving to the active one.
        assert!(!b.contains(NSWindowCollectionBehavior::MoveToActiveSpace));
        // Over normal and floating windows (the old `always_on_top`).
        assert!(LEVEL.value() > PanelLevel::Floating.value());
    }
}
