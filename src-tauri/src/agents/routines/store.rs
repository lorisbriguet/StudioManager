//! The routines the user set up (`routines.json`) and the last run of each (`routine-runs.json`).

use crate::agent_access::write_atomic;
use crate::agents::validate::{valid_model, valid_name, valid_task};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::RandomState;
use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

pub const ROUTINES_FILE: &str = "routines.json";
pub const RUNS_FILE: &str = "routine-runs.json";

#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct Routines {
    pub sections: Vec<Section>,
    pub routines: Vec<Routine>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Section {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub links: Vec<Link>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Link {
    pub label: String,
    /// An absolute path or an http(s) URL.
    pub target: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Routine {
    pub id: String,
    pub section_id: String,
    pub title: String,
    #[serde(default)]
    pub idle_hint: String,
    pub kind: RoutineKind,
    #[serde(default)]
    pub result_link: Option<String>,
    #[serde(default)]
    pub schedule: Option<Schedule>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RoutineKind {
    #[serde(rename_all = "camelCase")]
    Agent { folder: String, model: String, name: String, prompt: Prompt },
    #[serde(rename_all = "camelCase")]
    Command { program: String, args: Vec<String>, cwd: String },
}

/// The task of an agent routine: the text itself, or a file the agent reads at run time.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Prompt {
    Text(String),
    File(String),
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Schedule {
    /// `HH:MM`, 24 h.
    pub time: String,
    pub days: Days,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Days {
    Daily,
    Weekdays,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Running,
    Done,
    Failed,
}

/// The last run of a routine.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub routine_id: String,
    /// Epoch ms.
    pub started_at: i64,
    /// Epoch ms; None while running.
    #[serde(default)]
    pub finished_at: Option<i64>,
    pub status: Status,
    #[serde(default)]
    pub message: Option<String>,
    #[serde(default)]
    pub agent_short_id: Option<String>,
    /// `YYYY-MM-DD` of the scheduled run this was; None for a run started by hand.
    #[serde(default)]
    pub scheduled_for: Option<String>,
    /// The day of the routine's latest scheduled run, carried over when a run started by hand
    /// replaces this one (only the last run is kept, but a manual run mustn't erase it).
    #[serde(default)]
    pub last_scheduled_for: Option<String>,
}

impl Run {
    /// The day of the latest scheduled run up to and including this one.
    pub fn scheduled_day(&self) -> Option<&str> {
        self.scheduled_for.as_deref().or(self.last_scheduled_for.as_deref())
    }
}

/// The task handed to the agent. A prompt file stays a short task, so the 8000-character
/// limit never applies to its content.
pub fn task_text(p: &Prompt) -> String {
    match p {
        Prompt::Text(t) => t.clone(),
        Prompt::File(path) => format!("Read and follow the instructions in {path}."),
    }
}

/// An absolute path without `..`.
fn absolute(p: &str) -> bool {
    p.starts_with('/')
        && !p.chars().any(char::is_control)
        && !Path::new(p).components().any(|c| c == std::path::Component::ParentDir)
}

/// What a link may open: an absolute path or an http(s) URL.
pub fn link_target(t: &str) -> bool {
    absolute(t)
        || ((t.starts_with("https://") || t.starts_with("http://"))
            && !t.chars().any(char::is_control))
}

/// `HH:MM`, 00:00-23:59.
fn valid_time(t: &str) -> bool {
    let Some((h, m)) = t.split_once(':') else { return false };
    let two_digits = |x: &str| x.len() == 2 && x.bytes().all(|c| c.is_ascii_digit());
    two_digits(h)
        && two_digits(m)
        && h.parse::<u8>().is_ok_and(|h| h < 24)
        && m.parse::<u8>().is_ok_and(|m| m < 60)
}

fn text(field: &str, v: &str, min: usize, max: usize) -> Result<(), String> {
    let n = v.trim().chars().count();
    if n < min || v.chars().count() > max || v.chars().any(char::is_control) {
        return Err(format!("{field} must be {min}-{max} characters"));
    }
    Ok(())
}

/// The fields of one routine. Whether an agent's folder is trusted is checked when it runs.
pub fn validate(r: &Routine) -> Result<(), String> {
    text("Title", &r.title, 1, 100)?;
    text("Idle hint", &r.idle_hint, 0, 200)?;
    if r.result_link.as_deref().is_some_and(|l| !link_target(l)) {
        return Err("Result link must be an absolute path or an http(s) URL".into());
    }
    if r.schedule.as_ref().is_some_and(|s| !valid_time(&s.time)) {
        return Err("Schedule time must be HH:MM".into());
    }
    match &r.kind {
        RoutineKind::Agent { folder, model, name, prompt } => {
            if !absolute(folder) {
                return Err("Folder must be an absolute path".into());
            }
            if !valid_model(model) {
                return Err("Unknown model".into());
            }
            if !valid_name(name) {
                return Err("Invalid agent name".into());
            }
            match prompt {
                Prompt::Text(t) if t.trim().is_empty() || !valid_task(t) => {
                    Err("Prompt must be 1-8000 characters and not start with \"-\"".into())
                }
                Prompt::File(f) if !absolute(f) || !valid_task(&task_text(prompt)) => {
                    Err("Prompt file must be an absolute path".into())
                }
                _ => Ok(()),
            }
        }
        RoutineKind::Command { program, args, cwd } => {
            if !absolute(program) {
                return Err("Program must be an absolute path".into());
            }
            if !Path::new(program).is_file() {
                return Err(format!("Program not found: {program}"));
            }
            if !absolute(cwd) {
                return Err("Folder must be an absolute path".into());
            }
            if args.iter().any(|a| a.contains('\0')) {
                return Err("Invalid argument".into());
            }
            Ok(())
        }
    }
}

/// A saved id: `[A-Za-z0-9_-]{1,64}`.
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))
}

