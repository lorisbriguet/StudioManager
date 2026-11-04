//! When the Claude sign-in ends: `claude auth status` (Claude Code 2.1.318+) reports
//! `loginExpiresAt` for a stored claude.ai sign-in. Checked when Agents start, then hourly
//! by the poller, or on demand; the Agents page and the menu bar warn from 10 days out, and
//! the menu bar posts a notification at 10, 3 and 1 day and when it has ended.
//!
//! An env-token sign-in (`CLAUDE_CODE_OAUTH_TOKEN`, from `claude setup-token`) and an API key
//! report no date: nothing is shown for them.

use super::cli::Cli;
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;
use std::time::Duration;
use tauri::{Emitter, Manager};

pub const LOGIN_EVENT: &str = "agents:login";
pub const LOGIN_ALERTS_FILE: &str = "login-alerts.json";
pub const CHECK_INTERVAL: Duration = Duration::from_secs(3600);
const DAY_MS: i64 = 86_400_000;
/// Days left at which a notification is posted; 0 = the sign-in has ended.
const THRESHOLDS: [i64; 4] = [10, 3, 1, 0];

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LoginStatus {
    pub logged_in: bool,
    /// `claude.ai`, `oauth_token`, `api_key`, … as the CLI reports it.
    pub auth_method: Option<String>,
    /// Epoch ms; None when the CLI gives no date (an env token, an API key, an older CLI).
    pub expires_at: Option<i64>,
    /// Epoch ms of the check.
    pub checked_at: i64,
}

/// `claude auth status --json` output. None when it isn't the expected JSON object.
pub fn parse_status(json: &str, now_ms: i64) -> Option<LoginStatus> {
    let Ok(Value::Object(root)) = serde_json::from_str::<Value>(json.trim()) else {
        return None;
    };
    let expires_at = root
        .get("loginExpiresAt")
        .and_then(Value::as_str)
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.timestamp_millis());
    Some(LoginStatus {
        logged_in: root.get("loggedIn").and_then(Value::as_bool).unwrap_or(false),
        auth_method: root.get("authMethod").and_then(Value::as_str).map(str::to_string),
        expires_at,
        checked_at: now_ms,
    })
}

/// Runs `claude auth status --json`. None when it fails or prints something else, so a
/// flaky check never turns into a "signed out" warning.
pub fn check(cli: &dyn Cli, now_ms: i64) -> Option<LoginStatus> {
    let args = ["auth", "status", "--json"].map(String::from);
    let home = super::actions::home_dir();
    let out = cli.run(&args, &home);
    // Signed out, the CLI exits 1 but still prints the JSON.
    let status = parse_status(&out.stdout, now_ms);
    if status.is_none() {
        log::warn!("[agents] claude auth status failed (code {}): {}", out.code, out.stderr.trim());
    }
    status
}

