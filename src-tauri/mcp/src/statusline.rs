//! `studiomanager-mcp --statusline`: Claude Code runs this as its status line
//! command each turn. It keeps the plan limits (`rate_limits`) for the app:
//! `limits.json` (latest) and `limits-history.jsonl` (one sample per window,
//! for pacing). It never prints and the caller always exits 0.

use crate::samples::{samples_from, Sample};
#[cfg(test)]
use crate::samples::window_name;
use serde_json::{json, Map, Value};
use std::fs::{self, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::time::{Duration, UNIX_EPOCH};

pub const LIMITS_FILE: &str = "limits.json";
pub const HISTORY_FILE: &str = "limits-history.jsonl";
pub const TRIM_MARKER_FILE: &str = "limits-history.trim";
pub const LAST_RUN_FILE: &str = "statusline-last-run.json";

const KEEP_S: f64 = 8.0 * 86400.0;
const TRIM_EVERY_S: f64 = 3600.0;
const DEDUP_WITHIN_S: f64 = 60.0;
const TAIL_BYTES: u64 = 8192;

/// Reads the status line JSON from stdin and keeps its limits.
pub fn run(data_dir: &Path, now_s: f64) -> io::Result<()> {
    let mut input = Vec::new();
    // Unreadable stdin counts as empty input.
    let _ = io::stdin().read_to_end(&mut input);
    capture(&String::from_utf8_lossy(&input), data_dir, now_s)
}

/// Keeps the `rate_limits` of one status line payload. Input without a
/// non-empty `rate_limits` object leaves the limit files alone.
pub fn capture(stdin: &str, data_dir: &Path, now_s: f64) -> io::Result<()> {
    fs::create_dir_all(data_dir)?;
    let obj: Option<Map<String, Value>> = match serde_json::from_str(stdin) {
        Ok(Value::Object(o)) => Some(o),
        _ => None,
    };

    // A note of every run (no content): does the status line run at all, and what did it get.
    let rl = obj.as_ref().and_then(|o| o.get("rate_limits"));
    let shape = match rl {
        None => "missing",
        Some(Value::Null) => "null",
        Some(Value::Object(m)) if m.get("limits").is_some_and(Value::is_array) => "rows",
        Some(_) => "no rows",
    };
    let mut keys: Vec<&String> = obj.iter().flat_map(|o| o.keys()).collect();
    keys.sort();
    let note = json!({ "at": now_s, "keys": keys, "rateLimits": shape });
    write_atomic(&data_dir.join(LAST_RUN_FILE), note.to_string().as_bytes())?;

    let Some(Value::Object(limits)) = rl else {
        return Ok(());
    };
    if limits.is_empty() {
        return Ok(());
    }
    let out = json!({ "savedAt": now_s, "rate_limits": limits });
    write_atomic(&data_dir.join(LIMITS_FILE), out.to_string().as_bytes())?;
    append_history(
        &data_dir.join(HISTORY_FILE),
        &samples_from(limits, now_s),
        &data_dir.join(TRIM_MARKER_FILE),
        now_s,
    )
}

/// Appends the samples in one `O_APPEND` write (whole lines, so concurrent
/// processes don't interleave mid-line), skipping a window that has the same
/// percent within the last minute. Trims old lines at most once an hour,
/// decided by the marker file's modification time.
pub fn append_history(
    path: &Path,
    samples: &[Sample],
    marker: &Path,
    now_s: f64,
) -> io::Result<()> {
    trim_if_due(path, marker, now_s);
    if samples.is_empty() {
        return Ok(());
    }
    let recent = tail(path);
    let mut payload = String::new();
    for s in samples {
        let dup = recent.iter().any(|r| {
            r.window == s.window
                && r.percent == s.percent
                && (r.resets_at - s.resets_at).abs() < 1.0
                && (s.at - r.at).abs() < DEDUP_WITHIN_S
        });
        if dup {
            continue;
        }
        if let Ok(line) = serde_json::to_string(s) {
            payload.push_str(&line);
            payload.push('\n');
        }
    }
    if payload.is_empty() {
        return Ok(());
    }
    let mut f = OpenOptions::new().create(true).append(true).open(path)?;
    f.write_all(payload.as_bytes())
}

/// The last few KB of the file, parsed (enough to see the latest sample per window).
fn tail(path: &Path) -> Vec<Sample> {
    let Ok(mut f) = fs::File::open(path) else {
        return vec![];
    };
    let Ok(size) = f.seek(SeekFrom::End(0)) else {
        return vec![];
    };
    let start = size.saturating_sub(TAIL_BYTES);
    if f.seek(SeekFrom::Start(start)).is_err() {
        return vec![];
    }
    let mut buf = Vec::new();
    if f.read_to_end(&mut buf).is_err() {
        return vec![];
    }
    parse(&buf, start > 0)
}

fn parse(data: &[u8], drop_first_partial: bool) -> Vec<Sample> {
    let mut lines = data.split(|b| *b == b'\n').filter(|l| !l.is_empty());
    if drop_first_partial {
        lines.next();
    }
    lines.filter_map(|l| serde_json::from_slice(l).ok()).collect()
}

fn trim_if_due(path: &Path, marker: &Path, now_s: f64) {
    let last = fs::metadata(marker)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64());
    if let Some(last) = last {
        if now_s - last < TRIM_EVERY_S && last <= now_s {
            return;
        }
    }
    // Claim the slot first so concurrent status-line runs don't all trim.
    let claimed = OpenOptions::new()
        .create(true)
        .append(true)
        .open(marker)
        .and_then(|f| f.set_modified(UNIX_EPOCH + Duration::from_secs_f64(now_s.max(0.0))));
    if claimed.is_err() {
        return;
    }
    let Ok(data) = fs::read(path) else { return };
    if data.is_empty() {
        return;
    }
    let cutoff = now_s - KEEP_S;
    let mut out = String::new();
    for s in parse(&data, false).into_iter().filter(|s| s.at >= cutoff) {
        if let Ok(line) = serde_json::to_string(&s) {
            out.push_str(&line);
            out.push('\n');
        }
    }
    let _ = write_atomic(path, out.as_bytes());
}