/// 12 random lowercase letters and digits.
fn new_id() -> String {
    use std::hash::{BuildHasher, Hasher};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let mut h = RandomState::new().build_hasher();
    h.write_u128(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0),
    );
    h.write_u64(COUNTER.fetch_add(1, Ordering::Relaxed));
    let mut n = h.finish();
    (0..12)
        .map(|_| {
            let c = b"abcdefghijklmnopqrstuvwxyz0123456789"[(n % 36) as usize] as char;
            n /= 36;
            c
        })
        .collect()
}

/// Gives a new item (id "") an id; refuses a malformed or repeated one.
fn assign_id(id: &mut String, seen: &mut HashSet<String>) -> Result<(), String> {
    if id.is_empty() {
        *id = new_id();
    } else if !valid_id(id) {
        return Err("Invalid id".into());
    }
    if !seen.insert(id.clone()) {
        return Err("Duplicate id".into());
    }
    Ok(())
}

pub fn read_routines(dir: &Path) -> Routines {
    std::fs::read_to_string(dir.join(ROUTINES_FILE))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_json<T: Serialize>(dir: &Path, file: &str, v: &T) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    let json = serde_json::to_string_pretty(v).map_err(|e| e.to_string())?;
    write_atomic(&dir.join(file), &format!("{json}\n"))
}

/// Validates everything, gives new sections and routines (id "") an id, and writes the file.
pub fn save_routines(dir: &Path, mut all: Routines) -> Result<Routines, String> {
    let mut seen = HashSet::new();
    for s in &mut all.sections {
        assign_id(&mut s.id, &mut seen)?;
        text("Section name", &s.name, 1, 64)?;
        for l in &s.links {
            text("Link label", &l.label, 1, 64)?;
            if !link_target(&l.target) {
                return Err("A link must be an absolute path or an http(s) URL".into());
            }
        }
    }
    let sections: HashSet<&str> = all.sections.iter().map(|s| s.id.as_str()).collect();
    for r in &mut all.routines {
        assign_id(&mut r.id, &mut seen)?;
        if !sections.contains(r.section_id.as_str()) {
            return Err(format!("\"{}\": unknown section", r.title));
        }
        validate(r).map_err(|e| format!("\"{}\": {e}", r.title))?;
    }
    write_json(dir, ROUTINES_FILE, &all)?;
    Ok(all)
}

