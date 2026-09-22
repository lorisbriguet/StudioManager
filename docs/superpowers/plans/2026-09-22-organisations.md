# Organisations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one StudioManager install hold several fully separate businesses ("organisations"), switched in place from the sidebar, with the user's existing data migrated safely into the first one.

**Architecture:** One folder per organisation under the app data directory (`orgs/<id>/` holding the database and the invoice/receipt folders), described by a Rust-owned `organisations.json` registry. Rust keeps an `ActiveOrg` state that every path-building command reads; a Rust migration runner gives any database file the schema. The frontend gets an organisation store that resolves the active database URL and document folders, a switch sequence built on the existing test-mode mechanics, and a sidebar switcher.

**Tech Stack:** Tauri v2 (Rust: rusqlite 0.32, serde, `trash`, `chrono`), React 19 + TypeScript, zustand, TanStack Query, vitest + Testing Library, `cargo test`.

**Spec:** `docs/superpowers/specs/2026-09-22-organisations-design.md`

## Global Constraints

- Every user-visible string goes through `useT()` keys in `src/i18n/ui.ts`, added to BOTH `EN` and `FR`; FR strings are accent-free (the parity test `src/__tests__/i18nParity.test.ts` enforces equal key sets).
- Design system: lucide icons at 14/16/18, `rounded-xl` cards, `rounded-lg` inputs, `rounded-full` badges, colours only via CSS tokens (`var(--color-…)`), no `gray-*` classes, no unicode arrows.
- Never delete user data: organisation deletion moves the folder to the Trash.
- Registry writes are atomic (temp file + rename). Ids are six lowercase base-36 characters.
- Test/presentation mode file names stay `studiomanager_test.db`, `studiomanager_presentation.db`, `studiomanager_snapshot.db`, now inside the organisation folder.
- Rust stays on `rusqlite = "0.32"` (libsqlite3-sys unification with the SQL plugin).
- Run before every commit: `npx tsc --noEmit`, `npx vitest run`, `npm run lint`; for Rust tasks also `cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings`.
- Commit messages follow the repo style (`feat:`, `fix:`, `refactor:`, `test:`) and end with the two attribution lines used in this repo's recent commits.

---

## File structure

**Rust (`src-tauri/src/`)**

| File | Responsibility |
|---|---|
| `orgs.rs` (new) | Registry types, atomic load/save, id generation, mutations (add/rename/reorder/remove/set_active/set_prefs). Pure functions over `&Path`; no Tauri types. |
| `migrate.rs` (new) | Embedded SQL migrations list and `migrate_db(path)` runner with its own `schema_migrations` table; recognises plugin-migrated files. |
| `upgrade.rs` (new) | One-time move from the legacy single-database layout into `orgs/<id>/`, with snapshot, count checks, path rewrite and rollback. |
| `seed.rs` (new) | Copy of settings tables from one database file into another (`ATTACH` + DDL from `sqlite_master`). |
| `lib.rs` (modify) | `ActiveOrg` state replacing `ActiveDb`; existing commands read paths from it; new organisation commands; startup wiring in `setup`; `add_migrations` removed. |
| `Cargo.toml` (modify) | add `trash = "5"`, `chrono = { version = "0.4", default-features = false, features = ["clock"] }`. |

**Frontend (`src/`)**

| File | Responsibility |
|---|---|
| `lib/orgs.ts` (new) | Types (`Organisation`, `OrgPrefs`, `Registry`), defaults, typed `invoke` wrappers. |
| `stores/org-store.ts` (new) | zustand store: registry, active id, `load()`, `applyRegistry()`, `orgKey()` for namespaced localStorage, prefs bridge to the app store. |
| `lib/orgPaths.ts` (new) | `orgPaths()` → active organisation's `root`, `invoicesDir`, `receiptsDir`. |
| `lib/modes.ts` (new) | Non-hook `enterTestMode/exitTestMode/enterPresentationMode/exitPresentationMode` shared by Settings, MainLayout and the switch sequence. |
| `lib/switchOrganisation.ts` (new) | The ordered switch sequence with injected dependencies. |
| `components/layout/OrgSwitcher.tsx` (new) | Sidebar switcher menu. |
| `components/OrgCreateDialog.tsx` (new) | Create dialog (name + empty/seeded). |
| `components/settings/OrganisationsCard.tsx` (new) | Manage card (rename, reorder, delete). |
| `db/index.ts` (modify) | Database URL derived from the active organisation. |
| `stores/app-store.ts` (modify) | Per-organisation preference setters write through to the registry; namespaced timer and last-backup keys. |
| `stores/tab-store.ts` (modify) | Namespaced storage key, `closeAllTabs()`, `reloadForOrg()`. |
| `lib/backup.ts`, `hooks/useAutoBackup.ts` (modify) | Per-organisation folders, backup folder naming. |
| `lib/invoicePdfStore.ts`, `pages/ExpensesPage.tsx`, `pages/IncomePage.tsx`, `pages/QuotesPage.tsx`, `pages/InvoicesPage.tsx` (modify) | Use `orgPaths()`. |
| `pages/TasksPage.tsx` (modify) | Namespaced collapsed/order keys. |
| `components/layout/Sidebar.tsx`, `components/layout/MainLayout.tsx`, `components/GlobalShortcuts.tsx`, `pages/SettingsPage.tsx`, `App.tsx` (modify) | Switcher, banners, shortcut, settings card, startup gate. |
| `__mocks__/tauri-api.ts` (modify) | `setInvokeHandler` for tests. |
| `i18n/ui.ts` (modify) | New keys EN + FR. |

---

### Task 1: Rust registry module

**Files:**
- Create: `src-tauri/src/orgs.rs`
- Modify: `src-tauri/Cargo.toml` (dependencies), `src-tauri/src/lib.rs:1-2` (add `mod orgs;`)

**Interfaces:**
- Produces: `orgs::{Registry, Organisation, OrgPrefs, REGISTRY_FILE, ORGS_DIR, DB_FILE, org_dir, new_id, now_iso}` with the signatures shown in Step 3. Later tasks call `Registry::load/save/add/rename/reorder/remove/set_active/set_prefs/active/find`.

- [ ] **Step 1: Add dependencies**

In `src-tauri/Cargo.toml` under `[dependencies]` add:

```toml
trash = "5"
chrono = { version = "0.4", default-features = false, features = ["clock"] }
```

- [ ] **Step 2: Write the failing tests**

Create `src-tauri/src/orgs.rs` with only the test module first:

```rust
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
        assert!(reg.reorder(&[a.clone()]).is_err());
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
```

Add `mod orgs;` at the top of `src-tauri/src/lib.rs` (after `mod dbfiles;`).

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd src-tauri && cargo test orgs::`
Expected: compile errors (`Registry` not found).

- [ ] **Step 4: Implement the module**

Prepend to `src-tauri/src/orgs.rs`:

```rust
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd src-tauri && cargo test orgs:: && cargo clippy --all-targets -- -D warnings`
Expected: 8 passed, clippy clean (unused-code warnings for not-yet-used items are fine to `#[allow(dead_code)]` on the module line until Task 4 uses them; remove the allow in Task 4).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/orgs.rs src-tauri/src/lib.rs
git commit -m "feat(orgs): organisation registry module with atomic save"
```

---

### Task 2: Rust migration runner

**Files:**
- Create: `src-tauri/src/migrate.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod migrate;`)

**Interfaces:**
- Produces: `migrate::migrate_db(path: &Path) -> Result<u32, String>` (number of migrations applied) and `migrate::LATEST_VERSION: i64`.
- Consumes: the six SQL files in `src-tauri/migrations/`.

- [ ] **Step 1: Write the failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn temp_db(name: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("sm-migrate-{nanos}-{name}.db"))
    }

    fn table_exists(path: &std::path::Path, table: &str) -> bool {
        let conn = Connection::open(path).unwrap();
        conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
            [table],
            |r| r.get::<_, i64>(0),
        )
        .unwrap()
            == 1
    }

    #[test]
    fn fresh_file_gets_full_schema_and_seed_rows() {
        let db = temp_db("fresh");
        let applied = migrate_db(&db).unwrap();
        assert_eq!(applied as i64, LATEST_VERSION);
        for t in ["business_profile", "clients", "invoices", "subtasks", "activities", "expense_categories"] {
            assert!(table_exists(&db, t), "{t}");
        }
        let conn = Connection::open(&db).unwrap();
        let cats: i64 = conn.query_row("SELECT COUNT(*) FROM expense_categories", [], |r| r.get(0)).unwrap();
        assert_eq!(cats, 6);
        let has_activity_id: i64 = conn
            .query_row("SELECT COUNT(*) FROM pragma_table_info('invoices') WHERE name='activity_id'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(has_activity_id, 1);
        assert_eq!(migrate_db(&db).unwrap(), 0, "second run is a no-op");
    }

    #[test]
    fn plugin_migrated_file_is_recognised_and_not_re_run() {
        let db = temp_db("plugin");
        // Simulate a database the tauri-plugin-sql migrated fully.
        migrate_db(&db).unwrap();
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch(
            "DROP TABLE schema_migrations;
             CREATE TABLE _sqlx_migrations (version BIGINT PRIMARY KEY, description TEXT NOT NULL, installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, success BOOLEAN NOT NULL, checksum BLOB NOT NULL, execution_time BIGINT NOT NULL);
             INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) VALUES (1,'a',1,x'00',0),(2,'b',1,x'00',0),(3,'c',1,x'00',0),(4,'d',1,x'00',0),(5,'e',1,x'00',0),(6,'f',1,x'00',0);",
        )
        .unwrap();
        drop(conn);
        assert_eq!(migrate_db(&db).unwrap(), 0);
        let conn = Connection::open(&db).unwrap();
        let max: i64 = conn.query_row("SELECT MAX(version) FROM schema_migrations", [], |r| r.get(0)).unwrap();
        assert_eq!(max, LATEST_VERSION);
    }

    #[test]
    fn partially_migrated_file_catches_up() {
        let db = temp_db("partial");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch(MIGRATIONS[0].sql).unwrap();
        conn.execute_batch("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES (1, 'x');").unwrap();
        drop(conn);
        assert_eq!(migrate_db(&db).unwrap() as i64, LATEST_VERSION - 1);
        assert!(table_exists(&db, "activities"));
    }
}
```

Add `mod migrate;` to `lib.rs`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test migrate::`
Expected: compile error, `migrate_db` not found.

- [ ] **Step 3: Implement the runner**

Prepend to `src-tauri/src/migrate.rs`:

```rust
//! Schema migration runner that works on any database file (the SQL plugin
//! only migrates the one connection string it was configured with).
//! Progress lives in `schema_migrations`; files the plugin migrated earlier
//! are recognised through `_sqlx_migrations` and never re-run.

use std::path::Path;

pub struct SqlMigration {
    pub version: i64,
    pub sql: &'static str,
}

pub const MIGRATIONS: &[SqlMigration] = &[
    SqlMigration { version: 1, sql: include_str!("../migrations/001_initial_schema.sql") },
    SqlMigration { version: 2, sql: include_str!("../migrations/002_billing_name_task_status.sql") },
    SqlMigration { version: 3, sql: include_str!("../migrations/003_invoice_po_number.sql") },
    SqlMigration { version: 4, sql: include_str!("../migrations/004_subtasks.sql") },
    SqlMigration { version: 5, sql: include_str!("../migrations/005_consolidate_schema.sql") },
    SqlMigration { version: 6, sql: include_str!("../migrations/006_activities.sql") },
];

pub const LATEST_VERSION: i64 = 6;

fn table_exists(conn: &rusqlite::Connection, name: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
        [name],
        |r| r.get::<_, i64>(0),
    )
    .map(|n| n == 1)
    .map_err(|e| format!("sqlite_master lookup failed: {e}"))
}

/// Apply every migration newer than the file's recorded version.
/// Returns how many were applied.
pub fn migrate_db(path: &Path) -> Result<u32, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("create db folder: {e}"))?;
    }
    let mut conn = rusqlite::Connection::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    conn.busy_timeout(std::time::Duration::from_millis(5000))
        .map_err(|e| format!("busy_timeout: {e}"))?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
    )
    .map_err(|e| format!("create schema_migrations: {e}"))?;

    let recorded: i64 = conn
        .query_row("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", [], |r| r.get(0))
        .map_err(|e| format!("read schema_migrations: {e}"))?;
    let mut current = recorded;
    if current == 0 && table_exists(&conn, "_sqlx_migrations")? {
        conn.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, applied_at)
             SELECT version, datetime('now') FROM _sqlx_migrations WHERE success = 1",
            [],
        )
        .map_err(|e| format!("adopt plugin migrations: {e}"))?;
        current = conn
            .query_row("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", [], |r| r.get(0))
            .map_err(|e| format!("read schema_migrations: {e}"))?;
    }

    let mut applied = 0u32;
    for m in MIGRATIONS.iter().filter(|m| m.version > current) {
        let tx = conn.transaction().map_err(|e| format!("begin migration {}: {e}", m.version))?;
        tx.execute_batch(m.sql).map_err(|e| format!("migration {} failed: {e}", m.version))?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, datetime('now'))",
            [m.version],
        )
        .map_err(|e| format!("record migration {}: {e}", m.version))?;
        tx.commit().map_err(|e| format!("commit migration {}: {e}", m.version))?;
        applied += 1;
    }
    Ok(applied)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test migrate:: && cargo clippy --all-targets -- -D warnings`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/migrate.rs src-tauri/src/lib.rs
git commit -m "feat(orgs): Rust migration runner for any database file"
```

---

### Task 3: Settings seeding between databases

**Files:**
- Create: `src-tauri/src/seed.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod seed;`)

**Interfaces:**
- Produces: `seed::copy_settings_tables(src: &Path, dest: &Path) -> Result<Vec<String>, String>` returning the table names copied.
- Consumes: `migrate::migrate_db` (dest must already have the schema).

