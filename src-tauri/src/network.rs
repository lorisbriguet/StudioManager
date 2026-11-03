//! Reachability checks for the Network page: a status dot per service link
//! and an online state per remote machine. Nothing here notifies; a timeout
//! or no answer is "unreachable", never "down".

use serde::{Deserialize, Serialize};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

const MAX_TARGETS: usize = 32;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CheckKind {
    Http,
    Tcp,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckTarget {
    pub key: String,
    pub kind: CheckKind,
    pub url: String,
    /// The connection's `cert_fingerprint` (hex SHA-256), when one is stored.
    pub pin: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CheckState {
    Up,
    Unreachable,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckResult {
    pub key: String,
    pub state: CheckState,
    pub reason: Option<String>,
}

/// Below 500 is up (401 and 403 mean the service answered); 500 and above is
/// an error carrying the code.
pub fn classify_status(code: u16) -> (CheckState, Option<String>) {
    if code < 500 {
        (CheckState::Up, None)
    } else {
        (CheckState::Error, Some(format!("http_{code}")))
    }
}

/// `host:port` of a URL; port 5900 for `vnc://` without one, 80/443 for
/// http/https without one.
pub fn socket_address(url: &str) -> Option<String> {
    let (scheme, rest) = url.split_once("://").unwrap_or(("", url));
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let authority = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
    if authority.is_empty() {
        return None;
    }
    let has_port = match authority.rfind(':') {
        Some(i) => !authority[i..].contains(']') && authority[i + 1..].chars().all(|c| c.is_ascii_digit()) && i + 1 < authority.len(),
        None => false,
    };
    if has_port {
        return Some(authority.to_string());
    }
    let port = match scheme.to_ascii_lowercase().as_str() {
        "vnc" => 5900,
        "https" => 443,
        "http" => 80,
        _ => return None,
    };
    Some(format!("{authority}:{port}"))
}

/// Runs `work` on its own thread and gives up after `limit`: DNS resolution
/// has no timeout of its own. A late worker is left to finish and is ignored.
fn within<T: Send + 'static>(limit: Duration, work: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(work());
    });
    rx.recv_timeout(limit).ok()
}

/// Resolve and connect; stops trying further addresses once `deadline` passes.
fn tcp_connects(addr: &str, deadline: Instant) -> bool {
    let Ok(addrs) = addr.to_socket_addrs() else { return false };
    for a in addrs {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return false;
        }
        if TcpStream::connect_timeout(&a, CONNECT_TIMEOUT.min(left)).is_ok() {
            return true;
        }
    }
    false
}

fn check_tcp(target: &CheckTarget) -> CheckResult {
    let up = socket_address(&target.url)
        .and_then(|addr| {
            let deadline = Instant::now() + TOTAL_TIMEOUT;
            within(TOTAL_TIMEOUT, move || tcp_connects(&addr, deadline))
        })
        .unwrap_or(false);
    CheckResult {
        key: target.key.clone(),
        state: if up { CheckState::Up } else { CheckState::Unreachable },
        reason: None,
    }
}

fn check_http(target: &CheckTarget) -> CheckResult {
    let key = target.key.clone();
    let fail = |state, reason: Option<&str>| CheckResult { key: key.clone(), state, reason: reason.map(String::from) };
    let Ok((builder, _seen)) = crate::connectors::tls::pinned_http_client(target.pin.as_deref()) else {
        return fail(CheckState::Error, None);
    };
    let Ok(client) = builder
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(TOTAL_TIMEOUT)
        .build()
    else {
        return fail(CheckState::Error, None);
    };
    match client.get(&target.url).send() {
        Ok(resp) => {
            let (state, reason) = classify_status(resp.status().as_u16());
            CheckResult { key, state, reason }
        }
        Err(e) => {
            // reqwest has no structural flag for a refused certificate.
            let text = crate::connectors::describe(e).to_lowercase();
            if text.contains("certificate") {
                fail(CheckState::Error, Some("certificate"))
            } else {
                fail(CheckState::Unreachable, None)
            }
        }
    }
}

fn check_one(target: &CheckTarget) -> CheckResult {
    match target.kind {
        CheckKind::Http => check_http(target),
        CheckKind::Tcp => check_tcp(target),
    }
}