/// Whole days left, rounded up: 4.2 days left reads "4 days" until the 4th day has passed.
/// 0 or less once it has ended.
pub fn days_left(expires_at: i64, now_ms: i64) -> i64 {
    let left = expires_at - now_ms;
    if left <= 0 {
        0
    } else {
        (left + DAY_MS - 1) / DAY_MS
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct LoginAlert {
    pub key: String,
    pub title: String,
    pub body: String,
}

/// The notification now due, if any: the tightest threshold reached that wasn't sent for this
/// expiry date. Keys carry the date, so a new sign-in starts over.
pub fn due_alert(status: &LoginStatus, sent: &BTreeMap<String, i64>, now_ms: i64) -> Option<LoginAlert> {
    if !status.logged_in {
        let key = "signed-out".to_string();
        return (!sent.contains_key(&key)).then(|| LoginAlert {
            key,
            title: "Claude is signed out".into(),
            body: "Agents can't run. Run claude auth login in a terminal.".into(),
        });
    }
    let expires_at = status.expires_at?;
    let left = days_left(expires_at, now_ms);
    let threshold = THRESHOLDS.iter().copied().filter(|t| left <= *t).min()?;
    let key = format!("{expires_at}:{threshold}");
    if sent.contains_key(&key) {
        return None;
    }
    let (title, body) = match threshold {
        0 => (
            "Claude sign-in has ended".to_string(),
            "Agents can't run. Run claude auth login in a terminal.".to_string(),
        ),
        _ => (
            format!("Claude sign-in ends in {left} day{}", if left == 1 { "" } else { "s" }),
            "Run claude auth login in a terminal before then, or agents stop working.".to_string(),
        ),
    };
    Some(LoginAlert { key, title, body })
}

fn read_sent(dir: &Path) -> BTreeMap<String, i64> {
    std::fs::read_to_string(dir.join(LOGIN_ALERTS_FILE))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

/// Records the alert now due as sent and returns it. Also marks the wider thresholds of the
/// same date, so a sign-in first seen 2 days out posts one notification, not three. Records
/// of an older date, and "signed out" once signed in again, are dropped. None when nothing is
/// due or the record can't be written (it would post again on the next pass).
pub fn take_alert(dir: &Path, status: &LoginStatus, now_ms: i64) -> Option<LoginAlert> {
    let mut sent = read_sent(dir);
    let before = sent.clone();
    let current = status.expires_at.map(|e| format!("{e}:"));
    sent.retain(|k, _| {
        if k == "signed-out" {
            !status.logged_in
        } else {
            current.as_deref().is_some_and(|c| k.starts_with(c))
        }
    });
    let due = due_alert(status, &sent, now_ms);
    if let (Some(a), Some(e)) = (&due, status.expires_at) {
        let reached: i64 = a.key.rsplit(':').next().and_then(|t| t.parse().ok()).unwrap_or(0);
        for t in THRESHOLDS.iter().filter(|t| **t >= reached) {
            sent.insert(format!("{e}:{t}"), now_ms);
        }
    } else if let Some(a) = &due {
        sent.insert(a.key.clone(), now_ms);
    }
    if sent != before {
        let json = serde_json::to_string_pretty(&sent).ok()?;
        let tmp = dir.join(format!("{LOGIN_ALERTS_FILE}.tmp"));
        if std::fs::write(&tmp, json).and_then(|_| std::fs::rename(&tmp, dir.join(LOGIN_ALERTS_FILE))).is_err() {
            return None;
        }
    }
    due
}

/// Checks now, keeps the result in `AgentsState` and emits `agents:login`. A failed check
/// keeps the last result. Call it on a blocking thread.
pub fn refresh(app: &tauri::AppHandle, cli: &dyn Cli) -> Option<LoginStatus> {
    let state = app.try_state::<super::AgentsState>()?;
    let fresh = check(cli, super::usage::limits::now_ms());
    let status = match fresh {
        Some(s) => {
            if let Ok(mut l) = state.login.lock() {
                *l = Some(s.clone());
            }
            Some(s)
        }
        None => state.login.lock().ok().and_then(|l| l.clone()),
    };
    let _ = app.emit(LOGIN_EVENT, &status);
    status
}

/// The last check's result (None before the first one).
#[tauri::command]
pub async fn agents_login_status(
    state: tauri::State<'_, super::AgentsState>,
) -> Result<Option<LoginStatus>, String> {
    super::actions::switched_on(&state)?;
    Ok(state.login.lock().ok().and_then(|l| l.clone()))
}

/// "Check again": runs `claude auth status` now, after a fresh `claude auth login`.
#[tauri::command]
pub async fn agents_login_check(
    app: tauri::AppHandle,
    state: tauri::State<'_, super::AgentsState>,
) -> Result<Option<LoginStatus>, String> {
    super::actions::switched_on(&state)?;
    let login = state.login_cache();
    super::pty::blocking(move || {
        let cli = super::cli::real_cli(&login).ok_or("claude not found")?;
        Ok(refresh(&app, &cli))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::cli::CliOutput;

    const NOW: i64 = 1_793_800_000_000; // 2026-11-04

    fn status(expires_at: Option<i64>) -> LoginStatus {
        LoginStatus { logged_in: true, auth_method: Some("claude.ai".into()), expires_at, checked_at: NOW }
    }

    fn tmp() -> std::path::PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static N: AtomicU64 = AtomicU64::new(0);
        let d = std::env::temp_dir().join(format!(
            "sm-login-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn parses_a_claude_ai_sign_in() {
        let s = parse_status(
            r#"{"loggedIn":true,"authMethod":"claude.ai","loginExpiresAt":"2026-11-08T17:51:06.745Z","orgName":"x"}"#,
            NOW,
        )
        .unwrap();
        assert!(s.logged_in);
        assert_eq!(s.auth_method.as_deref(), Some("claude.ai"));
        assert_eq!(s.expires_at, Some(1_794_160_266_745));
        assert_eq!(s.checked_at, NOW);
    }

    #[test]
    fn an_env_token_or_older_cli_has_no_date() {
        let token = parse_status(r#"{"loggedIn":true,"authMethod":"oauth_token","loginExpiresAt":null}"#, NOW).unwrap();
        assert_eq!((token.logged_in, token.expires_at), (true, None));
        let old = parse_status(r#"{"loggedIn":true,"authMethod":"claude.ai"}"#, NOW).unwrap();
        assert_eq!(old.expires_at, None);
        let bad_date = parse_status(r#"{"loggedIn":true,"loginExpiresAt":"soon"}"#, NOW).unwrap();
        assert_eq!(bad_date.expires_at, None);
    }

    #[test]
    fn signed_out_and_garbage() {
        let out = parse_status(r#"{"loggedIn":false,"authMethod":"none"}"#, NOW).unwrap();
        assert!(!out.logged_in);
        assert_eq!(parse_status("Not logged in", NOW), None);
        assert_eq!(parse_status("[1,2]", NOW), None);
        assert_eq!(parse_status("", NOW), None);
    }

    struct FakeCli(CliOutput);
    impl Cli for FakeCli {
        fn run(&self, args: &[String], _cwd: &Path) -> CliOutput {
            assert_eq!(args, ["auth", "status", "--json"]);
            self.0.clone()
        }
    }

    #[test]
    fn check_reads_json_even_on_exit_1_and_ignores_failures() {
        let signed_out = FakeCli(CliOutput { code: 1, stdout: r#"{"loggedIn":false}"#.into(), stderr: String::new() });
        assert_eq!(check(&signed_out, NOW).map(|s| s.logged_in), Some(false));
        let timed_out = FakeCli(CliOutput { code: -1, stdout: String::new(), stderr: "timed out".into() });
        assert_eq!(check(&timed_out, NOW), None);
    }

    #[test]
    fn days_left_rounds_up() {
        assert_eq!(days_left(NOW + 4 * DAY_MS + 1, NOW), 5);
        assert_eq!(days_left(NOW + 4 * DAY_MS, NOW), 4);
        assert_eq!(days_left(NOW + 1, NOW), 1);
        assert_eq!(days_left(NOW, NOW), 0);
        assert_eq!(days_left(NOW - DAY_MS, NOW), 0);
    }

    #[test]
    fn nothing_due_far_out_or_without_a_date() {
        let sent = BTreeMap::new();
        assert_eq!(due_alert(&status(Some(NOW + 30 * DAY_MS)), &sent, NOW), None);
        assert_eq!(due_alert(&status(Some(NOW + 10 * DAY_MS + 1)), &sent, NOW), None);
        assert_eq!(due_alert(&status(None), &sent, NOW), None);
    }

    #[test]
    fn the_tightest_threshold_reached_is_due() {
        let sent = BTreeMap::new();
        let e = NOW + 10 * DAY_MS;
        let a = due_alert(&status(Some(e)), &sent, NOW).unwrap();
        assert_eq!(a.key, format!("{e}:10"));
        assert_eq!(a.title, "Claude sign-in ends in 10 days");
        let e = NOW + 2 * DAY_MS;
        assert_eq!(due_alert(&status(Some(e)), &sent, NOW).unwrap().key, format!("{e}:3"));
        let e = NOW + 3_600_000;
        let a = due_alert(&status(Some(e)), &sent, NOW).unwrap();
        assert_eq!((a.key, a.title.as_str()), (format!("{e}:1"), "Claude sign-in ends in 1 day"));
        let e = NOW - 1;
        let a = due_alert(&status(Some(e)), &sent, NOW).unwrap();
        assert_eq!((a.key, a.title.as_str()), (format!("{e}:0"), "Claude sign-in has ended"));
    }

    #[test]
    fn signed_out_is_due_once() {
        let out = LoginStatus { logged_in: false, auth_method: None, expires_at: None, checked_at: NOW };
        let mut sent = BTreeMap::new();
        assert_eq!(due_alert(&out, &sent, NOW).unwrap().title, "Claude is signed out");
        sent.insert("signed-out".into(), NOW);
        assert_eq!(due_alert(&out, &sent, NOW), None);
    }

    #[test]
    fn take_alert_posts_each_threshold_once() {
        let dir = tmp();
        let e = NOW + 9 * DAY_MS;
        let s = status(Some(e));
        assert_eq!(take_alert(&dir, &s, NOW).unwrap().key, format!("{e}:10"));
        assert_eq!(take_alert(&dir, &s, NOW + 3_600_000), None);
        // Six days later: 3 days left.
        assert_eq!(take_alert(&dir, &s, NOW + 6 * DAY_MS).unwrap().key, format!("{e}:3"));
        assert_eq!(take_alert(&dir, &s, NOW + 6 * DAY_MS + 1), None);
        assert_eq!(take_alert(&dir, &s, NOW + 8 * DAY_MS).unwrap().key, format!("{e}:1"));
        assert_eq!(take_alert(&dir, &s, e + 1).unwrap().key, format!("{e}:0"));
        assert_eq!(take_alert(&dir, &s, e + DAY_MS), None);
    }

    #[test]
    fn first_seen_close_to_the_end_posts_one_notification() {
        let dir = tmp();
        let e = NOW + 2 * DAY_MS;
        let s = status(Some(e));
        assert_eq!(take_alert(&dir, &s, NOW).unwrap().key, format!("{e}:3"));
        // The 10-day one isn't posted afterwards.
        assert_eq!(take_alert(&dir, &s, NOW + 60_000), None);
        let sent = read_sent(&dir);
        assert!(sent.contains_key(&format!("{e}:10")) && sent.contains_key(&format!("{e}:3")));
    }

    #[test]
    fn a_new_sign_in_starts_over_and_drops_old_records() {
        let dir = tmp();
        let old = NOW + 2 * DAY_MS;
        take_alert(&dir, &status(Some(old)), NOW).unwrap();
        let new = NOW + 30 * DAY_MS;
        assert_eq!(take_alert(&dir, &status(Some(new)), NOW), None);
        assert!(read_sent(&dir).is_empty());
        // Signed out, then back in: the signed-out record goes, so the next sign-out posts again.
        let out = LoginStatus { logged_in: false, auth_method: None, expires_at: None, checked_at: NOW };
        assert!(take_alert(&dir, &out, NOW).is_some());
        assert_eq!(take_alert(&dir, &out, NOW), None);
        take_alert(&dir, &status(Some(new)), NOW);
        assert!(take_alert(&dir, &out, NOW).is_some());
    }
}
