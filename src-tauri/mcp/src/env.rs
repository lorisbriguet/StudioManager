//! Where the app keeps its data. Mirrors Tauri's app data dir:
//! `~/Library/Application Support/<bundle identifier>`.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

pub const DATA_DIR_ENV: &str = "STUDIOMANAGER_DATA_DIR";
pub const DEFAULT_IDENTIFIER: &str = "ch.studiomanager.app";

pub const UNKNOWN_BUNDLE: &str =
    "Can't tell which StudioManager this is (Info.plist unreadable). Reinstall StudioManager.";

/// `$STUDIOMANAGER_DATA_DIR` when set; otherwise the Application Support
/// folder for the identifier of the enclosing `.app` (so the demo bundle
/// resolves its own folder). Inside a bundle whose identifier can't be read
/// this refuses rather than guess (the demo must never reach real data);
/// only a binary outside any `.app` (cargo builds) uses the default.
pub fn data_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().ok();
    resolve_data_dir(
        std::env::var_os(DATA_DIR_ENV),
        exe.as_deref(),
        std::env::var_os("HOME"),
    )
}

/// `data_dir()` over explicit inputs, for tests.
pub fn resolve_data_dir(
    env_dir: Option<OsString>,
    exe: Option<&Path>,
    home: Option<OsString>,
) -> Result<PathBuf, String> {
    if let Some(dir) = env_dir.filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(dir));
    }
    let identifier = match exe.and_then(enclosing_bundle) {
        Some(_) => exe
            .and_then(identifier_from_bundle)
            .ok_or_else(|| UNKNOWN_BUNDLE.to_string())?,
        None => DEFAULT_IDENTIFIER.to_string(),
    };
    let home = home
        .map(PathBuf::from)
        .filter(|h| h.is_absolute())
        .ok_or_else(|| "HOME is not set; can't find the StudioManager data folder.".to_string())?;
    Ok(home
        .join("Library")
        .join("Application Support")
        .join(identifier))
}

fn enclosing_bundle(exe: &Path) -> Option<&Path> {
    exe.ancestors()
        .find(|p| p.extension().is_some_and(|ext| ext == "app"))
}

/// `CFBundleIdentifier` from `<X>.app/Contents/Info.plist` when `exe` lives
/// inside an app bundle. Reads the XML text directly (no plist crate).
pub fn identifier_from_bundle(exe: &Path) -> Option<String> {
    let bundle = enclosing_bundle(exe)?;
    let xml = std::fs::read_to_string(bundle.join("Contents").join("Info.plist")).ok()?;
    let after_key = xml.split("<key>CFBundleIdentifier</key>").nth(1)?;
    let start = after_key.find("<string>")? + "<string>".len();
    // The value must be the very next element after the key.
    if !after_key[..start - "<string>".len()].trim().is_empty() {
        return None;
    }
    let rest = &after_key[start..];
    let value = rest[..rest.find("</string>")?].trim();
    (!value.is_empty()).then(|| value.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::temp_data_dir;

    /// Restores the previous value of an env var when dropped.
    struct EnvGuard(&'static str, Option<std::ffi::OsString>);
    impl Drop for EnvGuard {
        fn drop(&mut self) {
            match &self.1 {
                Some(v) => std::env::set_var(self.0, v),
                None => std::env::remove_var(self.0),
            }
        }
    }

    #[test]
    fn data_dir_prefers_env() {
        let _restore = EnvGuard(DATA_DIR_ENV, std::env::var_os(DATA_DIR_ENV));
        let dir = temp_data_dir();
        std::env::set_var(DATA_DIR_ENV, &dir);
        assert_eq!(data_dir(), Ok(dir));
    }

    fn bundle_exe(root: &Path, plist: Option<&[u8]>) -> PathBuf {
        let contents = root.join("X.app").join("Contents");
        std::fs::create_dir_all(contents.join("MacOS")).unwrap();
        if let Some(bytes) = plist {
            std::fs::write(contents.join("Info.plist"), bytes).unwrap();
        }
        let exe = contents.join("MacOS").join("bin");
        std::fs::write(&exe, "").unwrap();
        exe
    }

    #[test]
    fn inside_app_with_unreadable_plist_refuses() {
        let home = Some(std::ffi::OsString::from("/home-x"));
        for plist in [
            None,
            Some(&b"bplist00\x00\x01binary"[..]),
            Some(&b"<plist><dict></dict></plist>"[..]),
        ] {
            let exe = bundle_exe(&temp_data_dir(), plist);
            assert_eq!(
                resolve_data_dir(None, Some(&exe), home.clone()),
                Err(UNKNOWN_BUNDLE.to_string())
            );
        }
        assert_eq!(
            UNKNOWN_BUNDLE,
            "Can't tell which StudioManager this is (Info.plist unreadable). Reinstall StudioManager."
        );
    }

    #[test]
    fn inside_app_uses_bundle_identifier() {
        let exe = bundle_exe(
            &temp_data_dir(),
            Some(b"<plist><dict><key>CFBundleIdentifier</key><string>com.example.demo</string></dict></plist>"),
        );
        assert_eq!(
            resolve_data_dir(None, Some(&exe), Some("/home-x".into())),
            Ok(PathBuf::from(
                "/home-x/Library/Application Support/com.example.demo"
            ))
        );
    }

    #[test]
    fn outside_app_uses_default() {
        let exe = temp_data_dir()
            .join("target")
            .join("debug")
            .join("studiomanager-mcp");
        assert_eq!(
            resolve_data_dir(None, Some(&exe), Some("/home-x".into())),
            Ok(PathBuf::from("/home-x/Library/Application Support").join(DEFAULT_IDENTIFIER))
        );
        assert_eq!(
            resolve_data_dir(None, None, Some("/home-x".into())),
            Ok(PathBuf::from("/home-x/Library/Application Support").join(DEFAULT_IDENTIFIER))
        );
    }

    #[test]
    fn missing_home_refuses() {
        let exe = temp_data_dir().join("bin");
        assert!(resolve_data_dir(None, Some(&exe), None).is_err());
        assert!(resolve_data_dir(None, Some(&exe), Some("".into())).is_err());
        assert!(resolve_data_dir(None, Some(&exe), Some("relative".into())).is_err());
        // The env override needs no HOME.
        assert_eq!(
            resolve_data_dir(Some("/data-x".into()), Some(&exe), None),
            Ok(PathBuf::from("/data-x"))
        );
    }

    #[test]
    fn identifier_read_from_bundle_info_plist() {
        let root = temp_data_dir();
        let contents = root.join("X.app").join("Contents");
        std::fs::create_dir_all(contents.join("MacOS")).unwrap();
        std::fs::write(
            contents.join("Info.plist"),
            "<?xml version=\"1.0\"?>\n<plist version=\"1.0\"><dict>\n\
             <key>CFBundleName</key><string>X</string>\n\
             <key>CFBundleIdentifier</key>\n    <string>com.example.x</string>\n\
             </dict></plist>",
        )
        .unwrap();
        let exe = contents.join("MacOS").join("bin");
        std::fs::write(&exe, "").unwrap();
        assert_eq!(
            identifier_from_bundle(&exe),
            Some("com.example.x".to_string())
        );
        assert_eq!(identifier_from_bundle(&root.join("loose-bin")), None);
    }
}
