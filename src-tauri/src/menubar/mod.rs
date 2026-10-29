//! Menu bar part of the Agents feature: app lifetime (keep running with the window closed,
//! start hidden at login), the menu bar icon and its panel window.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::image::Image;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::ManagerExt;

use crate::agents::cli::{read_settings, SettingsGuard};

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
/// Until when (ms since epoch) the main window taking the focus from the panel is macOS
/// handing it over, not a click. Opening the panel while StudioManager is in the background
/// with its window open brings the app forward, and macOS then gives the focus to that window
/// (the #6 bug). Set only in that case, and used once.
static HANDOVER_UNTIL: AtomicU64 = AtomicU64::new(0);
/// Generous, for a slow Mac: a click elsewhere hides the panel at once whatever the time, and
/// only the main window taking the focus is held back.
const HANDOVER_MS: u64 = 3_000;

/// What the panel does when it loses focus: take it back from the main window while the app's
/// activation hands the focus over, hide otherwise (a click in another app, on the desktop, or
/// in the main window later on).
#[derive(Debug, PartialEq)]
pub enum BlurAction {
    Refocus,
    Hide,
}

pub fn blur_action(now: u64, handover_until: u64, main_focused: bool) -> BlurAction {
    if main_focused && now < handover_until {
        BlurAction::Refocus
    } else {
        BlurAction::Hide
    }
}

/// Dock icon and app menus only while the main window is open; with only the menu bar
/// (window hidden, menu bar on) StudioManager is an accessory app, so opening the panel does
/// not bring a window forward or switch the menu bar to the app's menus.
#[cfg(target_os = "macos")]
pub fn activation_policy(main_visible: bool, menu_bar_on: bool) -> tauri::ActivationPolicy {
    if menu_bar_on && !main_visible {
        tauri::ActivationPolicy::Accessory
    } else {
        tauri::ActivationPolicy::Regular
    }
}

#[cfg(target_os = "macos")]
fn apply_policy(app: &AppHandle, main_visible: bool, menu_bar_on: bool) {
    if let Err(e) = app.set_activation_policy(activation_policy(main_visible, menu_bar_on)) {
        eprintln!("[menubar] could not set the activation policy: {e}");
    }
}

/// Follows the main window: closing it with the menu bar on (it only hides, see `lib.rs`)
/// makes the app an accessory. Registered once, with the menu bar icon.
#[cfg(target_os = "macos")]
fn watch_main(app: &AppHandle) {
    static WATCHING: AtomicBool = AtomicBool::new(false);
    let Some(main) = app.get_webview_window("main") else { return };
    if WATCHING.swap(true, Ordering::Relaxed) {
        return;
    }
    let handle = app.clone();
    main.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { .. } = event {
            if keep_running(&handle) {
                apply_policy(&handle, false, true);
            }
        }
    });
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
    #[cfg(target_os = "macos")]
    apply_policy(app, true, true);
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
    #[cfg(target_os = "macos")]
    {
        let main_visible = app
            .get_webview_window("main")
            .is_some_and(|w| w.is_visible().unwrap_or(false));
        apply_policy(app, main_visible, enabled);
        if enabled {
            watch_main(app);
        }
    }
    if !enabled {
        let _ = app.remove_tray_by_id(TRAY_ID);
        if let Some(w) = app.get_webview_window(PANEL_LABEL) {
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
    let w = WebviewWindowBuilder::new(app, PANEL_LABEL, WebviewUrl::App("/menubar".into()))
        .title("StudioManager")
        .inner_size(PANEL_WIDTH, PANEL_HEIGHT)
        .resizable(false)
        .decorations(false)
        .skip_taskbar(true)
        .always_on_top(true)
        // Opens over the current Space and over a full-screen app, instead of switching Spaces.
        .visible_on_all_workspaces(true)
        .shadow(true)
        .visible(false)
        .build()?;
    let panel = w.clone();
    w.on_window_event(move |event| {
        if let tauri::WindowEvent::Focused(false) = event {
            // Decide once macOS has settled who has the focus: while the panel resigns, the
            // window taking over is not key yet. From another thread the task is queued
            // (on the main thread it would run at once).
            let panel = panel.clone();
            std::thread::spawn(move || {
                let app = panel.app_handle().clone();
                let _ = app.clone().run_on_main_thread(move || on_panel_blur(&app, &panel));
            });
        }
    });
    Ok(w)
}

/// Runs on the main thread after the panel lost the focus (see `ensure_panel`).
fn on_panel_blur(app: &AppHandle, panel: &tauri::WebviewWindow) {
    if panel.is_focused().unwrap_or(false) || !panel.is_visible().unwrap_or(false) {
        return;
    }
    let main_focused = app
        .get_webview_window("main")
        .is_some_and(|m| m.is_focused().unwrap_or(false));
    let now = now_ms();
    if blur_action(now, HANDOVER_UNTIL.swap(0, Ordering::Relaxed), main_focused) == BlurAction::Refocus {
        let _ = panel.set_focus();
        return;
    }
    PANEL_BLURRED_AT.store(now, Ordering::Relaxed);
    let _ = panel.hide();
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
    if now_ms().saturating_sub(PANEL_BLURRED_AT.load(Ordering::Relaxed)) < REOPEN_GUARD_MS {
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
    // The main window open behind other apps will take the focus as the app comes forward.
    let main_in_background = app
        .get_webview_window("main")
        .is_some_and(|m| m.is_visible().unwrap_or(false) && !m.is_focused().unwrap_or(false));
    HANDOVER_UNTIL.store(if main_in_background { now_ms() + HANDOVER_MS } else { 0 }, Ordering::Relaxed);
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
    fn focus_handed_to_the_main_window_while_the_app_activates_is_taken_back() {
        // Opened at 10 000 with the main window in the background: the hand-over is expected
        // until 13 000.
        let until = 10_000 + HANDOVER_MS;
        // The main window takes the focus, even late on a slow Mac: keep the panel.
        assert_eq!(blur_action(10_100, until, true), BlurAction::Refocus);
        assert_eq!(blur_action(12_999, until, true), BlurAction::Refocus);
        // A click in Finder (the main window doesn't get the focus) closes it at once.
        assert_eq!(blur_action(10_100, until, false), BlurAction::Hide);
        // No hand-over expected (main window hidden or already in front), or used up / late:
        // a click in the main window closes it.
        assert_eq!(blur_action(10_100, 0, true), BlurAction::Hide);
        assert_eq!(blur_action(13_000, until, true), BlurAction::Hide);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn accessory_only_with_the_menu_bar_and_the_window_hidden() {
        use tauri::ActivationPolicy::{Accessory, Regular};
        assert!(matches!(activation_policy(false, true), Accessory));
        assert!(matches!(activation_policy(true, true), Regular));
        // Menu bar off: always a regular app (the window can't stay hidden then).
        assert!(matches!(activation_policy(false, false), Regular));
        assert!(matches!(activation_policy(true, false), Regular));
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
