//! The capture panel: Control-Option-Space opens one text field over whatever is on screen.
//! A borderless, non-activating panel like the menu bar panel (`nspanel.rs`), so StudioManager's
//! main window never comes forward. The page is the `/capture` route (`src/capture`); it saves
//! through `capture_add` (`agents/capture.rs`) and asks `capture_hide` to close.
//!
//! The shortcut is registered while the Agents switch is on (never in the demo build). When
//! registration fails (macOS itself uses Control-Option-Space for "Select next source in Input
//! menu"), the app starts as usual: the error is logged and kept for Settings › Agents
//! (`capture_hotkey_status`), and the menu bar field still works.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use super::Area;

/// Label of the capture window; its page is the `/capture` route.
pub const CAPTURE_LABEL: &str = "capture";
const WIDTH: f64 = 560.0;
const HEIGHT: f64 = 120.0;
/// Space kept between the panel and the screen's left and right edges.
const SCREEN_MARGIN: f64 = 8.0;
/// Sent to the capture page each time the panel shows, so it starts empty.
pub const SHOWN_EVENT: &str = "capture:shown";

/// Why the shortcut is not registered; None while it is (or while Agents is off).
static HOTKEY_ERROR: Mutex<Option<String>> = Mutex::new(None);
/// When the panel last hid because it lost focus (ms since epoch): the shortcut pressed to close
/// it takes the focus first, and must not open it again (as `PANEL_BLURRED_AT` for the icon).
static BLURRED_AT: AtomicU64 = AtomicU64::new(0);

fn shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space)
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Top-left corner of the panel in physical pixels: centred horizontally, a quarter of the way
/// down the work area of the screen under the mouse; kept off the screen's edges when the panel
/// is wider than the screen.
pub fn capture_origin(screen: Area, w: f64, scale: f64) -> (f64, f64) {
    let margin = SCREEN_MARGIN * scale;
    let x = (screen.x + (screen.w - w) / 2.0).max(screen.x + margin);
    (x, screen.y + screen.h / 4.0)
}

fn set_error(error: Option<String>) {
    *HOTKEY_ERROR.lock().unwrap_or_else(|e| e.into_inner()) = error;
}

