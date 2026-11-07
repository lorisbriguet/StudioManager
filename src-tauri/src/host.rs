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
        let mut files = vec![dir.join("apple.rs"), dir.join("network.rs")];
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
            for (name, body) in commands(&src) {
                // apple.rs: only the calendar touches this Mac's data; the rest acts on a
                // file the person picked.
                if apple && !name.starts_with("calendar_") {
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
}