/// One thread per target; results keep the order and key of the targets.
fn check_all(targets: Vec<CheckTarget>) -> Vec<CheckResult> {
    let handles: Vec<_> = targets
        .into_iter()
        .map(|t| {
            let key = t.key.clone();
            (key, std::thread::spawn(move || check_one(&t)))
        })
        .collect();
    handles
        .into_iter()
        .map(|(key, h)| {
            // A panicked check maps to Error.
            h.join().unwrap_or(CheckResult { key, state: CheckState::Error, reason: None })
        })
        .collect()
}

#[tauri::command]
pub async fn network_check(app: tauri::AppHandle, targets: Vec<CheckTarget>) -> Result<Vec<CheckResult>, String> {
    if targets.len() > MAX_TARGETS {
        return Err(format!("too many targets: {} (at most {MAX_TARGETS} per call)", targets.len()));
    }
    if crate::active_org(&app)?.in_mode() {
        return Ok(vec![]);
    }
    tauri::async_runtime::spawn_blocking(move || check_all(targets))
        .await
        .map_err(|e| format!("network check failed: {e}"))
}

/// This Mac's Time Machine, as the Backups card shows it.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimeMachineStatus {
    pub enabled: bool,
    /// Newest snapshot of the last-used destination, ISO 8601 (UTC).
    pub last_backup_at: Option<String>,
    /// The destination's last result code (0 is success).
    pub last_result: Option<i64>,
    pub running: bool,
}

const TIME_MACHINE_PREFS: &str = "/Library/Preferences/com.apple.TimeMachine.plist";

/// Reads the preferences plist: `AutoBackup`, then the destination named by
/// `LastDestinationID` for its newest `SnapshotDates` entry and its `RESULT`.
/// `running` is left false; the command fills it from `tmutil`.
pub fn parse_time_machine(prefs: &plist::Value) -> TimeMachineStatus {
    let root = prefs.as_dictionary();
    let enabled = root.and_then(|d| d.get("AutoBackup")).and_then(|v| v.as_boolean()).unwrap_or(false);
    let last_id = root.and_then(|d| d.get("LastDestinationID")).and_then(|v| v.as_string());
    let dest = root
        .and_then(|d| d.get("Destinations"))
        .and_then(|v| v.as_array())
        .and_then(|list| {
            list.iter().filter_map(|v| v.as_dictionary()).find(|d| {
                last_id.is_some() && d.get("DestinationID").and_then(|v| v.as_string()) == last_id
            })
        });
    let last_backup_at = dest
        .and_then(|d| d.get("SnapshotDates"))
        .and_then(|v| v.as_array())
        .and_then(|dates| dates.iter().filter_map(|v| v.as_date()).map(|d| d.to_xml_format()).max());
    let last_result = dest.and_then(|d| d.get("RESULT")).and_then(|v| v.as_signed_integer());
    TimeMachineStatus { enabled, last_backup_at, last_result, running: false }
}

fn time_machine_running() -> bool {
    std::process::Command::new("/usr/bin/tmutil")
        .arg("status")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains("Running = 1"))
        .unwrap_or(false)
}

/// This Mac's Time Machine, or None when it was never set up (no preferences
/// file) or in test and presentation mode, where the Mac's real state stays out.
#[tauri::command]
pub async fn time_machine_status(app: tauri::AppHandle) -> Result<Option<TimeMachineStatus>, String> {
    if crate::active_org(&app)?.in_mode() {
        return Ok(None);
    }
    tauri::async_runtime::spawn_blocking(|| {
        if !std::path::Path::new(TIME_MACHINE_PREFS).exists() {
            return Ok(None);
        }
        let prefs = plist::Value::from_file(TIME_MACHINE_PREFS).map_err(|e| format!("Time Machine preferences: {e}"))?;
        let mut status = parse_time_machine(&prefs);
        status.running = status.enabled && time_machine_running();
        Ok(Some(status))
    })
    .await
    .map_err(|e| format!("Time Machine check failed: {e}"))?
}

/// Schemes a remote-access button may open. `vnc` is Screen Sharing. The Jump
/// Desktop scheme (`jump`) is confirmed during the on-site check; Jump Desktop
/// is not installed on the development Mac. Keep in sync with the TS list.
pub(crate) const REMOTE_SCHEMES: &[&str] = &["vnc", "jump"];

/// Parses a stored link and accepts it only when its scheme is a remote one.
/// Whitespace and control characters are refused outright.
fn remote_url_allowed(url: &str) -> Result<reqwest::Url, String> {
    let url = url.trim();
    if url.is_empty() || url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("not a remote link".into());
    }
    let parsed = reqwest::Url::parse(url).map_err(|_| "not a remote link".to_string())?;
    if !url.contains("://") || !REMOTE_SCHEMES.contains(&parsed.scheme()) {
        return Err("not a remote link".into());
    }
    Ok(parsed)
}

