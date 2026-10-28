//! Scheduled routines: which ones are due, the thread that starts them, and the notice a
//! failed scheduled run posts.

use super::store::{self, Days, Routine, Run, Status};
use chrono::{Datelike, Local, NaiveDateTime, NaiveTime, Weekday};
use std::path::Path;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Manager};
use tauri_plugin_notification::NotificationExt;

/// A slot is caught up for this long after its time (app started or Mac woke late).
const CATCH_UP: chrono::Duration = chrono::Duration::hours(2);
/// How often the due routines are looked up.
const CHECK_EVERY: Duration = Duration::from_secs(30);
/// How often the thread wakes to compare the wall clock with its own count.
const SLICE: Duration = Duration::from_secs(5);
/// A wall-clock jump longer than this between two wake-ups means the Mac slept.
const WAKE_JUMP: Duration = Duration::from_secs(60);

/// The date (`YYYY-MM-DD`) `r` is to run for at `now` (local time): today's slot has come, is
/// less than 2 h old, today is a day it runs on, and no scheduled run for today is recorded.
/// A run started by hand (`scheduled_for` None) doesn't count, nor does any other day's.
pub fn due(r: &Routine, last: Option<&Run>, now: NaiveDateTime) -> Option<String> {
    let schedule = r.schedule.as_ref()?;
    let (h, m) = schedule.time.split_once(':')?;
    let slot = now.date().and_time(NaiveTime::from_hms_opt(h.parse().ok()?, m.parse().ok()?, 0)?);
    let weekend = matches!(now.weekday(), Weekday::Sat | Weekday::Sun);
    if (schedule.days == Days::Weekdays && weekend) || now < slot || now - slot >= CATCH_UP {
        return None;
    }
    let today = now.date().to_string();
    if last.is_some_and(|l| l.scheduled_for.as_deref() == Some(today.as_str())) {
        return None;
    }
    Some(today)
}

/// The notice for a run that has ended: only a failed scheduled run has one.
fn failure_notice(title: &str, run: &Run) -> Option<String> {
    if run.scheduled_for.is_none() || run.status != Status::Failed {
        return None;
    }
    Some(match run.message.as_deref().filter(|m| !m.is_empty()) {
        Some(m) => format!("{title} failed: {m}"),
        None => format!("{title} failed"),
    })
}

/// Records the final run and calls `notify` once when a scheduled run failed. Every run ends
/// here, so a failure is announced once.
pub fn record_final(dir: &Path, title: &str, run: &Run, notify: &dyn Fn(String)) {
    let _ = store::record_run(dir, run);
    if let Some(notice) = failure_notice(title, run) {
        notify(notice);
    }
}

pub fn notify(app: &AppHandle, message: &str) {
    if let Err(e) = app.notification().builder().title("StudioManager").body(message).show() {
        log::warn!("[routines] notification failed: {e}");
    }
}

fn wall_ms() -> i64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Starts every routine that is due now.
fn check(app: &AppHandle) {
    let state = app.state::<crate::agents::AgentsState>();
    let dir = state.app_dir.clone();
    if !crate::agents::cli::read_settings(&dir).enabled {
        return;
    }
    let all = store::read_routines(&dir);
    let runs = store::read_runs(&dir);
    let now = Local::now().naive_local();
    for r in &all.routines {
        let last = runs.iter().find(|x| x.routine_id == r.id);
        let Some(date) = due(r, last, now) else { continue };
        log::info!("[routines] scheduled run: {} for {date}", r.id);
        // An agent routine waits for the CLI: keep that off this thread.
        let (app, dir, login, id) = (app.clone(), dir.clone(), state.login_cache(), r.id.clone());
        std::thread::spawn(move || {
            if let Err(e) = super::launch(&app, dir, login, &id, Some(date)) {
                log::warn!("[routines] could not start {id}: {e}");
            }
        });
    }
}

