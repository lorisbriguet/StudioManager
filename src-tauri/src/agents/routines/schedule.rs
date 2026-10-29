//! Scheduled routines: which ones are due, the thread that starts them, and the notice a
//! failed scheduled run posts.

use super::store::{self, Days, Routine, Routines, Run, Status};
use chrono::{Datelike, Local, NaiveDateTime, NaiveTime, Weekday};
use std::collections::HashSet;
use std::path::Path;
use std::sync::{Arc, Mutex};
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
    if last.is_some_and(|l| l.scheduled_day() == Some(today.as_str())) {
        return None;
    }
    Some(today)
}

/// The notice for a run that has ended: only a failed scheduled run has one. It names the
/// routine only: notifications reach the lock screen, so no output, message or path.
fn failure_notice(title: &str, run: &Run) -> Option<String> {
    if run.scheduled_for.is_none() || run.status != Status::Failed {
        return None;
    }
    Some(format!("{title} failed"))
}

/// Records the final run and calls `notify` once when a scheduled run failed. Every run ends
/// here, so a failure is announced once.
pub fn record_final(dir: &Path, title: &str, run: &Run, notify: &dyn Fn(String)) {
    if let Err(e) = store::record_run(dir, run) {
        // The run stays recorded as running for its day, so it is not started again.
        log::warn!("[routines] could not record the end of {}: {e}", run.routine_id);
    }
    if let Some(notice) = failure_notice(title, run) {
        notify(notice);
    }
}

/// Posted once while `routine-runs.json` can't be read: scheduled runs wait meanwhile.
pub const PAUSED_NOTICE: &str =
    "Scheduled routines are paused: their run history can't be read. Open the Day tab for details.";

/// What the scheduler remembers between checks.
#[derive(Debug, Default)]
pub struct Memory {
    /// (routine id, day) of scheduled runs that could not start: not tried again that day.
    attempted: HashSet<(String, String)>,
    /// Whether `PAUSED_NOTICE` went out since the runs file was last readable.
    paused_noticed: bool,
}

/// One check: the scheduled runs to start, and a notice to post.
#[derive(Debug, Default, PartialEq)]
pub struct Plan {
    /// (routine id, title, day).
    pub launches: Vec<(String, String, String)>,
    pub notice: Option<String>,
}

/// Which routines to start at `now`, given the last runs (an error when the runs file can't be
/// read: then nothing starts, since a run for today may already be recorded there, and one
/// notice says so).
pub fn plan(all: &Routines, runs: &Result<Vec<Run>, String>, now: NaiveDateTime, mem: &mut Memory) -> Plan {
    let runs = match runs {
        Ok(runs) => runs,
        Err(_) => {
            let notice = (!mem.paused_noticed).then(|| PAUSED_NOTICE.to_string());
            mem.paused_noticed = true;
            return Plan { launches: vec![], notice };
        }
    };
    mem.paused_noticed = false;
    let today = now.date().to_string();
    mem.attempted.retain(|(_, day)| *day == today);
    let launches = all
        .routines
        .iter()
        .filter_map(|r| {
            let date = due(r, runs.iter().find(|x| x.routine_id == r.id), now)?;
            (!mem.attempted.contains(&(r.id.clone(), date.clone()))).then(|| (r.id.clone(), r.title.clone(), date))
        })
        .collect();
    Plan { launches, notice: None }
}

