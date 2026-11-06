//! Opening a path from the app without ever launching it: a folder opens in Finder, a file
//! is revealed in its folder, and applications, installers and scripts are refused. Used by
//! "Open in Finder" and by routine links, whose targets come from files the webview or an
//! agent can write.

use std::ffi::OsString;
use std::path::Path;

/// Extensions macOS runs, installs or loads when a bundle or file of that type is opened.
/// They are refused outright: a project folder or link can be set by an agent (MCP
/// `link_folder`), a routine link by the webview, and opening one must never launch what it
/// points at.
const EXECUTABLE_EXTENSIONS: &[&str] = &[
    "app", "appex", "action", "bundle", "command", "component", "framework", "kext",
    "mpkg", "osax", "pkg", "plugin", "prefpane", "qlgenerator", "saver", "service",
    "terminal", "tool", "workflow", "xpc",
];

/// Is this a bundle or an executable document, by its extension or, for a
/// directory, by the `Contents/Info.plist` every application-like bundle has
/// whatever its name?
fn is_executable_target(path: &Path) -> bool {
    let by_extension = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| EXECUTABLE_EXTENSIONS.iter().any(|x| x.eq_ignore_ascii_case(e)));
    by_extension || (path.is_dir() && path.join("Contents").join("Info.plist").exists())
}

/// The `open` arguments for a canonical path: a folder opens in Finder
/// (`-a Finder`, never its default handler), a file is revealed in its
/// folder (`-R`, never opened). Bundles and executable files are refused.
fn finder_open_args(canonical: &Path) -> Result<Vec<OsString>, String> {
    if is_executable_target(canonical) {
        return Err(format!(
            "refusing to open an application, installer or script: {}",
            canonical.display()
        ));
    }
    let mut args: Vec<OsString> = if canonical.is_dir() {
        vec!["-a".into(), "Finder".into()]
    } else {
        vec!["-R".into()]
    };
    args.push(canonical.as_os_str().to_owned());
    Ok(args)
}

/// The `open` arguments for `path` (see `finder_open_args`), once resolved: it must exist,
/// and symlinks are followed so a harmless name can't stand in for an app. A canonical path
/// is absolute and never starts with `-`, so `open` can't read it as a flag.
pub(crate) fn path_open_args(path: &str) -> Result<Vec<OsString>, String> {
    let canonical = std::fs::canonicalize(path).map_err(|e| format!("Not found: {path} ({e})"))?;
    if !canonical.is_absolute() {
        return Err(format!("Not an absolute path: {path}"));
    }
    finder_open_args(&canonical)
}

/// Runs the system `open` with `args`.
pub(crate) fn run_open(args: &[OsString]) -> Result<(), String> {
    let output = std::process::Command::new("open").args(args).output().map_err(|e| e.to_string())?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() { format!("open failed: status {}", output.status) } else { stderr })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn tmp_dir(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("sm-finder-{nanos}-{name}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_folder_opens_in_finder_and_a_file_is_revealed() {
        let dir = tmp_dir("finder-plain");
        let folder = dir.join("Client work");
        std::fs::create_dir_all(&folder).unwrap();
        let file = folder.join("invoice.pdf");
        std::fs::write(&file, b"%PDF").unwrap();
        let args = |p: &Path| -> Vec<String> {
            finder_open_args(p).unwrap().into_iter().map(|a| a.into_string().unwrap()).collect()
        };
        assert_eq!(args(&folder), vec!["-a".to_string(), "Finder".into(), folder.display().to_string()]);
        assert_eq!(args(&file), vec!["-R".to_string(), file.display().to_string()]);
        // a dotted folder name that is not a bundle type is a plain folder
        let dotted = dir.join("v2.3.0");
        std::fs::create_dir_all(&dotted).unwrap();
        assert_eq!(args(&dotted)[0], "-a");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn bundles_and_executable_files_are_refused() {
        let dir = tmp_dir("finder-bundles");
        for name in ["Invoice.app", "Setup.PKG", "Tool.bundle", "Run.workflow"] {
            let bundle = dir.join(name);
            std::fs::create_dir_all(&bundle).unwrap();
            let err = finder_open_args(&bundle).unwrap_err();
            assert!(err.contains("refusing"), "{name}: {err}");
        }
        for name in ["run.command", "shell.terminal", "Installer.pkg"] {
            let file = dir.join(name);
            std::fs::write(&file, b"#!/bin/sh").unwrap();
            assert!(finder_open_args(&file).is_err(), "{name} must be refused");
        }
        // an application bundle renamed to look like a folder
        let disguised = dir.join("Invoices 2026");
        std::fs::create_dir_all(disguised.join("Contents")).unwrap();
        std::fs::write(disguised.join("Contents").join("Info.plist"), b"<plist/>").unwrap();
        assert!(finder_open_args(&disguised).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_missing_path_is_not_found() {
        assert!(path_open_args("/definitely/not/here-12345").unwrap_err().starts_with("Not found:"));
    }
}
