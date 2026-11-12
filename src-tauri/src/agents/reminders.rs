//! Capture from the phone: the open reminders of one list of the default Reminders account
//! become captures, then are ticked. Runs every 2 minutes while Agents and "Capture from
//! Reminders" are on (never in the demo build, never in test or presentation mode). Reading and
//! ticking go through `apple.rs` (fixed AppleScript, values as argv); tests use a fake source.

use super::capture::{self, Source};
use super::cli::read_settings;
use serde::Serialize;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use crate::apple::{Reminder, RemindersError};
use std::path::Path;

/// The ids already turned into captures, newest last; across organisations.
const SEEN_FILE: &str = "reminders-seen.json";
const SEEN_KEEP: usize = 500;
/// Between two passes.
const EVERY: Duration = Duration::from_secs(120);

/// Where the reminders come from; the real one is Apple Reminders.
pub trait ReminderSource {
    fn open(&self, list: &str) -> Result<Vec<Reminder>, RemindersError>;
    fn complete(&self, list: &str, id: &str) -> Result<(), RemindersError>;
}

/// How one reminder was added to the active organisation.
#[derive(Debug, PartialEq)]
pub enum Add {
    /// Saved (true) or already there (false).
    Done(bool),
    /// The active organisation changed, or is now in a mode: the pass stops here.
    OrgChanged,
    /// Could not be saved: this reminder is skipped.
    Failed(String),
}

/// Adds one reminder (its text and id) to the organisation the pass is for, or says why not.
pub type AddFn<'a> = &'a dyn Fn(&str, &str) -> Add;

/// One pass at a time: the Settings switch-on pass and the loop's never overlap.
static PASS: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// What a pass did: the captures it added, and the first completion that failed (retried on the
/// next pass).
#[derive(Debug, PartialEq, Default)]
pub struct Outcome {
    pub added: usize,
    pub error: Option<RemindersError>,
}

/// The reminder as a capture: the title, then a blank line and the body when it has one.
pub fn capture_text(r: &Reminder) -> Option<String> {
    let (title, body) = (r.title.trim(), r.body.trim());
    match (title.is_empty(), body.is_empty()) {
        (true, true) => None,
        (false, true) => Some(title.to_string()),
        (true, false) => Some(body.to_string()),
        (false, false) => Some(format!("{title}\n\n{body}")),
    }
}

fn read_seen(app_dir: &Path) -> Vec<String> {
    std::fs::read_to_string(app_dir.join(SEEN_FILE))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_seen(app_dir: &Path, seen: &mut Vec<String>) -> Result<(), String> {
    if seen.len() > SEEN_KEEP {
        seen.drain(..seen.len() - SEEN_KEEP);
    }
    let json = serde_json::to_string(seen).map_err(|e| e.to_string())?;
    crate::agent_access::write_atomic(&app_dir.join(SEEN_FILE), &format!("{json}\n"))
}

/// One pass: every open reminder of `list` becomes a capture (once: the seen list and the
/// `UNIQUE` reminder id see to that), is recorded as seen, then ticked. Only reading the list can
/// fail the pass; a reminder `add` cannot save is skipped; a tick that fails is kept in the outcome and retried next time (a timeout
/// stops the ticks: each would wait as long).
pub fn import(app_dir: &Path, list: &str, src: &dyn ReminderSource, add: AddFn) -> Result<Outcome, RemindersError> {
    let open = src.open(list)?;
    let mut seen = read_seen(app_dir);
    let mut out = Outcome::default();
    for r in open {
        let Some(text) = capture_text(&r) else { continue };
        if !seen.iter().any(|s| s == &r.id) {
            match add(&text, &r.id) {
                Add::Done(added) => out.added += usize::from(added),
                // The rest stays unticked: the next pass reads it again.
                Add::OrgChanged => break,
                // Not saved, so not seen and not ticked: it is read again next time.
                Add::Failed(e) => {
                    log::warn!("[reminders] could not save a reminder as a capture: {e}");
                    continue;
                }
            }
            seen.push(r.id.clone());
            write_seen(app_dir, &mut seen).map_err(RemindersError::Other)?;
        }
        if let Err(e) = src.complete(list, &r.id) {
            let stop = e == RemindersError::Timeout;
            out.error.get_or_insert(e);
            if stop {
                break;
            }
        }
    }
    Ok(out)
}

/// A pass for one organisation; None (nothing is read) while it is in test or presentation mode.
pub fn pass(
    app_dir: &Path,
    org: &crate::ActiveOrg,
    list: &str,
    src: &dyn ReminderSource,
    add: AddFn,
) -> Option<Result<Outcome, RemindersError>> {
    let _one_at_a_time = PASS.lock().unwrap_or_else(|e| e.into_inner());
    if org.in_mode() {
        return None;
    }
    Some(import(app_dir, list, src, add))
}

/// Apple Reminders, through the fixed scripts of `apple.rs`.
struct Apple;

impl ReminderSource for Apple {
    fn open(&self, list: &str) -> Result<Vec<Reminder>, RemindersError> {
        crate::apple::reminders_open(list)
    }
    fn complete(&self, list: &str, id: &str) -> Result<(), RemindersError> {
        crate::apple::reminders_complete(list, id)
    }
}

/// What Settings shows under the switch; the card words it with the list and the account.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    /// `not_found`, `denied`, `timeout` or `other`.
    pub kind: &'static str,
    pub list: String,
    pub account: String,
    pub message: String,
}

