//! Menu bar part of the Agents feature: app lifetime (keep running with the window closed,
//! start hidden at login), the menu bar icon and its panel window.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::image::Image;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::ManagerExt;

use crate::agents::cli::{read_settings, SettingsGuard};

#[cfg(target_os = "macos")]
mod nspanel;

/// Passed to the app when macOS starts it at login.
pub const STARTUP_ARG: &str = "--menubar";

const TRAY_ID: &str = "menubar";
/// Label of the panel window; its page is the `/menubar` route.
pub const PANEL_LABEL: &str = "menubar";
const PANEL_WIDTH: f64 = 340.0;
const PANEL_HEIGHT: f64 = 520.0;
/// Space between the menu bar item and the panel, and between the panel and the screen edge.
const PANEL_GAP: f64 = 6.0;
const SCREEN_MARGIN: f64 = 8.0;
/// Sent to the main window when the panel opens it on a page: `{ path }`.
pub const NAVIGATE_EVENT: &str = "menubar:navigate";

// The arrow drawn 18pt high by the system (the @2x image keeps it sharp on Retina screens).
const ICON_TEMPLATE: &[u8] = include_bytes!("../../icons/menubar/arrow-template@2x.png");
const ICON_AMBER: &[u8] = include_bytes!("../../icons/menubar/arrow-amber@2x.png");

/// Whether an agent is waiting for you (amber icon), as last reported by the poller.
static ATTENTION: AtomicBool = AtomicBool::new(false);
/// When the panel last hid because it lost focus (ms since epoch). A click on the icon
/// takes the focus from the panel before the click arrives: without this, that click
/// would open the panel again instead of closing it.
static PANEL_BLURRED_AT: AtomicU64 = AtomicU64::new(0);
const REOPEN_GUARD_MS: u64 = 300;

/// Whether a click on the icon this soon after the panel hid on losing the focus is that same
/// click (it closes the panel), not a new one to open it.
pub fn reopen_suppressed(now: u64, blurred_at: u64) -> bool {
    now.saturating_sub(blurred_at) < REOPEN_GUARD_MS
}

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

/// Start the app at login (with `--menubar`) or stop doing so. Enabling reports its failure
/// (the settings card shows it); disabling is best effort.
pub fn set_autostart(app: &AppHandle, on: bool) -> Result<(), String> {
    let launcher = app.autolaunch();
    if on {
        return launcher.enable().map_err(|e| format!("Could not start StudioManager at login: {e}"));
    }
    if let Err(e) = launcher.disable() {
        eprintln!("[menubar] start at login disable: {e}");
    }
    Ok(())
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn icon(needs_you: bool) -> Option<Image<'static>> {
    Image::from_bytes(if needs_you { ICON_AMBER } else { ICON_TEMPLATE }).ok()
}

/// Show the menu bar icon (and prepare its panel) or remove both. The settings guard keeps the
/// changes in the order they were made: the work is queued on the main thread while it is held.
///
/// macOS only lets the main thread add or remove a status item (removing one from another
/// thread stops the app), and the tray handle may only be touched there. The work is queued
/// without waiting for it, so the settings lock is never held while waiting on the main thread.
pub fn sync_tray(app: &AppHandle, enabled: bool, _held: &SettingsGuard) {
    let handle = app.clone();
    if let Err(e) = app.run_on_main_thread(move || apply_tray(&handle, enabled)) {
        eprintln!("[menubar] could not update the menu bar icon: {e}");
    }
}

/// Runs on the main thread (see `sync_tray`).
fn apply_tray(app: &AppHandle, enabled: bool) {
    if !enabled {
        let _ = app.remove_tray_by_id(TRAY_ID);
        if let Some(w) = app.get_webview_window(PANEL_LABEL) {
            #[cfg(target_os = "macos")]
            nspanel::release(app, PANEL_LABEL);
            let _ = w.destroy();
        }
        return;
    }
    if app.tray_by_id(TRAY_ID).is_some() {
        return;
    }
    let needs_you = ATTENTION.load(Ordering::Relaxed);
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("StudioManager")
        .icon_as_template(!needs_you)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                toggle_panel(tray.app_handle(), rect);
            }
        });
    if let Some(img) = icon(needs_you) {
        builder = builder.icon(img);
    }
    if let Err(e) = builder.build(app) {
        eprintln!("[menubar] could not add the menu bar icon: {e}");
        return;
    }
    // Load the panel now so the first click opens it with its content ready.
    if let Err(e) = ensure_panel(app) {
        eprintln!("[menubar] could not create the panel: {e}");
    }
}