- [ ] **Step 1: Write the failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn temp_db(name: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir().join(format!("sm-seed-{nanos}-{name}.db"))
    }

    #[test]
    fn copies_profile_activities_categories_and_frontend_created_tables() {
        let src = temp_db("src");
        let dest = temp_db("dest");
        crate::migrate::migrate_db(&src).unwrap();
        crate::migrate::migrate_db(&dest).unwrap();
        let s = Connection::open(&src).unwrap();
        s.execute_batch(
            "UPDATE business_profile SET owner_name='Loris' WHERE id=1;
             INSERT INTO activities (name_fr, name_en, sort_order) VALUES ('Graphisme','Graphic Design',0);
             UPDATE expense_categories SET name_en='Rent!' WHERE code='LO';
             CREATE TABLE invoice_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0);
             INSERT INTO invoice_templates (name, is_default) VALUES ('Default', 1);
             INSERT INTO clients (id, name) VALUES ('C-001', 'Should not copy');",
        )
        .unwrap();
        drop(s);

        let copied = copy_settings_tables(&src, &dest).unwrap();
        assert_eq!(copied, vec!["business_profile", "activities", "expense_categories", "invoice_templates"]);

        let d = Connection::open(&dest).unwrap();
        let owner: String = d.query_row("SELECT owner_name FROM business_profile WHERE id=1", [], |r| r.get(0)).unwrap();
        assert_eq!(owner, "Loris");
        let acts: i64 = d.query_row("SELECT COUNT(*) FROM activities", [], |r| r.get(0)).unwrap();
        assert_eq!(acts, 1);
        let rent: String = d.query_row("SELECT name_en FROM expense_categories WHERE code='LO'", [], |r| r.get(0)).unwrap();
        assert_eq!(rent, "Rent!");
        let tpl_sql: String = d
            .query_row("SELECT sql FROM sqlite_master WHERE name='invoice_templates'", [], |r| r.get(0))
            .unwrap();
        assert!(tpl_sql.contains("AUTOINCREMENT"), "DDL copied verbatim");
        let clients: i64 = d.query_row("SELECT COUNT(*) FROM clients", [], |r| r.get(0)).unwrap();
        assert_eq!(clients, 0);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test seed::`
Expected: compile error.

- [ ] **Step 3: Implement**

```rust
//! Copy the settings-type tables from one organisation database into a
//! freshly migrated one ("start from the current organisation's settings").
//! Tables the frontend creates at runtime (templates) may be absent in the
//! destination: their DDL is copied verbatim from the source's sqlite_master
//! so constraints and AUTOINCREMENT survive.

use std::path::Path;

/// Order matters only for readability; none of these reference each other.
pub const SETTINGS_TABLES: &[&str] = &[
    "business_profile",
    "activities",
    "expense_categories",
    "invoice_templates",
    "workload_templates",
];

pub fn copy_settings_tables(src: &Path, dest: &Path) -> Result<Vec<String>, String> {
    let conn = rusqlite::Connection::open(dest).map_err(|e| format!("open destination: {e}"))?;
    conn.execute("ATTACH DATABASE ?1 AS src", [src.to_string_lossy().as_ref()])
        .map_err(|e| format!("attach source: {e}"))?;
    let mut copied = Vec::new();
    conn.execute_batch("BEGIN").map_err(|e| format!("begin: {e}"))?;
    let result = (|| -> Result<(), String> {
        for table in SETTINGS_TABLES {
            let ddl: Option<String> = conn
                .query_row(
                    "SELECT sql FROM src.sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |r| r.get(0),
                )
                .ok();
            let Some(ddl) = ddl else { continue };
            let in_dest: i64 = conn
                .query_row("SELECT COUNT(*) FROM main.sqlite_master WHERE type='table' AND name=?1", [table], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            if in_dest == 0 {
                conn.execute_batch(&ddl).map_err(|e| format!("create {table}: {e}"))?;
            }
            conn.execute(&format!("DELETE FROM main.\"{table}\""), []).map_err(|e| format!("clear {table}: {e}"))?;
            conn.execute(&format!("INSERT INTO main.\"{table}\" SELECT * FROM src.\"{table}\""), [])
                .map_err(|e| format!("copy {table}: {e}"))?;
            copied.push((*table).to_string());
        }
        Ok(())
    })();
    match result {
        Ok(()) => conn.execute_batch("COMMIT").map_err(|e| format!("commit: {e}"))?,
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            return Err(e);
        }
    }
    let _ = conn.execute("DETACH DATABASE src", []);
    Ok(copied)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test seed:: && cargo clippy --all-targets -- -D warnings`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/seed.rs src-tauri/src/lib.rs
git commit -m "feat(orgs): copy settings tables into a new organisation database"
```

---

### Task 4: Legacy layout upgrade with rollback

**Files:**
- Create: `src-tauri/src/upgrade.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod upgrade;`)

**Interfaces:**
- Produces: `upgrade::needs_upgrade(app_dir: &Path) -> bool`, `upgrade::run(app_dir: &Path) -> Result<Registry, String>`, and for tests `upgrade::run_with_hooks(app_dir, fail_after_rename: Option<usize>)`.
- Consumes: `orgs::{Registry, org_dir, DB_FILE}`, `dbfiles::snapshot_db_file`.