fn problem(e: &RemindersError, list: &str) -> Problem {
    let (kind, account) = match e {
        RemindersError::NotFound { account } => ("not_found", account.clone()),
        RemindersError::Denied => ("denied", String::new()),
        RemindersError::Timeout => ("timeout", String::new()),
        RemindersError::Other(_) => ("other", String::new()),
    };
    Problem { kind, list: list.to_string(), account, message: e.to_string() }
}

/// One pass against Apple Reminders for the active organisation, with the list from Settings.
/// Blocking. Tells the windows when it added captures. None: nothing wrong (or in a mode).
pub fn run_now(app: &tauri::AppHandle) -> Option<Problem> {
    let state = app.state::<super::AgentsState>();
    let list = read_settings(&state.app_dir).reminders_list;
    let org = crate::active_org(app).ok()?;
    // Before each add: the active organisation is read again under the organisation lock (held
    // only for the add, never across Reminders), so a switch or a mode never receives a capture
    // meant for the organisation the pass began with.
    let add = |text: &str, id: &str| {
        let _guard = crate::org_shared();
        match crate::active_org(app) {
            Ok(now) if now.id == org.id && !now.in_mode() => {
                match capture::add(&now.prod_db_path(), text, Source::Reminders, None, Some(id)) {
                    Ok(added) => Add::Done(added.is_some()),
                    Err(e) => Add::Failed(e),
                }
            }
            Ok(_) => Add::OrgChanged,
            Err(e) => Add::Failed(e),
        }
    };
    let out = pass(&state.app_dir, &org, &list, &Apple, &add)?;
    let result = match out {
        Ok(o) => {
            if o.added > 0 {
                if let Err(e) = app.emit(crate::agent_access::CHANGED_EVENT, ["capture"]) {
                    log::warn!("[reminders] emit {}: {e}", crate::agent_access::CHANGED_EVENT);
                }
            }
            o.error
        }
        Err(e) => Some(e),
    };
    result.map(|e| problem(&e, &list))
}

fn check(app: &AppHandle) {
    // First, before any file is read or Reminders is asked.
    if crate::host::is_demo(app) {
        return;
    }
    let state = app.state::<super::AgentsState>();
    let s = read_settings(&state.app_dir);
    if !s.enabled || !s.reminders {
        return;
    }
    if let Some(p) = run_now(app) {
        // "Reminders did not answer" is routine (the Mac was busy): the next pass retries.
        log::info!("[reminders] {}", p.message);
    }
}

