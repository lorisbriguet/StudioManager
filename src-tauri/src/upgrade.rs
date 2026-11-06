//! One-time move from the legacy single-database layout to `orgs/<id>/`.
//! Same-volume renames (per file), a snapshot first, row/file counts before
//! and after, and a full rollback of completed renames on any error.
//!
//! Rollback is itself fallible (a rename-back or the path un-rewrite can
//! fail): when that happens the organisation folder is left exactly as-is
//! — it may hold the only remaining copy of some of the user's files —
//! rather than deleted, and the returned error names precisely what could
//! and could not be reversed. This module never claims "rolled back" while
//! silently discarding data.
//!
//! A crash (or power loss) can stop the process at any point, where no
//! rollback runs. So before the first move the upgrade writes
//! `upgrade.journal`: the registry it will save, the list of moves and the
//! counts taken before. Every step is safe to repeat, and the next start
//! resumes from the journal and finishes the upgrade instead of finding
//! half of each layout.

use crate::orgs::{is_plain_id, org_dir, Registry, DB_FILE, ORGS_DIR, REGISTRY_FILE};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const UPGRADE_SNAPSHOT: &str = "studiomanager_upgrade_snapshot.db";
pub const UPGRADE_JOURNAL: &str = "upgrade.journal";
const JOURNAL_VERSION: u32 = 1;
const DOC_DIRS: [&str; 2] = ["invoices", "receipts"];
const DISPOSABLE: [&str; 3] = ["studiomanager_test.db", "studiomanager_presentation.db", "studiomanager_snapshot.db"];

/// True for the legacy layout, and for an upgrade a crash interrupted (its
/// journal is still there and the registry was never saved).
pub fn needs_upgrade(app_dir: &Path) -> bool {
    !app_dir.join(REGISTRY_FILE).exists()
        && (app_dir.join(DB_FILE).exists() || app_dir.join(UPGRADE_JOURNAL).exists())
}

pub fn run(app_dir: &Path) -> Result<Registry, String> {
    run_with_hooks(app_dir, None)
}

/// Where `run_with_hooks` should inject a simulated failure. Tests only.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum FailPoint {
    /// Fail just before renaming `moves[n]`; the first `n` renames have
    /// already completed and must be reversed.
    AfterRename(usize),
    /// Fail after `rewrite_paths` has committed but before the post-move
    /// checks and cleanup: every rename has completed and the rewritten
    /// paths must be reversed too.
    AfterRewrite,
    /// Stop as a crash would, with no rollback, just before renaming
    /// `moves[n]`.
    CrashBeforeRename(usize),
    /// Stop as a crash would after the path rewrite has committed.
    CrashAfterRewrite,
    /// Stop as a crash would after the registry is saved, before the
    /// journal is removed.
    CrashAfterRegistry,
}

#[derive(Serialize, Deserialize, PartialEq, Debug)]
struct Counts {
    invoices: i64,
    expenses: i64,
    invoice_files: usize,
    receipt_files: usize,
}

