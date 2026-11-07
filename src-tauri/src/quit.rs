//! Quitting waits for the main window to write what it still holds (the wiki
//! autosave runs 2 s after the last keystroke). The app menu's Quit (Cmd+Q) is
//! our own item: it emits `app-will-quit`, the page flushes and calls
//! `quit_ready`, and the app exits then, or after `READY_TIMEOUT` at most.
//!
//! macOS's own terminate (Quit in the Dock menu, logout, shutdown) skips this:
//! Tauri only reports `RunEvent::Exit` for it, when the page can no longer run.

use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Mutex;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub const MENU_ID: &str = "app-quit";
pub const WILL_QUIT_EVENT: &str = "app-will-quit";
const READY_TIMEOUT: Duration = Duration::from_millis(1500);

/// One quit at a time: the first request starts it, the page's answer ends
/// the wait, and the exit that follows goes through.
pub struct QuitGate {
    state: Mutex<GateState>,
}

struct GateState {
    quitting: bool,
    ready: Option<Sender<()>>,
}

impl QuitGate {
    pub const fn new() -> Self {
        Self { state: Mutex::new(GateState { quitting: false, ready: None }) }
    }

    /// Starts a quit; `None` when one is already under way.
    pub fn start(&self) -> Option<Receiver<()>> {
        let mut s = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if s.quitting {
            return None;
        }
        let (tx, rx) = channel();
        s.quitting = true;
        s.ready = Some(tx);
        Some(rx)
    }

    /// The page has written everything: stop waiting.
    pub fn ready(&self) {
        let mut s = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(tx) = s.ready.take() {
            let _ = tx.send(());
        }
    }

    pub fn quitting(&self) -> bool {
        self.state.lock().unwrap_or_else(|e| e.into_inner()).quitting
    }
}

/// Waits for the page's answer; false when it timed out.
pub fn wait_ready(rx: &Receiver<()>, timeout: Duration) -> bool {
    rx.recv_timeout(timeout).is_ok()
}

static GATE: QuitGate = QuitGate::new();

/// Asks the main window to flush, then exits (at most `READY_TIMEOUT` later).
pub fn begin<R: Runtime>(app: &AppHandle<R>) {
    let Some(rx) = GATE.start() else { return };
    if app.emit_to("main", WILL_QUIT_EVENT, ()).is_err() {
        GATE.ready();
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        if !wait_ready(&rx, READY_TIMEOUT) {
            log::warn!("[quit] the window did not answer in time; quitting anyway");
        }
        handle.exit(0);
    });
}

/// `RunEvent::ExitRequested`: true when the exit must wait for a flush first
/// (the caller prevents it; `begin` exits once the page has answered). An exit
/// with a code (ours after the flush, the updater's restart) always goes on.
pub fn should_hold_exit<R: Runtime>(app: &AppHandle<R>, code: Option<i32>) -> bool {
    hold(code, GATE.quitting(), app.get_webview_window("main").is_some())
}

fn hold(code: Option<i32>, quitting: bool, has_main: bool) -> bool {
    code.is_none() && !quitting && has_main
}

/// The page has written its pending saves. Only the main window answers.
#[tauri::command]
pub fn quit_ready(window: tauri::WebviewWindow) {
    if window.label() == "main" {
        GATE.ready();
    }
}

/// Tauri's default menu, with its Quit replaced by ours (same label and Cmd+Q).
pub fn app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::default(app)?;
    #[cfg(target_os = "macos")]
    if let Some(app_menu) = menu.items()?.first().and_then(|i| i.as_submenu().cloned()) {
        let count = app_menu.items()?.len();
        // The predefined Quit is the last item of the app menu.
        if count > 0 {
            app_menu.remove_at(count - 1)?;
        }
        let label = format!("Quit {}", app.package_info().name);
        app_menu.append(&MenuItem::with_id(app, MENU_ID, label, true, Some("CmdOrCtrl+Q"))?)?;
    }
    Ok(menu)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_quit_starts_once() {
        let gate = QuitGate::new();
        assert!(gate.start().is_some());
        assert!(gate.quitting());
        assert!(gate.start().is_none());
    }

    #[test]
    fn the_page_answer_ends_the_wait() {
        let gate = QuitGate::new();
        let rx = gate.start().unwrap();
        gate.ready();
        assert!(wait_ready(&rx, Duration::from_secs(5)));
    }

    #[test]
    fn no_answer_times_out() {
        let gate = QuitGate::new();
        let rx = gate.start().unwrap();
        let started = std::time::Instant::now();
        assert!(!wait_ready(&rx, Duration::from_millis(50)));
        assert!(started.elapsed() >= Duration::from_millis(50));
    }

    #[test]
    fn only_an_exit_without_a_code_is_held() {
        assert!(hold(None, false, true));
        // Our own exit after the flush, and the updater's restart.
        assert!(!hold(Some(0), false, true));
        assert!(!hold(Some(tauri::RESTART_EXIT_CODE), false, true));
        assert!(!hold(None, true, true));
        // No main window: nothing to flush.
        assert!(!hold(None, false, false));
    }

    #[test]
    fn an_answer_with_no_quit_under_way_is_ignored() {
        let gate = QuitGate::new();
        gate.ready();
        assert!(!gate.quitting());
        assert!(gate.start().is_some());
    }
}
