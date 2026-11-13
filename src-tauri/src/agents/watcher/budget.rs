//! The budget rule: automatic sessions (the brief session, the watcher) start only while the
//! week's use is on or under its pace line and the 5-hour window has room. It protects the
//! owner's Claude plan from sessions the app starts by itself, so it fails closed: no reading,
//! a stale reading or a missing window all pause.
//!
//! All times are epoch milliseconds, as `limits::Meter::resets_at` and the save time
//! `limits::load` returns (the file itself holds seconds; `limits` converts).

use crate::agents::usage::limits::Meter;
use std::path::{Path, PathBuf};

/// The weekly window may be used up to this percent by its end; the line rises evenly to it.
pub const WEEK_LINE: f64 = 85.0;
/// At or over this much of the 5-hour window, nothing starts.
pub const FIVE_HOUR_CAP: f64 = 80.0;
pub const WEEK_MS: i64 = 7 * 86_400_000;
/// A reading older than this is not trusted (the status line writes it while Claude Code runs).
pub const STALE_MS: i64 = 30 * 60_000;
/// A reading may be this far ahead of the clock (clock jitter) before it is distrusted.
pub const FUTURE_SLACK_MS: i64 = 5 * 60_000;

#[derive(Clone, Debug, PartialEq)]
pub enum Budget {
    Ok,
    /// The week's use is over the pace line: both in percent.
    AheadOfWeek { percent: f64, line: f64 },
    /// The 5-hour window's use.
    FiveHour(f64),
    NoData,
    Stale { saved_at: i64 },
}

/// Where the week's use may stand now: 85% spread evenly over the 7 days that end at
/// `resets_at`. None when `now` is before the week began or after it ended.
pub fn week_line(resets_at: i64, now: i64) -> Option<f64> {
    let elapsed = now - (resets_at - WEEK_MS);
    if !(0..=WEEK_MS).contains(&elapsed) {
        return None;
    }
    Some(WEEK_LINE * elapsed as f64 / WEEK_MS as f64)
}

/// `limits` is what `limits::load_dated` gives (meters, when the file was saved). A file with no
/// save time cannot be shown fresh, so it is `NoData`. `limits::meters` already drops a window
/// that has reset, so a missing window means no usable reading.
pub fn budget(limits: Option<(Vec<Meter>, Option<i64>)>, now: i64) -> Budget {
    let Some((meters, Some(saved_at))) = limits else { return Budget::NoData };
    if now - saved_at > STALE_MS || saved_at - now > FUTURE_SLACK_MS {
        return Budget::Stale { saved_at };
    }
    let find = |w: &str| meters.iter().find(|m| m.window == w);
    let (Some(week), Some(five)) = (find("seven_day"), find("five_hour")) else {
        return Budget::NoData;
    };
    if five.percent >= FIVE_HOUR_CAP {
        return Budget::FiveHour(five.percent);
    }
    match week_line(week.resets_at, now) {
        Some(line) if week.percent <= line => Budget::Ok,
        // No line: the week has not begun by the clock (it ends more than 7 days from now).
        line => Budget::AheadOfWeek { percent: week.percent, line: line.unwrap_or(0.0) },
    }
}