/// A saved routine by its id.
pub fn find<'a>(all: &'a Routines, id: &str) -> Result<&'a Routine, String> {
    all.routines
        .iter()
        .find(|r| !id.is_empty() && r.id == id)
        .ok_or_else(|| "Unknown routine".to_string())
}

pub fn read_runs(dir: &Path) -> Vec<Run> {
    std::fs::read_to_string(dir.join(RUNS_FILE))
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// Serialises saving `routines.json` together with the pruning of the runs of deleted routines.
pub static SAVE_LOCK: Mutex<()> = Mutex::new(());

/// Serialises every read-modify-write of `routine-runs.json`.
static RUNS_LOCK: Mutex<()> = Mutex::new(());

/// Applies `f` to the runs and writes them back.
pub fn update_runs(dir: &Path, f: impl FnOnce(&mut Vec<Run>)) -> Result<(), String> {
    let _held = RUNS_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut runs = read_runs(dir);
    f(&mut runs);
    write_json(dir, RUNS_FILE, &runs)
}

/// Records `run` as the last run of its routine.
pub fn record_run(dir: &Path, run: &Run) -> Result<(), String> {
    update_runs(dir, |runs| {
        let mut run = run.clone();
        if run.scheduled_for.is_none() {
            if let Some(old) = runs.iter().find(|r| r.routine_id == run.routine_id) {
                run.last_scheduled_for = old.scheduled_day().map(String::from);
            }
        }
        runs.retain(|r| r.routine_id != run.routine_id);
        runs.push(run);
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("sm-routines-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn command(program: &str, cwd: &str) -> Routine {
        Routine {
            id: String::new(),
            section_id: "s1".into(),
            title: "Hours".into(),
            idle_hint: String::new(),
            kind: RoutineKind::Command { program: program.into(), args: vec![], cwd: cwd.into() },
            result_link: None,
            schedule: None,
        }
    }

    fn section() -> Section {
        Section { id: "s1".into(), name: "Personal".into(), links: vec![] }
    }

    #[test]
    fn prompt_file_becomes_short_task() {
        let long = "x".repeat(20_000);
        assert_eq!(task_text(&Prompt::Text("do it".into())), "do it");
        assert_eq!(task_text(&Prompt::Text(long.clone())), long);
        let t = task_text(&Prompt::File("/Users/me/briefs/morning.md".into()));
        assert_eq!(t, "Read and follow the instructions in /Users/me/briefs/morning.md.");
        assert!(valid_task(&t));
    }

    #[test]
    fn save_rejects_relative_program() {
        let dir = tmp("relative");
        let all = |r: Routine| Routines { sections: vec![section()], routines: vec![r] };
        let err = save_routines(&dir, all(command("sh", "/tmp"))).unwrap_err();
        assert!(err.contains("absolute"), "{err}");
        assert!(save_routines(&dir, all(command("/bin/../bin/sh", "/tmp"))).is_err());
        assert!(save_routines(&dir, all(command("/no/such/program", "/tmp"))).is_err());
        assert!(save_routines(&dir, all(command("/bin/echo", "tmp"))).is_err());
        assert!(!dir.join(ROUTINES_FILE).exists());

        let saved = save_routines(&dir, all(command("/bin/echo", "/tmp"))).unwrap();
        let id = &saved.routines[0].id;
        assert!(!id.is_empty());
        assert_eq!(read_routines(&dir), saved);
        // An existing id is kept.
        let again = save_routines(&dir, saved.clone()).unwrap();
        assert_eq!(&again.routines[0].id, id);
    }

    #[test]
    fn validate_agent_and_shared_fields() {
        let agent = |model: &str, name: &str, prompt: Prompt| Routine {
            kind: RoutineKind::Agent {
                folder: "/work/proj".into(),
                model: model.into(),
                name: name.into(),
                prompt,
            },
            ..command("/bin/echo", "/tmp")
        };
        assert!(validate(&agent("opus", "brief", Prompt::Text("go".into()))).is_ok());
        assert!(validate(&agent("gpt", "brief", Prompt::Text("go".into()))).is_err());
        assert!(validate(&agent("opus", "-x", Prompt::Text("go".into()))).is_err());
        assert!(validate(&agent("opus", "brief", Prompt::Text("-go".into()))).is_err());
        assert!(validate(&agent("opus", "brief", Prompt::File("rel.md".into()))).is_err());
        // Control characters never get into a path, link or task.
        assert!(validate(&agent("opus", "brief", Prompt::File("/w/a\nb.md".into()))).is_err());
        assert!(validate(&agent("opus", "brief", Prompt::File("/w/ok.md".into()))).is_ok());
        let mut c = command("/bin/echo", "/tmp");
        c.result_link = Some("https://example.com/a\nb".into());
        assert!(validate(&c).is_err());
        c.result_link = Some("/tmp/a\tb".into());
        assert!(validate(&c).is_err());
        let mut r = command("/bin/echo", "/tmp");
        r.result_link = Some("javascript:alert(1)".into());
        assert!(validate(&r).is_err());
        r.result_link = Some("https://example.com/brief".into());
        assert!(validate(&r).is_ok());
        r.schedule = Some(Schedule { time: "24:00".into(), days: Days::Daily });
        assert!(validate(&r).is_err());
        r.schedule = Some(Schedule { time: "08:00".into(), days: Days::Weekdays });
        assert!(validate(&r).is_ok());
    }

    #[test]
    fn save_checks_sections() {
        let dir = tmp("sections");
        let mut r = command("/bin/echo", "/tmp");
        r.section_id = "missing".into();
        let all = Routines { sections: vec![section()], routines: vec![r] };
        assert!(save_routines(&dir, all).is_err());
        let bad_link = Section {
            links: vec![Link { label: "x".into(), target: "file:///etc".into() }],
            ..section()
        };
        assert!(save_routines(&dir, Routines { sections: vec![bad_link], routines: vec![] }).is_err());
        let ctrl_link = Section {
            links: vec![Link { label: "x".into(), target: "https://a.example/\r\nx".into() }],
            ..section()
        };
        assert!(save_routines(&dir, Routines { sections: vec![ctrl_link], routines: vec![] }).is_err());
        let new = Section { id: String::new(), ..section() };
        let saved = save_routines(&dir, Routines { sections: vec![new], routines: vec![] }).unwrap();
        assert!(!saved.sections[0].id.is_empty());
    }

    #[test]
    fn record_run_keeps_last_per_routine() {
        let dir = tmp("runs");
        let run = |id: &str, at: i64| Run {
            routine_id: id.into(),
            started_at: at,
            finished_at: None,
            status: Status::Running,
            message: None,
            agent_short_id: None,
            scheduled_for: None,
            last_scheduled_for: None,
        };
        record_run(&dir, &run("a", 1)).unwrap();
        record_run(&dir, &run("b", 2)).unwrap();
        record_run(&dir, &run("a", 3)).unwrap();
        let runs = read_runs(&dir);
        assert_eq!(runs.len(), 2);
        assert_eq!(runs.iter().find(|r| r.routine_id == "a").unwrap().started_at, 3);
    }

    #[test]
    fn json_shape() {
        let r = Routine {
            kind: RoutineKind::Agent {
                folder: "/w".into(),
                model: "opus".into(),
                name: "n".into(),
                prompt: Prompt::File("/w/p.md".into()),
            },
            schedule: Some(Schedule { time: "08:00".into(), days: Days::Weekdays }),
            ..command("/bin/echo", "/tmp")
        };
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["sectionId"], "s1");
        assert_eq!(v["kind"]["kind"], "agent");
        assert_eq!(v["kind"]["prompt"]["file"], "/w/p.md");
        assert_eq!(v["schedule"]["days"], "weekdays");
    }
}