/// The loop: a pass every 2 minutes and right after a wake. The first waits 30 s.
pub fn start(app: &AppHandle) {
    use super::routines::schedule::{wall_ms, woke, SLICE};
    let app = app.clone();
    std::thread::spawn(move || {
        let mut last_wall = wall_ms();
        let mut since = EVERY - Duration::from_secs(30);
        loop {
            if since >= EVERY {
                if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| check(&app))).is_err() {
                    log::error!("[reminders] pass panicked; continuing");
                }
                since = Duration::ZERO;
            }
            std::thread::sleep(SLICE);
            let wall = wall_ms();
            since = if woke(last_wall, wall) { EVERY } else { since + SLICE };
            last_wall = wall;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::cell::RefCell;
    use std::path::PathBuf;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("sm-reminders-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn migrated(dir: &Path, file: &str) -> PathBuf {
        let path = dir.join(file);
        let conn = Connection::open(&path).unwrap();
        for m in crate::migrate::MIGRATIONS {
            conn.execute_batch(m.sql).unwrap();
        }
        path
    }

    fn rem(id: &str, title: &str, body: &str) -> Reminder {
        Reminder { id: id.into(), title: title.into(), body: body.into() }
    }

    /// Open reminders it serves, the ticks it was asked for, and ids whose tick fails.
    #[derive(Default)]
    struct Fake {
        open: RefCell<Vec<Reminder>>,
        ticked: RefCell<Vec<String>>,
        failing: RefCell<Vec<String>>,
        reads: RefCell<usize>,
    }

    impl ReminderSource for Fake {
        fn open(&self, _list: &str) -> Result<Vec<Reminder>, RemindersError> {
            *self.reads.borrow_mut() += 1;
            Ok(self.open.borrow().clone())
        }
        fn complete(&self, _list: &str, id: &str) -> Result<(), RemindersError> {
            if self.failing.borrow().iter().any(|f| f == id) {
                return Err(RemindersError::Timeout);
            }
            self.ticked.borrow_mut().push(id.to_string());
            self.open.borrow_mut().retain(|r| r.id != id);
            Ok(())
        }
    }

    /// The real add (`capture::add`) into `db`, as `import` takes it.
    fn into(db: &Path) -> impl Fn(&str, &str) -> Add + '_ {
        move |text, id| match capture::add(db, text, Source::Reminders, None, Some(id)) {
            Ok(added) => Add::Done(added.is_some()),
            Err(e) => Add::Failed(e),
        }
    }

    fn captures(db: &Path) -> Vec<(String, String, Option<String>)> {
        let conn = Connection::open(db).unwrap();
        let mut st = conn.prepare("SELECT text, source, reminder_id FROM captures ORDER BY id").unwrap();
        st.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().map(|r| r.unwrap()).collect()
    }

    #[test]
    fn capture_text_is_the_title_then_the_body() {
        assert_eq!(capture_text(&rem("a", "  Call the printer ", "")), Some("Call the printer".into()));
        assert_eq!(
            capture_text(&rem("a", "Call the printer", "Ask for a quote\nby Friday")),
            Some("Call the printer\n\nAsk for a quote\nby Friday".into())
        );
        assert_eq!(capture_text(&rem("a", "", "Only a body")), Some("Only a body".into()));
        assert_eq!(capture_text(&rem("a", "  ", "\n ")), None);
    }

    #[test]
    fn two_reminders_become_two_captures_and_are_ticked() {
        let dir = tmp("two");
        let db = migrated(&dir, "a.db");
        let src = Fake::default();
        *src.open.borrow_mut() = vec![rem("r1", "Call the printer", ""), rem("r2", "Buy tape", "Two rolls")];
        let out = import(&dir, "Inbox", &src, &into(&db)).unwrap();
        assert_eq!(out, Outcome { added: 2, error: None });
        assert_eq!(
            captures(&db),
            vec![
                ("Call the printer".into(), "reminders".into(), Some("r1".into())),
                ("Buy tape\n\nTwo rolls".into(), "reminders".into(), Some("r2".into())),
            ]
        );
        assert_eq!(*src.ticked.borrow(), vec!["r1", "r2"]);
    }

    #[test]
    fn a_failed_tick_is_retried_and_never_a_second_capture() {
        let dir = tmp("retry");
        let db = migrated(&dir, "a.db");
        let src = Fake::default();
        *src.open.borrow_mut() = vec![rem("r1", "Call the printer", "")];
        *src.failing.borrow_mut() = vec!["r1".into()];
        let first = import(&dir, "Inbox", &src, &into(&db)).unwrap();
        assert_eq!(first, Outcome { added: 1, error: Some(RemindersError::Timeout) });
        assert!(src.ticked.borrow().is_empty());
        src.failing.borrow_mut().clear();
        let second = import(&dir, "Inbox", &src, &into(&db)).unwrap();
        assert_eq!(second, Outcome { added: 0, error: None });
        assert_eq!(*src.ticked.borrow(), vec!["r1"]);
        assert_eq!(captures(&db).len(), 1);
    }

    #[test]
    fn the_same_id_in_another_organisation_adds_nothing() {
        let dir = tmp("orgs");
        let (a, b) = (migrated(&dir, "a.db"), migrated(&dir, "b.db"));
        let src = Fake::default();
        *src.open.borrow_mut() = vec![rem("r1", "Call the printer", "")];
        *src.failing.borrow_mut() = vec!["r1".into()];
        import(&dir, "Inbox", &src, &into(&a)).unwrap();
        // The active organisation changed before the tick worked.
        src.failing.borrow_mut().clear();
        let out = import(&dir, "Inbox", &src, &into(&b)).unwrap();
        assert_eq!(out.added, 0);
        assert!(captures(&b).is_empty());
        assert_eq!(captures(&a).len(), 1);
        assert_eq!(*src.ticked.borrow(), vec!["r1"]);
    }

    #[test]
    fn a_pass_stops_when_the_organisation_changed_and_leaves_the_rest_unticked() {
        let dir = tmp("changed");
        let db = migrated(&dir, "a.db");
        let src = Fake::default();
        *src.open.borrow_mut() = vec![rem("r1", "One", ""), rem("r2", "Two", ""), rem("r3", "Three", "")];
        let calls = RefCell::new(0);
        let add = |text: &str, id: &str| {
            *calls.borrow_mut() += 1;
            // The second add finds another active organisation (or a mode).
            if *calls.borrow() == 2 { Add::OrgChanged } else { into(&db)(text, id) }
        };
        let out = import(&dir, "Inbox", &src, &add).unwrap();
        assert_eq!(out.added, 1);
        assert_eq!(*calls.borrow(), 2, "no add after the change");
        assert_eq!(*src.ticked.borrow(), vec!["r1"]);
        assert_eq!(captures(&db).len(), 1);
        // Next pass: r2 and r3 are still open and unseen.
        let out = import(&dir, "Inbox", &src, &into(&db)).unwrap();
        assert_eq!(out.added, 2);
    }

    #[test]
    fn a_reminder_that_cannot_be_added_is_skipped_and_the_pass_goes_on() {
        let dir = tmp("skip");
        let db = migrated(&dir, "a.db");
        let src = Fake::default();
        *src.open.borrow_mut() = vec![rem("r1", "One", ""), rem("r2", "Two", ""), rem("r3", "Three", "")];
        let add = |text: &str, id: &str| {
            if id == "r2" { Add::Failed("disk full".into()) } else { into(&db)(text, id) }
        };
        let out = import(&dir, "Inbox", &src, &add).unwrap();
        assert_eq!(out, Outcome { added: 2, error: None });
        assert_eq!(*src.ticked.borrow(), vec!["r1", "r3"]);
        // r2 stays open, not seen: it is read again next pass.
        assert_eq!(src.open.borrow().iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), vec!["r2"]);
        assert!(!read_seen(&dir).contains(&"r2".to_string()));
    }

    #[test]
    fn two_passes_never_overlap() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        struct Slow {
            now: AtomicUsize,
            max: AtomicUsize,
        }
        impl ReminderSource for Slow {
            fn open(&self, _l: &str) -> Result<Vec<Reminder>, RemindersError> {
                let n = self.now.fetch_add(1, Ordering::SeqCst) + 1;
                self.max.fetch_max(n, Ordering::SeqCst);
                std::thread::sleep(Duration::from_millis(150));
                self.now.fetch_sub(1, Ordering::SeqCst);
                Ok(vec![])
            }
            fn complete(&self, _l: &str, _i: &str) -> Result<(), RemindersError> {
                Ok(())
            }
        }
        let dir = tmp("overlap");
        let db = migrated(&dir, "studiomanager.db");
        let src = Slow { now: AtomicUsize::new(0), max: AtomicUsize::new(0) };
        let org = crate::ActiveOrg { id: "o".into(), dir: dir.clone(), db_name: "studiomanager.db".into() };
        std::thread::scope(|sc| {
            for _ in 0..2 {
                sc.spawn(|| pass(&dir, &org, "Inbox", &src, &into(&db)));
            }
        });
        assert_eq!(src.max.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_blank_reminder_is_left_alone() {
        let dir = tmp("blank");
        let db = migrated(&dir, "a.db");
        let src = Fake::default();
        *src.open.borrow_mut() = vec![rem("r1", " ", "")];
        assert_eq!(import(&dir, "Inbox", &src, &into(&db)).unwrap(), Outcome::default());
        assert!(src.ticked.borrow().is_empty());
    }

    #[test]
    fn the_seen_list_keeps_the_last_500_ids() {
        let dir = tmp("cap");
        let db = migrated(&dir, "a.db");
        let src = Fake::default();
        *src.open.borrow_mut() = (0..510).map(|i| rem(&format!("r{i}"), &format!("Thing {i}"), "")).collect();
        import(&dir, "Inbox", &src, &into(&db)).unwrap();
        let seen: Vec<String> = serde_json::from_str(&std::fs::read_to_string(dir.join(SEEN_FILE)).unwrap()).unwrap();
        assert_eq!(seen.len(), 500);
        assert_eq!(seen.last().unwrap(), "r509");
    }

    #[test]
    fn a_mode_reads_nothing_and_the_demo_is_never_asked() {
        let dir = tmp("mode");
        let src = Fake::default();
        *src.open.borrow_mut() = vec![rem("r1", "Call the printer", "")];
        let org = |db_name: &str| crate::ActiveOrg { id: "o".into(), dir: dir.clone(), db_name: db_name.into() };
        assert_eq!(pass(&dir, &org("studiomanager_test.db"), "Inbox", &src, &into(&dir.join("studiomanager_test.db"))), None);
        assert_eq!(*src.reads.borrow(), 0);
        migrated(&dir, "studiomanager.db");
        let out = pass(&dir, &org("studiomanager.db"), "Inbox", &src, &into(&dir.join("studiomanager.db"))).unwrap().unwrap();
        assert_eq!(out.added, 1);
        // The loop's first line, before any read of this Mac.
        let code = include_str!("reminders.rs");
        let check = &code[code.find("fn check(").unwrap()..];
        assert!(check.find("is_demo(").unwrap() < check.find("read_settings(").unwrap());
    }
}