/// Amber icon while an agent is waiting for you, the plain (template) arrow otherwise.
/// Only touches the icon when the state changes.
pub fn set_attention(app: &AppHandle, needs_you: bool) {
    if ATTENTION.swap(needs_you, Ordering::Relaxed) == needs_you {
        return;
    }
    // The tray handle may only be touched on the main thread (see `sync_tray`).
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(tray) = handle.tray_by_id(TRAY_ID) {
            let _ = tray.set_icon_with_as_template(icon(needs_you), !needs_you);
        }
    });
}

fn ensure_panel(app: &AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    if let Some(w) = app.get_webview_window(PANEL_LABEL) {
        return Ok(w);
    }
    // On macOS the panel's level and Spaces behaviour (`nspanel.rs`) replace `always_on_top` and
    // `visible_on_all_workspaces`.
    let w = WebviewWindowBuilder::new(app, PANEL_LABEL, WebviewUrl::App("/menubar".into()))
        .title("StudioManager")
        .inner_size(PANEL_WIDTH, PANEL_HEIGHT)
        .resizable(false)
        .decorations(false)
        // Transparent, with the rounded frame drawn by the page (`MenuBarApp`).
        .transparent(true)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .shadow(true)
        .visible(false)
        .build()?;
    // Should it fail, the panel stays a plain window: it still works, but opening it activates
    // the app and can bring the main window forward.
    #[cfg(target_os = "macos")]
    if let Err(e) = nspanel::convert(&w) {
        eprintln!("[menubar] the panel is a plain window: {e}");
        nspanel::release(app, PANEL_LABEL);
    }
    let panel = w.clone();
    w.on_window_event(move |event| {
        // A click anywhere else (another app, the desktop, the main window) closes it.
        if let tauri::WindowEvent::Focused(false) = event {
            PANEL_BLURRED_AT.store(now_ms(), Ordering::Relaxed);
            let _ = panel.hide();
        }
    });
    Ok(w)
}

/// A rectangle in physical pixels: left, top, width, height.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Area {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Top-left corner of the panel: left edges aligned with the menu bar item, just under it,
/// kept inside the screen's work area (as AgentBar's `Bar.swift`).
pub fn panel_origin(item: Area, screen: Area, panel_w: f64, scale: f64) -> (f64, f64) {
    let left = screen.x + SCREEN_MARGIN * scale;
    let right = screen.x + screen.w - panel_w - SCREEN_MARGIN * scale;
    let x = item.x.min(right).max(left);
    (x, item.y + item.h + PANEL_GAP * scale)
}

/// The screen holding a point in physical pixels (screens' frames are physical too), else
/// the main screen.
fn monitor_under(app: &AppHandle, x: f64, y: f64) -> Option<tauri::Monitor> {
    let contains = |m: &tauri::Monitor| {
        let (p, s) = (m.position(), m.size());
        x >= p.x as f64
            && x < p.x as f64 + s.width as f64
            && y >= p.y as f64
            && y < p.y as f64 + s.height as f64
    };
    let found = app.available_monitors().ok()?.into_iter().find(contains);
    found.or_else(|| app.primary_monitor().ok().flatten())
}

fn toggle_panel(app: &AppHandle, item: tauri::Rect) {
    let Ok(panel) = ensure_panel(app) else { return };
    if panel.is_visible().unwrap_or(false) {
        let _ = panel.hide();
        return;
    }
    if reopen_suppressed(now_ms(), PANEL_BLURRED_AT.load(Ordering::Relaxed)) {
        return;
    }
    // The icon's rect comes in physical pixels; the screen under it gives the scale.
    let pos = item.position.to_physical::<f64>(1.0);
    let size = item.size.to_physical::<f64>(1.0);
    if let Some(monitor) = monitor_under(app, pos.x + size.width / 2.0, pos.y) {
        let scale = monitor.scale_factor();
        let wa = monitor.work_area();
        let screen = Area {
            x: wa.position.x as f64,
            y: wa.position.y as f64,
            w: wa.size.width as f64,
            h: wa.size.height as f64,
        };
        let icon = Area { x: pos.x, y: pos.y, w: size.width, h: size.height };
        let (x, y) = panel_origin(icon, screen, PANEL_WIDTH * scale, scale);
        let _ = panel.set_position(PhysicalPosition::new(x, y));
    }
    // Takes the keyboard without activating the app: the main window stays where it is (#6).
    #[cfg(target_os = "macos")]
    if nspanel::show(app, PANEL_LABEL) {
        return;
    }
    let _ = panel.show();
    let _ = panel.set_focus();
}