/// The remote URL stored in `machine_files` row `file_id`: it must be a link, not an attachment.
fn remote_link_url(conn: &rusqlite::Connection, file_id: i64) -> Result<reqwest::Url, String> {
    let row: Option<(String, String)> = conn
        .query_row("SELECT kind, path_or_url FROM machine_files WHERE id = ?1", [file_id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            e => Err(e),
        })
        .map_err(|e| format!("Failed to read the link: {e}"))?;
    match row {
        Some((kind, url)) if kind == "link" => remote_url_allowed(&url),
        _ => Err("not a remote link".into()),
    }
}

/// Opens a machine's remote link (Screen Sharing, Jump Desktop). The URL is read from the
/// database by id, never taken from the page, and passed to `open` as one argument (no shell).
#[tauri::command]
pub async fn open_remote_link(app: tauri::AppHandle, target_org: Option<String>, file_id: i64) -> Result<(), String> {
    let org = crate::active_org(&app)?;
    let db_path = crate::batch_db_path(&app, &org, target_org.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || {
        let conn = rusqlite::Connection::open_with_flags(&db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| format!("Failed to open DB: {e}"))?;
        let url = remote_link_url(&conn, file_id)?;
        let status = std::process::Command::new("/usr/bin/open")
            .arg(url.as_str())
            .status()
            .map_err(|e| format!("Failed to open the link: {e}"))?;
        if status.success() { Ok(()) } else { Err("Failed to open the link".into()) }
    })
    .await
    .map_err(|e| format!("open failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    fn target(key: &str, kind: CheckKind, url: String) -> CheckTarget {
        CheckTarget { key: key.into(), kind, url, pin: None }
    }

    /// Accepts connections and holds them without writing.
    fn silent_listener() -> u16 {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let mut held = vec![];
            for s in l.incoming().flatten() {
                held.push(s);
            }
        });
        port
    }

    fn ok_listener() -> u16 {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for mut s in l.incoming().flatten() {
                let mut buf = [0u8; 1024];
                let _ = s.read(&mut buf);
                let _ = s.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            }
        });
        port
    }

    #[test]
    fn status_below_500_is_up() {
        for code in [200, 302, 401, 403] {
            assert_eq!(classify_status(code), (CheckState::Up, None));
        }
    }

    #[test]
    fn status_5xx_is_error_with_code() {
        assert_eq!(classify_status(502), (CheckState::Error, Some("http_502".into())));
    }

    #[test]
    fn silent_server_is_unreachable_within_timeout() {
        let port = silent_listener();
        let start = Instant::now();
        let r = check_one(&target("a", CheckKind::Http, format!("http://127.0.0.1:{port}/")));
        assert_eq!(r.state, CheckState::Unreachable);
        assert!(start.elapsed() < Duration::from_secs(7));
    }

    #[test]
    fn closed_port_is_unreachable() {
        let port = {
            let l = TcpListener::bind("127.0.0.1:0").unwrap();
            l.local_addr().unwrap().port()
        };
        let r = check_one(&target("a", CheckKind::Tcp, format!("tcp://127.0.0.1:{port}")));
        assert_eq!(r.state, CheckState::Unreachable);
    }

    #[test]
    fn open_port_is_up() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let r = check_one(&target("a", CheckKind::Tcp, format!("tcp://127.0.0.1:{port}")));
        assert_eq!(r.state, CheckState::Up);
    }

    #[test]
    fn vnc_without_port_uses_5900() {
        assert_eq!(socket_address("vnc://studio-mac.local").as_deref(), Some("studio-mac.local:5900"));
        assert_eq!(socket_address("vnc://studio-mac.local:5901/x").as_deref(), Some("studio-mac.local:5901"));
    }

    #[test]
    fn targets_are_checked_independently() {
        let silent = silent_listener();
        let ok = ok_listener();
        let results = check_all(vec![
            target("slow", CheckKind::Http, format!("http://127.0.0.1:{silent}/")),
            target("fast", CheckKind::Http, format!("http://127.0.0.1:{ok}/")),
        ]);
        assert_eq!(results[0].key, "slow");
        assert_eq!(results[0].state, CheckState::Unreachable);
        assert_eq!(results[1].key, "fast");
        assert_eq!(results[1].state, CheckState::Up);
    }

    #[test]
    fn stalled_work_gives_up_at_the_limit() {
        let start = Instant::now();
        let r = within(Duration::from_millis(200), || {
            std::thread::sleep(Duration::from_secs(3));
            true
        });
        assert_eq!(r, None);
        assert!(start.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn expired_deadline_stops_before_connecting() {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = l.local_addr().unwrap().to_string();
        assert!(!tcp_connects(&addr, Instant::now()));
        assert!(tcp_connects(&addr, Instant::now() + Duration::from_secs(2)));
    }

    #[test]
    fn remote_url_allowed_accepts_vnc_and_jump() {
        assert_eq!(remote_url_allowed("vnc://mini.local").unwrap().scheme(), "vnc");
        assert_eq!(remote_url_allowed("vnc://user@mini.local:5901").unwrap().scheme(), "vnc");
        assert_eq!(remote_url_allowed("  jump://mini.local ").unwrap().scheme(), "jump");
    }

    #[test]
    fn remote_url_allowed_refuses_https_file_and_shell_like_input() {
        for bad in [
            "https://x",
            "file:///etc/passwd",
            "vnc",
            "vnc:mini.local",
            "javascript:alert(1)",
            "vnc://mini.local; rm -rf ~",
            "vnc://mini.local\n-a Calculator",
            "",
        ] {
            assert!(remote_url_allowed(bad).is_err(), "{bad:?} should be refused");
        }
    }

    fn files_db() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE machine_files (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, path_or_url TEXT NOT NULL);
             INSERT INTO machine_files VALUES (1, 'link', 'vnc://mini.local');
             INSERT INTO machine_files VALUES (2, 'file', '/Users/x/manual.pdf');
             INSERT INTO machine_files VALUES (3, 'link', 'https://example.test');",
        )
        .unwrap();
        conn
    }

    #[test]
    fn open_remote_link_reads_a_remote_link() {
        assert_eq!(remote_link_url(&files_db(), 1).unwrap().as_str(), "vnc://mini.local");
    }

    #[test]
    fn open_remote_link_refuses_a_file_attachment() {
        assert!(remote_link_url(&files_db(), 2).is_err());
    }

    #[test]
    fn open_remote_link_refuses_a_web_link() {
        assert!(remote_link_url(&files_db(), 3).is_err());
    }

    #[test]
    fn open_remote_link_refuses_a_missing_row() {
        assert!(remote_link_url(&files_db(), 99).is_err());
    }

    fn plist_of(body: &str) -> plist::Value {
        let xml = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?><plist version=\"1.0\"><dict>{body}</dict></plist>"
        );
        plist::Value::from_reader_xml(xml.as_bytes()).unwrap()
    }

    #[test]
    fn parse_time_machine_reads_the_last_destination() {
        let p = plist_of(
            "<key>AutoBackup</key><true/><key>LastDestinationID</key><string>B</string>
             <key>Destinations</key><array>
               <dict><key>DestinationID</key><string>A</string><key>RESULT</key><integer>21</integer>
                 <key>SnapshotDates</key><array><date>2026-01-01T10:00:00Z</date></array></dict>
               <dict><key>DestinationID</key><string>B</string><key>RESULT</key><integer>0</integer>
                 <key>SnapshotDates</key><array><date>2026-10-30T08:00:00Z</date><date>2026-11-01T09:30:00Z</date></array></dict>
             </array>",
        );
        let s = parse_time_machine(&p);
        assert!(s.enabled);
        assert_eq!(s.last_backup_at.as_deref(), Some("2026-11-01T09:30:00Z"));
        assert_eq!(s.last_result, Some(0));
        assert!(!s.running);
    }

    #[test]
    fn parse_time_machine_without_snapshot_dates_has_no_last_backup() {
        let p = plist_of(
            "<key>AutoBackup</key><true/><key>LastDestinationID</key><string>A</string>
             <key>Destinations</key><array>
               <dict><key>DestinationID</key><string>A</string><key>RESULT</key><integer>26</integer></dict>
             </array>",
        );
        let s = parse_time_machine(&p);
        assert!(s.enabled);
        assert_eq!(s.last_backup_at, None);
        assert_eq!(s.last_result, Some(26));
    }

    #[test]
    fn parse_time_machine_auto_backup_off_is_disabled() {
        let s = parse_time_machine(&plist_of("<key>AutoBackup</key><false/>"));
        assert!(!s.enabled);
        assert_eq!(s.last_backup_at, None);
        assert_eq!(s.last_result, None);
    }
}