- [ ] **Step 1: Write the failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn legacy_fixture(name: &str) -> std::path::PathBuf {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let app = std::env::temp_dir().join(format!("sm-upgrade-{nanos}-{name}"));
        std::fs::create_dir_all(app.join("invoices")).unwrap();
        std::fs::create_dir_all(app.join("receipts")).unwrap();
        let db = app.join(DB_FILE);
        crate::migrate::migrate_db(&db).unwrap();
        let c = Connection::open(&db).unwrap();
        let inv = app.join("invoices/2026-001_ACME.pdf");
        let rec = app.join("receipts/F-26-001.pdf");
        std::fs::write(&inv, b"pdf").unwrap();
        std::fs::write(&rec, b"pdf").unwrap();
        c.execute("UPDATE business_profile SET owner_name='Loris Briguet' WHERE id=1", []).unwrap();
        c.execute("INSERT INTO clients (id, name) VALUES ('C-001','ACME')", []).unwrap();
        // If this INSERT fails on a NOT NULL column without a default, add
        // that column with a literal; the fixture only needs one row.
        c.execute(
            "INSERT INTO invoices (reference, client_id, status, invoice_date, subtotal, total, pdf_path) VALUES ('2026-001','C-001','sent','2026-01-01',1,1,?1)",
            [inv.to_string_lossy().as_ref()],
        ).unwrap();
        c.execute(
            "INSERT INTO expenses (reference, supplier, category_code, invoice_date, amount, receipt_path) VALUES ('F-26-001','X','FA','2026-01-01',1,?1)",
            [rec.to_string_lossy().as_ref()],
        ).unwrap();
        c.execute(
            "INSERT INTO expenses (reference, supplier, category_code, invoice_date, amount, receipt_path) VALUES ('F-26-002','Y','FA','2026-01-02',1,'/Volumes/External/keep.pdf')",
            [],
        ).unwrap();
        // disposable companions that must be deleted, not moved
        std::fs::write(app.join("studiomanager_test.db"), b"x").unwrap();
        std::fs::write(app.join("studiomanager_presentation.db-wal"), b"x").unwrap();
        app
    }

    #[test]
    fn needs_upgrade_only_for_legacy_layout() {
        let app = legacy_fixture("needs");
        assert!(needs_upgrade(&app));
        let reg = run(&app).unwrap();
        assert!(!needs_upgrade(&app));
        assert_eq!(reg.organisations.len(), 1);
        let empty = std::env::temp_dir().join("sm-upgrade-empty");
        std::fs::create_dir_all(&empty).unwrap();
        assert!(!needs_upgrade(&empty));
    }

    #[test]
    fn moves_files_rewrites_paths_and_names_the_org_after_the_owner() {
        let app = legacy_fixture("move");
        let reg = run(&app).unwrap();
        let org = reg.active().unwrap();
        assert_eq!(org.name, "Loris Briguet");
        assert_eq!(org.prefs, None);
        let dir = org_dir(&app, &org.id);
        assert!(dir.join(DB_FILE).exists());
        assert!(dir.join("invoices/2026-001_ACME.pdf").exists());
        assert!(dir.join("receipts/F-26-001.pdf").exists());
        assert!(!app.join(DB_FILE).exists());
        assert!(!app.join("invoices").exists());
        assert!(!app.join("studiomanager_test.db").exists());
        assert!(!app.join("studiomanager_presentation.db-wal").exists());
        let c = Connection::open(dir.join(DB_FILE)).unwrap();
        let pdf: String = c.query_row("SELECT pdf_path FROM invoices", [], |r| r.get(0)).unwrap();
        assert_eq!(pdf, dir.join("invoices/2026-001_ACME.pdf").to_string_lossy());
        let rec: String = c.query_row("SELECT receipt_path FROM expenses WHERE reference='F-26-001'", [], |r| r.get(0)).unwrap();
        assert_eq!(rec, dir.join("receipts/F-26-001.pdf").to_string_lossy());
        let ext: String = c.query_row("SELECT receipt_path FROM expenses WHERE reference='F-26-002'", [], |r| r.get(0)).unwrap();
        assert_eq!(ext, "/Volumes/External/keep.pdf");
        assert!(app.join(UPGRADE_SNAPSHOT).exists(), "snapshot kept until next launch");
    }

    #[test]
    fn failure_mid_way_rolls_back_to_the_legacy_layout() {
        let app = legacy_fixture("rollback");
        let err = run_with_hooks(&app, Some(2)).unwrap_err();
        assert!(err.contains("simulated"), "{err}");
        assert!(app.join(DB_FILE).exists());
        assert!(app.join("invoices/2026-001_ACME.pdf").exists());
        assert!(app.join("receipts/F-26-001.pdf").exists());
        assert!(!app.join(REGISTRY_FILE).exists());
        assert!(!app.join(ORGS_DIR).exists() || std::fs::read_dir(app.join(ORGS_DIR)).unwrap().next().is_none());
        let c = Connection::open(app.join(DB_FILE)).unwrap();
        let pdf: String = c.query_row("SELECT pdf_path FROM invoices", [], |r| r.get(0)).unwrap();
        assert!(pdf.starts_with(app.join("invoices").to_string_lossy().as_ref()));
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test upgrade::`
Expected: compile error.

- [ ] **Step 3: Implement**

```rust
//! One-time move from the legacy single-database layout to `orgs/<id>/`.
//! Same-volume renames (atomic per file), a snapshot first, row/file counts
//! before and after, and a full rollback of completed renames on any error.

use crate::orgs::{org_dir, Registry, DB_FILE, ORGS_DIR, REGISTRY_FILE};
use std::path::{Path, PathBuf};

pub const UPGRADE_SNAPSHOT: &str = "studiomanager_upgrade_snapshot.db";
const DOC_DIRS: [&str; 2] = ["invoices", "receipts"];
const DISPOSABLE: [&str; 3] = ["studiomanager_test.db", "studiomanager_presentation.db", "studiomanager_snapshot.db"];

pub fn needs_upgrade(app_dir: &Path) -> bool {
    !app_dir.join(REGISTRY_FILE).exists() && app_dir.join(DB_FILE).exists()
}

pub fn run(app_dir: &Path) -> Result<Registry, String> {
    run_with_hooks(app_dir, None)
}

struct Counts {
    invoices: i64,
    expenses: i64,
    invoice_files: usize,
    receipt_files: usize,
}

fn count_files(dir: &Path) -> usize {
    std::fs::read_dir(dir).map(|it| it.filter_map(Result::ok).count()).unwrap_or(0)
}

fn counts(db: &Path, docs_root: &Path) -> Result<Counts, String> {
    let conn = rusqlite::Connection::open(db).map_err(|e| format!("open db for counts: {e}"))?;
    let q = |sql: &str| conn.query_row(sql, [], |r| r.get::<_, i64>(0)).map_err(|e| format!("count: {e}"));
    Ok(Counts {
        invoices: q("SELECT COUNT(*) FROM invoices")?,
        expenses: q("SELECT COUNT(*) FROM expenses")?,
        invoice_files: count_files(&docs_root.join("invoices")),
        receipt_files: count_files(&docs_root.join("receipts")),
    })
}

fn owner_name(db: &Path) -> String {
    rusqlite::Connection::open(db)
        .ok()
        .and_then(|c| c.query_row("SELECT owner_name FROM business_profile WHERE id = 1", [], |r| r.get::<_, String>(0)).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Studio".to_string())
}

fn rewrite_paths(db: &Path, app_dir: &Path, org: &Path) -> Result<(), String> {
    let conn = rusqlite::Connection::open(db).map_err(|e| format!("open db for path rewrite: {e}"))?;
    let tx_res = (|| -> Result<(), String> {
        conn.execute_batch("BEGIN").map_err(|e| e.to_string())?;
        for (table, column, dir) in [("expenses", "receipt_path", "receipts"), ("invoices", "pdf_path", "invoices")] {
            let old_prefix = format!("{}/{dir}/", app_dir.display());
            let new_prefix = format!("{}/{dir}/", org.display());
            conn.execute(
                &format!(
                    "UPDATE {table} SET {column} = ?1 || substr({column}, length(?2) + 1)
                     WHERE {column} IS NOT NULL AND substr({column}, 1, length(?2)) = ?2"
                ),
                [new_prefix.as_str(), old_prefix.as_str()],
            )
            .map_err(|e| format!("rewrite {table}.{column}: {e}"))?;
        }
        conn.execute_batch("COMMIT").map_err(|e| e.to_string())
    })();
    if tx_res.is_err() {
        let _ = conn.execute_batch("ROLLBACK");
    }
    tx_res
}

/// `fail_after_rename` injects a failure after that many renames (tests).
pub fn run_with_hooks(app_dir: &Path, fail_after_rename: Option<usize>) -> Result<Registry, String> {
    let legacy_db = app_dir.join(DB_FILE);
    let snapshot = app_dir.join(UPGRADE_SNAPSHOT);
    crate::dbfiles::snapshot_db_file(&legacy_db, &snapshot).map_err(|e| format!("upgrade snapshot: {e}"))?;
    let before = counts(&legacy_db, app_dir)?;
    let name = owner_name(&legacy_db);

    let mut reg = Registry::empty();
    let id = reg.add(&name, None)?.id.clone();
    reg.set_active(&id)?;
    let org = org_dir(app_dir, &id);
    std::fs::create_dir_all(&org).map_err(|e| format!("create organisation folder: {e}"))?;

    let mut moves: Vec<(PathBuf, PathBuf)> = Vec::new();
    for suffix in ["", "-wal", "-shm"] {
        let from = app_dir.join(format!("{DB_FILE}{suffix}"));
        if from.exists() {
            moves.push((from, org.join(format!("{DB_FILE}{suffix}"))));
        }
    }
    for dir in DOC_DIRS {
        let from = app_dir.join(dir);
        if from.exists() {
            moves.push((from, org.join(dir)));
        }
    }

    let mut done: Vec<(PathBuf, PathBuf)> = Vec::new();
    let result = (|| -> Result<(), String> {
        for (i, (from, to)) in moves.iter().enumerate() {
            if fail_after_rename == Some(i) {
                return Err("simulated failure during upgrade".to_string());
            }
            std::fs::rename(from, to).map_err(|e| format!("move {}: {e}", from.display()))?;
            done.push((from.clone(), to.clone()));
        }
        rewrite_paths(&org.join(DB_FILE), app_dir, &org)?;
        let after = counts(&org.join(DB_FILE), &org)?;
        if after.invoices != before.invoices
            || after.expenses != before.expenses
            || after.invoice_files != before.invoice_files
            || after.receipt_files != before.receipt_files
        {
            return Err("row or file counts differ after the move".to_string());
        }
        Ok(())
    })();

    if let Err(e) = result {
        for (from, to) in done.iter().rev() {
            let _ = std::fs::rename(to, from);
        }
        // Undo the path rewrite if it happened (the db is back at the legacy path)
        let _ = rewrite_back(&legacy_db, app_dir, &org);
        let _ = std::fs::remove_dir_all(&org);
        let _ = std::fs::remove_dir(app_dir.join(ORGS_DIR));
        return Err(format!("upgrade failed and was rolled back: {e}"));
    }

    for f in DISPOSABLE {
        crate::dbfiles::remove_db_files(&app_dir.join(f));
    }
    reg.save(app_dir)?;
    Ok(reg)
}

fn rewrite_back(db: &Path, app_dir: &Path, org: &Path) -> Result<(), String> {
    if !db.exists() {
        return Ok(());
    }
    // Same statement with prefixes swapped.
    let conn = rusqlite::Connection::open(db).map_err(|e| e.to_string())?;
    for (table, column, dir) in [("expenses", "receipt_path", "receipts"), ("invoices", "pdf_path", "invoices")] {
        let new_prefix = format!("{}/{dir}/", app_dir.display());
        let old_prefix = format!("{}/{dir}/", org.display());
        conn.execute(
            &format!(
                "UPDATE {table} SET {column} = ?1 || substr({column}, length(?2) + 1)
                 WHERE {column} IS NOT NULL AND substr({column}, 1, length(?2)) = ?2"
            ),
            [new_prefix.as_str(), old_prefix.as_str()],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Called once the app started successfully on the new layout.
pub fn discard_snapshot(app_dir: &Path) {
    crate::dbfiles::remove_db_files(&app_dir.join(UPGRADE_SNAPSHOT));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test upgrade:: && cargo clippy --all-targets -- -D warnings`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/upgrade.rs src-tauri/src/lib.rs
git commit -m "feat(orgs): upgrade legacy data layout into the first organisation with rollback"
```

---

### Task 5: ActiveOrg state, organisation commands, startup wiring

**Files:**
- Modify: `src-tauri/src/lib.rs` (whole file touched: state struct, all path-building commands, new commands, builder)

**Interfaces:**
- Produces Tauri commands (all return `Result<_, String>`): `list_organisations() -> Registry`, `create_organisation(name: String, seed_from_current: bool, prefs: OrgPrefs) -> Registry`, `rename_organisation(id, name) -> Registry`, `reorder_organisations(ids: Vec<String>) -> Registry`, `delete_organisation(id) -> Registry`, `switch_organisation(id) -> Registry`, `set_organisation_prefs(id, prefs: OrgPrefs) -> Registry`, `get_active_db() -> String` (now returns `orgs/<id>/<dbname>`).
- Consumes: Tasks 1–4.

- [ ] **Step 1: Write the failing test for the pure helpers**

Add to the existing `mod tests` in `lib.rs`:

```rust
    #[test]
    fn active_org_paths_are_inside_the_org_folder() {
        let a = ActiveOrg { id: "abc123".into(), dir: PathBuf::from("/tmp/app/orgs/abc123"), db_name: "studiomanager.db".into() };
        assert_eq!(a.db_path(), PathBuf::from("/tmp/app/orgs/abc123/studiomanager.db"));
        assert_eq!(a.prod_db_path(), PathBuf::from("/tmp/app/orgs/abc123/studiomanager.db"));
        assert_eq!(a.relative_db(), "orgs/abc123/studiomanager.db");
        let t = ActiveOrg { db_name: "studiomanager_test.db".into(), ..a.clone() };
        assert_eq!(t.db_path(), PathBuf::from("/tmp/app/orgs/abc123/studiomanager_test.db"));
        assert!(t.in_mode());
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd src-tauri && cargo test active_org_paths`
Expected: compile error, `ActiveOrg` not found.

- [ ] **Step 3: Replace `ActiveDb` with `ActiveOrg`**

In `lib.rs`, replace the `ActiveDb` definition with:

```rust
mod migrate;
mod orgs;
mod seed;
mod upgrade;

use orgs::{OrgPrefs, Registry, DB_FILE};

/// Global state: the active organisation folder and which database file
/// inside it is live (production, test or presentation copy).
#[derive(Clone, Debug)]
pub struct ActiveOrg {
    pub id: String,
    pub dir: PathBuf,
    pub db_name: String,
}

impl ActiveOrg {
    pub fn db_path(&self) -> PathBuf { self.dir.join(&self.db_name) }
    pub fn prod_db_path(&self) -> PathBuf { self.dir.join(DB_FILE) }
    pub fn file(&self, name: &str) -> PathBuf { self.dir.join(name) }
    pub fn relative_db(&self) -> String { format!("{}/{}/{}", orgs::ORGS_DIR, self.id, self.db_name) }
    pub fn in_mode(&self) -> bool { self.db_name != DB_FILE }
}

struct ActiveOrgState(Mutex<ActiveOrg>);

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| format!("Failed to get app data dir: {e}"))
}

fn active_org(app: &tauri::AppHandle) -> Result<ActiveOrg, String> {
    let state = app.state::<ActiveOrgState>();
    let guard = state.0.lock().map_err(|e| format!("Lock error: {e}"))?;
    Ok(guard.clone())
}

fn set_active_db_name(app: &tauri::AppHandle, name: &str) -> Result<(), String> {
    let state = app.state::<ActiveOrgState>();
    state.0.lock().map_err(|e| format!("Lock error: {e}"))?.db_name = name.to_string();
    Ok(())
}
```

Then rewrite every existing command that used `app_dir.join("...")`:

- `execute_batch`: `let db_path = active_org(&app)?.db_path();`
- `enter_test_mode`: `let org = active_org(&app)?; let prod_db = org.prod_db_path(); let snapshot_db = org.file("studiomanager_snapshot.db"); let test_db = org.file("studiomanager_test.db");` … then `set_active_db_name(&app, "studiomanager_test.db")?;`
- `exit_test_mode`: `let org = active_org(&app)?; let test_db = org.file("studiomanager_test.db"); set_active_db_name(&app, DB_FILE)?; dbfiles::remove_db_files(&test_db);`
- `enter_presentation_mode` / `exit_presentation_mode`: same pattern with `studiomanager_presentation.db`.
- `snapshot_db`, `restore_snapshot`, `has_snapshot`: `org.prod_db_path()` and `org.file("studiomanager_snapshot.db")`.
- `get_active_db`: `Ok(active_org(&app)?.relative_db())`.

- [ ] **Step 4: Add the organisation commands**

```rust
fn load_registry(app: &tauri::AppHandle) -> Result<Registry, String> {
    Registry::load(&app_data_dir(app)?)?.ok_or_else(|| "organisation registry missing".to_string())
}

fn save_registry(app: &tauri::AppHandle, reg: &Registry) -> Result<(), String> {
    reg.save(&app_data_dir(app)?)
}

#[tauri::command]
fn list_organisations(app: tauri::AppHandle) -> Result<Registry, String> {
    load_registry(&app)
}

#[tauri::command]
fn create_organisation(app: tauri::AppHandle, name: String, seed_from_current: bool, prefs: OrgPrefs) -> Result<Registry, String> {
    let app_dir = app_data_dir(&app)?;
    let mut reg = load_registry(&app)?;
    let id = reg.add(&name, Some(prefs))?.id.clone();
    let dir = orgs::org_dir(&app_dir, &id);
    let result = (|| -> Result<(), String> {
        std::fs::create_dir_all(dir.join("invoices")).map_err(|e| format!("create folders: {e}"))?;
        std::fs::create_dir_all(dir.join("receipts")).map_err(|e| format!("create folders: {e}"))?;
        migrate::migrate_db(&dir.join(DB_FILE))?;
        if seed_from_current {
            let current = active_org(&app)?;
            if current.in_mode() {
                return Err("leave test or presentation mode before creating an organisation from it".to_string());
            }
            seed::copy_settings_tables(&current.prod_db_path(), &dir.join(DB_FILE))?;
        }
        Ok(())
    })();
    if let Err(e) = result {
        let _ = std::fs::remove_dir_all(&dir);
        return Err(e);
    }
    save_registry(&app, &reg)?;
    Ok(reg)
}

#[tauri::command]
fn rename_organisation(app: tauri::AppHandle, id: String, name: String) -> Result<Registry, String> {
    let mut reg = load_registry(&app)?;
    reg.rename(&id, &name)?;
    save_registry(&app, &reg)?;
    Ok(reg)
}

#[tauri::command]
fn reorder_organisations(app: tauri::AppHandle, ids: Vec<String>) -> Result<Registry, String> {
    let mut reg = load_registry(&app)?;
    reg.reorder(&ids)?;
    save_registry(&app, &reg)?;
    Ok(reg)
}

#[tauri::command]
fn delete_organisation(app: tauri::AppHandle, id: String) -> Result<Registry, String> {
    let app_dir = app_data_dir(&app)?;
    let mut reg = load_registry(&app)?;
    if id == active_org(&app)?.id {
        return Err("switch to another organisation before deleting this one".to_string());
    }
    reg.remove(&id)?;
    let dir = orgs::org_dir(&app_dir, &id);
    if dir.exists() {
        trash::delete(&dir).map_err(|e| format!("move organisation folder to Trash: {e}"))?;
    }
    save_registry(&app, &reg)?;
    Ok(reg)
}

#[tauri::command]
fn switch_organisation(app: tauri::AppHandle, id: String) -> Result<Registry, String> {
    let app_dir = app_data_dir(&app)?;
    if active_org(&app)?.in_mode() {
        return Err("leave test or presentation mode before switching organisation".to_string());
    }
    let mut reg = load_registry(&app)?;
    reg.set_active(&id)?;
    let dir = orgs::org_dir(&app_dir, &id);
    migrate::migrate_db(&dir.join(DB_FILE))?;
    save_registry(&app, &reg)?;
    let state = app.state::<ActiveOrgState>();
    *state.0.lock().map_err(|e| format!("Lock error: {e}"))? = ActiveOrg { id, dir, db_name: DB_FILE.to_string() };
    Ok(reg)
}

#[tauri::command]
fn set_organisation_prefs(app: tauri::AppHandle, id: String, prefs: OrgPrefs) -> Result<Registry, String> {
    let mut reg = load_registry(&app)?;
    reg.set_prefs(&id, prefs)?;
    save_registry(&app, &reg)?;
    Ok(reg)
}

/// Startup: upgrade the legacy layout if present, create a first
/// organisation on a fresh install, migrate the active database, and
/// install the ActiveOrg state.
fn init_organisations(app: &tauri::AppHandle) -> Result<(), String> {
    let app_dir = app_data_dir(app)?;
    std::fs::create_dir_all(&app_dir).map_err(|e| format!("create app dir: {e}"))?;
    let reg = if upgrade::needs_upgrade(&app_dir) {
        upgrade::run(&app_dir)?
    } else if let Some(reg) = Registry::load(&app_dir)? {
        upgrade::discard_snapshot(&app_dir);
        reg
    } else {
        let mut reg = Registry::empty();
        let id = reg.add("Studio", Some(OrgPrefs::default()))?.id.clone();
        reg.set_active(&id)?;
        let dir = orgs::org_dir(&app_dir, &id);
        std::fs::create_dir_all(dir.join("invoices")).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(dir.join("receipts")).map_err(|e| e.to_string())?;
        reg.save(&app_dir)?;
        reg
    };
    let active = reg.active().ok_or_else(|| "registry has no active organisation".to_string())?;
    let dir = orgs::org_dir(&app_dir, &active.id);
    migrate::migrate_db(&dir.join(DB_FILE))?;
    app.manage(ActiveOrgState(Mutex::new(ActiveOrg { id: active.id.clone(), dir, db_name: DB_FILE.to_string() })));
    Ok(())
}
```

In `run()`: delete the `migrations` vec and the `Migration`/`MigrationKind` import; replace `.manage(ActiveDb(...))` and the SQL plugin registration with:

```rust
        .plugin(tauri_plugin_sql::Builder::default().build())
```

and inside `.setup(|app| { ... })` add as the first lines:

```rust
            if let Err(e) = init_organisations(app.handle()) {
                // Surface loudly: the frontend cannot open any database without this.
                eprintln!("[organisations] startup failed: {e}");
                return Err(e.into());
            }
```

Register the new commands in `generate_handler![...]`: `list_organisations, create_organisation, rename_organisation, reorder_organisations, delete_organisation, switch_organisation, set_organisation_prefs`.

- [ ] **Step 5: Verify**

Run: `cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings && cargo check`
Expected: all tests pass (dbfiles, orgs, migrate, seed, upgrade, lib), no warnings. Remove any `#[allow(dead_code)]` added in Task 1.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(orgs): ActiveOrg state, organisation commands and startup upgrade"
```

---

### Task 6: Frontend test infrastructure for invoke

**Files:**
- Modify: `src/__mocks__/tauri-api.ts`

**Interfaces:**
- Produces: `setInvokeHandler(handler: ((cmd: string, args: Record<string, unknown>) => unknown) | null)` and `invokedCommands: { cmd: string; args: Record<string, unknown> }[]`, `clearInvokedCommands()`.

- [ ] **Step 1: Write the failing test** — `src/__tests__/tauriApiMock.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { invoke, setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";

afterEach(() => { setInvokeHandler(null); clearInvokedCommands(); });

describe("tauri-api mock invoke", () => {
  it("routes commands to the handler and records them", async () => {
    setInvokeHandler((cmd, args) => (cmd === "ping" ? { pong: args.x } : null));
    expect(await invoke("ping", { x: 1 })).toEqual({ pong: 1 });
    expect(invokedCommands).toEqual([{ cmd: "ping", args: { x: 1 } }]);
  });
  it("still batches execute_batch statements", async () => {
    expect(await invoke("execute_batch", { statements: [] })).toEqual({ lastInsertId: 1 });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/__tests__/tauriApiMock.test.ts` → import error.

- [ ] **Step 3: Implement** — in `src/__mocks__/tauri-api.ts` replace the `invoke` function with:

```ts
type InvokeHandler = (cmd: string, args: Record<string, unknown>) => unknown;
let invokeHandler: InvokeHandler | null = null;
export const invokedCommands: { cmd: string; args: Record<string, unknown> }[] = [];
export function setInvokeHandler(handler: InvokeHandler | null): void { invokeHandler = handler; }
export function clearInvokedCommands(): void { invokedCommands.length = 0; }

export async function invoke(cmd?: string, args?: Record<string, unknown>): Promise<unknown> {
  const c = cmd ?? "";
  const a = args ?? {};
  invokedCommands.push({ cmd: c, args: a });
  if (c === "execute_batch" && Array.isArray(a.statements)) {
    for (const stmt of a.statements as { sql: string; params: unknown[] }[]) {
      executedStatements.push({ sql: stmt.sql, params: stmt.params });
    }
    return { lastInsertId: 1 };
  }
  return invokeHandler ? await invokeHandler(c, a) : null;
}
```

- [ ] **Step 4: Verify** — `npx vitest run` → all green (existing tests unaffected).
- [ ] **Step 5: Commit** — `git add src/__mocks__/tauri-api.ts src/__tests__/tauriApiMock.test.ts && git commit -m "test: invoke handler hook in the Tauri API mock"`

---

### Task 7: Organisation types, invoke wrappers and store

**Files:**
- Create: `src/lib/orgs.ts`, `src/stores/org-store.ts`
- Test: `src/__tests__/orgStore.test.ts`

**Interfaces:**
- Produces (`lib/orgs.ts`): `OrgPrefs`, `Organisation`, `Registry`, `DEFAULT_ORG_PREFS`, `listOrganisations()`, `createOrganisation(name, seedFromCurrent, prefs)`, `renameOrganisation(id, name)`, `reorderOrganisations(ids)`, `deleteOrganisation(id)`, `switchOrganisationCmd(id)`, `setOrganisationPrefs(id, prefs)` — each returns `Promise<Registry>`.
- Produces (`stores/org-store.ts`): `useOrgStore` with `{ organisations, activeId, loaded, load(), applyRegistry(reg), active(), orgKey(base), savePrefs(partial) }` and the pure `prefsFromLocalStorage()`, `applyPrefsToAppStore(prefs)`.
- Consumes: `useAppStore` fields `showIncome, showTasksPage, showTimeOverview, calendarSync, calendarName, backupPath, exportLanguage`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { useOrgStore, prefsFromLocalStorage } from "../stores/org-store";
import { useAppStore } from "../stores/app-store";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";
import type { Registry } from "../lib/orgs";

const reg = (prefs: Registry["organisations"][0]["prefs"]): Registry => ({
  version: 1,
  activeId: "aaa111",
  organisations: [{ id: "aaa111", name: "Studio", createdAt: "2026-09-22T00:00:00Z", prefs }],
});

beforeEach(() => {
  localStorage.clear();
  clearInvokedCommands();
  useOrgStore.setState({ organisations: [], activeId: "", loaded: false });
});
afterEach(() => setInvokeHandler(null));

describe("org store", () => {
  it("loads the registry and applies prefs to the app store", async () => {
    setInvokeHandler((cmd) => (cmd === "list_organisations" ? reg({ showIncome: false, showTasksPage: true, showTimeOverview: false, calendarSync: true, calendarName: "Label", backupPath: "/b", exportLanguage: "EN" }) : null));
    await useOrgStore.getState().load();
    expect(useOrgStore.getState().activeId).toBe("aaa111");
    expect(useOrgStore.getState().loaded).toBe(true);
    const s = useAppStore.getState();
    expect(s.showIncome).toBe(false);
    expect(s.calendarName).toBe("Label");
    expect(s.exportLanguage).toBe("EN");
  });

  it("seeds null prefs from localStorage once and clears the keys", async () => {
    localStorage.setItem("showIncome", "true");
    localStorage.setItem("calendarName", "Old");
    localStorage.setItem("backupPath", "/old");
    setInvokeHandler((cmd, args) => (cmd === "list_organisations" ? reg(null) : cmd === "set_organisation_prefs" ? reg(args.prefs as never) : null));
    await useOrgStore.getState().load();
    const set = invokedCommands.find((c) => c.cmd === "set_organisation_prefs");
    expect(set?.args).toMatchObject({ id: "aaa111", prefs: { showIncome: true, calendarName: "Old", backupPath: "/old" } });
    expect(localStorage.getItem("showIncome")).toBeNull();
    expect(localStorage.getItem("calendarName")).toBeNull();
  });

  it("orgKey namespaces localStorage keys by active id", async () => {
    useOrgStore.setState({ activeId: "aaa111" });
    expect(useOrgStore.getState().orgKey("open-tabs")).toBe("open-tabs:aaa111");
  });

  it("savePrefs merges and writes through", async () => {
    setInvokeHandler((cmd, args) => (cmd === "set_organisation_prefs" ? reg(args.prefs as never) : null));
    useOrgStore.getState().applyRegistry(reg({ showIncome: true, showTasksPage: true, showTimeOverview: true, calendarSync: false, calendarName: "StudioManager", backupPath: "", exportLanguage: "FR" }));
    await useOrgStore.getState().savePrefs({ showIncome: false });
    const set = invokedCommands.find((c) => c.cmd === "set_organisation_prefs");
    expect(set?.args).toMatchObject({ prefs: { showIncome: false, calendarName: "StudioManager" } });
  });

  it("prefsFromLocalStorage uses the same defaults as the app store", () => {
    expect(prefsFromLocalStorage()).toEqual({ showIncome: false, showTasksPage: true, showTimeOverview: false, calendarSync: false, calendarName: "", backupPath: "", exportLanguage: "FR" });
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/__tests__/orgStore.test.ts` → module not found.

- [ ] **Step 3: Implement `src/lib/orgs.ts`**

```ts
import { invoke } from "@tauri-apps/api/core";
import type { AppLanguage } from "../i18n/ui";

export interface OrgPrefs {
  showIncome: boolean;
  showTasksPage: boolean;
  showTimeOverview: boolean;
  calendarSync: boolean;
  calendarName: string;
  backupPath: string;
  exportLanguage: AppLanguage;
}

export interface Organisation {
  id: string;
  name: string;
  createdAt: string;
  /** null only for the organisation created by the layout upgrade */
  prefs: OrgPrefs | null;
}

export interface Registry {
  version: number;
  activeId: string;
  organisations: Organisation[];
}

export const DEFAULT_ORG_PREFS: OrgPrefs = {
  showIncome: true,
  showTasksPage: true,
  showTimeOverview: true,
  calendarSync: false,
  calendarName: "StudioManager",
  backupPath: "",
  exportLanguage: "FR",
};

export const listOrganisations = () => invoke<Registry>("list_organisations");
export const createOrganisation = (name: string, seedFromCurrent: boolean, prefs: OrgPrefs) =>
  invoke<Registry>("create_organisation", { name, seedFromCurrent, prefs });
export const renameOrganisation = (id: string, name: string) => invoke<Registry>("rename_organisation", { id, name });
export const reorderOrganisations = (ids: string[]) => invoke<Registry>("reorder_organisations", { ids });
export const deleteOrganisation = (id: string) => invoke<Registry>("delete_organisation", { id });
export const switchOrganisationCmd = (id: string) => invoke<Registry>("switch_organisation", { id });
export const setOrganisationPrefs = (id: string, prefs: OrgPrefs) =>
  invoke<Registry>("set_organisation_prefs", { id, prefs });
```

- [ ] **Step 4: Implement `src/stores/org-store.ts`**

```ts
import { create } from "zustand";
import { useAppStore } from "./app-store";
import { listOrganisations, setOrganisationPrefs, type Organisation, type OrgPrefs, type Registry } from "../lib/orgs";
import type { AppLanguage } from "../i18n/ui";

/** localStorage keys that used to hold what is now per-organisation. */
const LEGACY_PREF_KEYS = ["showIncome", "showTasksPage", "showTimeOverview", "calendarSync", "calendarName", "backupPath", "exportLanguage"] as const;

/** Mirrors the app store's own localStorage defaults (pre-organisations). */
export function prefsFromLocalStorage(): OrgPrefs {
  return {
    showIncome: localStorage.getItem("showIncome") === "true",
    showTasksPage: localStorage.getItem("showTasksPage") !== "false",
    showTimeOverview: localStorage.getItem("showTimeOverview") === "true",
    calendarSync: localStorage.getItem("calendarSync") === "true",
    calendarName: localStorage.getItem("calendarName") ?? "",
    backupPath: localStorage.getItem("backupPath") ?? "",
    exportLanguage: ((localStorage.getItem("exportLanguage") as AppLanguage | null) ?? "FR"),
  };
}

export function applyPrefsToAppStore(prefs: OrgPrefs): void {
  useAppStore.setState({
    showIncome: prefs.showIncome,
    showTasksPage: prefs.showTasksPage,
    showTimeOverview: prefs.showTimeOverview,
    calendarSync: prefs.calendarSync,
    calendarName: prefs.calendarName,
    backupPath: prefs.backupPath,
    exportLanguage: prefs.exportLanguage,
  });
}

interface OrgState {
  organisations: Organisation[];
  activeId: string;
  loaded: boolean;
  load: () => Promise<void>;
  applyRegistry: (reg: Registry) => void;
  active: () => Organisation | undefined;
  activePrefs: () => OrgPrefs | null;
  orgKey: (base: string) => string;
  savePrefs: (partial: Partial<OrgPrefs>) => Promise<void>;
}

export const useOrgStore = create<OrgState>((set, get) => ({
  organisations: [],
  activeId: "",
  loaded: false,

  applyRegistry: (reg) => {
    set({ organisations: reg.organisations, activeId: reg.activeId });
    const prefs = get().activePrefs();
    if (prefs) applyPrefsToAppStore(prefs);
  },

  load: async () => {
    const reg = await listOrganisations();
    get().applyRegistry(reg);
    const active = reg.organisations.find((o) => o.id === reg.activeId);
    if (active && active.prefs === null) {
      // First launch after the layout upgrade: adopt the legacy localStorage values once.
      const seeded = prefsFromLocalStorage();
      const updated = await setOrganisationPrefs(active.id, seeded);
      for (const k of LEGACY_PREF_KEYS) localStorage.removeItem(k);
      get().applyRegistry(updated);
    }
    set({ loaded: true });
  },

  active: () => get().organisations.find((o) => o.id === get().activeId),
  activePrefs: () => get().active()?.prefs ?? null,
  orgKey: (base) => `${base}:${get().activeId}`,

  savePrefs: async (partial) => {
    const current = get().activePrefs();
    const id = get().activeId;
    if (!current || !id) return;
    const next = { ...current, ...partial };
    applyPrefsToAppStore(next);
    const reg = await setOrganisationPrefs(id, next);
    set({ organisations: reg.organisations });
  },
}));
```

- [ ] **Step 5: Verify** — `npx vitest run src/__tests__/orgStore.test.ts` → 5 passed; `npx tsc --noEmit`.
- [ ] **Step 6: Commit** — `git add src/lib/orgs.ts src/stores/org-store.ts src/__tests__/orgStore.test.ts && git commit -m "feat(orgs): organisation types, invoke wrappers and store"`

---

### Task 8: Per-organisation preference setters write through

**Files:**
- Modify: `src/stores/app-store.ts:305-312, 355-366, 387-398` (the seven setters)
- Test: `src/__tests__/orgPrefsWriteThrough.test.ts`

**Interfaces:**
- Consumes: `useOrgStore.getState().savePrefs` (Task 7).
- Produces: unchanged setter names (`setShowIncome`, `setShowTasksPage`, `setShowTimeOverview`, `setCalendarSync`, `setCalendarName`, `setBackupPath`, `setExportLanguage`) that no longer touch localStorage.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { useAppStore } from "../stores/app-store";
import { useOrgStore } from "../stores/org-store";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";
import { DEFAULT_ORG_PREFS } from "../lib/orgs";

beforeEach(() => {
  localStorage.clear();
  clearInvokedCommands();
  useOrgStore.getState().applyRegistry({ version: 1, activeId: "o1", organisations: [{ id: "o1", name: "S", createdAt: "", prefs: { ...DEFAULT_ORG_PREFS } }] });
  setInvokeHandler((cmd, args) => (cmd === "set_organisation_prefs" ? { version: 1, activeId: "o1", organisations: [{ id: "o1", name: "S", createdAt: "", prefs: args.prefs }] } : null));
});
afterEach(() => setInvokeHandler(null));

describe("per-organisation preference setters", () => {
  it.each([
    ["setShowIncome", false, "showIncome"],
    ["setShowTasksPage", false, "showTasksPage"],
    ["setShowTimeOverview", false, "showTimeOverview"],
    ["setCalendarSync", true, "calendarSync"],
    ["setCalendarName", "Label", "calendarName"],
    ["setBackupPath", "/x", "backupPath"],
    ["setExportLanguage", "EN", "exportLanguage"],
  ] as const)("%s writes through to the registry, not localStorage", async (setter, value, field) => {
    (useAppStore.getState()[setter] as (v: never) => void)(value as never);
    await new Promise((r) => setTimeout(r, 0));
    expect((useAppStore.getState() as Record<string, unknown>)[field]).toBe(value);
    expect(localStorage.getItem(field)).toBeNull();
    const call = invokedCommands.find((c) => c.cmd === "set_organisation_prefs");
    expect(call?.args.prefs).toMatchObject({ [field]: value });
  });

  it("app-wide setters still use localStorage", () => {
    useAppStore.getState().setDateFormat("dd.MM.yyyy" as never);
    expect(localStorage.getItem("dateFormat")).not.toBeNull();
  });
});
```

If `setDateFormat` does not exist under that name, use the actual app-wide setter for `dateFormat` found in `app-store.ts`.

- [ ] **Step 2: Run to verify it fails** — the write-through assertions fail (localStorage still written, no invoke).

- [ ] **Step 3: Implement** — in `app-store.ts`, add at the top `import { useOrgStore } from "./org-store";` (org-store imports app-store too; zustand stores are created lazily at call time, so the cycle is safe as long as neither module calls the other at import time — keep both imports type-plus-function only). Replace the seven setters with:

```ts
  setExportLanguage: (lang) => { set({ exportLanguage: lang }); void useOrgStore.getState().savePrefs({ exportLanguage: lang }); },
  setCalendarSync: (enabled) => { set({ calendarSync: enabled }); void useOrgStore.getState().savePrefs({ calendarSync: enabled }); },
  setCalendarName: (name) => { set({ calendarName: name }); void useOrgStore.getState().savePrefs({ calendarName: name }); },
  setBackupPath: (path) => { set({ backupPath: path }); void useOrgStore.getState().savePrefs({ backupPath: path }); },
  setShowTasksPage: (show) => { set({ showTasksPage: show }); void useOrgStore.getState().savePrefs({ showTasksPage: show }); },
  setShowIncome: (show) => { set({ showIncome: show }); void useOrgStore.getState().savePrefs({ showIncome: show }); },
  setShowTimeOverview: (show) => { set({ showTimeOverview: show }); void useOrgStore.getState().savePrefs({ showTimeOverview: show }); },
```

Leave the initial-state reads from localStorage in place (they are the pre-upgrade fallback that `prefsFromLocalStorage` mirrors); the org store overwrites them on load.

- [ ] **Step 4: Verify** — `npx vitest run` all green; `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git commit -am "feat(orgs): per-organisation preferences write through to the registry"`

---

### Task 9: Database URL from the active organisation, shared mode helpers

**Files:**
- Modify: `src/db/index.ts:47-52, 92-96, 126-136`
- Create: `src/lib/modes.ts`
- Modify: `src/pages/SettingsPage.tsx:97-160` and `src/components/layout/MainLayout.tsx:23-50` to call `lib/modes.ts`
- Test: `src/__tests__/dbOrgUrl.test.ts`

**Interfaces:**
- Produces: `db/index.ts` exports unchanged (`getDb`, `switchDb(name)`, `resetDb`, `seedPresentationDb`) plus `dbUrlFor(name: string): string`.
- Produces (`lib/modes.ts`): `enterTestMode()`, `exitTestMode()`, `enterPresentationMode()`, `exitPresentationMode()` — each `Promise<void>`, performing invoke + `switchDb` + app-store flag; no toasts, no reload (callers keep those).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { dbUrlFor } from "../db";
import { useOrgStore } from "../stores/org-store";

describe("database URL per organisation", () => {
  beforeEach(() => useOrgStore.setState({ activeId: "" }));
  it("falls back to the bare name before the registry is loaded", () => {
    expect(dbUrlFor("studiomanager.db")).toBe("sqlite:studiomanager.db");
  });
  it("points inside the active organisation folder", () => {
    useOrgStore.setState({ activeId: "k3f9a2" });
    expect(dbUrlFor("studiomanager.db")).toBe("sqlite:orgs/k3f9a2/studiomanager.db");
    expect(dbUrlFor("studiomanager_test.db")).toBe("sqlite:orgs/k3f9a2/studiomanager_test.db");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `dbUrlFor` not exported.

- [ ] **Step 3: Implement** — in `src/db/index.ts` add `import { useOrgStore } from "../stores/org-store";` and:

```ts
/** SQL plugin connection string for a database file of the active organisation. */
export function dbUrlFor(name: string): string {
  const id = useOrgStore.getState().activeId;
  return id ? `sqlite:orgs/${id}/${name}` : `sqlite:${name}`;
}
```

and change `Database.load(\`sqlite:${currentDbName}\`)` to `Database.load(dbUrlFor(currentDbName))`.

Create `src/lib/modes.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import { switchDb, seedPresentationDb } from "../db";
import { useAppStore } from "../stores/app-store";

export async function enterTestMode(): Promise<void> {
  await invoke<string>("enter_test_mode");
  await switchDb("studiomanager_test.db");
  useAppStore.getState().setTestMode(true);
}

export async function exitTestMode(): Promise<void> {
  await invoke("exit_test_mode");
  await switchDb("studiomanager.db");
  useAppStore.getState().setTestMode(false);
}

export async function enterPresentationMode(): Promise<void> {
  await invoke<string>("enter_presentation_mode");
  await switchDb("studiomanager_presentation.db");
  await seedPresentationDb();
  useAppStore.getState().setPresentationMode(true);
}

export async function exitPresentationMode(): Promise<void> {
  await invoke("exit_presentation_mode");
  await switchDb("studiomanager.db");
  useAppStore.getState().setPresentationMode(false);
}
```

In `SettingsPage.tsx` handlers and `MainLayout.tsx` exit handlers, replace the three-line invoke/switchDb/setX sequences with the corresponding `lib/modes.ts` call, keeping their existing toasts, confirmations and `window.location.reload()` timers. Remove now-unused imports (`switchDb`, `seedPresentationDb`, `invoke` where no longer used).

- [ ] **Step 4: Verify** — `npx vitest run && npx tsc --noEmit && npm run lint`.
- [ ] **Step 5: Commit** — `git add -A src/db/index.ts src/lib/modes.ts src/pages/SettingsPage.tsx src/components/layout/MainLayout.tsx src/__tests__/dbOrgUrl.test.ts && git commit -m "feat(orgs): database URL follows the active organisation; shared mode helpers"`

---

### Task 10: Startup gate

**Files:**
- Modify: `src/App.tsx:160-190` (`App` component)
- Create: `src/components/OrgGate.tsx`
- Test: `src/__tests__/orgGate.test.tsx`

**Interfaces:**
- Produces: `<OrgGate>{children}</OrgGate>` renders `PageSpinner` until `useOrgStore.loaded`, calls `load()` once, shows the existing fatal DB overlay path on failure (via `showFatalDbError` exported from `db/index.ts`).
- Consumes: `useOrgStore.load` (Task 7).

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { OrgGate } from "../components/OrgGate";
import { useOrgStore } from "../stores/org-store";
import { setInvokeHandler } from "../__mocks__/tauri-api";

beforeEach(() => useOrgStore.setState({ organisations: [], activeId: "", loaded: false }));
afterEach(() => { setInvokeHandler(null); cleanup(); });

describe("OrgGate", () => {
  it("renders children only after the registry loaded", async () => {
    let resolve!: (v: unknown) => void;
    setInvokeHandler((cmd) => (cmd === "list_organisations" ? new Promise((r) => { resolve = r; }) : null));
    render(<OrgGate><div>app</div></OrgGate>);
    expect(screen.queryByText("app")).toBeNull();
    resolve({ version: 1, activeId: "o1", organisations: [{ id: "o1", name: "S", createdAt: "", prefs: null }] });
    await waitFor(() => expect(screen.getByText("app")).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run to verify it fails** — module not found.

- [ ] **Step 3: Implement `src/components/OrgGate.tsx`**

```tsx
import { useEffect, type ReactNode } from "react";
import { useOrgStore } from "../stores/org-store";
import { showFatalDbError } from "../db";
import { PageSpinner } from "./ui/PageSpinner";

/** Blocks the app until the organisation registry is loaded, so no query
 *  can open a database before the active organisation is known. */
export function OrgGate({ children }: { children: ReactNode }) {
  const loaded = useOrgStore((s) => s.loaded);
  useEffect(() => {
    if (loaded) return;
    useOrgStore.getState().load().catch((e) => showFatalDbError(e));
  }, [loaded]);
  if (!loaded) return <PageSpinner />;
  return <>{children}</>;
}
```

Export `showFatalDbError` from `src/db/index.ts` (change `function showFatalDbError` to `export function showFatalDbError`). Confirm the spinner's actual path with `grep -rn "export function PageSpinner" src/components` and import from there.

In `App.tsx`, wrap: `<QueryClientProvider client={queryClient}><OrgGate><StartupChecks key={activeId} />…</OrgGate>…` where `const activeId = useOrgStore((s) => s.activeId);` is read in `App`. The `key` makes the startup hooks (overdue, recurring, auto-backup) re-run after a switch.

- [ ] **Step 4: Verify** — `npx vitest run && npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git add -A src/App.tsx src/components/OrgGate.tsx src/db/index.ts src/__tests__/orgGate.test.tsx && git commit -m "feat(orgs): gate startup on the organisation registry"`

---

### Task 11: Document folders via `orgPaths()`

**Files:**
- Create: `src/lib/orgPaths.ts`
- Modify: `src/lib/invoicePdfStore.ts:86-87`, `src/pages/ExpensesPage.tsx:187-188, 261-262`, `src/pages/IncomePage.tsx:152-153, 236-237`, `src/pages/QuotesPage.tsx:181-182`, `src/pages/InvoicesPage.tsx:318-319`, `src/lib/backup.ts:175-176, 195-196, 577-580` (and the invoices restore block right after)
- Test: `src/__tests__/orgPaths.test.ts`

**Interfaces:**
- Produces: `orgPaths(): Promise<{ root: string; invoicesDir: string; receiptsDir: string }>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { orgPaths } from "../lib/orgPaths";
import { useOrgStore } from "../stores/org-store";

describe("orgPaths", () => {
  beforeEach(() => useOrgStore.setState({ activeId: "" }));
  it("uses the organisation folder when one is active", async () => {
    useOrgStore.setState({ activeId: "k3f9a2" });
    expect(await orgPaths()).toEqual({
      root: "/tmp/test-app-data/orgs/k3f9a2",
      invoicesDir: "/tmp/test-app-data/orgs/k3f9a2/invoices",
      receiptsDir: "/tmp/test-app-data/orgs/k3f9a2/receipts",
    });
  });
  it("falls back to the app data folder before load", async () => {
    expect((await orgPaths()).invoicesDir).toBe("/tmp/test-app-data/invoices");
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

```ts
import { appDataDir } from "@tauri-apps/api/path";
import { useOrgStore } from "../stores/org-store";

/** Document folders of the active organisation. */
export async function orgPaths(): Promise<{ root: string; invoicesDir: string; receiptsDir: string }> {
  const base = (await appDataDir()).replace(/\/$/, "");
  const id = useOrgStore.getState().activeId;
  const root = id ? `${base}/orgs/${id}` : base;
  return { root, invoicesDir: `${root}/invoices`, receiptsDir: `${root}/receipts` };
}
```

Replace each `const dataDir = await appDataDir(); const invoicesDir = \`${dataDir}/invoices\`;` with `const { invoicesDir } = await orgPaths();`, each receipts pair with `const { receiptsDir } = await orgPaths();`, and the two temp-PDF constructions in QuotesPage/InvoicesPage with `const { root } = await orgPaths(); const tempPath = \`${root}/temp_…\`` . In `backup.ts` do the same in `createBackup` and `restoreFromBackup`. Remove unused `appDataDir` imports.

- [ ] **Step 4: Verify** — `npx vitest run && npx tsc --noEmit && npm run lint`; `grep -rn "appDataDir()" src --include='*.ts' --include='*.tsx' | grep -v __mocks__ | grep -v orgPaths.ts` must print nothing.
- [ ] **Step 5: Commit** — `git commit -am "feat(orgs): document folders resolve through orgPaths()"`

---

### Task 12: Backups per organisation

**Files:**
- Modify: `src/lib/backup.ts:147-160, 243-260, 274-282`, `src/hooks/useAutoBackup.ts`, `src/stores/app-store.ts` (`lastAutoBackup` init and setter)
- Test: extend `src/__tests__/backupIo.test.ts` (read it first for its harness) with the naming cases below.

**Interfaces:**
- Produces: backup folder name `backup-<orgId>-<timestamp>`; `rotateBackups` and `listBackups` only consider the active organisation's folders; `setLastAutoBackup` stores under `orgKey("lastAutoBackup")`; the org store loads `lastAutoBackup` for the active organisation on `applyRegistry`.

- [ ] **Step 1: Write the failing tests** (in `backupIo.test.ts`, using its existing mocks for `mkdir`/`readDir`):

```ts
it("names the backup folder with the organisation id", async () => {
  useOrgStore.setState({ activeId: "k3f9a2" });
  const path = await createBackup("/backups", 5);
  expect(path).toMatch(/\/backups\/backup-k3f9a2-\d{4}-\d{2}-\d{2}/);
});

it("rotation and listing ignore other organisations' backups", async () => {
  useOrgStore.setState({ activeId: "k3f9a2" });
  setReadDirEntries("/backups", ["backup-k3f9a2-2026-01-01", "backup-zzz999-2026-01-02", "backup-2026-01-03"]);
  expect(await listBackups("/backups")).toEqual(["backup-k3f9a2-2026-01-01"]);
});
```

Adapt `setReadDirEntries` to whatever helper `backupIo.test.ts` already uses to stub `readDir`; if none exists, add one to the test file with `vi.mock("@tauri-apps/plugin-fs", …)` following the file's current pattern.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement** — in `backup.ts`:

```ts
import { useOrgStore } from "../stores/org-store";
function backupPrefix(): string { return `backup-${useOrgStore.getState().activeId}-`; }
```

`createBackup`: `const backupPath = \`${backupDir}/${backupPrefix()}${ts}\`;`. In `rotateBackups` and `listBackups` replace `e.name?.startsWith("backup-")` with `e.name?.startsWith(backupPrefix())`.

In `app-store.ts`: `lastAutoBackup: 0` initially; `setLastAutoBackup: (ts) => { localStorage.setItem(useOrgStore.getState().orgKey("lastAutoBackup"), String(ts)); set({ lastAutoBackup: ts }); }`. In `org-store.ts` `applyRegistry`, after applying prefs: `useAppStore.setState({ lastAutoBackup: Number(localStorage.getItem(get().orgKey("lastAutoBackup"))) || 0 });`.

- [ ] **Step 4: Verify** — `npx vitest run && npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git commit -am "feat(orgs): backups are per organisation"`

---

### Task 13: Namespaced tabs, timer and task-page keys

**Files:**
- Modify: `src/stores/tab-store.ts:10-30` and the store actions, `src/stores/app-store.ts:120-135, 284-296` (timer persistence), `src/pages/TasksPage.tsx:74-80, 206, 277`, `src/stores/org-store.ts` (`applyRegistry` calls the reloads)
- Test: `src/__tests__/orgNamespacedKeys.test.ts`

**Interfaces:**
- Produces: `useTabStore.getState().closeAllTabs()`, `useTabStore.getState().reloadForOrg()`, `useAppStore.getState().reloadTimerForOrg()`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useTabStore } from "../stores/tab-store";
import { useAppStore } from "../stores/app-store";
import { useOrgStore } from "../stores/org-store";

beforeEach(() => { localStorage.clear(); useOrgStore.setState({ activeId: "o1" }); });

describe("organisation-namespaced localStorage", () => {
  it("tabs persist under open-tabs:<id> and reload per organisation", () => {
    useTabStore.getState().reloadForOrg();
    useTabStore.getState().openTab("/clients", "Clients");
    expect(localStorage.getItem("open-tabs:o1")).toContain("/clients");
    expect(localStorage.getItem("open-tabs")).toBeNull();
    useOrgStore.setState({ activeId: "o2" });
    useTabStore.getState().reloadForOrg();
    expect(useTabStore.getState().tabs.filter((t) => t.path === "/clients")).toHaveLength(0);
  });

  it("closeAllTabs leaves only the dashboard tab", () => {
    useTabStore.getState().reloadForOrg();
    useTabStore.getState().openTab("/clients", "Clients");
    useTabStore.getState().closeAllTabs();
    expect(useTabStore.getState().tabs.map((t) => t.path)).toEqual(["/"]);
  });

  it("timer persists under activeTimer:<id>", () => {
    useAppStore.getState().startTimer(1, 2, "P");
    expect(localStorage.getItem("activeTimer:o1")).not.toBeNull();
    useOrgStore.setState({ activeId: "o2" });
    useAppStore.getState().reloadTimerForOrg();
    expect(useAppStore.getState().activeTimer).toBeNull();
  });
});
```

Check the tab store's default tab shape first (`grep -n "path: \"/\"" src/stores/tab-store.ts`) and adjust the `closeAllTabs` expectation to the actual home tab if it differs.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** — `tab-store.ts`: replace `const STORAGE_KEY = "open-tabs"` with `const storageKey = () => useOrgStore.getState().orgKey("open-tabs");` and use `storageKey()` in the load/save helpers; add actions:

```ts
  closeAllTabs: () => { const home = defaultTabs(); set({ tabs: home, activeTabId: home[0].id }); saveTabs(home, home[0].id); },
  reloadForOrg: () => { const { tabs, activeTabId } = loadTabs(); set({ tabs, activeTabId }); },
```

(`defaultTabs`, `loadTabs`, `saveTabs` are the existing helpers; rename to match what the file actually has.) `app-store.ts`: `loadActiveTimer()` reads `localStorage.getItem(useOrgStore.getState().orgKey("activeTimer"))`; `startTimer`/`clearTimer` write and remove the namespaced key; add `reloadTimerForOrg: () => set({ activeTimer: loadActiveTimer() })`. `TasksPage.tsx`: wrap the two keys with `useOrgStore.getState().orgKey(...)`. In `org-store.ts` `applyRegistry`, after prefs: `useTabStore.getState().reloadForOrg(); useAppStore.getState().reloadTimerForOrg();` (import `useTabStore` lazily inside the function to avoid an import cycle at module load: `const { useTabStore } = await import("./tab-store")` is not possible in a sync action, so import at top and confirm `tab-store.ts` does not import `org-store` at module evaluation beyond the function-level call).

- [ ] **Step 4: Verify** — `npx vitest run && npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git commit -am "feat(orgs): tabs, timer and task-page state are per organisation"`

---

### Task 14: The switch sequence

**Files:**
- Create: `src/lib/switchOrganisation.ts`
- Test: `src/__tests__/switchOrganisation.test.ts`

**Interfaces:**
- Produces: `switchOrganisation(id: string, deps: SwitchDeps): Promise<boolean>` with
  `interface SwitchDeps { confirmIfDirty: () => Promise<boolean>; stopTimer: () => Promise<boolean>; exitTestMode: () => Promise<void>; exitPresentationMode: () => Promise<void>; resetDb: () => Promise<void>; switchCmd: (id: string) => Promise<Registry>; applyRegistry: (r: Registry) => void; clearQueries: () => void; closeAllTabs: () => void; navigate: (path: string) => void; }`
  and `defaultSwitchDeps(navigate, stopTimer)` assembling the real ones.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { switchOrganisation, type SwitchDeps } from "../lib/switchOrganisation";
import { useAppStore } from "../stores/app-store";

function deps(overrides: Partial<SwitchDeps> = {}) {
  const calls: string[] = [];
  const mk = <T,>(name: string, ret: T) => vi.fn(async () => { calls.push(name); return ret; });
  const d: SwitchDeps = {
    confirmIfDirty: mk("confirm", true),
    stopTimer: mk("stopTimer", true),
    exitTestMode: mk("exitTest", undefined),
    exitPresentationMode: mk("exitPres", undefined),
    resetDb: mk("resetDb", undefined),
    switchCmd: vi.fn(async (id: string) => { calls.push("switch:" + id); return { version: 1, activeId: id, organisations: [] }; }),
    applyRegistry: vi.fn(() => { calls.push("apply"); }),
    clearQueries: vi.fn(() => { calls.push("clear"); }),
    closeAllTabs: vi.fn(() => { calls.push("closeTabs"); }),
    navigate: vi.fn((p: string) => { calls.push("nav:" + p); }),
    ...overrides,
  };
  return { d, calls };
}

describe("switchOrganisation", () => {
  it("runs the steps in order with no mode and no timer", async () => {
    useAppStore.setState({ testMode: false, presentationMode: false, activeTimer: null });
    const { d, calls } = deps();
    expect(await switchOrganisation("o2", d)).toBe(true);
    // applyRegistry runs before resetDb: resetDb reopens the connection, and
    // the URL it opens is built from the org store's activeId.
    expect(calls).toEqual(["confirm", "switch:o2", "apply", "resetDb", "clear", "closeTabs", "nav:/"]);
  });

  it("stops early when the dirty guard declines", async () => {
    const { d, calls } = deps({ confirmIfDirty: vi.fn(async () => false) });
    expect(await switchOrganisation("o2", d)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("exits an active mode and stops a running timer before switching", async () => {
    useAppStore.setState({ testMode: true, presentationMode: false, activeTimer: { taskId: 1, projectId: 1, startedAt: Date.now() } as never });
    const { d, calls } = deps();
    await switchOrganisation("o2", d);
    expect(calls.slice(0, 3)).toEqual(["confirm", "exitTest", "stopTimer"]);
  });

  it("aborts if the timer could not be saved", async () => {
    useAppStore.setState({ testMode: false, presentationMode: false, activeTimer: { taskId: 1, projectId: 1, startedAt: Date.now() } as never });
    const { d, calls } = deps({ stopTimer: vi.fn(async () => false) });
    expect(await switchOrganisation("o2", d)).toBe(false);
    expect(calls).not.toContain("switch:o2");
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

```ts
import { useAppStore } from "../stores/app-store";
import { useOrgStore } from "../stores/org-store";
import { useTabStore } from "../stores/tab-store";
import { confirmIfDirty } from "./dirty-guard";
import { exitPresentationMode, exitTestMode } from "./modes";
import { resetDb } from "../db";
import { switchOrganisationCmd, type Registry } from "./orgs";
import { queryClient } from "./queryClient";

export interface SwitchDeps {
  confirmIfDirty: () => Promise<boolean>;
  stopTimer: () => Promise<boolean>;
  exitTestMode: () => Promise<void>;
  exitPresentationMode: () => Promise<void>;
  resetDb: () => Promise<void>;
  switchCmd: (id: string) => Promise<Registry>;
  applyRegistry: (r: Registry) => void;
  clearQueries: () => void;
  closeAllTabs: () => void;
  navigate: (path: string) => void;
}

export function defaultSwitchDeps(navigate: (p: string) => void, stopTimer: () => Promise<boolean>): SwitchDeps {
  return {
    confirmIfDirty: () => confirmIfDirty(),
    stopTimer,
    exitTestMode,
    exitPresentationMode,
    resetDb,
    switchCmd: switchOrganisationCmd,
    applyRegistry: (r) => useOrgStore.getState().applyRegistry(r),
    clearQueries: () => queryClient.clear(),
    closeAllTabs: () => useTabStore.getState().closeAllTabs(),
    navigate,
  };
}

/** Ordered switch. Returns false when the user declined or the timer could not be saved. */
export async function switchOrganisation(id: string, deps: SwitchDeps): Promise<boolean> {
  if (!(await deps.confirmIfDirty())) return false;
  const { testMode, presentationMode, activeTimer } = useAppStore.getState();
  if (testMode) await deps.exitTestMode();
  if (presentationMode) await deps.exitPresentationMode();
  if (activeTimer) {
    const saved = await deps.stopTimer();
    if (!saved) return false;
  }
  const reg = await deps.switchCmd(id);
  // Registry first: resetDb reopens the connection with a URL built from activeId.
  deps.applyRegistry(reg);
  await deps.resetDb();
  deps.clearQueries();
  deps.closeAllTabs();
  deps.navigate("/");
  return true;
}
```

- [ ] **Step 4: Verify** — `npx vitest run src/__tests__/switchOrganisation.test.ts` → 4 passed.
- [ ] **Step 5: Commit** — `git add src/lib/switchOrganisation.ts src/__tests__/switchOrganisation.test.ts && git commit -m "feat(orgs): ordered organisation switch sequence"`

---

### Task 15: i18n keys

**Files:**
- Modify: `src/i18n/ui.ts` (both `EN` and `FR` objects)

- [ ] **Step 1: Add the keys** (EN, then the accent-free FR equivalents):

```ts
    // Organisations
    organisations: "Organisations",
    organisation: "Organisation",
    switch_organisation: "Switch organisation",
    new_organisation: "New organisation",
    manage_organisations: "Manage organisations",
    organisation_name: "Organisation name",
    organisation_name_required: "Organisation name is required",
    organisation_name_taken: "An organisation with this name already exists",
    create_organisation: "Create organisation",
    start_empty: "Start empty",
    start_empty_desc: "Fresh database. You fill in profile, bank, activities and categories.",
    start_from_current: "Start from the current organisation's settings",
    start_from_current_desc: "Copies business profile, bank details, activities, expense categories and templates. No clients or documents.",
    organisation_created: "Organisation created",
    organisation_switched: "Switched to {name}",
    organisation_switch_failed: "Could not switch organisation",
    rename_organisation: "Rename",
    delete_organisation: "Delete organisation",
    delete_organisation_confirm: "Type the organisation name to confirm. Its folder is moved to the Trash.",
    delete_organisation_active: "Switch to another organisation first",
    delete_organisation_last: "The last organisation cannot be deleted",
    organisation_deleted: "Organisation moved to the Trash",
    organisations_desc: "Each organisation has its own clients, projects, documents, bank details and finances.",
    mode_in_organisation: "in {name}",
```

FR (accent-free):

```ts
    organisations: "Organisations",
    organisation: "Organisation",
    switch_organisation: "Changer d'organisation",
    new_organisation: "Nouvelle organisation",
    manage_organisations: "Gerer les organisations",
    organisation_name: "Nom de l'organisation",
    organisation_name_required: "Le nom de l'organisation est requis",
    organisation_name_taken: "Une organisation porte deja ce nom",
    create_organisation: "Creer l'organisation",
    start_empty: "Partir de zero",
    start_empty_desc: "Base vide. Vous remplissez profil, banque, activites et categories.",
    start_from_current: "Reprendre les reglages de l'organisation actuelle",
    start_from_current_desc: "Copie le profil, les coordonnees bancaires, les activites, les categories de depenses et les modeles. Aucun client ni document.",
    organisation_created: "Organisation creee",
    organisation_switched: "Passage a {name}",
    organisation_switch_failed: "Impossible de changer d'organisation",
    rename_organisation: "Renommer",
    delete_organisation: "Supprimer l'organisation",
    delete_organisation_confirm: "Tapez le nom de l'organisation pour confirmer. Son dossier est deplace vers la corbeille.",
    delete_organisation_active: "Changez d'abord d'organisation",
    delete_organisation_last: "La derniere organisation ne peut pas etre supprimee",
    organisation_deleted: "Organisation deplacee vers la corbeille",
    organisations_desc: "Chaque organisation a ses propres clients, projets, documents, coordonnees bancaires et finances.",
    mode_in_organisation: "dans {name}",
```

- [ ] **Step 2: Verify** — `npx vitest run src/__tests__/i18nParity.test.ts && npx tsc --noEmit`.
- [ ] **Step 3: Commit** — `git commit -am "feat(orgs): i18n keys"`

---

### Task 16: Sidebar switcher, window title, shortcut

**Files:**
- Create: `src/components/layout/OrgSwitcher.tsx`
- Modify: `src/components/layout/Sidebar.tsx:203` (brand row), `src/components/GlobalShortcuts.tsx:32-56`, `src/components/layout/MainLayout.tsx` (title effect and banners)
- Test: `src/__tests__/orgSwitcher.test.tsx`

**Interfaces:**
- Produces: `<OrgSwitcher collapsed={boolean} onCreate={() => void} />`; dispatches `window` event `sm:open-org-switcher` handling for Cmd+Shift+O.
- Consumes: `switchOrganisation` + `defaultSwitchDeps` (Task 14), `useTimerActions().stopAndSave`, `ContextMenu` (`src/components/ContextMenu.tsx`).

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OrgSwitcher } from "../components/layout/OrgSwitcher";
import { useOrgStore } from "../stores/org-store";
import { useAppStore } from "../stores/app-store";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";

const registry = { version: 1, activeId: "o1", organisations: [
  { id: "o1", name: "Studio", createdAt: "", prefs: null },
  { id: "o2", name: "Label", createdAt: "", prefs: null },
] };

function mount(onCreate = vi.fn()) {
  const qc = new QueryClient();
  render(<QueryClientProvider client={qc}><MemoryRouter><OrgSwitcher collapsed={false} onCreate={onCreate} /></MemoryRouter></QueryClientProvider>);
  return onCreate;
}

beforeEach(() => {
  clearInvokedCommands();
  useAppStore.setState({ language: "EN", testMode: false, presentationMode: false, activeTimer: null });
  useOrgStore.getState().applyRegistry(registry);
  setInvokeHandler((cmd, args) => (cmd === "switch_organisation" ? { ...registry, activeId: args.id } : null));
});
afterEach(() => { setInvokeHandler(null); cleanup(); });

describe("OrgSwitcher", () => {
  it("shows the active name and lists the others on click", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /studio/i }));
    expect(screen.getByRole("menuitem", { name: /label/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /new organisation/i })).toBeInTheDocument();
  });

  it("switches when another organisation is chosen", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /studio/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /label/i }));
    await waitFor(() => expect(invokedCommands.some((c) => c.cmd === "switch_organisation" && c.args.id === "o2")).toBe(true));
    await waitFor(() => expect(useOrgStore.getState().activeId).toBe("o2"));
  });

  it("opens the create dialog callback", () => {
    const onCreate = mount();
    fireEvent.click(screen.getByRole("button", { name: /studio/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /new organisation/i }));
    expect(onCreate).toHaveBeenCalled();
  });

  it("opens on the Cmd+Shift+O window event", () => {
    mount();
    window.dispatchEvent(new CustomEvent("sm:open-org-switcher"));
    expect(screen.getByRole("menuitem", { name: /label/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement `OrgSwitcher.tsx`**

```tsx
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ChevronsUpDown, Plus, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";
import { useOrgStore } from "../../stores/org-store";
import { useTimerActions } from "../../hooks/useTimerActions";
import { switchOrganisation, defaultSwitchDeps } from "../../lib/switchOrganisation";
import { notifyError } from "../../lib/notifyError";
import { useT } from "../../i18n/useT";

export function OrgSwitcher({ collapsed, onCreate }: { collapsed: boolean; onCreate: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const { stopAndSave } = useTimerActions();
  const organisations = useOrgStore((s) => s.organisations);
  const activeId = useOrgStore((s) => s.activeId);
  const active = organisations.find((o) => o.id === activeId);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    setMenu({ x: r ? r.left : 16, y: r ? r.bottom + 4 : 56 });
  };

  useEffect(() => {
    const handler = () => openMenu();
    window.addEventListener("sm:open-org-switcher", handler);
    return () => window.removeEventListener("sm:open-org-switcher", handler);
  }, []);

  const doSwitch = async (id: string) => {
    if (id === activeId) return;
    try {
      const ok = await switchOrganisation(id, defaultSwitchDeps(navigate, stopAndSave));
      if (ok) {
        const name = organisations.find((o) => o.id === id)?.name ?? "";
        toast.success(t.organisation_switched.replace("{name}", name));
      }
    } catch (e) {
      notifyError(t.organisation_switch_failed, e);
    }
  };

  const items: ContextMenuItem[] = [
    ...organisations.map((o) => ({
      label: o.name,
      icon: o.id === activeId ? <Check size={14} /> : <span className="inline-block w-3.5" />,
      onClick: () => void doSwitch(o.id),
    })),
    { label: t.new_organisation, icon: <Plus size={14} />, onClick: onCreate, divider: true },
    { label: t.manage_organisations, icon: <Settings2 size={14} />, onClick: () => navigate("/settings?category=organisations") },
  ];

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={openMenu}
        aria-label={`${t.organisation}: ${active?.name ?? ""}`}
        aria-haspopup="menu"
        className={`flex items-center gap-2 w-full rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--color-hover-row)] ${collapsed ? "justify-center" : ""}`}
      >
        <span className="flex items-center justify-center w-6 h-6 rounded-md bg-[var(--color-input-bg)] text-xs font-semibold shrink-0">
          {(active?.name ?? "?").slice(0, 1).toUpperCase()}
        </span>
        {!collapsed && (
          <>
            <span className="truncate flex-1 text-left font-medium">{active?.name}</span>
            <ChevronsUpDown size={14} className="text-muted shrink-0" />
          </>
        )}
      </button>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </>
  );
}
```

Check `ContextMenu` renders items with `role="menuitem"` and honours a `divider` flag as "divider before this item" (read `src/components/ContextMenu.tsx:25-90`); if `divider` means "after", move the flag to the last organisation entry instead.

In `Sidebar.tsx`, below the brand row add `<div className="px-2 pt-2"><OrgSwitcher collapsed={collapsed} onCreate={() => setCreateOpen(true)} /></div>` and render `<OrgCreateDialog open={createOpen} onClose={() => setCreateOpen(false)} />` (component from Task 17; until then a stub dialog with `open`/`onClose` props is fine). In `GlobalShortcuts.tsx` handler, before the Cmd+B check, add:

```ts
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "o" || e.key === "O") && !inTypingContext(e)) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("sm:open-org-switcher"));
        return;
      }
```

and relax the early `e.shiftKey` return so this branch runs first. In `MainLayout.tsx` add `const orgName = useOrgStore((s) => s.active()?.name ?? "");` and `useEffect(() => { document.title = orgName ? \`StudioManager — ${orgName}\` : "StudioManager"; }, [orgName]);` (Tauri syncs `document.title` to the window title), and append `{" "}{t.mode_in_organisation.replace("{name}", orgName)}` to both banner texts. `SettingsPage` reads `?category=` from `useSearchParams` to preselect the Organisations category (Task 18 adds the category).

- [ ] **Step 4: Verify** — `npx vitest run && npx tsc --noEmit && npm run lint`.
- [ ] **Step 5: Commit** — `git add -A src/components src/__tests__/orgSwitcher.test.tsx && git commit -m "feat(orgs): sidebar organisation switcher, window title, Cmd+Shift+O"`

---

### Task 17: Create dialog

**Files:**
- Create: `src/components/OrgCreateDialog.tsx`
- Test: `src/__tests__/orgCreateDialog.test.tsx`

**Interfaces:**
- Produces: `<OrgCreateDialog open onClose />`; on submit calls `createOrganisation(name, seed, DEFAULT_ORG_PREFS)` then `switchOrganisation(newId, …)`.
- Consumes: `Modal`, `Input`, `Button` from `components/ui`, Tasks 7 and 14.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OrgCreateDialog } from "../components/OrgCreateDialog";
import { useOrgStore } from "../stores/org-store";
import { useAppStore } from "../stores/app-store";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";

const base = { version: 1, activeId: "o1", organisations: [{ id: "o1", name: "Studio", createdAt: "", prefs: null }] };

beforeEach(() => {
  clearInvokedCommands();
  useAppStore.setState({ language: "EN", testMode: false, presentationMode: false, activeTimer: null });
  useOrgStore.getState().applyRegistry(base);
  setInvokeHandler((cmd, args) => {
    if (cmd === "create_organisation") return { ...base, organisations: [...base.organisations, { id: "o2", name: args.name, createdAt: "", prefs: args.prefs }] };
    if (cmd === "switch_organisation") return { ...base, activeId: "o2", organisations: [...base.organisations, { id: "o2", name: "Label", createdAt: "", prefs: null }] };
    return null;
  });
});
afterEach(() => { setInvokeHandler(null); cleanup(); });

function mount(onClose = vi.fn()) {
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><OrgCreateDialog open onClose={onClose} /></MemoryRouter></QueryClientProvider>);
  return onClose;
}

describe("OrgCreateDialog", () => {
  it("requires a name", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /create organisation/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/required/i);
    expect(invokedCommands.some((c) => c.cmd === "create_organisation")).toBe(false);
  });

  it("creates with the chosen seeding option, switches, and closes", async () => {
    const onClose = mount();
    fireEvent.change(screen.getByLabelText(/organisation name/i), { target: { value: "Label" } });
    fireEvent.click(screen.getByLabelText(/start from the current/i));
    fireEvent.click(screen.getByRole("button", { name: /create organisation/i }));
    await waitFor(() => expect(invokedCommands.find((c) => c.cmd === "create_organisation")?.args).toMatchObject({ name: "Label", seedFromCurrent: true }));
    await waitFor(() => expect(invokedCommands.some((c) => c.cmd === "switch_organisation" && c.args.id === "o2")).toBe(true));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { FormField } from "./ui/FormField";
import { createOrganisation, DEFAULT_ORG_PREFS } from "../lib/orgs";
import { useOrgStore } from "../stores/org-store";
import { useTimerActions } from "../hooks/useTimerActions";
import { switchOrganisation, defaultSwitchDeps } from "../lib/switchOrganisation";
import { notifyError } from "../lib/notifyError";
import { useT } from "../i18n/useT";

export function OrgCreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const { stopAndSave } = useTimerActions();
  const [name, setName] = useState("");
  const [seed, setSeed] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const reset = () => { setName(""); setSeed(false); setError(undefined); };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError(t.organisation_name_required); return; }
    if (useOrgStore.getState().organisations.some((o) => o.name.toLowerCase() === trimmed.toLowerCase())) {
      setError(t.organisation_name_taken); return;
    }
    setBusy(true);
    try {
      const reg = await createOrganisation(trimmed, seed, { ...DEFAULT_ORG_PREFS });
      useOrgStore.setState({ organisations: reg.organisations });
      const created = reg.organisations.find((o) => o.name === trimmed);
      toast.success(t.organisation_created);
      if (created) await switchOrganisation(created.id, defaultSwitchDeps(navigate, stopAndSave));
      reset();
      onClose();
    } catch (e) {
      notifyError(t.organisation_switch_failed, e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={() => { reset(); onClose(); }} title={t.new_organisation}
      footer={<><Button variant="ghost" size="sm" onClick={() => { reset(); onClose(); }}>{t.cancel}</Button><Button size="sm" onClick={submit} loading={busy}>{t.create_organisation}</Button></>}>
      <div className="space-y-4">
        <FormField label={t.organisation_name} required error={error}>
          <Input value={name} onChange={(e) => { setName(e.target.value); setError(undefined); }} onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} autoFocus />
        </FormField>
        <fieldset className="space-y-2">
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input type="radio" name="seed" checked={!seed} onChange={() => setSeed(false)} className="mt-1 accent-[var(--accent)]" />
            <span><span className="font-medium">{t.start_empty}</span><span className="block text-xs text-muted">{t.start_empty_desc}</span></span>
          </label>
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input type="radio" name="seed" checked={seed} onChange={() => setSeed(true)} className="mt-1 accent-[var(--accent)]" />
            <span><span className="font-medium">{t.start_from_current}</span><span className="block text-xs text-muted">{t.start_from_current_desc}</span></span>
          </label>
        </fieldset>
      </div>
    </Modal>
  );
}
```

Confirm the `Input` component path and props (`grep -n "export const Input\|export function Input" src/components/ui/Input.tsx`).

- [ ] **Step 4: Verify** — `npx vitest run && npx tsc --noEmit && npm run lint`.
- [ ] **Step 5: Commit** — `git add src/components/OrgCreateDialog.tsx src/__tests__/orgCreateDialog.test.tsx src/components/layout/Sidebar.tsx && git commit -m "feat(orgs): create organisation dialog"`

---

### Task 18: Settings → Organisations card

**Files:**
- Create: `src/components/settings/OrganisationsCard.tsx`
- Modify: `src/pages/SettingsPage.tsx:29` (category union), `:318-330` (Data group items), `:624` (render block), plus `useSearchParams` preselection
- Test: `src/__tests__/organisationsCard.test.tsx`

**Interfaces:**
- Produces: `<OrganisationsCard />` (self-contained: reads the org store, calls rename/reorder/delete wrappers, refreshes the store from the returned registry).

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { OrganisationsCard } from "../components/settings/OrganisationsCard";
import { useOrgStore } from "../stores/org-store";
import { useAppStore } from "../stores/app-store";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";

const reg = { version: 1, activeId: "o1", organisations: [
  { id: "o1", name: "Studio", createdAt: "", prefs: null },
  { id: "o2", name: "Label", createdAt: "", prefs: null },
] };

beforeEach(() => {
  clearInvokedCommands();
  useAppStore.setState({ language: "EN" });
  useOrgStore.getState().applyRegistry(reg);
  setInvokeHandler((cmd, args) => {
    if (cmd === "rename_organisation") return { ...reg, organisations: reg.organisations.map((o) => (o.id === args.id ? { ...o, name: args.name as string } : o)) };
    if (cmd === "delete_organisation") return { ...reg, organisations: reg.organisations.filter((o) => o.id !== args.id) };
    return null;
  });
});
afterEach(() => { setInvokeHandler(null); cleanup(); });

describe("OrganisationsCard", () => {
  it("renames inline on Enter", async () => {
    render(<OrganisationsCard />);
    fireEvent.click(screen.getAllByRole("button", { name: /rename/i })[1]);
    const input = screen.getByDisplayValue("Label");
    fireEvent.change(input, { target: { value: "Music Label" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(invokedCommands.find((c) => c.cmd === "rename_organisation")?.args).toEqual({ id: "o2", name: "Music Label" }));
    await waitFor(() => expect(screen.getByText("Music Label")).toBeInTheDocument());
  });

  it("disables delete on the active organisation and requires typing the name for others", async () => {
    render(<OrganisationsCard />);
    const deletes = screen.getAllByRole("button", { name: /delete organisation/i });
    expect(deletes[0]).toBeDisabled();
    fireEvent.click(deletes[1]);
    const confirmBtn = screen.getByRole("button", { name: /^delete$/i });
    expect(confirmBtn).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Label"), { target: { value: "Label" } });
    expect(confirmBtn).toBeEnabled();
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(invokedCommands.some((c) => c.cmd === "delete_organisation" && c.args.id === "o2")).toBe(true));
    await waitFor(() => expect(screen.queryByText("Label")).toBeNull());
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

```tsx
import { useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Modal } from "../ui/Modal";
import { useOrgStore } from "../../stores/org-store";
import { renameOrganisation, reorderOrganisations, deleteOrganisation } from "../../lib/orgs";
import { notifyError } from "../../lib/notifyError";
import { useT } from "../../i18n/useT";

export function OrganisationsCard() {
  const t = useT();
  const organisations = useOrgStore((s) => s.organisations);
  const activeId = useOrgStore((s) => s.activeId);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const [typed, setTyped] = useState("");

  const apply = (reg: { organisations: typeof organisations; activeId: string }) =>
    useOrgStore.setState({ organisations: reg.organisations, activeId: reg.activeId });

  const commitRename = async () => {
    if (!editing) return;
    try { apply(await renameOrganisation(editing.id, editing.name)); setEditing(null); }
    catch (e) { notifyError(t.organisation_name_taken, e); }
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const ids = organisations.map((o) => o.id);
    const j = idx + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    try { apply(await reorderOrganisations(ids)); } catch (e) { notifyError(t.operation_failed, e); }
  };

  const commitDelete = async () => {
    if (!deleting) return;
    try { apply(await deleteOrganisation(deleting.id)); toast.success(t.organisation_deleted); setDeleting(null); setTyped(""); }
    catch (e) { notifyError(t.operation_failed, e); }
  };

  return (
    <section className="rounded-xl bg-[var(--color-surface)] border border-[var(--color-border-divider)] px-4 pt-3 pb-1">
      <div className="border-b border-[var(--color-border-divider)] pb-2 mb-3">
        <h2 className="text-[10px] font-medium uppercase tracking-widest text-muted">{t.organisations}</h2>
        <p className="text-xs text-muted mt-0.5">{t.organisations_desc}</p>
      </div>
      <ul>
        {organisations.map((o, idx) => {
          const isActive = o.id === activeId;
          const isLast = organisations.length === 1;
          return (
            <li key={o.id} className="flex items-center gap-2 py-2 border-b border-[var(--color-border-divider)] last:border-b-0">
              {editing?.id === o.id ? (
                <Input value={editing.name} onChange={(e) => setEditing({ id: o.id, name: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") void commitRename(); if (e.key === "Escape") setEditing(null); }} autoFocus />
              ) : (
                <span className="flex-1 text-sm truncate">{o.name}{isActive && <span className="ml-2 text-xs text-muted">({t.active})</span>}</span>
              )}
              <Button variant="ghost" size="sm" icon={<ArrowUp size={12} />} aria-label={t.move_up} disabled={idx === 0} onClick={() => void move(idx, -1)} />
              <Button variant="ghost" size="sm" icon={<ArrowDown size={12} />} aria-label={t.move_down} disabled={idx === organisations.length - 1} onClick={() => void move(idx, 1)} />
              <Button variant="ghost" size="sm" icon={<Pencil size={12} />} aria-label={t.rename_organisation} onClick={() => setEditing({ id: o.id, name: o.name })} />
              <Button variant="ghost" size="sm" icon={<Trash2 size={12} />} aria-label={t.delete_organisation}
                disabled={isActive || isLast} title={isActive ? t.delete_organisation_active : isLast ? t.delete_organisation_last : undefined}
                onClick={() => { setDeleting({ id: o.id, name: o.name }); setTyped(""); }} />
            </li>
          );
        })}
      </ul>
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title={t.delete_organisation}
        footer={<><Button variant="ghost" size="sm" onClick={() => setDeleting(null)}>{t.cancel}</Button><Button variant="danger" size="sm" disabled={typed.trim() !== deleting?.name} onClick={() => void commitDelete()}>{t.delete}</Button></>}>
        <p className="text-sm text-muted mb-3">{t.delete_organisation_confirm}</p>
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={deleting?.name} autoFocus />
      </Modal>
    </section>
  );
}
```

Check that `t.active`, `t.move_up`, `t.move_down`, `t.delete`, `t.operation_failed` exist in `ui.ts`; add any missing key (EN + FR) in this task.

In `SettingsPage.tsx`: add `"organisations"` to the `SettingsCategory` union; add `{ key: "organisations", label: t.organisations, icon: <Building2 size={14} /> }` as the first item of the Data group; render `{activeCategory === "organisations" && <OrganisationsCard />}` next to the other category blocks; initialise `activeCategory` from `useSearchParams().get("category")` when it is a valid key.

- [ ] **Step 4: Verify** — `npx vitest run && npx tsc --noEmit && npm run lint`.
- [ ] **Step 5: Commit** — `git add -A src/components/settings src/pages/SettingsPage.tsx src/i18n/ui.ts src/__tests__/organisationsCard.test.tsx && git commit -m "feat(orgs): manage organisations in Settings"`

---

### Task 19: Real-data rehearsal and docs

**Files:**
- Create: `scripts/rehearse-org-upgrade.sh`
- Modify: `README.md` (Data Location section), `docs/GUIDE.md` (section 6), `IDEAS.md` (New Features done entry), `RELEASING.md` (add a pre-release step for layout upgrades)

- [ ] **Step 1: Write the rehearsal script**

```bash
#!/usr/bin/env bash
# Rehearse the organisation layout upgrade on a COPY of the real app data.
# Usage: scripts/rehearse-org-upgrade.sh [source app dir]
set -euo pipefail
SRC="${1:-$HOME/Library/Application Support/ch.studiomanager.app}"
WORK="$(mktemp -d /tmp/sm-rehearsal.XXXXXX)"
echo "copying $SRC -> $WORK"
rsync -a --exclude 'studiomanager_test.db*' --exclude 'studiomanager_presentation.db*' "$SRC/" "$WORK/"
before_counts() {
  sqlite3 "$1" "SELECT 'invoices',COUNT(*) FROM invoices UNION ALL SELECT 'expenses',COUNT(*) FROM expenses UNION ALL SELECT 'clients',COUNT(*) FROM clients UNION ALL SELECT 'tasks',COUNT(*) FROM tasks UNION ALL SELECT 'time_entries',COUNT(*) FROM time_entries;"
}
echo "== before =="; before_counts "$WORK/studiomanager.db" | tee "$WORK/before.txt"
find "$WORK/invoices" "$WORK/receipts" -type f -exec md5 -q {} + | sort > "$WORK/files-before.md5"
# Run the upgrade through the Rust test harness binary
( cd "$(dirname "$0")/../src-tauri" && cargo run --quiet --bin rehearse-upgrade -- "$WORK" )
ORG=$(ls "$WORK/orgs")
echo "== after (org $ORG) =="; before_counts "$WORK/orgs/$ORG/studiomanager.db" | tee "$WORK/after.txt"
find "$WORK/orgs/$ORG/invoices" "$WORK/orgs/$ORG/receipts" -type f -exec md5 -q {} + | sort > "$WORK/files-after.md5"
diff "$WORK/before.txt" "$WORK/after.txt" && echo "row counts identical"
diff "$WORK/files-before.md5" "$WORK/files-after.md5" && echo "file checksums identical"
echo "unresolved paths:"; sqlite3 "$WORK/orgs/$ORG/studiomanager.db" "SELECT receipt_path FROM expenses WHERE receipt_path LIKE '$SRC/receipts/%' UNION ALL SELECT pdf_path FROM invoices WHERE pdf_path LIKE '$SRC/invoices/%';"
echo "rehearsal folder: $WORK"
```

Add `src-tauri/src/bin/rehearse-upgrade.rs`:

```rust
//! Dev helper: run the organisation layout upgrade on a folder path.
fn main() {
    let dir = std::env::args().nth(1).expect("usage: rehearse-upgrade <app data dir copy>");
    match app_lib::upgrade::run(std::path::Path::new(&dir)) {
        Ok(reg) => println!("upgraded; active org {}", reg.active_id),
        Err(e) => { eprintln!("upgrade failed: {e}"); std::process::exit(1); }
    }
}
```

This needs `pub mod upgrade;` and `pub mod orgs;` in `lib.rs` (make those two modules `pub`).

- [ ] **Step 2: Run the rehearsal** — `chmod +x scripts/rehearse-org-upgrade.sh && scripts/rehearse-org-upgrade.sh`. Expected: "row counts identical", "file checksums identical", no unresolved paths. Then `npm run tauri dev` is NOT pointed at the rehearsal folder (the app always uses the real folder); instead open the rehearsal database with `sqlite3` and spot-check three invoice `pdf_path` values exist on disk with `test -f`.

- [ ] **Step 3: Update docs** — README "Data Location": the folder now contains `organisations.json` and `orgs/<id>/` per organisation, each with its database, `invoices/` and `receipts/`. GUIDE section 6: same, plus one line that each organisation backs up separately. IDEAS.md: move the organisation subtask line into a "V1.18.0 — Done" section. RELEASING.md step 1: "If the release changes the data layout, run `scripts/rehearse-org-upgrade.sh` against the real folder first and recommend Backup Now in the release notes."

- [ ] **Step 4: Verify** — `npx vitest run && npx tsc --noEmit && npm run lint && (cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings)`.
- [ ] **Step 5: Commit** — `git add -A scripts src-tauri/src/bin src-tauri/src/lib.rs README.md docs/GUIDE.md IDEAS.md RELEASING.md && git commit -m "chore(orgs): upgrade rehearsal script and docs"`

---

### Task 20: Manual pass in the dev build

No code. Run `npm run tauri dev` with the installed app closed (both share the real data folder; the dev build performs the real upgrade on first launch, so take a Backup Now from the installed app first and note the `studiomanager_upgrade_snapshot.db` location).

- [ ] Launch: the app opens on the existing data, sidebar shows the owner's name as the organisation, no dialog.
- [ ] Settings → Data → Organisations lists one organisation; rename it.
- [ ] Create "Label" starting from current settings; verify Profile shows the copied business profile and bank details, Clients is empty, invoice reference starts at 001.
- [ ] Switch back and forth with Cmd+Shift+O; verify tabs, dashboard and finances change; window title updates.
- [ ] Start a timer in Studio, switch: the time entry is logged, no timer in Label.
- [ ] Edit an invoice, switch: the unsaved-changes prompt appears; cancel keeps you in place.
- [ ] Enter test mode, switch: test mode exits first, the other organisation opens on its production data.
- [ ] Enter presentation mode in Label, exit: Label's own data returns.
- [ ] Backup Now in each organisation to the same parent folder: two distinctly named folders; Restore in one does not touch the other.
- [ ] Calendar sync on in one organisation with a distinct calendar name.
- [ ] Delete "Label" while in Studio: folder appears in the Trash; the registry no longer lists it.
- [ ] Quit and relaunch: last active organisation reopens; the upgrade snapshot file is gone.

Record findings in IDEAS.md under the V1.18.0 section, then hand over to the release procedure (`RELEASING.md`) with release notes that lead with "Back up before updating: this version moves your data into a per-organisation folder."