fn hotkey_error() -> Option<String> {
    HOTKEY_ERROR.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

/// Registers or unregisters the shortcut. Runs on the main thread (setup, or `sync_hotkey`).
/// Never fails: an error is logged and kept for `capture_hotkey_status`.
pub fn apply_hotkey(app: &AppHandle, on: bool) {
    let keys = app.global_shortcut();
    let sc = shortcut();
    if !on {
        if keys.is_registered(sc) {
            if let Err(e) = keys.unregister(sc) {
                log::warn!("[capture] could not release the shortcut: {e}");
            }
        }
        if let Some(w) = app.get_webview_window(CAPTURE_LABEL) {
            #[cfg(target_os = "macos")]
            super::nspanel::release(app, CAPTURE_LABEL);
            let _ = w.destroy();
        }
        set_error(None);
        return;
    }
    if keys.is_registered(sc) {
        return;
    }
    match keys.on_shortcut(sc, |app, _, event| {
        if event.state == ShortcutState::Pressed {
            toggle(app);
        }
    }) {
        Ok(()) => set_error(None),
        Err(e) => {
            log::warn!("[capture] Control-Option-Space is not available: {e}");
            set_error(Some(e.to_string()));
        }
    }
}

/// Registers (Agents on, not the demo build) or unregisters the shortcut from any thread but
/// the main one, and waits briefly for the outcome so Settings reads it right after.
pub fn sync_hotkey(app: &AppHandle, on: bool) {
    let on = on && !crate::host::is_demo(app);
    let (tx, rx) = std::sync::mpsc::channel();
    let handle = app.clone();
    if let Err(e) = app.run_on_main_thread(move || {
        apply_hotkey(&handle, on);
        let _ = tx.send(());
    }) {
        log::warn!("[capture] could not update the shortcut: {e}");
        return;
    }
    let _ = rx.recv_timeout(std::time::Duration::from_secs(2));
}

/// Setup, on the main thread: the shortcut follows the Agents switch.
pub fn init_hotkey(app: &AppHandle, agents_on: bool) {
    apply_hotkey(app, agents_on && !crate::host::is_demo(app));
}

fn ensure_panel(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    if let Some(w) = app.get_webview_window(CAPTURE_LABEL) {
        return Ok(w);
    }
    let w = WebviewWindowBuilder::new(app, CAPTURE_LABEL, WebviewUrl::App("/capture".into()))
        .title("StudioManager")
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
        .decorations(false)
        // Transparent, with the rounded frame drawn by the page.
        .transparent(true)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .shadow(true)
        .visible(false)
        .build()?;
    #[cfg(target_os = "macos")]
    if let Err(e) = super::nspanel::convert_capture(&w) {
        log::warn!("[capture] the panel is a plain window: {e}");
        super::nspanel::release(app, CAPTURE_LABEL);
    }
    let panel = w.clone();
    w.on_window_event(move |event| {
        if let tauri::WindowEvent::Focused(false) = event {
            BLURRED_AT.store(now_ms(), Ordering::Relaxed);
            let _ = panel.hide();
        }
    });
    Ok(w)
}

/// The shortcut: hide the panel when it shows, else show it under the mouse's screen.
fn toggle(app: &AppHandle) {
    let handle = app.clone();
    // AppKit calls are for the main thread; the shortcut callback may arrive elsewhere.
    let _ = app.run_on_main_thread(move || {
        let Ok(panel) = ensure_panel(&handle) else { return };
        if panel.is_visible().unwrap_or(false) {
            let _ = panel.hide();
            return;
        }
        if super::reopen_suppressed(now_ms(), BLURRED_AT.load(Ordering::Relaxed)) {
            return;
        }
        let mouse = handle.cursor_position().ok();
        let monitor = mouse.and_then(|m| super::monitor_under(&handle, m.x, m.y)).or_else(|| handle.primary_monitor().ok().flatten());
        if let Some(monitor) = monitor {
            let scale = monitor.scale_factor();
            let wa = monitor.work_area();
            let screen = Area {
                x: wa.position.x as f64,
                y: wa.position.y as f64,
                w: wa.size.width as f64,
                h: wa.size.height as f64,
            };
            let (x, y) = capture_origin(screen, WIDTH * scale, scale);
            let _ = panel.set_position(PhysicalPosition::new(x, y));
        }
        let _ = handle.emit_to(CAPTURE_LABEL, SHOWN_EVENT, ());
        #[cfg(target_os = "macos")]
        if super::nspanel::show(&handle, CAPTURE_LABEL) {
            return;
        }
        let _ = panel.show();
        let _ = panel.set_focus();
    });
}

/// From the capture panel: hide it (after saving, or Escape).
#[tauri::command]
pub fn capture_hide(app: AppHandle) {
    if let Some(p) = app.get_webview_window(CAPTURE_LABEL) {
        let _ = p.hide();
    }
}

/// For Settings › Agents: None while the shortcut is registered, else why it is not.
#[tauri::command]
pub fn capture_hotkey_status() -> Result<Option<String>, String> {
    Ok(hotkey_error())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panel_is_centred_a_quarter_down_the_screen_under_the_mouse() {
        // 1440 x 900 points at scale 2: a 2880 x 1800 pixel work area, the panel 1120 px wide.
        let screen = Area { x: 0.0, y: 50.0, w: 2880.0, h: 1800.0 };
        assert_eq!(capture_origin(screen, 1120.0, 2.0), (880.0, 50.0 + 450.0));
        // A second screen to the left (negative x).
        let left = Area { x: -1920.0, y: 0.0, w: 1920.0, h: 1080.0 };
        assert_eq!(capture_origin(left, 560.0, 1.0), (-1920.0 + 680.0, 270.0));
        // Narrower than the panel: kept at the margin, not off the screen.
        let narrow = Area { x: 100.0, y: 0.0, w: 400.0, h: 800.0 };
        assert_eq!(capture_origin(narrow, 560.0, 1.0).0, 108.0);
    }

    #[test]
    fn a_failed_registration_is_kept_for_settings_and_cleared_when_it_works() {
        set_error(Some("already registered".into()));
        assert_eq!(capture_hotkey_status().unwrap().as_deref(), Some("already registered"));
        set_error(None);
        assert_eq!(capture_hotkey_status().unwrap(), None);
    }

    #[test]
    fn the_shortcut_is_control_option_space() {
        let sc = shortcut();
        assert_eq!(sc.mods, Modifiers::CONTROL | Modifiers::ALT);
        assert_eq!(sc.key, Code::Space);
    }
}
