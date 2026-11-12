//! Which build is running. The demo build (`ch.studiomanager.demo`) holds fictional data only
//! and never reads or writes this Mac: not its calendar, its network, Claude Code's files or
//! the real app's Keychain entries. Decided from the bundle identifier, never from the page.

use std::sync::OnceLock;

/// The real app's bundle identifier.
pub const APP_IDENTIFIER: &str = "ch.studiomanager.app";

static IDENTIFIER: OnceLock<String> = OnceLock::new();

/// Called first thing in `setup`, before any command can run.
pub fn init(identifier: &str) {
    let _ = IDENTIFIER.set(identifier.to_string());
}

/// The running build's identifier; the real app's until `init` ran (tests).
pub fn identifier() -> &'static str {
    IDENTIFIER.get().map(String::as_str).unwrap_or(APP_IDENTIFIER)
}

pub fn is_demo_identifier(identifier: &str) -> bool {
    identifier == crate::agent_access::DEMO_IDENTIFIER
}

/// For commands, which have the app handle.
pub fn is_demo(app: &tauri::AppHandle) -> bool {
    is_demo_identifier(&app.config().identifier)
}

/// For code without the app handle (the Agents switch, the Keychain).
pub fn running_demo() -> bool {
    is_demo_identifier(identifier())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_demo_identifier_is_the_demo() {
        assert!(is_demo_identifier("ch.studiomanager.demo"));
        assert!(!is_demo_identifier(APP_IDENTIFIER));
        assert!(!is_demo_identifier(""));
    }

    /// The source of a `#[tauri::command]` function, up to its closing brace at column 0.
    fn commands(src: &str) -> Vec<(String, String)> {
        let mut out = vec![];
        let mut rest = src;
        while let Some(at) = rest.find("#[tauri::command]") {
            rest = &rest[at + "#[tauri::command]".len()..];
            let Some(fn_at) = rest.find("fn ") else { break };
            let name: String =
                rest[fn_at + 3..].chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
            let end = rest.find("\n}\n").unwrap_or(rest.len());
            out.push((name, rest[..end].to_string()));
        }
        out
    }

    /// Every command that reads or writes this Mac (Calendar, network, Claude Code's files)
    /// goes through a demo gate. `switched_on` and `ready` count: the Agents switch always
    /// reads off in the demo (tested in `agents::cli`).
    #[test]
    fn every_host_command_is_gated_for_the_demo() {
        const GATES: &[&str] =
            &["is_demo(", "running_demo(", "demo_off(", "host_reads(", "switched_on(", "ready("];
        // Touch nothing of this Mac, or only the demo's own `agents.json`, whose switch reads
        // off there (`agents_get_settings` skips the `claude` lookup in the demo).
        const UNGATED: &[&str] = &[
            "agents_watch",
            "agents_term_close",
            "agents_set_limit_alerts",
            "agents_get_enabled",
            "agents_get_settings",
            "agents_set_menu_bar",
        ];
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut files = vec![dir.join("apple.rs"), dir.join("network.rs"), dir.join("lib.rs")];
        let mut stack = vec![dir.join("agents")];
        while let Some(d) = stack.pop() {
            for e in std::fs::read_dir(&d).unwrap().flatten() {
                let p = e.path();
                if p.is_dir() {
                    stack.push(p);
                } else if p.extension().is_some_and(|x| x == "rs") {
                    files.push(p);
                }
            }
        }
        let mut seen = 0;
        let mut missing = vec![];
        for f in &files {
            let src = std::fs::read_to_string(f).unwrap();
            let apple = f.ends_with("apple.rs");
            let lib = f.ends_with("lib.rs");
            for (name, body) in commands(&src) {
                // apple.rs: only the calendar and Reminders touch this Mac's data; the rest acts on a
                // file the person picked. lib.rs: only the openers (Finder) leave the app;
                // the rest works on the app's own data folder.
                if (apple && !name.starts_with("calendar_") && !name.starts_with("reminders_")) || (lib && !name.starts_with("open_")) {
                    continue;
                }
                seen += 1;
                if !UNGATED.contains(&name.as_str()) && !GATES.iter().any(|g| body.contains(g)) {
                    missing.push(name);
                }
            }
        }
        assert!(seen > 30, "the scan found only {seen} commands");
        assert!(missing.is_empty(), "commands without a demo gate: {missing:?}");
    }

    /// Rerun 6: a link in the demo opened the real Tailscale login page. Besides the
    /// front end's `openExternal`, the demo build's config switches the shell plugin's
    /// `open` off, so no page script can open a URL or a file there.
    #[test]
    fn the_demo_build_cannot_open_links() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.demo.conf.json");
        let conf: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(conf["identifier"], crate::agent_access::DEMO_IDENTIFIER);
        assert_eq!(conf["plugins"]["shell"]["open"], serde_json::Value::Bool(false));
    }

    /// Every calendar command (list, create, delete; an update is a create then a delete)
    /// returns from its demo check before any AppleScript runs, so the demo never reads or
    /// writes this Mac's Calendar, whatever the page sends.
    #[test]
    fn demo_calendar_commands_return_before_osascript() {
        let src = std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/apple.rs")).unwrap();
        let cal: Vec<_> = commands(&src).into_iter().filter(|(n, _)| n.starts_with("calendar_")).collect();
        let names: Vec<&str> = cal.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, ["calendar_list_writable", "calendar_create_event", "calendar_delete_event"]);
        for (name, body) in &cal {
            let gate = body.find("if crate::host::is_demo(&app) {").unwrap_or_else(|| panic!("{name}: no demo gate"));
            let script = body.find("osascript").unwrap_or_else(|| panic!("{name}: no osascript"));
            assert!(gate < script, "{name}: the demo gate must come before osascript");
            assert!(body[gate..script].contains("return Ok("), "{name}: the demo gate must return");
        }
        assert!(src.contains("pub(crate) const DEMO_CALENDAR: &str = \"Studio\";"));
    }

    /// Reminders: `reminders_open` and `reminders_complete` in apple.rs are plain functions, not
    /// commands (the scan above would otherwise hold them to the gate), and both of their callers
    /// check the demo before any of them runs: the loop's `check` first, the switch's command
    /// before it saves or imports anything.
    #[test]
    fn demo_reminders_never_reach_osascript() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let apple = std::fs::read_to_string(root.join("apple.rs")).unwrap();
        assert!(commands(&apple).iter().all(|(n, _)| !n.starts_with("reminders_")));
        let loop_src = std::fs::read_to_string(root.join("agents/reminders.rs")).unwrap();
        let check = &loop_src[loop_src.find("fn check(").unwrap()..];
        assert!(check.find("is_demo(").unwrap() < check.find("run_now(").unwrap());
        let cli = std::fs::read_to_string(root.join("agents/cli.rs")).unwrap();
        let cmd = &cli[cli.find("pub async fn agents_set_reminders").unwrap()..];
        let gate = cmd.find("is_demo(&app)").unwrap();
        assert!(gate < cmd.find(" set_reminders(&app_dir").unwrap() && gate < cmd.find("run_now(").unwrap());
        // Only the loop and the switch's command call the scripts.
        for (file, src) in [("agents/cli.rs", &cli), ("agents/reminders.rs", &loop_src)] {
            let n = src.matches("apple::reminders_").count();
            assert_eq!(n, if file.ends_with("reminders.rs") { 2 } else { 0 }, "{file}");
        }
    }

    /// The Finder opener is one of the scanned commands, so the scan above covers it.
    #[test]
    fn the_scan_reaches_open_in_finder() {
        let src = std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/lib.rs")).unwrap();
        let found = commands(&src).into_iter().find(|(name, _)| name == "open_in_finder");
        assert!(found.is_some_and(|(_, body)| body.contains("is_demo(")));
    }
}
