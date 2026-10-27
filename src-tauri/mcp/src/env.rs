//! Where the app keeps its data. Mirrors Tauri's app data dir:
//! `~/Library/Application Support/<bundle identifier>`.

use std::path::{Path, PathBuf};

pub const DATA_DIR_ENV: &str = "STUDIOMANAGER_DATA_DIR";
pub const DEFAULT_IDENTIFIER: &str = "ch.studiomanager.app";

/// `$STUDIOMANAGER_DATA_DIR` when set; otherwise the Application Support
/// folder for the identifier of the enclosing `.app` (so the demo bundle
/// resolves its own folder), falling back to the production identifier.
pub fn data_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os(DATA_DIR_ENV).filter(|v| !v.is_empty()) {
        return PathBuf::from(dir);
    }
    let identifier = std::env::current_exe()
        .ok()
        .and_then(|exe| identifier_from_bundle(&exe))
        .unwrap_or_else(|| DEFAULT_IDENTIFIER.to_string());
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_default();
    home.join("Library")
        .join("Application Support")
        .join(identifier)
}

/// `CFBundleIdentifier` from `<X>.app/Contents/Info.plist` when `exe` lives
/// inside an app bundle. Reads the XML text directly (no plist crate).
pub fn identifier_from_bundle(exe: &Path) -> Option<String> {
    let bundle = exe
        .ancestors()
        .find(|p| p.extension().is_some_and(|ext| ext == "app"))?;
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

    #[test]
    fn data_dir_prefers_env() {
        let dir = temp_data_dir();
        std::env::set_var(DATA_DIR_ENV, &dir);
        assert_eq!(data_dir(), dir);
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