/// After a scheduled launch: "Already running" is tried again at the next check; any other
/// error (e.g. the run could not be recorded) marks the day attempted and gives one notice.
pub fn after_launch(result: &Result<Run, String>, id: &str, title: &str, day: &str, mem: &mut Memory) -> Option<String> {
    match result {
        Err(e) if e == super::run::ALREADY_RUNNING => None,
        Err(_) => mem
            .attempted
            .insert((id.to_string(), day.to_string()))
            .then(|| format!("{title} could not start")),
        Ok(_) => None,
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
fn check(app: &AppHandle, mem: &Arc<Mutex<Memory>>) {
    let state = app.state::<crate::agents::AgentsState>();
    let dir = state.app_dir.clone();
    if !crate::agents::cli::read_settings(&dir).enabled {
        return;
    }
    let all = store::read_routines(&dir);
    let runs = store::read_runs(&dir);
    if let Err(e) = &runs {
        log::warn!("[routines] scheduled runs paused: {e}");
    }
    let now = Local::now().naive_local();
    let plan = plan(&all, &runs, now, &mut mem.lock().unwrap_or_else(|e| e.into_inner()));
    if let Some(n) = plan.notice {
        notify(app, &n);
    }
    for (id, title, date) in plan.launches {
        log::info!("[routines] scheduled run: {id} for {date}");
        // An agent routine waits for the CLI: keep that off this thread.
        let (app, dir, login, mem) = (app.clone(), dir.clone(), state.login_cache(), mem.clone());
        std::thread::spawn(move || {
            let result = super::launch(&app, dir, login, &id, Some(date.clone()));
            match &result {
                Err(e) if e == super::run::ALREADY_RUNNING => log::debug!("[routines] {id} is still running"),
                Err(e) => log::warn!("[routines] could not start {id}: {e}"),
                Ok(_) => {}
            }
            let notice = after_launch(&result, &id, &title, &date, &mut mem.lock().unwrap_or_else(|e| e.into_inner()));
            if let Some(n) = notice {
                notify(&app, &n);
            }
        });
    }
}

/// Whether the wall clock moved on so much more than one slice that the Mac must have slept.
fn woke(last_wall: i64, wall: i64) -> bool {
    wall - last_wall > (SLICE + WAKE_JUMP).as_millis() as i64
}

/// Time counted towards the next check after one slice: a wake makes the check due at once.
fn next_since_check(since_check: Duration, last_wall: i64, wall: i64) -> Duration {
    if woke(last_wall, wall) {
        CHECK_EVERY
    } else {
        since_check + SLICE
    }
}

/// The scheduler: looks for due routines at start, every 30 s and right after a wake, while
/// the Agents switch is on.
pub fn start(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mem = Arc::new(Mutex::new(Memory::default()));
        let mut last_wall = wall_ms();
        let mut since_check = CHECK_EVERY;
        loop {
            if since_check >= CHECK_EVERY {
                if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| check(&app, &mem))).is_err() {
                    log::error!("[routines] scheduler check panicked; continuing");
                }
                since_check = Duration::ZERO;
            }
            std::thread::sleep(SLICE);
            let wall = wall_ms();
            // The monotonic clock stops while the Mac sleeps, the wall clock doesn't.
            since_check = next_since_check(since_check, last_wall, wall);
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
            last_scheduled_for: None,
            output: None,
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
    fn manual_run_does_not_erase_the_scheduled_one() {
        let dir = std::env::temp_dir().join(format!("sm-sched-manual-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let r = routine(Days::Daily);
        let last = || read_runs(&dir).unwrap().into_iter().next();
        // A manual run alone today: the scheduled one still runs.
        store::record_run(&dir, &run(Status::Done, None)).unwrap();
        assert_eq!(due(&r, last().as_ref(), at(27, 8, 30)), Some("2026-10-27".into()));
        // The scheduled run, then a manual one replacing it: not due again.
        store::record_run(&dir, &run(Status::Done, Some("2026-10-27"))).unwrap();
        store::record_run(&dir, &run(Status::Done, None)).unwrap();
        store::record_run(&dir, &run(Status::Failed, None)).unwrap();
        assert_eq!(due(&r, last().as_ref(), at(27, 8, 40)), None);
        // Tomorrow it is due again.
        assert_eq!(due(&r, last().as_ref(), at(28, 8, 10)), Some("2026-10-28".into()));
    }

    #[test]
    fn failure_notifies_once() {
        let dir = std::env::temp_dir().join(format!("sm-sched-notify-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let seen = RefCell::new(Vec::new());
        let notify = |m: String| seen.borrow_mut().push(m);
        // A failed scheduled run: recorded and one notice.
        record_final(&dir, "Brief", &run(Status::Failed, Some("2026-10-27")), &notify);
        assert_eq!(*seen.borrow(), vec!["Brief failed".to_string()]);
        assert_eq!(read_runs(&dir).unwrap().len(), 1);
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

    #[test]
    fn failure_notice_carries_no_output_message_or_path() {
        let dir = std::env::temp_dir().join(format!("sm-sched-quiet-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut r = run(Status::Failed, Some("2026-10-27"));
        r.message = Some("Folder not found: /Users/me/private".into());
        r.output = Some("< Authorization: Bearer sk-secret-token".into());
        let seen = RefCell::new(Vec::new());
        record_final(&dir, "Brief", &r, &|m| seen.borrow_mut().push(m));
        assert_eq!(*seen.borrow(), vec!["Brief failed".to_string()]);
        // The runs file keeps neither the output line nor anything but the app's message.
        let raw = std::fs::read_to_string(dir.join(store::RUNS_FILE)).unwrap();
        assert!(!raw.contains("sk-secret-token") && !raw.contains("Authorization"), "{raw}");
        // The panel still gets the line while the app runs.
        let shown = store::with_output(&dir, read_runs(&dir).unwrap());
        assert_eq!(shown[0].message.as_deref(), Some("< Authorization: Bearer sk-secret-token"));
        // A later run without output forgets it.
        let mut next = run(Status::Done, Some("2026-10-28"));
        next.started_at = 5;
        store::record_run(&dir, &next).unwrap();
        let shown = store::with_output(&dir, read_runs(&dir).unwrap());
        assert_eq!(shown[0].message.as_deref(), Some("boom"));
    }

    #[test]
    fn record_final_still_notifies_when_the_run_cannot_be_recorded() {
        // The app data "folder" is a file: nothing can be written there.
        let file = std::env::temp_dir().join(format!("sm-sched-unwritable-{}", std::process::id()));
        std::fs::write(&file, "x").unwrap();
        let seen = RefCell::new(Vec::new());
        record_final(&file, "Brief", &run(Status::Failed, Some("2026-10-27")), &|m| seen.borrow_mut().push(m));
        assert_eq!(*seen.borrow(), vec!["Brief failed".to_string()]);
        let _ = std::fs::remove_file(&file);
    }

    fn routines(rs: Vec<Routine>) -> Routines {
        Routines { sections: vec![], routines: rs }
    }

    #[test]
    fn plan_starts_due_routines_once() {
        let mut mem = Memory::default();
        let all = routines(vec![routine(Days::Daily)]);
        let want = vec![("r1".to_string(), "Brief".to_string(), "2026-10-27".to_string())];
        assert_eq!(plan(&all, &Ok(vec![]), at(27, 8, 1), &mut mem).launches, want);
        // Recorded for today: not again.
        let today = run(Status::Running, Some("2026-10-27"));
        assert!(plan(&all, &Ok(vec![today]), at(27, 8, 2), &mut mem).launches.is_empty());
        // Not yet due, or another routine's run: as `due` says.
        assert!(plan(&all, &Ok(vec![]), at(27, 7, 0), &mut mem).launches.is_empty());
    }

    #[test]
    fn plan_pauses_on_an_unreadable_runs_file_and_says_so_once() {
        let mut mem = Memory::default();
        let all = routines(vec![routine(Days::Daily)]);
        let bad: Result<Vec<Run>, String> = Err("routine-runs.json is damaged".into());
        let first = plan(&all, &bad, at(27, 8, 1), &mut mem);
        assert!(first.launches.is_empty());
        assert_eq!(first.notice.as_deref(), Some(PAUSED_NOTICE));
        // Still unreadable: still nothing, no second notice.
        assert_eq!(plan(&all, &bad, at(27, 8, 2), &mut mem), Plan::default());
        // Readable again: runs, and a later breakage notifies again.
        assert_eq!(plan(&all, &Ok(vec![]), at(27, 8, 3), &mut mem).launches.len(), 1);
        assert!(plan(&all, &bad, at(27, 8, 4), &mut mem).notice.is_some());
    }

    #[test]
    fn missing_runs_file_is_no_runs_but_a_damaged_one_is_an_error() {
        let dir = std::env::temp_dir().join(format!("sm-sched-damaged-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(read_runs(&dir), Ok(vec![]));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(store::RUNS_FILE), "{ not json").unwrap();
        assert!(read_runs(&dir).is_err());
        // Nothing overwrites it: recording a run fails and leaves the file for inspection.
        assert!(store::record_run(&dir, &run(Status::Done, None)).is_err());
        assert_eq!(std::fs::read_to_string(dir.join(store::RUNS_FILE)).unwrap(), "{ not json");
    }

    #[test]
    fn already_running_is_retried_other_errors_mark_the_day_once() {
        let mut mem = Memory::default();
        let all = routines(vec![routine(Days::Daily)]);
        let busy: Result<Run, String> = Err(crate::agents::routines::run::ALREADY_RUNNING.into());
        assert_eq!(after_launch(&busy, "r1", "Brief", "2026-10-27", &mut mem), None);
        assert_eq!(plan(&all, &Ok(vec![]), at(27, 8, 1), &mut mem).launches.len(), 1);
        // The start could not be recorded: one notice (title only), no retry today.
        let broken: Result<Run, String> = Err("Failed to create /x: denied".into());
        let n = after_launch(&broken, "r1", "Brief", "2026-10-27", &mut mem);
        assert_eq!(n.as_deref(), Some("Brief could not start"));
        assert_eq!(after_launch(&broken, "r1", "Brief", "2026-10-27", &mut mem), None);
        assert!(plan(&all, &Ok(vec![]), at(27, 8, 2), &mut mem).launches.is_empty());
        // The next day it is due again.
        assert_eq!(plan(&all, &Ok(vec![]), at(28, 8, 1), &mut mem).launches.len(), 1);
        assert_eq!(after_launch(&Ok(run(Status::Done, None)), "r1", "Brief", "2026-10-28", &mut mem), None);
    }

    #[test]
    fn wake_jump_arithmetic() {
        let slice = SLICE.as_millis() as i64;
        // A normal slice counts towards the next check.
        assert!(!woke(0, slice));
        assert_eq!(next_since_check(Duration::ZERO, 0, slice), SLICE);
        assert_eq!(next_since_check(Duration::from_secs(25), 0, slice), Duration::from_secs(30));
        // Up to slice + 60 s late is not a wake (a busy Mac).
        let limit = (SLICE + WAKE_JUMP).as_millis() as i64;
        assert!(!woke(1_000, 1_000 + limit));
        // Longer: the Mac slept, check at once.
        assert!(woke(1_000, 1_000 + limit + 1));
        assert_eq!(next_since_check(Duration::ZERO, 1_000, 1_000 + 3_600_000), CHECK_EVERY);
        // The clock set back is not a wake.
        assert!(!woke(10_000_000, 0));
        assert_eq!(next_since_check(Duration::from_secs(5), 10_000_000, 0), Duration::from_secs(10));
    }
}