/// Writes next to the target and renames over it, so readers never see half a file.
fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let tmp = path.with_extension(format!("tmp{}", std::process::id()));
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path).inspect_err(|_| {
        let _ = fs::remove_file(&tmp);
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::temp_data_dir;

    const NOW: f64 = 1_800_000_000.0;

    fn history(dir: &Path) -> Vec<Sample> {
        parse(&fs::read(dir.join(HISTORY_FILE)).unwrap_or_default(), false)
    }

    // 2027-01-15T08:00:00Z minus NOW.
    fn epoch_offset() -> f64 {
        chrono::DateTime::parse_from_rfc3339("2027-01-15T08:00:00Z")
            .unwrap()
            .timestamp() as f64
            - NOW
    }

    fn sample(window: &str, percent: f64, at: f64) -> Sample {
        Sample { window: window.into(), percent, resets_at: at + 3600.0, at }
    }

    fn note(dir: &Path) -> Value {
        serde_json::from_slice(&fs::read(dir.join(LAST_RUN_FILE)).unwrap()).unwrap()
    }

    #[test]
    fn ignores_input_without_rate_limits() {
        let dir = temp_data_dir();
        for input in [
            "",
            "not json",
            "[]",
            "{}",
            r#"{"model":"x"}"#,
            r#"{"rate_limits":null}"#,
            r#"{"rate_limits":{}}"#,
            r#"{"rate_limits":"x"}"#,
        ] {
            capture(input, &dir, NOW).unwrap();
        }
        assert!(!dir.join(LIMITS_FILE).exists());
        assert!(!dir.join(HISTORY_FILE).exists());
        // The diagnostic note is still there.
        assert_eq!(note(&dir)["rateLimits"], "no rows");
    }

    #[test]
    fn named_windows_become_samples() {
        let dir = temp_data_dir();
        let input = r#"{"model":{"id":"x"},"rate_limits":{
            "five_hour":{"used_percentage":42.5,"resets_at":1800003600},
            "seven_day":{"used_percentage":10,"resets_at":1800400000},
            "seven_day_opus":{"used_percentage":77,"resets_at":1800400000},
            "other":{"used_percentage":1,"resets_at":1}}}"#;
        capture(input, &dir, NOW).unwrap();

        let saved: Value =
            serde_json::from_slice(&fs::read(dir.join(LIMITS_FILE)).unwrap()).unwrap();
        assert_eq!(saved["savedAt"], NOW);
        assert_eq!(saved["rate_limits"]["five_hour"]["used_percentage"], 42.5);

        let h = history(&dir);
        let names: Vec<_> = h.iter().map(|s| s.window.as_str()).collect();
        assert_eq!(names, ["five_hour", "seven_day", "seven_day_opus"]);
        assert_eq!(h[0].percent, 42.5);
        assert_eq!(h[0].resets_at, 1_800_003_600.0);
        assert_eq!(h[0].at, NOW);
        let line = fs::read_to_string(dir.join(HISTORY_FILE)).unwrap();
        assert!(line.contains("\"resetsAt\":1800003600"), "{line}");
        assert_eq!(note(&dir)["rateLimits"], "no rows");
        assert_eq!(note(&dir)["keys"], json!(["model", "rate_limits"]));
    }

    #[test]
    fn limits_list_becomes_samples() {
        let dir = temp_data_dir();
        let input = r#"{"rate_limits":{"limits":[
            {"kind":"session","percent":30,"resets_at":"2027-01-15T08:00:00.000Z","severity":"normal"},
            {"kind":"weekly_all","percent":55.5,"resets_at":"2027-01-18T08:00:00Z"},
            {"kind":"weekly_scoped","percent":80,"resets_at":1800400000,
             "scope":{"model":{"display_name":"Opus"}}},
            {"name":"weekly_scoped","used_percentage":5,"resets_at":1800400000,
             "scope":{"surface":{"display_name":"Design"}}},
            {"kind":"session","percent":9}]}}"#;
        capture(input, &dir, NOW).unwrap();
        let h = history(&dir);
        let got: Vec<_> = h.iter().map(|s| (s.window.as_str(), s.percent)).collect();
        assert_eq!(
            got,
            [
                ("five_hour", 30.0),
                ("seven_day", 55.5),
                ("seven_day_opus", 80.0),
                ("seven_day_design", 5.0)
            ]
        );
        assert_eq!(h[0].resets_at, NOW + epoch_offset());
        assert_eq!(note(&dir)["rateLimits"], "rows");
    }

    #[test]
    fn scope_names_become_stable_keys() {
        let name = |s| window_name("weekly_scoped", s);
        assert_eq!(name(Some("Claude Design")), "seven_day_claude_design");
        assert_eq!(name(Some("Opus 4.5 (beta)")), "seven_day_opus_4_5_beta_");
        assert_eq!(name(None), "seven_day_scoped");
    }

    #[test]
    fn history_append_and_trim() {
        let dir = temp_data_dir();
        let (path, marker) = (dir.join(HISTORY_FILE), dir.join(TRIM_MARKER_FILE));
        let old = NOW - 9.0 * 86400.0;
        let fresh = NOW - 86400.0;

        // Seed an old and a recent line (marker absent: the first append trims).
        fs::write(
            &path,
            format!(
                "{}\n{}\n",
                serde_json::to_string(&sample("five_hour", 1.0, old)).unwrap(),
                serde_json::to_string(&sample("five_hour", 2.0, fresh)).unwrap()
            ),
        )
        .unwrap();
        append_history(&path, &[sample("five_hour", 3.0, NOW)], &marker, NOW).unwrap();
        let h = history(&dir);
        assert_eq!(h.iter().map(|s| s.percent).collect::<Vec<_>>(), [2.0, 3.0]);

        // Whole lines even when two appends run at once.
        let a: Vec<Sample> = (0..50).map(|i| sample(&format!("a{i}"), 1.0, NOW)).collect();
        let b: Vec<Sample> = (0..50).map(|i| sample(&format!("b{i}"), 2.0, NOW)).collect();
        let (p1, m1, p2, m2) = (path.clone(), marker.clone(), path.clone(), marker.clone());
        let t1 = std::thread::spawn(move || append_history(&p1, &a, &m1, NOW).unwrap());
        let t2 = std::thread::spawn(move || append_history(&p2, &b, &m2, NOW).unwrap());
        t1.join().unwrap();
        t2.join().unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.ends_with('\n'));
        assert_eq!(text.lines().count(), 102);
        assert!(text.lines().all(|l| serde_json::from_str::<Sample>(l).is_ok()));

        // Same percent within 60 s is skipped; a change is kept.
        let n = text.lines().count();
        append_history(&path, &[Sample { resets_at: NOW + 3600.0, ..sample("five_hour", 3.0, NOW + 30.0) }], &marker, NOW + 30.0).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap().lines().count(), n);
        append_history(&path, &[Sample { resets_at: NOW + 3600.0, ..sample("five_hour", 4.0, NOW + 31.0) }], &marker, NOW + 31.0).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap().lines().count(), n + 1);

        // A second trim within the hour is skipped: an old line added now survives.
        let mut f = OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(f, "{}", serde_json::to_string(&sample("seven_day", 9.0, old)).unwrap()).unwrap();
        append_history(&path, &[], &marker, NOW + 600.0).unwrap();
        assert!(history(&dir).iter().any(|s| s.window == "seven_day"));
        // An hour later it is trimmed.
        append_history(&path, &[], &marker, NOW + 3700.0).unwrap();
        assert!(!history(&dir).iter().any(|s| s.window == "seven_day"));
    }
}
