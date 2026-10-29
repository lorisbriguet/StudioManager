//! Meters, pace projection and alerts for the plan-limit windows.

use super::samples::{samples_from, Sample};
use serde::Serialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

pub const LIMITS_FILE: &str = "limits.json";
pub const HISTORY_FILE: &str = "limits-history.jsonl";
pub const ALERTS_FILE: &str = "limit-alerts.json";

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pace {
    pub projected_percent_at_reset: f64,
    /// Epoch ms when use reaches 100% before the window resets; None when it will not.
    pub hits_full_at: Option<i64>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Meter {
    /// `five_hour`, `seven_day`, `seven_day_<scope>`; the webview translates it.
    pub window: String,
    /// English fallback.
    pub label: String,
    pub percent: f64,
    /// Epoch ms.
    pub resets_at: i64,
    pub pace: Option<Pace>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Alert {
    pub key: String,
    pub title: String,
    pub body: String,
}

/// `resets_at` can jitter by a few seconds between readings of one window.
const SAME_WINDOW_MS: i64 = 300_000;
const MIN_SAMPLES: usize = 3;
const MIN_SPAN_S: f64 = 30.0 * 60.0;
const PACE_LEAD_MS: i64 = 3_600_000;
const KEEP_ALERTS_MS: i64 = 8 * 86_400_000;

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// `five_hour` -> "5-hour window", `seven_day` -> "Weekly, all models",
/// `seven_day_claude_design` -> "Weekly, Claude Design".
fn english_label(window: &str) -> String {
    match window {
        "five_hour" => "5-hour window".into(),
        "seven_day" => "Weekly, all models".into(),
        other => {
            let scope = other.strip_prefix("seven_day_").unwrap_or(other);
            let words: Vec<String> = scope
                .split('_')
                .filter(|w| !w.is_empty())
                .map(|w| {
                    let mut c = w.chars();
                    c.next().map(|f| f.to_uppercase().chain(c).collect()).unwrap_or_default()
                })
                .collect();
            format!("Weekly, {}", words.join(" "))
        }
    }
}

/// The pace of one window: wall-clock projection from the earliest sample of the current window
/// (same `resets_at` within 5 minutes), idle time included.
fn pace(window: &str, percent: f64, resets_at: i64, history: &[Sample], now_ms: i64) -> Option<Pace> {
    let mut mine: Vec<&Sample> = history
        .iter()
        .filter(|s| {
            s.window == window && ((s.resets_at * 1000.0) as i64 - resets_at).abs() < SAME_WINDOW_MS
        })
        .collect();
    mine.sort_by(|a, b| a.at.total_cmp(&b.at));
    let (first, last) = (mine.first()?, mine.last()?);
    if percent >= 100.0 {
        return Some(Pace { projected_percent_at_reset: 100.0, hits_full_at: None });
    }
    if mine.len() < MIN_SAMPLES || last.at - first.at < MIN_SPAN_S {
        return None;
    }
    let now_s = now_ms as f64 / 1000.0;
    let elapsed = (now_s - first.at).max(1.0);
    let rate = (last.percent - first.percent) / elapsed; // percent per second
    if rate <= 0.0 {
        return Some(Pace { projected_percent_at_reset: last.percent, hits_full_at: None });
    }
    let hit_ms = now_ms + ((100.0 - last.percent) / rate * 1000.0) as i64;
    if hit_ms < resets_at {
        return Some(Pace { projected_percent_at_reset: 100.0, hits_full_at: Some(hit_ms) });
    }
    let left_s = ((resets_at - now_ms) as f64 / 1000.0).max(0.0);
    Some(Pace {
        projected_percent_at_reset: (last.percent + rate * left_s).min(100.0),
        hits_full_at: None,
    })
}

/// The windows of `limits.json` as meters. Anything unreadable gives none. `limits.json` is only
/// rewritten when Claude Code runs, so a window that already reset (`resets_at <= now`) is dropped:
/// it is neither shown nor alerted on.
pub fn meters(limits_json: &str, history: &[Sample], now_ms: i64) -> Vec<Meter> {
    let Ok(Value::Object(root)) = serde_json::from_str::<Value>(limits_json) else {
        return vec![];
    };
    let Some(Value::Object(rate_limits)) = root.get("rate_limits") else {
        return vec![];
    };
    let saved_s = root.get("savedAt").and_then(Value::as_f64).unwrap_or(now_ms as f64 / 1000.0);
    samples_from(rate_limits, saved_s)
        .into_iter()
        .filter(|s| (s.resets_at * 1000.0) as i64 > now_ms)
        .map(|s| {
            let resets_at = (s.resets_at * 1000.0) as i64;
            Meter {
                label: english_label(&s.window),
                pace: pace(&s.window, s.percent, resets_at, history, now_ms),
                window: s.window,
                percent: s.percent,
                resets_at,
            }
        })
        .collect()
}

fn in_words(ms: i64) -> String {
    let mins = (ms.max(0) + 30_000) / 60_000;
    match (mins / 60, mins % 60) {
        (0, m) => format!("{m} min"),
        (h, 0) => format!("{h} h"),
        (h, m) => format!("{h} h {m} min"),
    }
}

/// `<window>@<resetsAt>:<kind>` split into its parts.
fn split_key(key: &str) -> Option<(&str, i64, &str)> {
    let (rest, kind) = key.rsplit_once(':')?;
    let (window, at) = rest.rsplit_once('@')?;
    Some((window, at.parse().ok()?, kind))
}

fn already_sent(sent: &BTreeSet<String>, window: &str, resets_at: i64, kind: &str) -> bool {
    sent.iter().filter_map(|k| split_key(k)).any(|(w, at, k)| {
        w == window && k == kind && (at - resets_at).abs() <= SAME_WINDOW_MS
    })
}

/// The alerts not sent yet: 80% used, and a pace that fills the window more than an hour before
/// it resets. Each at most once per window.
pub fn due_alerts(meters: &[Meter], sent: &BTreeSet<String>, now_ms: i64) -> Vec<Alert> {
    let mut out = Vec::new();
    for m in meters {
        let key = |kind: &str| format!("{}@{}:{kind}", m.window, m.resets_at);
        if m.percent >= 80.0 && !already_sent(sent, &m.window, m.resets_at, "80") {
            out.push(Alert {
                key: key("80"),
                title: format!("{} at {}%", m.label, m.percent.round() as i64),
                body: format!("Resets in {}.", in_words(m.resets_at - now_ms)),
            });
        }
        let full_at = m.pace.as_ref().and_then(|p| p.hits_full_at);
        if let Some(full_at) = full_at {
            if m.percent < 100.0
                && full_at < m.resets_at - PACE_LEAD_MS
                && !already_sent(sent, &m.window, m.resets_at, "pace")
            {
                out.push(Alert {
                    key: key("pace"),
                    title: format!("{} on pace to run out", m.label),
                    body: format!(
                        "At this pace it hits 100% in {}, before it resets in {}.",
                        in_words(full_at - now_ms),
                        in_words(m.resets_at - now_ms)
                    ),
                });
            }
        }
    }
    out
}

/// The parsed history and the file state it was read from.
struct HistoryCache {
    path: PathBuf,
    len: u64,
    modified: SystemTime,
    samples: Arc<Vec<Sample>>,
}

static HISTORY: Mutex<Option<HistoryCache>> = Mutex::new(None);

/// The whole history: pace needs each window's earliest sample, which can be days back. The
/// capture trims it to 8 days, and the parse is cached by length and modification time, so a
/// reading while Claude is idle costs one `stat`.
fn read_history(path: &Path) -> Arc<Vec<Sample>> {
    let Ok(meta) = std::fs::metadata(path) else { return Arc::default() };
    let (len, modified) = (meta.len(), meta.modified().unwrap_or(SystemTime::UNIX_EPOCH));
    let mut cache = HISTORY.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(c) = cache.as_ref() {
        if c.path == path && c.len == len && c.modified == modified {
            return c.samples.clone();
        }
    }
    let Ok(buf) = std::fs::read(path) else { return Arc::default() };
    let samples: Arc<Vec<Sample>> = Arc::new(
        buf.split(|b| *b == b'\n')
            .filter(|l| !l.is_empty())
            .filter_map(|l| serde_json::from_slice(l).ok())
            .collect(),
    );
    *cache = Some(HistoryCache { path: path.to_path_buf(), len, modified, samples: samples.clone() });
    samples
}

/// The meters and when `limits.json` was written (epoch ms); None without the file.
pub fn load(dir: &Path, now_ms: i64) -> Option<(Vec<Meter>, i64)> {
    let text = std::fs::read_to_string(dir.join(LIMITS_FILE)).ok()?;
    let saved_ms = serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|v| v.get("savedAt").and_then(Value::as_f64))
        .map(|s| (s * 1000.0) as i64)
        .unwrap_or(now_ms);
    Some((meters(&text, &read_history(&dir.join(HISTORY_FILE)), now_ms), saved_ms))
}

/// Sent alert keys with when each was sent (epoch ms).
fn read_sent(dir: &Path) -> BTreeMap<String, i64> {
    std::fs::read_to_string(dir.join(ALERTS_FILE))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

/// Records the alerts now due as sent and returns them, or none when `notify` is off (they stay
/// recorded, so turning alerts back on doesn't post a backlog). Without `limits.json`, nothing.
pub fn check_alerts(dir: &Path, now_ms: i64, notify: bool) -> Vec<Alert> {
    let Some((meters, _)) = load(dir, now_ms) else { return vec![] };
    let mut sent = read_sent(dir);
    let keys: BTreeSet<String> = sent.keys().cloned().collect();
    let due = due_alerts(&meters, &keys, now_ms);
    let before = sent.len();
    sent.retain(|_, at| now_ms - *at <= KEEP_ALERTS_MS);
    if due.is_empty() && sent.len() == before {
        return vec![];
    }
    for a in &due {
        sent.insert(a.key.clone(), now_ms);
    }
    if let Ok(json) = serde_json::to_string_pretty(&sent) {
        let tmp = dir.join(format!("{ALERTS_FILE}.tmp"));
        if std::fs::write(&tmp, json).and_then(|_| std::fs::rename(&tmp, dir.join(ALERTS_FILE))).is_err() {
            // Not recorded: don't notify, or the next pass would notify again.
            return vec![];
        }
    }
    if notify {
        due
    } else {
        vec![]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    const HOUR: i64 = 3_600_000;
    const NOW: i64 = 1_800_000_000_000;

    fn limits(five: f64, five_reset_s: i64, week: f64, week_reset_s: i64) -> String {
        format!(
            r#"{{"savedAt":{},"rate_limits":{{
              "five_hour":{{"used_percentage":{five},"resets_at":{five_reset_s}}},
              "seven_day":{{"used_percentage":{week},"resets_at":{week_reset_s}}},
              "seven_day_opus":{{"used_percentage":3,"resets_at":{week_reset_s}}}}}}}"#,
            NOW / 1000
        )
    }

    fn sample(window: &str, percent: f64, resets_s: i64, at_ms: i64) -> Sample {
        Sample {
            window: window.into(),
            percent,
            resets_at: resets_s as f64,
            at: at_ms as f64 / 1000.0,
        }
    }

    fn meter(window: &str, percent: f64, resets_at: i64, hits: Option<i64>) -> Meter {
        Meter {
            window: window.into(),
            label: english_label(window),
            percent,
            resets_at,
            pace: hits
                .map(|h| Pace { projected_percent_at_reset: 100.0, hits_full_at: Some(h) }),
        }
    }

    fn tmp() -> std::path::PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static N: AtomicU64 = AtomicU64::new(0);
        let n = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let d = std::env::temp_dir()
            .join(format!("sm-limits-{n}-{}", N.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn meters_from_named_windows() {
        let reset = NOW / 1000 + 3600;
        let m = meters(&limits(42.0, reset, 10.0, reset + 86_400), &[], NOW);
        let got: Vec<_> = m.iter().map(|m| (m.window.as_str(), m.label.as_str())).collect();
        assert_eq!(
            got,
            [
                ("five_hour", "5-hour window"),
                ("seven_day", "Weekly, all models"),
                ("seven_day_opus", "Weekly, Opus")
            ]
        );
        assert_eq!((m[0].percent, m[0].resets_at, m[0].pace.clone()), (42.0, reset * 1000, None));
        // The list form maps to the same window names.
        let list = format!(
            r#"{{"savedAt":1,"rate_limits":{{"limits":[
              {{"kind":"session","percent":7,"resets_at":{reset}}},
              {{"kind":"weekly_scoped","percent":9,"resets_at":{reset},"scope":{{"model":{{"display_name":"Claude Design"}}}}}}]}}}}"#
        );
        let m = meters(&list, &[], NOW);
        assert_eq!(m[0].label, "5-hour window");
        assert_eq!(
            (m[1].window.as_str(), m[1].label.as_str()),
            ("seven_day_claude_design", "Weekly, Claude Design")
        );
        // A window that already reset (stale limits.json) is not a meter.
        let stale = meters(&limits(85.0, NOW / 1000 - 10, 10.0, NOW / 1000 + 600), &[], NOW);
        assert_eq!(stale.iter().map(|m| m.window.as_str()).collect::<Vec<_>>(), ["seven_day", "seven_day_opus"]);
        // Unreadable input has no meters.
        assert!(meters("nope", &[], NOW).is_empty());
        assert!(meters(r#"{"rate_limits":{}}"#, &[], NOW).is_empty());
    }

    #[test]
    fn pace_projection_from_earliest_sample() {
        let reset_s = NOW / 1000 + 4 * 3600;
        // 10% two hours ago, 30% now: 10 points an hour from the earliest sample.
        let slow = vec![
            // An earlier window (resets long before) is ignored.
            sample("five_hour", 99.0, reset_s - 5 * 3600, NOW - 3 * HOUR),
            // resets_at jittered by 200 s still belongs to this window.
            sample("five_hour", 10.0, reset_s + 200, NOW - 2 * HOUR),
            sample("five_hour", 20.0, reset_s, NOW - HOUR),
            sample("five_hour", 30.0, reset_s, NOW),
            // Another window never mixes in.
            sample("seven_day", 1.0, reset_s, NOW - 2 * HOUR),
        ];
        let m = meters(&limits(30.0, reset_s, 1.0, reset_s), &slow, NOW);
        let p = m[0].pace.clone().expect("pace");
        // 70 to go would take 7 h but only 4 h are left: ends at 30 + 40.
        assert!((p.projected_percent_at_reset - 70.0).abs() < 1e-6, "{p:?}");
        assert_eq!(p.hits_full_at, None);

        // Faster: 10 -> 60 in 2 h = 25 an hour; 40 to go = 1.6 h.
        let fast = vec![
            sample("five_hour", 10.0, reset_s, NOW - 2 * HOUR),
            sample("five_hour", 35.0, reset_s, NOW - HOUR),
            sample("five_hour", 60.0, reset_s, NOW),
        ];
        let m = meters(&limits(60.0, reset_s, 1.0, reset_s), &fast, NOW);
        let p = m[0].pace.clone().unwrap();
        assert_eq!(p.projected_percent_at_reset, 100.0);
        assert_eq!(p.hits_full_at, Some(NOW + (1.6 * HOUR as f64) as i64));

        // Too little history: no pace.
        let short = vec![
            sample("five_hour", 10.0, reset_s, NOW - 600_000),
            sample("five_hour", 12.0, reset_s, NOW),
        ];
        assert_eq!(meters(&limits(12.0, reset_s, 1.0, reset_s), &short, NOW)[0].pace, None);
    }

    #[test]
    fn alert_80_once_per_window() {
        let reset = NOW + 3 * HOUR;
        let ms = [meter("five_hour", 79.9, reset, None)];
        assert!(due_alerts(&ms, &BTreeSet::new(), NOW).is_empty());
        let ms = [meter("five_hour", 80.0, reset, None)];
        let a = due_alerts(&ms, &BTreeSet::new(), NOW);
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].key, format!("five_hour@{reset}:80"));
        assert!(
            a[0].title.contains("5-hour window") && a[0].title.contains("80%"),
            "{:?}",
            a[0]
        );
        let sent: BTreeSet<String> = a.iter().map(|a| a.key.clone()).collect();
        assert!(due_alerts(&ms, &sent, NOW).is_empty());
        // resets_at jitters by a few seconds: still the same window.
        let jitter = [meter("five_hour", 85.0, reset + 4_000, None)];
        assert!(due_alerts(&jitter, &sent, NOW).is_empty());
    }

    #[test]
    fn pace_alert_only_when_full_an_hour_before_reset() {
        let reset = NOW + 5 * HOUR;
        let early = [meter("five_hour", 50.0, reset, Some(reset - HOUR - 60_000))];
        let a = due_alerts(&early, &BTreeSet::new(), NOW);
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].key, format!("five_hour@{reset}:pace"));
        let late = [meter("five_hour", 50.0, reset, Some(reset - HOUR))];
        assert!(due_alerts(&late, &BTreeSet::new(), NOW).is_empty());
        let none = [meter("five_hour", 50.0, reset, None)];
        assert!(due_alerts(&none, &BTreeSet::new(), NOW).is_empty());
        // Both at once when past 80% and on pace.
        let both = [meter("five_hour", 85.0, reset, Some(NOW + HOUR))];
        assert_eq!(due_alerts(&both, &BTreeSet::new(), NOW).len(), 2);
    }

    #[test]
    fn no_alert_for_a_window_that_already_reset() {
        let dir = tmp();
        let past = NOW / 1000 - 60;
        fs::write(dir.join(LIMITS_FILE), limits(95.0, past, 10.0, NOW / 1000 + 86_400)).unwrap();
        assert!(check_alerts(&dir, NOW, true).is_empty());
    }

    #[test]
    fn alerts_recorded_but_silent_when_off() {
        let dir = tmp();
        let reset_s = NOW / 1000 + 3600;
        fs::write(dir.join(LIMITS_FILE), limits(90.0, reset_s, 10.0, reset_s + 86_400)).unwrap();
        assert!(check_alerts(&dir, NOW, false).is_empty());
        let recorded = fs::read_to_string(dir.join(ALERTS_FILE)).unwrap();
        assert!(recorded.contains("five_hour@") && recorded.contains(":80"), "{recorded}");
        // Turned back on: nothing from the backlog.
        assert!(check_alerts(&dir, NOW + 60_000, true).is_empty());
    }

    #[test]
    fn new_window_resets_alerts() {
        let dir = tmp();
        let reset_s = NOW / 1000 + 3600;
        fs::write(dir.join(LIMITS_FILE), limits(90.0, reset_s, 10.0, reset_s + 86_400)).unwrap();
        assert_eq!(check_alerts(&dir, NOW, true).len(), 1);
        assert!(check_alerts(&dir, NOW + 2_000, true).is_empty());
        // The window rolled over and crossed 80% again.
        let next = reset_s + 5 * 3600;
        fs::write(dir.join(LIMITS_FILE), limits(81.0, next, 10.0, next + 86_400)).unwrap();
        let a = check_alerts(&dir, NOW + 5 * HOUR, true);
        assert_eq!(a.len(), 1);
        assert!(a[0].key.starts_with(&format!("five_hour@{}", next * 1000)));
    }

    fn line(s: &Sample) -> String {
        serde_json::to_string(s).unwrap() + "\n"
    }

    #[test]
    fn load_reads_the_whole_history() {
        let dir = tmp();
        let reset_s = NOW / 1000 + 4 * 3600;
        fs::write(dir.join(LIMITS_FILE), limits(30.0, reset_s, 1.0, reset_s)).unwrap();
        let mut text = String::new();
        // Over 64 KB of an old window, then the current one.
        for i in 0..1500 {
            text.push_str(&line(&sample("five_hour", 1.0, reset_s - 9 * 3600, NOW - 9 * HOUR + i)));
        }
        for (p, back) in [(10.0, 2), (20.0, 1), (30.0, 0)] {
            text.push_str(&line(&sample("five_hour", p, reset_s, NOW - back * HOUR)));
        }
        assert!(text.len() > 100_000);
        fs::write(dir.join(HISTORY_FILE), text).unwrap();
        let (m, saved) = load(&dir, NOW).unwrap();
        assert_eq!(saved, NOW);
        assert!(m[0].pace.is_some());
        // No limits file: nothing.
        assert!(load(&tmp(), NOW).is_none());
    }

    #[test]
    fn weekly_pace_uses_the_earliest_sample_beyond_64_kb() {
        let dir = tmp();
        let five_reset_s = NOW / 1000 + 2 * 3600;
        let week_reset_s = NOW / 1000 + 96 * 3600;
        fs::write(dir.join(LIMITS_FILE), limits(5.0, five_reset_s, 14.0, week_reset_s)).unwrap();
        // The week started quietly: 10% three days ago.
        let mut text = line(&sample("seven_day", 10.0, week_reset_s, NOW - 72 * HOUR));
        // Then a busy afternoon: 10% -> 14% over the last 4 hours, a sample of every window each
        // minute, well over 64 KB. From those alone it would hit 100% in about 86 h of 96.
        for i in 0..=240 {
            let at = NOW - 4 * HOUR + i * 60_000;
            let week = 10.0 + 4.0 * i as f64 / 240.0;
            text.push_str(&line(&sample("five_hour", 5.0, five_reset_s, at)));
            text.push_str(&line(&sample("seven_day", week, week_reset_s, at)));
            text.push_str(&line(&sample("seven_day_opus", 3.0, week_reset_s, at)));
            text.push_str(&line(&sample("seven_day_sonnet", 1.0, week_reset_s, at)));
        }
        assert!(text.len() > 64 * 1024, "{}", text.len());
        fs::write(dir.join(HISTORY_FILE), &text).unwrap();
        let (m, _) = load(&dir, NOW).unwrap();
        let week = m.iter().find(|m| m.window == "seven_day").unwrap();
        let p = week.pace.clone().expect("pace");
        // 4 points in 72 h, not in 4 h: about 19% at reset, never 100% before it.
        assert_eq!(p.hits_full_at, None, "{p:?}");
        assert!(p.projected_percent_at_reset < 25.0, "{p:?}");
        // So no pace alert.
        assert!(check_alerts(&dir, NOW, true).is_empty());

        // The cache follows the file: one more sample at 90% changes the meter's pace.
        text.push_str(&line(&sample("seven_day", 90.0, week_reset_s, NOW)));
        fs::write(dir.join(HISTORY_FILE), &text).unwrap();
        let (m, _) = load(&dir, NOW).unwrap();
        let week = m.iter().find(|m| m.window == "seven_day").unwrap();
        assert!(week.pace.clone().unwrap().projected_percent_at_reset > 25.0);
    }
}
