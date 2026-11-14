//! Opening what a connector's `open` answered, after checking it here: an `https` link, an
//! `http` link to this Mac, or a path inside the hub's folder shown in Finder. Nothing is
//! launched, and the connector's text is never handed to a shell.

use super::contract::Target;
use std::ffi::OsString;
use std::path::Path;

/// The longest link accepted.
pub const URL_CHARS: usize = 2048;

/// What to open, once checked.
#[derive(Debug, Clone, PartialEq)]
pub enum Opener {
    /// The link as the parser prints it.
    Url(String),
    /// The arguments of the system `open` (`finder::path_open_args`).
    Finder(Vec<OsString>),
}

fn check_url(s: &str) -> Result<Opener, String> {
    if s.chars().count() > URL_CHARS {
        return Err(format!("The link is over {URL_CHARS} characters."));
    }
    let url = tauri::Url::parse(s).map_err(|_| "The link is not a valid address.".to_string())?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err("A link with a user name or password is not opened.".into());
    }
    match url.scheme() {
        "https" => {
            if url.host_str().map_or(true, str::is_empty) {
                return Err("The link has no host.".into());
            }
        }
        "http" => {
            // The parser prints the host in one form: an IPv4 address in dots, an IPv6 one in brackets.
            if !matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")) {
                return Err("An http link is opened only on this Mac (127.0.0.1, localhost, [::1]).".into());
            }
        }
        other => return Err(format!("Links of the kind \"{}\" are not opened.", other.chars().take(20).collect::<String>())),
    }
    Ok(Opener::Url(url.to_string()))
}

fn check_path(p: &str, hub_folder: &Path) -> Result<Opener, String> {
    if !Path::new(p).is_absolute() {
        return Err("The path is not absolute.".into());
    }
    let canonical = std::fs::canonicalize(p).map_err(|_| "The path was not found.".to_string())?;
    let root = std::fs::canonicalize(hub_folder).map_err(|_| "The hub's folder was not found.".to_string())?;
    // Path components, so a sibling folder with the same prefix is outside.
    if !canonical.starts_with(&root) {
        return Err("The path is outside the hub's folder.".into());
    }
    let args = crate::finder::path_open_args(&canonical.to_string_lossy())?;
    Ok(Opener::Finder(args))
}

/// Call 13: whether `t` may be opened for a hub in `hub_folder`, and how.
pub fn check_target(t: &Target, hub_folder: &Path) -> Result<Opener, String> {
    match t {
        Target::Url(u) => check_url(u),
        Target::Path(p) => check_path(p, hub_folder),
    }
}

/// Opens a checked target through the system `open`, as argv.
pub fn open(o: &Opener) -> Result<(), String> {
    match o {
        Opener::Url(u) => crate::finder::run_open(&[OsString::from(u)]),
        Opener::Finder(args) => crate::finder::run_open(args),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sm-hubopen-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    fn url(s: &str) -> Result<Opener, String> {
        check_target(&Target::Url(s.into()), Path::new("/tmp"))
    }

    fn path(s: &str, hub: &Path) -> Result<Opener, String> {
        check_target(&Target::Path(s.into()), hub)
    }

    #[test]
    fn open_target_https_ok() {
        assert_eq!(url("https://example.com/a?b=1").unwrap(), Opener::Url("https://example.com/a?b=1".into()));
        assert!(url("https://").is_err());
        assert!(url(&format!("https://example.com/{}", "a".repeat(URL_CHARS))).is_err());
        assert!(url("not a url").is_err());
    }

    #[test]
    fn open_target_loopback_http_ok() {
        for u in ["http://127.0.0.1:8080/x", "http://localhost/x", "http://[::1]:3000/"] {
            assert!(url(u).is_ok(), "{u}");
        }
    }

    #[test]
    fn open_target_other_http_refused() {
        for u in ["http://example.com", "http://127.0.0.2", "http://localhost.example.com", "http://192.0.2.1", "http://[::2]/"] {
            assert!(url(u).is_err(), "{u}");
        }
    }

    #[test]
    fn open_target_userinfo_refused() {
        for u in ["https://user@example.com", "https://user:pw@example.com", "http://a@localhost/", "https://:pw@example.com"] {
            assert!(url(u).is_err(), "{u}");
        }
    }

    #[test]
    fn open_target_schemes_refused() {
        for u in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,<b>x</b>",
            "mailto:a@example.com",
            "vscode://file/tmp/x",
            "x-apple.systempreferences:com.apple.preference.security",
            "ftp://example.com",
        ] {
            assert!(url(u).is_err(), "{u}");
        }
    }

    #[test]
    fn open_target_path_inside_revealed() {
        let hub = tmp("inside");
        let file = hub.join("note.txt");
        std::fs::write(&file, "x").unwrap();
        let Opener::Finder(args) = path(&file.to_string_lossy(), &hub).unwrap() else { panic!("not Finder") };
        assert_eq!(args, vec![OsString::from("-R"), file.as_os_str().to_owned()]);
    }

    #[test]
    fn open_target_folder_opens_in_finder() {
        let hub = tmp("folder");
        let sub = hub.join("docs");
        std::fs::create_dir(&sub).unwrap();
        let Opener::Finder(args) = path(&sub.to_string_lossy(), &hub).unwrap() else { panic!("not Finder") };
        assert_eq!(args, vec![OsString::from("-a"), OsString::from("Finder"), sub.as_os_str().to_owned()]);
        // The hub's own folder is inside itself.
        assert!(path(&hub.to_string_lossy(), &hub).is_ok());
    }

    #[test]
    fn open_target_relative_refused() {
        let hub = tmp("relative");
        std::fs::write(hub.join("a.txt"), "x").unwrap();
        assert!(path("a.txt", &hub).is_err());
        assert!(path("./a.txt", &hub).is_err());
        assert!(path("~/a.txt", &hub).is_err());
    }

    #[test]
    fn open_target_dotdot_out_refused() {
        let base = tmp("dotdot");
        let hub = base.join("hub");
        std::fs::create_dir(&hub).unwrap();
        std::fs::write(base.join("secret.txt"), "x").unwrap();
        assert!(path(&format!("{}/../secret.txt", hub.display()), &hub).is_err());
        // A sibling that shares the prefix is outside too.
        let sibling = base.join("hub-other");
        std::fs::create_dir(&sibling).unwrap();
        assert!(path(&sibling.to_string_lossy(), &hub).is_err());
        assert!(path("/no/such/path/here", &hub).is_err());
    }

    #[test]
    fn open_target_symlink_out_refused() {
        let base = tmp("symlink");
        let hub = base.join("hub");
        std::fs::create_dir(&hub).unwrap();
        let outside = base.join("outside.txt");
        std::fs::write(&outside, "x").unwrap();
        std::os::unix::fs::symlink(&outside, hub.join("link.txt")).unwrap();
        assert!(path(&hub.join("link.txt").to_string_lossy(), &hub).is_err());
    }

    #[test]
    fn open_target_app_inside_refused() {
        let hub = tmp("app");
        let app = hub.join("Poster tool.app");
        std::fs::create_dir_all(app.join("Contents")).unwrap();
        assert!(path(&app.to_string_lossy(), &hub).is_err());
        let script = hub.join("run.command");
        std::fs::write(&script, "#!/bin/sh").unwrap();
        assert!(path(&script.to_string_lossy(), &hub).is_err());
    }
}