/// The scheduler: looks for due routines at start, every 30 s and right after a wake, while
/// the Agents switch is on.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut last_wall = wall_ms();
        let mut since_check = CHECK_EVERY;
        loop {
            if since_check >= CHECK_EVERY {
                check(&app);
                since_check = Duration::ZERO;
            }
            std::thread::sleep(SLICE);
            let wall = wall_ms();
            // The monotonic clock stops while the Mac sleeps, the wall clock doesn't.
            if wall - last_wall > (SLICE + WAKE_JUMP).as_millis() as i64 {
                since_check = CHECK_EVERY;
            } else {
                since_check += SLICE;
            }
            last_wall = wall;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::routines::store::{read_runs, RoutineKind, Schedule};
    use chrono::NaiveDate;
    use std::cell::RefCell;

    fn at(d: u32, h: u32, m: u32) -> NaiveDateTime {
        // 2026-10-26 is a Monday.
        NaiveDate::from_ymd_opt(2026, 10, d).unwrap().and_hms_opt(h, m, 0).unwrap()
    }

    fn routine(days: Days) -> Routine {
        Routine {
            id: "r1".into(),
            section_id: "s1".into(),
            title: "Brief".into(),
            idle_hint: String::new(),
            kind: RoutineKind::Command {
                program: "/bin/echo".into(),
                args: vec![],
                cwd: "/tmp".into(),
            },
            result_link: None,
            schedule: Some(Schedule { time: "08:00".into(), days }),
        }
    }

    fn run(status: Status, scheduled_for: Option<&str>) -> Run {
        Run {
            routine_id: "r1".into(),
            started_at: 1,
            finished_at: Some(2),
            status,
            message: Some("boom".into()),
            agent_short_id: None,
            scheduled_for: scheduled_for.map(String::from),
        }
    }

    #[test]
    fn catch_up_rules() {
        let r = routine(Days::Daily);
        // Tuesday 27th.
        assert_eq!(due(&r, None, at(27, 7, 59)), None);
        assert_eq!(due(&r, None, at(27, 8, 0)), Some("2026-10-27".into()));
        assert_eq!(due(&r, None, at(27, 9, 59)), Some("2026-10-27".into()));
        assert_eq!(due(&r, None, at(27, 10, 1)), None);
        // Not again once it ran today, even if it failed; yesterday's run doesn't count.
        let today = run(Status::Failed, Some("2026-10-27"));
        assert_eq!(due(&r, Some(&today), at(27, 8, 30)), None);
        let yesterday = run(Status::Done, Some("2026-10-26"));
        assert_eq!(due(&r, Some(&yesterday), at(27, 8, 30)), Some("2026-10-27".into()));
        // A run started by hand is not the day's scheduled run.
        let manual = run(Status::Done, None);
        assert_eq!(due(&r, Some(&manual), at(27, 8, 30)), Some("2026-10-27".into()));
        // Never for a past day: just after midnight, yesterday's late slot is gone.
        let mut late = routine(Days::Daily);
        late.schedule.as_mut().unwrap().time = "23:30".into();
        assert_eq!(due(&late, None, at(28, 0, 10)), None);
        // Weekdays: Friday yes, Saturday and Sunday no.
        let w = routine(Days::Weekdays);
        assert_eq!(due(&w, None, at(30, 8, 5)), Some("2026-10-30".into()));
        assert_eq!(due(&w, None, at(31, 8, 5)), None);
        assert_eq!(due(&r, None, at(31, 8, 5)), Some("2026-10-31".into()));
        // No schedule, or a bad time: never.
        let mut none = routine(Days::Daily);
        none.schedule = None;
        assert_eq!(due(&none, None, at(27, 8, 5)), None);
        none.schedule = Some(Schedule { time: "8am".into(), days: Days::Daily });
        assert_eq!(due(&none, None, at(27, 8, 5)), None);
    }

    #[test]
    fn failure_notifies_once() {
        let dir = std::env::temp_dir().join(format!("sm-sched-notify-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let seen = RefCell::new(Vec::new());
        let notify = |m: String| seen.borrow_mut().push(m);
        // A failed scheduled run: recorded and one notice.
        record_final(&dir, "Brief", &run(Status::Failed, Some("2026-10-27")), &notify);
        assert_eq!(*seen.borrow(), vec!["Brief failed: boom".to_string()]);
        assert_eq!(read_runs(&dir).len(), 1);
        // Done, or failed but started by hand: no notice.
        record_final(&dir, "Brief", &run(Status::Done, Some("2026-10-27")), &notify);
        record_final(&dir, "Brief", &run(Status::Failed, None), &notify);
        assert_eq!(seen.borrow().len(), 1);
        // A failure without a message still says what failed.
        let mut bare = run(Status::Failed, Some("2026-10-27"));
        bare.message = None;
        record_final(&dir, "Brief", &bare, &notify);
        assert_eq!(seen.borrow()[1], "Brief failed");
    }
}
