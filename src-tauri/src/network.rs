//! Reachability checks for the Network page: a status dot per service link
//! and an online state per remote machine. Nothing here notifies; a timeout
//! or no answer is "unreachable", never "down".

use serde::{Deserialize, Serialize};
use std::net::{TcpStream, ToSocketAddrs};
use std::time::Duration;

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

fn check_tcp(target: &CheckTarget) -> CheckResult {
    let up = socket_address(&target.url)
        .and_then(|addr| addr.to_socket_addrs().ok())
        .map(|mut addrs| addrs.any(|a| TcpStream::connect_timeout(&a, CONNECT_TIMEOUT).is_ok()))
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::time::Instant;

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
}