/// Where the main window goes when the panel opens it: an agent, the start form, or
/// nowhere in particular.
pub fn navigate_path(agent: Option<&str>, new_agent: bool, settings: Option<&str>) -> Option<String> {
    // Only fixed Settings targets, never a path from the panel.
    if let Some("agents") = settings {
        return Some("/settings?category=agents".into());
    }
    if new_agent {
        return Some("/agents?new=1".into());
    }
    agent.map(|id| format!("/agents?agent={}", encode_component(id)))
}

fn encode_component(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[derive(Clone, serde::Serialize)]
struct Navigate {
    path: String,
}

/// From the panel: hide it, bring the main window forward and, when given, open the agent
/// (`agent`, a session id), the start form (`newAgent`) or the Agents settings (`settings: "agents"`,
/// the only target accepted) there.
#[tauri::command]
pub fn menubar_open_main(app: AppHandle, agent: Option<String>, new_agent: bool, settings: Option<String>) {
    if let Some(p) = app.get_webview_window(PANEL_LABEL) {
        let _ = p.hide();
    }
    show_main(&app);
    if let Some(path) = navigate_path(agent.as_deref(), new_agent, settings.as_deref()) {
        let _ = app.emit_to("main", NAVIGATE_EVENT, Navigate { path });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_click_that_closed_the_panel_does_not_reopen_it() {
        // Hid at 10 000 when the click on the icon took its focus: that click arrives after.
        assert!(reopen_suppressed(10_000, 10_000));
        assert!(reopen_suppressed(10_299, 10_000));
        // A later click opens it again.
        assert!(!reopen_suppressed(10_300, 10_000));
        // Never hidden that way: no guard. The clock went back: no overflow.
        assert!(!reopen_suppressed(10_000, 0));
        assert!(reopen_suppressed(9_000, 10_000));
    }

    #[test]
    fn panel_sits_under_the_icon_on_screen() {
        let screen = Area { x: 0.0, y: 50.0, w: 2000.0, h: 1200.0 };
        let icon = Area { x: 1000.0, y: 0.0, w: 44.0, h: 48.0 };
        // Left edges aligned, just under the item (scale 2: 6pt gap = 12px).
        assert_eq!(panel_origin(icon, screen, 680.0, 2.0), (1000.0, 60.0));
        // Near the right edge: pulled back on screen with an 8pt margin.
        let icon = Area { x: 1900.0, ..icon };
        assert_eq!(panel_origin(icon, screen, 680.0, 2.0), (2000.0 - 680.0 - 16.0, 60.0));
        // Off the left edge (a second screen to the left): kept at the margin.
        let screen = Area { x: 100.0, ..screen };
        let icon = Area { x: 50.0, ..icon };
        assert_eq!(panel_origin(icon, screen, 680.0, 2.0).0, 116.0);
    }

    #[test]
    fn navigate_path_for_agent_new_or_nothing() {
        assert_eq!(navigate_path(None, false, None), None);
        assert_eq!(navigate_path(Some("ab-12"), false, None).as_deref(), Some("/agents?agent=ab-12"));
        assert_eq!(navigate_path(Some("a b&c"), false, None).as_deref(), Some("/agents?agent=a%20b%26c"));
        assert_eq!(navigate_path(Some("ab"), true, None).as_deref(), Some("/agents?new=1"));
    }

    #[test]
    fn navigate_path_settings_accepts_only_agents() {
        assert_eq!(navigate_path(None, false, Some("agents")).as_deref(), Some("/settings?category=agents"));
        assert_eq!(navigate_path(None, false, Some("/etc")), None);
        assert_eq!(navigate_path(None, false, Some("general")), None);
        assert_eq!(navigate_path(None, false, Some("agents&x=1")), None);
        // A refused target falls back to the other arguments.
        assert_eq!(navigate_path(Some("ab"), false, Some("../x")).as_deref(), Some("/agents?agent=ab"));
    }
}
