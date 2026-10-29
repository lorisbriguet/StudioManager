//! The places a project folder may be: Documents, Desktop, Downloads and
//! `~/Library/CloudStorage` (the same roots as the app's file-system scope).
//! The app reads project files only from there, and the MCP server links
//! only folders inside them. Dependency-free so the MCP server compiles it
//! in unchanged (`#[path]` in `mcp/src/lib.rs`).

use std::path::{Path, PathBuf};

/// The roots, relative to the home folder.
pub const ROOT_DIRS: [&str; 4] = ["Documents", "Desktop", "Downloads", "Library/CloudStorage"];

/// The roots under `home` that exist, resolved (symlinks followed), so a
/// resolved folder can be compared with them.
pub fn roots_in(home: &Path) -> Vec<PathBuf> {
    ROOT_DIRS
        .iter()
        .filter_map(|d| std::fs::canonicalize(home.join(d)).ok())
        .collect()
}

/// The roots under `$HOME`; none when it is unset.
pub fn allowed_roots() -> Vec<PathBuf> {
    std::env::var_os("HOME")
        .map(|home| roots_in(Path::new(&home)))
        .unwrap_or_default()
}

/// `real` (a resolved path) is one of the roots or inside one.
pub fn under_root(real: &Path, roots: &[PathBuf]) -> bool {
    roots.iter().any(|r| real.starts_with(r))
}

/// `real` (a resolved path) is inside a root, not the root itself (which
/// would claim every folder in it). Used by the MCP server's `link_folder`.
#[allow(dead_code)]
pub fn inside_root(real: &Path, roots: &[PathBuf]) -> bool {
    roots.iter().any(|r| real.starts_with(r) && real != r)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_home() -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static N: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "sm-roots-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::canonicalize(dir).unwrap()
    }

    #[test]
    fn roots_are_the_existing_places_resolved() {
        let home = tmp_home();
        std::fs::create_dir_all(home.join("Documents")).unwrap();
        std::fs::create_dir_all(home.join("Library/CloudStorage")).unwrap();
        // Desktop is a symlink (iCloud Desktop & Documents does this).
        let elsewhere = home.join("elsewhere");
        std::fs::create_dir_all(&elsewhere).unwrap();
        std::os::unix::fs::symlink(&elsewhere, home.join("Desktop")).unwrap();
        // Downloads is missing.
        assert_eq!(
            roots_in(&home),
            [home.join("Documents"), elsewhere, home.join("Library/CloudStorage")]
        );
        assert!(roots_in(&home.join("nowhere")).is_empty());
        std::fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn inside_versus_under_a_root() {
        let roots = [PathBuf::from("/u/me/Documents"), PathBuf::from("/u/me/Library/CloudStorage")];
        let project = Path::new("/u/me/Documents/Clients/Acme");
        assert!(under_root(project, &roots));
        assert!(inside_root(project, &roots));
        assert!(inside_root(Path::new("/u/me/Library/CloudStorage/Drive/x"), &roots));
        // The root itself: readable, but not a project folder.
        assert!(under_root(Path::new("/u/me/Documents"), &roots));
        assert!(!inside_root(Path::new("/u/me/Documents"), &roots));
        // Outside, or a sibling that only shares a prefix.
        for p in ["/u/me", "/", "/u/me/Documents2/x", "/u/me/Library", "/etc"] {
            assert!(!under_root(Path::new(p), &roots), "{p}");
            assert!(!inside_root(Path::new(p), &roots), "{p}");
        }
        assert!(!under_root(project, &[]));
        assert!(!inside_root(project, &[]));
    }
}
