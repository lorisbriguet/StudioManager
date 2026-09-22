//! Organisation registry: `organisations.json` in the app data folder plus
//! one folder per organisation under `orgs/<id>/`. Pure functions over
//! `&Path` so they are unit-testable without a Tauri app handle.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const REGISTRY_FILE: &str = "organisations.json";
pub const ORGS_DIR: &str = "orgs";
pub const DB_FILE: &str = "studiomanager.db";
pub const REGISTRY_VERSION: u32 = 1;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OrgPrefs {
    pub show_income: bool,
    pub show_tasks_page: bool,
    pub show_time_overview: bool,
    pub calendar_sync: bool,
    pub calendar_name: String,
    pub backup_path: String,
    pub export_language: String,
}

impl Default for OrgPrefs {
    fn default() -> Self {
        Self {
            show_income: true,
            show_tasks_page: true,
            show_time_overview: true,
            calendar_sync: false,
            calendar_name: "StudioManager".to_string(),
            backup_path: String::new(),
            export_language: "FR".to_string(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Organisation {
    pub id: String,
    pub name: String,
    pub created_at: String,
    /// `None` only for the organisation created by the layout upgrade: the
    /// frontend fills it from localStorage on its first load.
    pub prefs: Option<OrgPrefs>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Registry {
    pub version: u32,
    pub active_id: String,
    pub organisations: Vec<Organisation>,
}

pub fn org_dir(app_dir: &Path, id: &str) -> PathBuf {
    app_dir.join(ORGS_DIR).join(id)
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Six lowercase base-36 characters from a time/counter hash. Uniqueness
/// against existing ids is enforced by `Registry::add`.
pub fn new_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut x = nanos ^ (n.wrapping_mul(0x9E37_79B9_7F4A_7C15)) ^ (std::process::id() as u64) << 32;
    // xorshift mix
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    const ALPHABET: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    (0..6)
        .map(|_| {
            let c = ALPHABET[(x % 36) as usize] as char;
            x /= 36;
            c
        })
        .collect()
}

fn normalize_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("organisation name is required".to_string());
    }
    Ok(trimmed.to_string())
}

impl Registry {
    pub fn empty() -> Self {
        Self { version: REGISTRY_VERSION, active_id: String::new(), organisations: Vec::new() }
    }

    pub fn load(app_dir: &Path) -> Result<Option<Registry>, String> {
        let path = app_dir.join(REGISTRY_FILE);
        if !path.exists() {
            return Ok(None);
        }
        let raw = std::fs::read_to_string(&path).map_err(|e| format!("read registry: {e}"))?;
        let reg: Registry = serde_json::from_str(&raw).map_err(|e| format!("parse registry: {e}"))?;
        Ok(Some(reg))
    }

    /// Whole-file atomic write: serialize to `organisations.json.tmp`, then rename.
    pub fn save(&self, app_dir: &Path) -> Result<(), String> {
        std::fs::create_dir_all(app_dir).map_err(|e| format!("create app dir: {e}"))?;
        let path = app_dir.join(REGISTRY_FILE);
        let tmp = app_dir.join(format!("{REGISTRY_FILE}.tmp"));
        let json = serde_json::to_string_pretty(self).map_err(|e| format!("serialize registry: {e}"))?;
        std::fs::write(&tmp, json).map_err(|e| format!("write registry: {e}"))?;
        std::fs::rename(&tmp, &path).map_err(|e| format!("commit registry: {e}"))?;
        Ok(())
    }

    pub fn find(&self, id: &str) -> Option<&Organisation> {
        self.organisations.iter().find(|o| o.id == id)
    }

    fn find_mut(&mut self, id: &str) -> Result<&mut Organisation, String> {
        self.organisations
            .iter_mut()
            .find(|o| o.id == id)
            .ok_or_else(|| format!("unknown organisation: {id}"))
    }

    pub fn active(&self) -> Option<&Organisation> {
        self.find(&self.active_id)
    }

    fn name_taken(&self, name: &str, except_id: Option<&str>) -> bool {
        self.organisations
            .iter()
            .any(|o| Some(o.id.as_str()) != except_id && o.name.eq_ignore_ascii_case(name))
    }

    pub fn add(&mut self, name: &str, prefs: Option<OrgPrefs>) -> Result<&Organisation, String> {
        let name = normalize_name(name)?;
        if self.name_taken(&name, None) {
            return Err(format!("an organisation named \"{name}\" already exists"));
        }
        let mut id = new_id();
        while self.find(&id).is_some() {
            id = new_id();
        }
        self.organisations.push(Organisation { id, name, created_at: now_iso(), prefs });
        Ok(self.organisations.last().expect("just pushed"))
    }

    pub fn rename(&mut self, id: &str, name: &str) -> Result<(), String> {
        let name = normalize_name(name)?;
        if self.name_taken(&name, Some(id)) {
            return Err(format!("an organisation named \"{name}\" already exists"));
        }
        self.find_mut(id)?.name = name;
        Ok(())
    }

    pub fn reorder(&mut self, ids: &[String]) -> Result<(), String> {
        if ids.len() != self.organisations.len() || ids.iter().any(|id| self.find(id).is_none()) {
            return Err("reorder must list every organisation exactly once".to_string());
        }
        let mut seen = std::collections::HashSet::new();
        if !ids.iter().all(|id| seen.insert(id)) {
            return Err("reorder must list every organisation exactly once".to_string());
        }
        let mut reordered = Vec::with_capacity(ids.len());
        for id in ids {
            let idx = self.organisations.iter().position(|o| &o.id == id).expect("checked");
            reordered.push(self.organisations.remove(idx));
        }
        self.organisations = reordered;
        Ok(())
    }

    /// Refuses the active organisation and the last remaining one.
    pub fn remove(&mut self, id: &str) -> Result<Organisation, String> {
        if id == self.active_id {
            return Err("switch to another organisation before deleting this one".to_string());
        }
        if self.organisations.len() <= 1 {
            return Err("the last organisation cannot be deleted".to_string());
        }
        let idx = self
            .organisations
            .iter()
            .position(|o| o.id == id)
            .ok_or_else(|| format!("unknown organisation: {id}"))?;
        Ok(self.organisations.remove(idx))
    }

    pub fn set_active(&mut self, id: &str) -> Result<(), String> {
        self.find(id).ok_or_else(|| format!("unknown organisation: {id}"))?;
        self.active_id = id.to_string();
        Ok(())
    }

    pub fn set_prefs(&mut self, id: &str, prefs: OrgPrefs) -> Result<(), String> {
        self.find_mut(id)?.prefs = Some(prefs);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("sm-orgs-{nanos}-{name}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn load_returns_none_when_no_registry() {
        let dir = temp_dir("none");
        assert_eq!(Registry::load(&dir).unwrap(), None);
    }

    #[test]
    fn save_then_load_round_trips_and_writes_atomically() {
        let dir = temp_dir("rt");
        let mut reg = Registry::empty();
        let id = reg.add("Studio", Some(OrgPrefs::default())).unwrap().id.clone();
        reg.set_active(&id).unwrap();
        reg.save(&dir).unwrap();
        assert!(dir.join(REGISTRY_FILE).exists());
        assert!(!dir.join(format!("{REGISTRY_FILE}.tmp")).exists());
        assert_eq!(Registry::load(&dir).unwrap().unwrap(), reg);
    }

    #[test]
    fn ids_are_six_base36_chars_and_unique() {
        let mut reg = Registry::empty();
        let a = reg.add("A", None).unwrap().id.clone();
        let b = reg.add("B", None).unwrap().id.clone();
        assert_ne!(a, b);
        for id in [&a, &b] {
            assert_eq!(id.len(), 6);
            assert!(id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()));
        }
    }

    #[test]
    fn add_rejects_blank_and_duplicate_names_case_insensitively() {
        let mut reg = Registry::empty();
        reg.add("Studio", None).unwrap();
        assert!(reg.add("  ", None).is_err());
        assert!(reg.add("studio", None).is_err());
    }

    #[test]
    fn remove_refuses_active_and_last() {
        let mut reg = Registry::empty();
        let a = reg.add("A", None).unwrap().id.clone();
        reg.set_active(&a).unwrap();
        assert!(reg.remove(&a).is_err(), "active");
        let b = reg.add("B", None).unwrap().id.clone();
        assert!(reg.remove(&b).is_ok());
        assert!(reg.remove(&a).is_err(), "last remaining");
    }

    #[test]
    fn reorder_requires_the_exact_id_set() {
        let mut reg = Registry::empty();
        let a = reg.add("A", None).unwrap().id.clone();
        let b = reg.add("B", None).unwrap().id.clone();
        assert!(reg.reorder(&[b.clone(), a.clone()]).is_ok());
        assert_eq!(reg.organisations[0].id, b);
        assert!(reg.reorder(std::slice::from_ref(&a)).is_err());
        assert!(reg.reorder(&[a, b, "zzzzzz".into()]).is_err());
    }

    #[test]
    fn set_prefs_and_rename_update_the_right_organisation() {
        let mut reg = Registry::empty();
        let a = reg.add("A", None).unwrap().id.clone();
        let prefs = OrgPrefs { show_income: false, ..OrgPrefs::default() };
        reg.set_prefs(&a, prefs.clone()).unwrap();
        reg.rename(&a, "  Atelier ").unwrap();
        let org = reg.find(&a).unwrap();
        assert_eq!(org.name, "Atelier");
        assert_eq!(org.prefs, Some(prefs));
        assert!(reg.rename("nope", "X").is_err());
    }

    #[test]
    fn org_dir_is_under_orgs() {
        let dir = temp_dir("dir");
        assert_eq!(org_dir(&dir, "abc123"), dir.join(ORGS_DIR).join("abc123"));
    }
}
