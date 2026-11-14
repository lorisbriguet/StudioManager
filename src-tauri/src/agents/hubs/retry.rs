//! Why a connector call failed, and when it may be tried again: the counters kept in
//! `hubs-state.json`. They hold no text from a connector, only a kind and times.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

pub const STATE_FILE: &str = "hubs-state.json";
/// The wait after the first failure; it doubles with each one.
pub const FIRST_WAIT_MS: i64 = 60_000;
pub const MAX_WAIT_MS: i64 = 3_600_000;
/// After this many failures in a row the app stops trying by itself.
pub const MAX_AUTO_FAILS: u32 = 6;
/// Two runs of the same request are at least this far apart, even by hand.
pub const MIN_GAP_MS: i64 = 30_000;

/// The kind of a failed call, kept in the hubs' state file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ErrorKind {
    NotApproved,
    NotStarted,
    TimedOut,
    TooLarge,
    BadAnswer,
    Failed,
}

impl ErrorKind {
    /// The name the page gets (camelCase), so it can word the problem in its own language.
    pub fn label(self) -> &'static str {
        match self {
            ErrorKind::NotApproved => "notApproved",
            ErrorKind::NotStarted => "notStarted",
            ErrorKind::TimedOut => "timedOut",
            ErrorKind::TooLarge => "tooLarge",
            ErrorKind::BadAnswer => "badAnswer",
            ErrorKind::Failed => "failed",
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Tries {
    pub fails: u32,
    pub next_try_at: i64,
    pub last_run_at: i64,
    pub last_ok_at: Option<i64>,
    pub last_error: Option<ErrorKind>,
}

/// Why a run is not allowed yet, with the milliseconds left (`Paused` has none).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Wait {
    Gap(i64),
    Backoff(i64),
    Paused,
}

/// The key of one request of one hub in the state file.
pub fn key(hub_id: &str, request: &str) -> String {
    format!("{hub_id}/{request}")
}

/// Whether a run may start now. By hand skips the backoff and the pause, never the gap. A
/// `next_try_at` further ahead than `MAX_WAIT_MS` (the clock went back) counts as due.
pub fn may_run(t: &Tries, now: i64, by_hand: bool) -> Result<(), Wait> {
    let since = now - t.last_run_at;
    if t.last_run_at > 0 && (0..MIN_GAP_MS).contains(&since) {
        return Err(Wait::Gap(MIN_GAP_MS - since));
    }
    if by_hand {
        return Ok(());
    }
    if t.fails >= MAX_AUTO_FAILS {
        return Err(Wait::Paused);
    }
    let ahead = t.next_try_at - now;
    if ahead > 0 && ahead <= MAX_WAIT_MS {
        return Err(Wait::Backoff(ahead));
    }
    Ok(())
}

pub fn after_failure(t: &mut Tries, kind: ErrorKind, now: i64) {
    t.fails = t.fails.saturating_add(1);
    let shift = (t.fails - 1).min(20);
    t.next_try_at = now + (FIRST_WAIT_MS << shift).min(MAX_WAIT_MS);
    t.last_run_at = now;
    t.last_error = Some(kind);
}

pub fn after_success(t: &mut Tries, now: i64) {
    t.fails = 0;
    t.next_try_at = 0;
    t.last_run_at = now;
    t.last_ok_at = Some(now);
    t.last_error = None;
}

/// The counters; unreadable or absent means empty (every hub then waits its gap only).
pub fn read_tries(app_dir: &Path) -> HashMap<String, Tries> {
    let Ok(text) = std::fs::read_to_string(app_dir.join(STATE_FILE)) else { return HashMap::new() };
    serde_json::from_str(&text).unwrap_or_default()
}

static WRITE_LOCK: Mutex<()> = Mutex::new(());

pub fn write_tries(app_dir: &Path, all: &HashMap<String, Tries>) -> Result<(), String> {
    let _lock = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let text = serde_json::to_string(all).map_err(|e| e.to_string())?;
    crate::agent_access::write_atomic(&app_dir.join(STATE_FILE), &text)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: i64 = 60_000;
    const T0: i64 = 1_000_000_000_000;

    fn tmp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("sm-hubretry-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn backoff_doubles_and_pauses_after_six() {
        let mut t = Tries::default();
        let mut now = T0;
        assert_eq!(may_run(&t, now, false), Ok(()));
        for minutes in [1, 2, 4, 8, 16, 32] {
            after_failure(&mut t, ErrorKind::Failed, now);
            assert_eq!(t.next_try_at - now, minutes * MIN);
            // Not yet due, a second before.
            let wait = may_run(&t, now + minutes * MIN - 1000, false);
            if t.fails < MAX_AUTO_FAILS {
                assert!(matches!(wait, Err(Wait::Backoff(_))), "{wait:?}");
                assert_eq!(may_run(&t, now + minutes * MIN, false), Ok(()));
            }
            now += minutes * MIN;
        }
        assert_eq!(t.fails, 6);
        assert_eq!(may_run(&t, now + 10 * 3_600_000, false), Err(Wait::Paused));
        // By hand runs, once the gap has passed.
        assert_eq!(may_run(&t, now + 10 * 3_600_000, true), Ok(()));
        // A seventh failure still waits at most the cap.
        after_failure(&mut t, ErrorKind::TimedOut, now);
        assert_eq!(t.next_try_at - now, MAX_WAIT_MS);
    }

    #[test]
    fn the_wait_is_capped() {
        let mut t = Tries { fails: 30, ..Tries::default() };
        after_failure(&mut t, ErrorKind::Failed, T0);
        assert_eq!(t.next_try_at - T0, MAX_WAIT_MS);
    }

    #[test]
    fn success_clears_the_failures() {
        let mut t = Tries::default();
        after_failure(&mut t, ErrorKind::BadAnswer, T0);
        after_success(&mut t, T0 + 5 * MIN);
        assert_eq!((t.fails, t.next_try_at, t.last_ok_at, t.last_error), (0, 0, Some(T0 + 5 * MIN), None));
        assert_eq!(may_run(&t, T0 + 5 * MIN + MIN_GAP_MS, false), Ok(()));
    }

    #[test]
    fn gap_holds_even_by_hand() {
        let mut t = Tries::default();
        after_success(&mut t, T0);
        assert_eq!(may_run(&t, T0 + 10_000, true), Err(Wait::Gap(20_000)));
        assert_eq!(may_run(&t, T0 + 10_000, false), Err(Wait::Gap(20_000)));
        assert_eq!(may_run(&t, T0 + MIN_GAP_MS, true), Ok(()));
    }

    #[test]
    fn restart_keeps_the_counters() {
        let dir = tmp("restart");
        let mut t = Tries::default();
        after_failure(&mut t, ErrorKind::TooLarge, T0);
        let mut all = HashMap::new();
        all.insert(key("h00000001", "counts"), t.clone());
        write_tries(&dir, &all).unwrap();
        assert_eq!(read_tries(&dir), all);
        // Unreadable: empty.
        std::fs::write(dir.join(STATE_FILE), "garbled").unwrap();
        assert!(read_tries(&dir).is_empty());
    }

    #[test]
    fn clock_jumped_back_is_not_a_long_wait() {
        let mut t = Tries::default();
        after_failure(&mut t, ErrorKind::Failed, T0 + 5 * 3_600_000);
        // The clock went back by five hours: the next try is over an hour ahead.
        assert_eq!(may_run(&t, T0, false), Ok(()));
        // Not so for a wait within the cap.
        let mut u = Tries::default();
        after_failure(&mut u, ErrorKind::Failed, T0);
        assert!(matches!(may_run(&u, T0 + MIN_GAP_MS, false), Err(Wait::Backoff(_))));
    }

    #[test]
    fn state_file_holds_no_output() {
        let dir = tmp("noout");
        let mut t = Tries::default();
        // The failed run's stderr line is never passed in: only its kind is.
        let stderr = "secret line";
        let kind = if stderr.is_empty() { ErrorKind::NotStarted } else { ErrorKind::Failed };
        after_failure(&mut t, kind, T0);
        let mut all = HashMap::new();
        all.insert(key("h00000001", "open"), t);
        write_tries(&dir, &all).unwrap();
        let text = std::fs::read_to_string(dir.join(STATE_FILE)).unwrap();
        assert!(!text.contains("secret line"), "{text}");
        assert!(text.contains("Failed"));
    }
}