/// Every (table, column, folder) whose stored absolute paths point into the
/// app's document folders. `income` is created by the frontend schema, not
/// the Rust migrations, so a legacy database may not have it yet.
fn path_columns(conn: &rusqlite::Connection) -> Result<Vec<(&'static str, &'static str, &'static str)>, String> {
    let mut cols = vec![("expenses", "receipt_path", "receipts"), ("invoices", "pdf_path", "invoices")];
    if crate::migrate::table_exists(conn, "income")? {
        cols.push(("income", "receipt_path", "receipts"));
    }
    Ok(cols)
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

/// Counts invoice/expense/income rows whose stored path sits under `root` (the same
/// per-table prefix `rewrite_paths`/`rewrite_back` use) AND whose file
/// actually exists on disk. `counts()` alone can't help but agree before and
/// after a plain directory rename (it's the same files, just relocated) —
/// this re-derives the DB-row -> file link itself, so it catches a
/// `rewrite_paths` bug that updates some rows but not others, which a raw
/// row/file total would never notice.
fn linked_existing_count(db: &Path, root: &Path) -> Result<i64, String> {
    let conn = rusqlite::Connection::open(db).map_err(|e| format!("open db for link check: {e}"))?;
    let mut total = 0i64;
    for (table, column, dir) in path_columns(&conn)? {
        let prefix = format!("{}/{dir}/", root.display());
        let sql = format!(
            "SELECT {column} FROM {table} WHERE {column} IS NOT NULL AND substr({column}, 1, length(?1)) = ?1"
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| format!("prepare {table} link check: {e}"))?;
        let mut rows = stmt.query([prefix.as_str()]).map_err(|e| format!("query {table} link check: {e}"))?;
        while let Some(row) = rows.next().map_err(|e| format!("read {table} link check row: {e}"))? {
            let path: String = row.get(0).map_err(|e| format!("read {table} link check value: {e}"))?;
            if Path::new(&path).exists() {
                total += 1;
            }
        }
    }
    Ok(total)
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
        for (table, column, dir) in path_columns(&conn)? {
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

fn rewrite_back(db: &Path, app_dir: &Path, org: &Path) -> Result<(), String> {
    if !db.exists() {
        return Ok(());
    }
    // Same statement with prefixes swapped.
    let conn = rusqlite::Connection::open(db).map_err(|e| e.to_string())?;
    for (table, column, dir) in path_columns(&conn)? {
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

/// Reverses every completed rename (in reverse order) and, if it had
/// committed, the path rewrite — then removes the now-empty organisation
/// folder. If any rename-back fails, or the path un-rewrite fails, the
/// organisation folder is left exactly as-is (it may hold the only
/// remaining copy of some of the user's files) and the returned error names
/// what is still unreconciled, instead of silently deleting it.
fn rollback(app_dir: &Path, org: &Path, legacy_db: &Path, done: &[(PathBuf, PathBuf)]) -> Result<(), String> {
    let mut rename_errors: Vec<String> = Vec::new();
    for (from, to) in done.iter().rev() {
        if let Err(e) = std::fs::rename(to, from) {
            rename_errors.push(format!("{} (still at {}): {e}", from.display(), to.display()));
        }
    }
    let rewrite_err = rewrite_back(legacy_db, app_dir, org).err();

    if !rename_errors.is_empty() || rewrite_err.is_some() {
        let mut msg = String::from("rollback incomplete —");
        if !rename_errors.is_empty() {
            msg.push_str(&format!(" could not move back: {}.", rename_errors.join("; ")));
        }
        if let Some(e) = &rewrite_err {
            msg.push_str(&format!(" stored file paths were not restored: {e}."));
        }
        msg.push_str(&format!(" left in place to avoid data loss: {}", org.display()));
        return Err(msg);
    }

    // Everything reversed cleanly: the organisation folder is now empty.
    if let Err(e) = std::fs::remove_dir_all(org) {
        if e.kind() != std::io::ErrorKind::NotFound {
            return Err(format!("could not remove the now-empty {}: {e}", org.display()));
        }
    }
    let _ = std::fs::remove_dir(app_dir.join(ORGS_DIR));
    Ok(())
}

/// The upgrade's plan, written before anything moves. Moves are names
/// relative to the app folder (source) and the organisation folder
/// (destination).
#[derive(Serialize, Deserialize)]
struct Journal {
    version: u32,
    registry: Registry,
    moves: Vec<String>,
    before: Counts,
    before_linked: i64,
}

impl Journal {
    fn org_id(&self) -> &str {
        &self.registry.active_id
    }
}

/// The only names a journal may move: anything else (a `..`, an absolute
/// path) is refused, so a damaged journal can't move files outside the app
/// folder.
fn movable_names() -> Vec<String> {
    let mut names: Vec<String> = ["", "-wal", "-shm"].iter().map(|s| format!("{DB_FILE}{s}")).collect();
    names.extend(DOC_DIRS.iter().map(|d| d.to_string()));
    names
}

fn write_journal(app_dir: &Path, journal: &Journal) -> Result<(), String> {
    use std::io::Write;
    let path = app_dir.join(UPGRADE_JOURNAL);
    let tmp = app_dir.join(format!("{UPGRADE_JOURNAL}.tmp"));
    let json = serde_json::to_string_pretty(journal).map_err(|e| format!("serialize upgrade journal: {e}"))?;
    let mut f = std::fs::File::create(&tmp).map_err(|e| format!("write upgrade journal: {e}"))?;
    f.write_all(json.as_bytes()).map_err(|e| format!("write upgrade journal: {e}"))?;
    f.sync_all().map_err(|e| format!("write upgrade journal: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("commit upgrade journal: {e}"))
}

fn read_journal(app_dir: &Path) -> Result<Journal, String> {
    let path = app_dir.join(UPGRADE_JOURNAL);
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("read upgrade journal: {e}"))?;
    let journal: Journal = serde_json::from_str(&raw).map_err(|e| format!("parse upgrade journal: {e}"))?;
    if journal.version != JOURNAL_VERSION {
        return Err(format!("unknown upgrade journal version {}", journal.version));
    }
    if !is_plain_id(journal.org_id()) || journal.registry.active().is_none() {
        return Err("the upgrade journal names no valid organisation".to_string());
    }
    let allowed = movable_names();
    if let Some(bad) = journal.moves.iter().find(|m| !allowed.contains(m)) {
        return Err(format!("the upgrade journal lists an unexpected move: {bad}"));
    }
    Ok(journal)
}

/// How `apply` stopped: a simulated crash (tests: leave everything on disk
/// as it is) or an error the caller handles.
enum Stop {
    Crash,
    Fail(String),
}

impl From<String> for Stop {
    fn from(e: String) -> Self {
        Stop::Fail(e)
    }
}

/// Every step of the upgrade after the journal is written. Each one is
/// safe to repeat, so a resumed run picks up wherever a crash stopped the
/// last one: a move whose source is already gone is done, the path
/// rewrite only touches paths still under the old prefix, and the counts
/// are checked against the ones taken before anything moved.
fn apply(
    app_dir: &Path,
    journal: &Journal,
    fail_point: Option<FailPoint>,
    done: &mut Vec<(PathBuf, PathBuf)>,
) -> Result<(), Stop> {
    let org = org_dir(app_dir, journal.org_id());
    std::fs::create_dir_all(&org).map_err(|e| format!("create organisation folder: {e}"))?;
    for (i, name) in journal.moves.iter().enumerate() {
        if fail_point == Some(FailPoint::AfterRename(i)) {
            return Err(Stop::Fail("simulated failure during upgrade".to_string()));
        }
        if fail_point == Some(FailPoint::CrashBeforeRename(i)) {
            return Err(Stop::Crash);
        }
        let from = app_dir.join(name);
        let to = org.join(name);
        if from.symlink_metadata().is_err() {
            continue; // already moved by the interrupted run
        }
        if to.symlink_metadata().is_ok() {
            return Err(Stop::Fail(format!(
                "both {} and {} exist; neither was touched",
                from.display(),
                to.display()
            )));
        }
        std::fs::rename(&from, &to).map_err(|e| format!("move {}: {e}", from.display()))?;
        done.push((from, to));
    }
    let db = org.join(DB_FILE);
    rewrite_paths(&db, app_dir, &org)?;
    if fail_point == Some(FailPoint::AfterRewrite) {
        return Err(Stop::Fail("simulated failure after path rewrite".to_string()));
    }
    if fail_point == Some(FailPoint::CrashAfterRewrite) {
        return Err(Stop::Crash);
    }
    let after = counts(&db, &org)?;
    let after_linked = linked_existing_count(&db, &org)?;
    if after != journal.before || after_linked != journal.before_linked {
        return Err(Stop::Fail("row or file counts differ after the move".to_string()));
    }
    journal.registry.save(app_dir)?;
    if fail_point == Some(FailPoint::CrashAfterRegistry) {
        return Err(Stop::Crash);
    }
    Ok(())
}

/// Only once the move is verified AND the registry is on disk: the journal
/// goes, and so do the disposable databases. Deleting those any earlier
/// destroyed a test or presentation session's databases even when the
/// upgrade then failed and rolled the layout back. They are disposable
/// copies, but only the successful path is entitled to dispose of them.
fn finish(app_dir: &Path) {
    let _ = std::fs::remove_file(app_dir.join(UPGRADE_JOURNAL));
    for f in DISPOSABLE {
        crate::dbfiles::remove_db_files(&app_dir.join(f));
    }
}

/// `fail_point` injects a simulated failure at a specific point (tests).
pub fn run_with_hooks(app_dir: &Path, fail_point: Option<FailPoint>) -> Result<Registry, String> {
    if app_dir.join(UPGRADE_JOURNAL).exists() {
        return resume(app_dir, fail_point);
    }
    let legacy_db = app_dir.join(DB_FILE);
    let snapshot = app_dir.join(UPGRADE_SNAPSHOT);
    crate::dbfiles::snapshot_db_file(&legacy_db, &snapshot).map_err(|e| format!("upgrade snapshot: {e}"))?;
    let before = counts(&legacy_db, app_dir)?;
    let before_linked = linked_existing_count(&legacy_db, app_dir)?;
    let name = owner_name(&legacy_db);

    let mut reg = Registry::empty();
    let id = reg.add(&name, None)?.id.clone();
    reg.set_active(&id)?;
    let org = org_dir(app_dir, &id);

    // Merge any WAL content into the main file and clear the -wal/-shm
    // companions before moving, so the DB move is as close as possible to
    // one atomic rename rather than up to three independent ones. This is
    // best-effort: the guarded renames below still pick up whatever -wal/
    // -shm files remain (or get recreated) regardless of whether this
    // checkpoint fully clears them.
    if let Ok(conn) = rusqlite::Connection::open(&legacy_db) {
        let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)");
    }

    let moves: Vec<String> = movable_names().into_iter().filter(|n| app_dir.join(n).exists()).collect();
    let journal = Journal { version: JOURNAL_VERSION, registry: reg, moves, before, before_linked };
    write_journal(app_dir, &journal)?;

    let mut done: Vec<(PathBuf, PathBuf)> = Vec::new();
    match apply(app_dir, &journal, fail_point, &mut done) {
        Ok(()) => {
            finish(app_dir);
            Ok(journal.registry)
        }
        Err(Stop::Crash) => Err("simulated crash".to_string()),
        Err(Stop::Fail(e)) => match rollback(app_dir, &org, &legacy_db, &done) {
            Ok(()) => {
                // Back on the legacy layout: the next start upgrades afresh.
                let _ = std::fs::remove_file(app_dir.join(UPGRADE_JOURNAL));
                Err(format!("upgrade failed and was rolled back to the legacy layout: {e}"))
            }
            // The journal stays: the next start finishes the move forward,
            // which works from any mix of moved and not-moved files.
            Err(rollback_err) => Err(format!("upgrade failed ({e}); {rollback_err}")),
        },
    }
}

/// The next start after a crash: finish the upgrade the journal describes.
/// Nothing is rolled back here and nothing is deleted on failure; the
/// journal stays so the start after that tries again.
fn resume(app_dir: &Path, fail_point: Option<FailPoint>) -> Result<Registry, String> {
    let interrupted = |e: &str| {
        format!(
            "The move to the organisations layout was interrupted and could not be finished: {e}. \
             No files were deleted. StudioManager tries again at the next start. Upgrade journal: {}",
            app_dir.join(UPGRADE_JOURNAL).display()
        )
    };
    let journal = read_journal(app_dir).map_err(|e| interrupted(&e))?;
    let mut done = Vec::new();
    match apply(app_dir, &journal, fail_point, &mut done) {
        Ok(()) => {
            finish(app_dir);
            Ok(journal.registry)
        }
        Err(Stop::Crash) => Err("simulated crash".to_string()),
        Err(Stop::Fail(e)) => Err(interrupted(&e)),
    }
}

/// Startup with a registry on disk: a journal still there means a crash
/// came after the registry was saved, so finish the clean-up. A journal
/// for an organisation the registry doesn't know is left alone.
pub fn clear_finished_journal(app_dir: &Path, reg: &Registry) {
    if let Ok(journal) = read_journal(app_dir) {
        if reg.find(journal.org_id()).is_some() {
            finish(app_dir);
        }
    }
}

/// Called once the app started successfully on the new layout.
pub fn discard_snapshot(app_dir: &Path) {
    crate::dbfiles::remove_db_files(&app_dir.join(UPGRADE_SNAPSHOT));
}

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
        // `income` comes from the frontend schema (ensureSchema), not the Rust
        // migrations; create the columns the upgrade reads.
        c.execute_batch("CREATE TABLE income (id INTEGER PRIMARY KEY AUTOINCREMENT, reference TEXT NOT NULL, receipt_path TEXT)").unwrap();
        let inc = app.join("receipts/R-26-001_HEAD.pdf");
        std::fs::write(&inc, b"pdf").unwrap();
        c.execute("INSERT INTO income (reference, receipt_path) VALUES ('R-26-001', ?1)", [inc.to_string_lossy().as_ref()]).unwrap();
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
        let income: String = c.query_row("SELECT receipt_path FROM income WHERE reference='R-26-001'", [], |r| r.get(0)).unwrap();
        assert_eq!(income, dir.join("receipts/R-26-001_HEAD.pdf").to_string_lossy());
        assert!(app.join(UPGRADE_SNAPSHOT).exists(), "snapshot kept until next launch");
    }

    #[test]
    fn upgrades_a_legacy_db_that_has_no_income_table() {
        let app = legacy_fixture("no-income");
        Connection::open(app.join(DB_FILE)).unwrap().execute_batch("DROP TABLE income").unwrap();
        let reg = run(&app).unwrap();
        let dir = org_dir(&app, &reg.active().unwrap().id);
        let c = Connection::open(dir.join(DB_FILE)).unwrap();
        let rec: String = c.query_row("SELECT receipt_path FROM expenses WHERE reference='F-26-001'", [], |r| r.get(0)).unwrap();
        assert_eq!(rec, dir.join("receipts/F-26-001.pdf").to_string_lossy());
    }

    #[test]
    fn failure_mid_way_rolls_back_to_the_legacy_layout() {
        let app = legacy_fixture("rollback");
        let err = run_with_hooks(&app, Some(FailPoint::AfterRename(2))).unwrap_err();
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

    #[test]
    fn failure_after_the_path_rewrite_commits_still_fully_restores_the_legacy_layout() {
        let app = legacy_fixture("rollback-after-rewrite");
        let inv = app.join("invoices/2026-001_ACME.pdf");
        let rec = app.join("receipts/F-26-001.pdf");
        let err = run_with_hooks(&app, Some(FailPoint::AfterRewrite)).unwrap_err();
        assert!(err.contains("simulated"), "{err}");
        assert!(app.join(DB_FILE).exists());
        assert!(inv.exists());
        assert!(rec.exists());
        assert!(!app.join(REGISTRY_FILE).exists());
        assert!(!app.join(ORGS_DIR).exists() || std::fs::read_dir(app.join(ORGS_DIR)).unwrap().next().is_none());
        let c = Connection::open(app.join(DB_FILE)).unwrap();
        let pdf: String = c.query_row("SELECT pdf_path FROM invoices", [], |r| r.get(0)).unwrap();
        assert_eq!(pdf, inv.to_string_lossy(), "rewrite_back must restore the exact legacy path, not just its prefix");
        let receipt: String = c.query_row("SELECT receipt_path FROM expenses WHERE reference='F-26-001'", [], |r| r.get(0)).unwrap();
        assert_eq!(receipt, rec.to_string_lossy());
        let ext: String = c.query_row("SELECT receipt_path FROM expenses WHERE reference='F-26-002'", [], |r| r.get(0)).unwrap();
        assert_eq!(ext, "/Volumes/External/keep.pdf", "path outside the app dir must stay untouched");
        let income: String = c.query_row("SELECT receipt_path FROM income WHERE reference='R-26-001'", [], |r| r.get(0)).unwrap();
        assert_eq!(income, app.join("receipts/R-26-001_HEAD.pdf").to_string_lossy());
    }

    #[test]
    fn a_failure_while_saving_the_registry_keeps_the_disposable_databases() {
        let app = legacy_fixture("registry-save-fails");
        // Block the registry's atomic write: it writes organisations.json.tmp
        // first, and a directory there makes that write fail — the last
        // fallible step of the upgrade, after every rename and check passed.
        std::fs::create_dir_all(app.join(format!("{REGISTRY_FILE}.tmp"))).unwrap();

        let err = run(&app).unwrap_err();
        assert!(err.contains("write registry"), "{err}");
        assert!(!app.join(REGISTRY_FILE).exists());
        // Rolled back to the legacy layout...
        assert!(app.join(DB_FILE).exists());
        assert!(app.join("invoices/2026-001_ACME.pdf").exists());
        // ...and the disposable copies are still there: they belong to the
        // legacy layout the app just went back to, so only a successful
        // upgrade may delete them.
        assert!(app.join("studiomanager_test.db").exists());
        assert!(app.join("studiomanager_presentation.db-wal").exists());
    }

    #[test]
    fn moves_a_legacy_db_still_holding_uncheckpointed_wal_content() {
        let app = legacy_fixture("wal");
        let db = app.join(DB_FILE);
        // Force WAL mode and keep a writer connection open so the extra row
        // genuinely lives only in the -wal file: closing the last connection
        // to a WAL-mode db auto-checkpoints it, which would defeat the test
        // (see dbfiles.rs's `make_wal_db` for the same pattern).
        let writer = Connection::open(&db).unwrap();
        writer.pragma_update(None, "journal_mode", "WAL").unwrap();
        writer.execute("INSERT INTO clients (id, name) VALUES ('C-002','Beta')", []).unwrap();
        assert!(
            std::fs::metadata(format!("{}-wal", db.display())).map(|m| m.len() > 0).unwrap_or(false),
            "precondition: -wal must hold data"
        );

        let reg = run(&app).unwrap();
        drop(writer);

        let org = org_dir(&app, &reg.active().unwrap().id);
        let c = Connection::open(org.join(DB_FILE)).unwrap();
        let clients: i64 = c.query_row("SELECT COUNT(*) FROM clients", [], |r| r.get(0)).unwrap();
        assert_eq!(clients, 2, "the row committed only to the -wal file must survive the move");
    }

    /// The finished layout, after a fresh or a resumed run.
    fn assert_upgraded(app: &Path, reg: &Registry) {
        let dir = org_dir(app, &reg.active().unwrap().id);
        assert_eq!(Registry::load(app).unwrap().as_ref(), Some(reg));
        assert!(!app.join(UPGRADE_JOURNAL).exists());
        assert!(!app.join(DB_FILE).exists());
        assert!(!app.join("invoices").exists());
        assert!(!app.join("receipts").exists());
        assert!(!app.join("studiomanager_test.db").exists());
        let c = Connection::open(dir.join(DB_FILE)).unwrap();
        let pdf: String = c.query_row("SELECT pdf_path FROM invoices", [], |r| r.get(0)).unwrap();
        assert_eq!(pdf, dir.join("invoices/2026-001_ACME.pdf").to_string_lossy());
        let rec: String = c.query_row("SELECT receipt_path FROM expenses WHERE reference='F-26-001'", [], |r| r.get(0)).unwrap();
        assert_eq!(rec, dir.join("receipts/F-26-001.pdf").to_string_lossy());
        let ext: String = c.query_row("SELECT receipt_path FROM expenses WHERE reference='F-26-002'", [], |r| r.get(0)).unwrap();
        assert_eq!(ext, "/Volumes/External/keep.pdf");
        let income: String = c.query_row("SELECT receipt_path FROM income WHERE reference='R-26-001'", [], |r| r.get(0)).unwrap();
        assert_eq!(income, dir.join("receipts/R-26-001_HEAD.pdf").to_string_lossy());
        // Only one organisation folder: a resume reuses the journal's id.
        assert_eq!(std::fs::read_dir(app.join(ORGS_DIR)).unwrap().count(), 1);
    }

    #[test]
    fn a_crash_before_any_move_resumes_on_the_next_start() {
        // The fixture moves the database, invoices/ and receipts/ (indices
        // 0..3). Index 1 is the case from the review: database moved, no
        // registry, which used to refuse every later start.
        for n in 0..3 {
            let app = legacy_fixture(&format!("crash-rename-{n}"));
            let err = run_with_hooks(&app, Some(FailPoint::CrashBeforeRename(n))).unwrap_err();
            assert_eq!(err, "simulated crash");
            assert!(app.join(UPGRADE_JOURNAL).exists());
            assert!(!app.join(REGISTRY_FILE).exists());
            assert!(needs_upgrade(&app), "move {n}: the next start must pick the upgrade up again");
            let journal_id = read_journal(&app).unwrap().org_id().to_string();

            let reg = run(&app).unwrap();
            assert_eq!(reg.active_id, journal_id);
            assert_eq!(reg.active().unwrap().name, "Loris Briguet");
            assert_upgraded(&app, &reg);
        }
    }

    #[test]
    fn a_crash_after_the_path_rewrite_resumes_without_rewriting_twice() {
        let app = legacy_fixture("crash-rewrite");
        run_with_hooks(&app, Some(FailPoint::CrashAfterRewrite)).unwrap_err();
        assert!(needs_upgrade(&app));
        let reg = run(&app).unwrap();
        assert_upgraded(&app, &reg);
    }

    #[test]
    fn a_crash_after_the_registry_is_saved_only_leaves_clean_up_for_the_next_start() {
        let app = legacy_fixture("crash-registry");
        run_with_hooks(&app, Some(FailPoint::CrashAfterRegistry)).unwrap_err();
        assert!(!needs_upgrade(&app), "the registry is saved: the upgrade itself is done");
        assert!(app.join(UPGRADE_JOURNAL).exists());
        assert!(app.join("studiomanager_test.db").exists());

        let reg = Registry::load(&app).unwrap().unwrap();
        clear_finished_journal(&app, &reg);
        assert_upgraded(&app, &reg);
    }

    #[test]
    fn a_journal_for_an_unknown_organisation_is_left_alone() {
        let app = legacy_fixture("journal-unknown-org");
        run_with_hooks(&app, Some(FailPoint::CrashAfterRegistry)).unwrap_err();
        let mut other = Registry::empty();
        let id = other.add("Other", None).unwrap().id.clone();
        other.set_active(&id).unwrap();
        clear_finished_journal(&app, &other);
        assert!(app.join(UPGRADE_JOURNAL).exists());
        assert!(app.join("studiomanager_test.db").exists());
    }

    #[test]
    fn a_resume_that_cannot_finish_touches_nothing_and_says_where_the_journal_is() {
        let app = legacy_fixture("resume-conflict");
        // Database moved, then a new database appeared at the old place:
        // the resume must not pick one copy over the other.
        run_with_hooks(&app, Some(FailPoint::CrashBeforeRename(1))).unwrap_err();
        std::fs::write(app.join(DB_FILE), b"new").unwrap();
        let org = org_dir(&app, read_journal(&app).unwrap().org_id());

        let err = run(&app).unwrap_err();
        assert!(err.contains("neither was touched"), "{err}");
        assert_eq!(std::fs::read(app.join(DB_FILE)).unwrap(), b"new");
        assert!(err.contains("interrupted and could not be finished"), "{err}");
        assert!(err.contains(app.join(UPGRADE_JOURNAL).to_string_lossy().as_ref()), "{err}");
        assert!(app.join(UPGRADE_JOURNAL).exists(), "kept for the next try");
        assert!(app.join("invoices/2026-001_ACME.pdf").exists());
        assert!(app.join("receipts/F-26-001.pdf").exists());
        assert!(org.join(DB_FILE).exists());
        assert!(!app.join(REGISTRY_FILE).exists());
    }

    #[test]
    fn a_journal_that_names_a_path_outside_the_app_folder_is_refused() {
        let app = legacy_fixture("journal-bad-move");
        run_with_hooks(&app, Some(FailPoint::CrashBeforeRename(0))).unwrap_err();
        let path = app.join(UPGRADE_JOURNAL);
        let mut v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        v["moves"] = serde_json::json!(["../elsewhere"]);
        std::fs::write(&path, v.to_string()).unwrap();
        let err = run(&app).unwrap_err();
        assert!(err.contains("unexpected move"), "{err}");
        assert!(app.join(DB_FILE).exists());
    }

    #[test]
    fn a_rolled_back_upgrade_removes_its_journal() {
        let app = legacy_fixture("rollback-journal");
        run_with_hooks(&app, Some(FailPoint::AfterRename(1))).unwrap_err();
        assert!(!app.join(UPGRADE_JOURNAL).exists());
        assert!(app.join(DB_FILE).exists());
    }
}
