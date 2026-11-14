//! A hub's settings (`hubs.json` in the app data folder) and the Keychain approval of its
//! connector. The file can be written by the webview, so a connector runs only while the
//! fingerprint of its program, arguments and folder is in the Keychain, as for routine commands.

use crate::connectors::keychain::SecretStore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashSet};
use std::hash::{BuildHasher, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const HUBS_FILE: &str = "hubs.json";
pub const MAX_HUBS: usize = 5;
pub const NAME_CHARS: usize = 40;
pub const MAX_ARGS: usize = 8;
pub const ARG_CHARS: usize = 300;
/// Keychain account (no colon: a connection account is always `<org>:<id>`).
pub const KEYCHAIN_ACCOUNT: &str = "hub-connectors";
/// The names of `TAG_COLOR_NAMES` in `src/lib/tagColors.ts`.
pub const COLOURS: [&str; 9] = ["blue", "purple", "green", "red", "yellow", "cyan", "orange", "teal", "gray"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Hub {
    pub id: String,
    pub name: String,
    pub colour: String,
    pub folder: String,
    pub program: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HubsFile {
    pub hubs: Vec<Hub>,
}

/// What the webview sends to add or change a hub; `id` is None for a new hub.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HubInput {
    pub id: Option<String>,
    pub name: String,
    pub colour: String,
    pub folder: String,
    pub program: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HubsRead {
    Absent,
    Hubs(Vec<Hub>),
    Unreadable(String),
}

/// The hubs; in the demo nothing is read.
pub fn read_hubs(app_dir: &Path, demo: bool) -> HubsRead {
    if demo {
        return HubsRead::Absent;
    }
    let path = app_dir.join(HUBS_FILE);
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return HubsRead::Absent,
        Err(e) => return HubsRead::Unreadable(format!("Could not read {HUBS_FILE}: {e}")),
    };
    match serde_json::from_str::<HubsFile>(&text) {
        Ok(f) => HubsRead::Hubs(f.hubs),
        Err(e) => HubsRead::Unreadable(format!("{HUBS_FILE} is not valid: {e}")),
    }
}

static WRITE_LOCK: Mutex<()> = Mutex::new(());

pub fn write_hubs(app_dir: &Path, hubs: &[Hub]) -> Result<(), String> {
    let _lock = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let text = serde_json::to_string_pretty(&HubsFile { hubs: hubs.to_vec() }).map_err(|e| e.to_string())?;
    crate::agent_access::write_atomic(&app_dir.join(HUBS_FILE), &text)
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from).and_then(|h| h.canonicalize().ok())
}

/// A new id: `h` and 8 hex characters.
fn new_id() -> String {
    let n = std::collections::hash_map::RandomState::new().build_hasher().finish();
    format!("h{:08x}", n as u32)
}

/// Checks `input` against the rules and builds the hub to store. `existing` is every hub saved
/// now; an input with an `id` of a saved hub replaces that hub.
pub fn validate(input: HubInput, existing: &[Hub]) -> Result<Hub, String> {
    let name = input.name.trim().to_string();
    let len = name.chars().count();
    if len == 0 || len > NAME_CHARS {
        return Err(format!("The name takes 1 to {NAME_CHARS} characters."));
    }
    if name.chars().any(char::is_control) {
        return Err("The name has a control character.".into());
    }
    let editing = input.id.as_deref().filter(|id| existing.iter().any(|h| h.id == *id));
    if existing.iter().any(|h| Some(h.id.as_str()) != editing && h.name.to_lowercase() == name.to_lowercase()) {
        return Err("Another hub has this name.".into());
    }
    if !COLOURS.contains(&input.colour.as_str()) {
        return Err("Unknown colour.".into());
    }
    if editing.is_none() && existing.len() >= MAX_HUBS {
        return Err(format!("At most {MAX_HUBS} hubs."));
    }
    let folder = {
        let p = Path::new(&input.folder);
        if !p.is_absolute() || !p.is_dir() {
            return Err("The folder must be an existing folder (absolute path).".into());
        }
        p.canonicalize().map_err(|e| format!("The folder cannot be read: {e}"))?
    };
    // The home folder and every folder that contains it are too wide (they hold every project).
    if folder == Path::new("/") || home().is_some_and(|h| h.starts_with(&folder)) {
        return Err("The folder cannot be the root, the home folder or a folder that contains it.".into());
    }
    let program = Path::new(&input.program);
    if !program.is_absolute() || !program.is_file() {
        return Err("The program must be an existing file (absolute path).".into());
    }
    if input.args.len() > MAX_ARGS {
        return Err(format!("At most {MAX_ARGS} arguments."));
    }
    for a in &input.args {
        if a.chars().count() > ARG_CHARS || a.contains('\0') || a.contains('\n') || a.contains('\r') {
            return Err(format!("An argument is over {ARG_CHARS} characters or has a line break."));
        }
    }
    let id = match editing {
        Some(id) => id.to_string(),
        None => loop {
            let id = new_id();
            if !existing.iter().any(|h| h.id == id) {
                break id;
            }
        },
    };
    Ok(Hub {
        id,
        name,
        colour: input.colour,
        folder: folder.to_string_lossy().into_owned(),
        program: input.program,
        args: input.args,
    })
}

/// SHA-256 of the JSON of `(program, args, folder)`; JSON keeps the arguments' boundaries.
pub fn fingerprint(h: &Hub) -> String {
    let canonical = serde_json::to_string(&(&h.program, &h.args, &h.folder)).unwrap_or_default();
    Sha256::digest(canonical.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

fn load(store: &dyn SecretStore) -> Result<HashSet<String>, String> {
    let v = store.get(KEYCHAIN_ACCOUNT)?;
    Ok(v.unwrap_or_default().lines().filter(|l| !l.is_empty()).map(String::from).collect())
}

fn save(store: &dyn SecretStore, set: &HashSet<String>) -> Result<(), String> {
    let sorted: BTreeSet<&str> = set.iter().map(String::as_str).collect();
    store.set(KEYCHAIN_ACCOUNT, &sorted.into_iter().collect::<Vec<_>>().join("\n"))
}

/// Whether the hub's connector was allowed as it is now; an unreadable Keychain approves nothing.
pub fn approved(store: &dyn SecretStore, h: &Hub) -> bool {
    match load(store) {
        Ok(set) => set.contains(&fingerprint(h)),
        Err(e) => {
            log::warn!("[hubs] allowed connectors unreadable: {e}");
            false
        }
    }
}

pub fn allow(store: &dyn SecretStore, h: &Hub) -> Result<(), String> {
    let mut set = load(store)?;
    set.insert(fingerprint(h));
    save(store, &set)
}

pub fn forget(store: &dyn SecretStore, h: &Hub) -> Result<(), String> {
    let mut set = load(store)?;
    if set.remove(&fingerprint(h)) {
        save(store, &set)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::connectors::keychain::MemoryStore;

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sm-hubset-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn input(dir: &Path) -> HubInput {
        HubInput {
            id: None,
            name: "Demo hub".into(),
            colour: "purple".into(),
            folder: dir.display().to_string(),
            program: "/bin/sh".into(),
            args: vec!["connector.sh".into()],
        }
    }

    fn hub(dir: &Path) -> Hub {
        validate(input(dir), &[]).unwrap()
    }

    fn store() -> MemoryStore {
        MemoryStore(Default::default())
    }

    #[test]
    fn a_valid_input_makes_a_hub() {
        let dir = tmp("valid");
        let h = hub(&dir);
        assert_eq!(h.folder, dir.canonicalize().unwrap().to_string_lossy());
        assert!(h.id.len() == 9 && h.id.starts_with('h') && h.id[1..].chars().all(|c| c.is_ascii_hexdigit()), "{}", h.id);
    }

    #[test]
    fn validate_refuses_each_rule() {
        let dir = tmp("rules");
        let ok = || input(&dir);
        let refused = |i: HubInput| assert!(validate(i, &[]).is_err());
        refused(HubInput { name: "".into(), ..ok() });
        refused(HubInput { name: "   ".into(), ..ok() });
        refused(HubInput { name: "x".repeat(41), ..ok() });
        refused(HubInput { name: "a\u{7}b".into(), ..ok() });
        assert!(validate(HubInput { name: "x".repeat(40), ..ok() }, &[]).is_ok());
        refused(HubInput { colour: "pink".into(), ..ok() });
        refused(HubInput { folder: "relative".into(), ..ok() });
        refused(HubInput { folder: dir.join("nope").display().to_string(), ..ok() });
        refused(HubInput { folder: "/bin/sh".into(), ..ok() });
        refused(HubInput { folder: "/".into(), ..ok() });
        refused(HubInput { program: "sh".into(), ..ok() });
        refused(HubInput { program: dir.join("nope").display().to_string(), ..ok() });
        refused(HubInput { program: dir.display().to_string(), ..ok() });
        refused(HubInput { args: vec!["a".into(); 9], ..ok() });
        refused(HubInput { args: vec!["x".repeat(301)], ..ok() });
        refused(HubInput { args: vec!["a\nb".into()], ..ok() });
        refused(HubInput { args: vec!["a\0b".into()], ..ok() });
        assert!(validate(HubInput { args: vec!["x".repeat(300); 8], ..ok() }, &[]).is_ok());
    }

    #[test]
    fn the_home_folder_is_refused() {
        if let Some(h) = home() {
            let i = HubInput { folder: h.display().to_string(), ..input(&tmp("home")) };
            assert!(validate(i, &[]).is_err());
        }
    }

    #[test]
    fn a_folder_that_contains_the_home_folder_is_refused() {
        if let Some(h) = home() {
            for anc in h.ancestors().filter(|a| a.is_dir()) {
                let i = HubInput { folder: anc.display().to_string(), ..input(&tmp("ancestor")) };
                assert!(validate(i, &[]).is_err(), "{}", anc.display());
            }
        }
    }

    #[test]
    fn names_are_unique_and_an_edit_keeps_its_id() {
        let dir = tmp("unique");
        let a = hub(&dir);
        assert!(validate(input(&dir), std::slice::from_ref(&a)).is_err());
        let edit = HubInput { id: Some(a.id.clone()), colour: "teal".into(), ..input(&dir) };
        let b = validate(edit, std::slice::from_ref(&a)).unwrap();
        assert_eq!((b.id.as_str(), b.colour.as_str()), (a.id.as_str(), "teal"));
    }

    #[test]
    fn at_most_five_hubs() {
        let dir = tmp("five");
        let mut all: Vec<Hub> = vec![];
        for n in 0..5 {
            let h = validate(HubInput { name: format!("Hub {n}"), ..input(&dir) }, &all).unwrap();
            all.push(h);
        }
        assert!(validate(HubInput { name: "Hub 6".into(), ..input(&dir) }, &all).is_err());
        // Changing one of the five is still fine.
        let edit = HubInput { id: Some(all[0].id.clone()), name: "Hub 0".into(), ..input(&dir) };
        assert!(validate(edit, &all).is_ok());
    }

    #[test]
    fn colours_match_the_tag_colours() {
        let ts = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../src/lib/tagColors.ts")).unwrap();
        let line = ts.lines().find(|l| l.contains("export const TAG_COLOR_NAMES")).unwrap();
        let list = &line[line.find("= [").unwrap() + 3..line.rfind(']').unwrap()];
        let names: Vec<&str> = list.split(',').map(|s| s.trim().trim_matches('"')).collect();
        assert_eq!(names, COLOURS);
    }

    #[test]
    fn fingerprint_keeps_argument_boundaries() {
        let dir = tmp("finger");
        let a = Hub { args: vec!["a b".into()], ..hub(&dir) };
        let b = Hub { args: vec!["a".into(), "b".into()], ..a.clone() };
        assert_ne!(fingerprint(&a), fingerprint(&b));
        assert_eq!(fingerprint(&a), fingerprint(&a.clone()));
    }

    #[test]
    fn allow_approves_and_forget_removes() {
        let dir = tmp("allow");
        let store = store();
        let h = hub(&dir);
        assert!(!approved(&store, &h));
        allow(&store, &h).unwrap();
        assert!(approved(&store, &h));
        forget(&store, &h).unwrap();
        assert!(!approved(&store, &h));
    }

    #[test]
    fn edited_file_does_not_run() {
        let dir = tmp("edited");
        let store = store();
        let h = hub(&dir);
        allow(&store, &h).unwrap();
        write_hubs(&dir, std::slice::from_ref(&h)).unwrap();
        let text = std::fs::read_to_string(dir.join(HUBS_FILE)).unwrap().replace("/bin/sh", "/bin/bash");
        std::fs::write(dir.join(HUBS_FILE), text).unwrap();
        let HubsRead::Hubs(read) = read_hubs(&dir, false) else { panic!("not read") };
        assert_eq!(read[0].program, "/bin/bash");
        assert!(!approved(&store, &read[0]));
    }

    struct Broken;
    impl SecretStore for Broken {
        fn get(&self, _: &str) -> Result<Option<String>, String> {
            Err("locked".into())
        }
        fn set(&self, _: &str, _: &str) -> Result<(), String> {
            Err("locked".into())
        }
        fn delete(&self, _: &str) -> Result<(), String> {
            Err("locked".into())
        }
    }

    #[test]
    fn unreadable_keychain_approves_nothing() {
        let dir = tmp("broken");
        let h = hub(&dir);
        allow(&store(), &h).unwrap();
        assert!(!approved(&Broken, &h));
        assert!(allow(&Broken, &h).is_err());
    }

    #[test]
    fn read_hubs_in_demo_reads_nothing() {
        let dir = tmp("demo");
        std::fs::write(dir.join(HUBS_FILE), "not json").unwrap();
        assert_eq!(read_hubs(&dir, true), HubsRead::Absent);
    }

    #[test]
    fn garbled_file_is_unreadable_and_a_missing_one_is_absent() {
        let dir = tmp("garbled");
        assert_eq!(read_hubs(&dir, false), HubsRead::Absent);
        std::fs::write(dir.join(HUBS_FILE), "not json").unwrap();
        assert!(matches!(read_hubs(&dir, false), HubsRead::Unreadable(_)));
        std::fs::write(dir.join(HUBS_FILE), r#"{"hubs":[{"id":"h1","extra":1}]}"#).unwrap();
        assert!(matches!(read_hubs(&dir, false), HubsRead::Unreadable(_)));
    }

    #[test]
    fn written_hubs_read_back() {
        let dir = tmp("roundtrip");
        let h = hub(&dir);
        write_hubs(&dir, std::slice::from_ref(&h)).unwrap();
        assert_eq!(read_hubs(&dir, false), HubsRead::Hubs(vec![h]));
    }
}