/// Where the usage readings are. The dev build's status line writes them only into the installed
/// app's folder, so the dev build reads that one (read only); every other build reads its own.
pub fn limits_dir(app_dir: &Path, dev: bool, home: &Path) -> PathBuf {
    if dev {
        home.join("Library/Application Support/ch.studiomanager.app")
    } else {
        app_dir.to_path_buf()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::usage::limits;

    const NOW: i64 = 1_800_000_000_000;
    const DAY: i64 = 86_400_000;
    const MIN: i64 = 60_000;
    const HOUR: i64 = 3_600_000;

    /// The meters of a `limits.json` as the status line writes it (seconds), read through
    /// `limits::meters` like the real loader does.
    fn meters(five: f64, five_reset_ms: i64, week: f64, week_reset_ms: i64) -> Vec<Meter> {
        let json = format!(
            r#"{{"savedAt":{},"rate_limits":{{
              "five_hour":{{"used_percentage":{five},"resets_at":{}}},
              "seven_day":{{"used_percentage":{week},"resets_at":{}}}}}}}"#,
            NOW / 1000,
            five_reset_ms / 1000,
            week_reset_ms / 1000
        );
        limits::meters(&json, &[], NOW)
    }

    /// Fresh readings, half the week gone (the line stands at 42.5%).
    fn at_half(five: f64, week: f64) -> Budget {
        budget(Some((meters(five, NOW + HOUR, week, NOW + 3 * DAY + DAY / 2), Some(NOW))), NOW)
    }

    fn saved(saved_at: i64) -> Budget {
        budget(Some((meters(10.0, NOW + HOUR, 10.0, NOW + 3 * DAY), Some(saved_at))), NOW)
    }

    #[test]
    fn week_line_rises_evenly_and_is_none_outside_the_week() {
        assert_eq!(week_line(NOW + 3 * DAY + DAY / 2, NOW), Some(42.5));
        assert_eq!(week_line(NOW + WEEK_MS, NOW), Some(0.0));
        assert_eq!(week_line(NOW, NOW), Some(85.0));
        assert_eq!(week_line(NOW + WEEK_MS + 1, NOW), None);
        assert_eq!(week_line(NOW - 1, NOW), None);
    }

    #[test]
    fn budget_ok_on_the_line() {
        assert_eq!(at_half(10.0, 42.5), Budget::Ok);
        assert_eq!(at_half(10.0, 42.6), Budget::AheadOfWeek { percent: 42.6, line: 42.5 });
        assert_eq!(at_half(10.0, 10.0), Budget::Ok);
    }

    #[test]
    fn budget_five_hour_80_stops() {
        assert_eq!(at_half(79.9, 10.0), Budget::Ok);
        assert_eq!(at_half(80.0, 10.0), Budget::FiveHour(80.0));
        // The 5-hour cap is checked before the week.
        assert_eq!(at_half(90.0, 99.0), Budget::FiveHour(90.0));
    }

    /// `limits.json` text with fresh-looking windows and the given `savedAt` JSON (or none),
    /// read through the budget's own loader.
    fn loaded(saved_at_json: Option<&str>) -> Budget {
        let dir = std::env::temp_dir().join(format!("sm-budget-{}-{}", std::process::id(), saved_at_json.map_or(0, |s| s.len())));
        std::fs::create_dir_all(&dir).unwrap();
        let saved = saved_at_json.map(|v| format!(r#""savedAt":{v},"#)).unwrap_or_default();
        let (five, week) = (NOW / 1000 + 3600, NOW / 1000 + 3 * 86_400);
        std::fs::write(
            dir.join(limits::LIMITS_FILE),
            format!(
                r#"{{{saved}"rate_limits":{{"five_hour":{{"used_percentage":10,"resets_at":{five}}},"seven_day":{{"used_percentage":10,"resets_at":{week}}}}}}}"#
            ),
        )
        .unwrap();
        budget(limits::load_dated(&dir, NOW), NOW)
    }

    #[test]
    fn budget_no_saved_at_is_no_data() {
        assert_eq!(loaded(None), Budget::NoData);
        // Control: the same file with a fresh `savedAt` is fine.
        assert_eq!(loaded(Some(&(NOW / 1000).to_string())), Budget::Ok);
    }

    #[test]
    fn budget_non_numeric_saved_at_is_no_data() {
        assert_eq!(loaded(Some(r#""soon""#)), Budget::NoData);
        assert_eq!(loaded(Some("null")), Budget::NoData);
    }

    #[test]
    fn budget_no_file() {
        assert_eq!(budget(None, NOW), Budget::NoData);
    }

    #[test]
    fn budget_stale_31_min() {
        assert_eq!(saved(NOW - 31 * MIN), Budget::Stale { saved_at: NOW - 31 * MIN });
    }

    #[test]
    fn budget_stale_boundary_is_exactly_thirty_minutes() {
        assert_eq!(saved(NOW - STALE_MS), Budget::Ok);
        assert_eq!(saved(NOW - STALE_MS - 1), Budget::Stale { saved_at: NOW - STALE_MS - 1 });
    }

    #[test]
    fn budget_saved_in_the_future() {
        assert_eq!(saved(NOW + FUTURE_SLACK_MS), Budget::Ok);
        assert_eq!(saved(NOW + FUTURE_SLACK_MS + 1), Budget::Stale { saved_at: NOW + FUTURE_SLACK_MS + 1 });
    }

    #[test]
    fn budget_week_reset_already() {
        // The weekly window reset in the past: `limits::meters` drops it.
        let b = budget(Some((meters(10.0, NOW + HOUR, 10.0, NOW - 1000), Some(NOW))), NOW);
        assert_eq!(b, Budget::NoData);
        // So does a five-hour window that reset.
        let b = budget(Some((meters(10.0, NOW - 1000, 10.0, NOW + 3 * DAY), Some(NOW))), NOW);
        assert_eq!(b, Budget::NoData);
        // A file with no windows at all.
        assert_eq!(budget(Some((vec![], Some(NOW))), NOW), Budget::NoData);
    }

    #[test]
    fn budget_week_more_than_7_days_ahead() {
        // The week ends more than 7 days from now: no line to stand under, so it pauses.
        let b = budget(Some((meters(10.0, NOW + HOUR, 1.0, NOW + WEEK_MS + 2000), Some(NOW))), NOW);
        assert_eq!(b, Budget::AheadOfWeek { percent: 1.0, line: 0.0 });
    }

    #[test]
    fn limits_dir_is_the_installed_folder_only_in_dev() {
        let app = Path::new("/data/app");
        let home = Path::new("/Users/someone");
        assert_eq!(limits_dir(app, false, home), PathBuf::from("/data/app"));
        assert_eq!(
            limits_dir(app, true, home),
            PathBuf::from("/Users/someone/Library/Application Support/ch.studiomanager.app")
        );
    }
}
