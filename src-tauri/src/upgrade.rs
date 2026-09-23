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

/// Counts invoice/expense rows whose stored path sits under `root` (the same
/// per-table prefix `rewrite_paths`/`rewrite_back` use) AND whose file
/// actually exists on disk. `counts()` alone can't help but agree before and
/// after a plain directory rename (it's the same files, just relocated) —
/// this re-derives the DB-row -> file link itself, so it catches a
/// `rewrite_paths` bug that updates some rows but not others, which a raw
/// row/file total would never notice.
fn linked_existing_count(db: &Path, root: &Path) -> Result<i64, String> {
    let conn = rusqlite::Connection::open(db).map_err(|e| format!("open db for link check: {e}"))?;
    let mut total = 0i64;
    for (table, column, dir) in [("expenses", "receipt_path", "receipts"), ("invoices", "pdf_path", "invoices")] {
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

/// `fail_point` injects a simulated failure at a specific point (tests).
pub fn run_with_hooks(app_dir: &Path, fail_point: Option<FailPoint>) -> Result<Registry, String> {
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
    std::fs::create_dir_all(&org).map_err(|e| format!("create organisation folder: {e}"))?;

    // Merge any WAL content into the main file and clear the -wal/-shm
    // companions before moving, so the DB move is as close as possible to
    // one atomic rename rather than up to three independent ones. This is
    // best-effort: the guarded renames below still pick up whatever -wal/
    // -shm files remain (or get recreated) regardless of whether this
    // checkpoint fully clears them.
    if let Ok(conn) = rusqlite::Connection::open(&legacy_db) {
        let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)");
    }

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
            if fail_point == Some(FailPoint::AfterRename(i)) {
                return Err("simulated failure during upgrade".to_string());
            }
            std::fs::rename(from, to).map_err(|e| format!("move {}: {e}", from.display()))?;
            done.push((from.clone(), to.clone()));
        }
        rewrite_paths(&org.join(DB_FILE), app_dir, &org)?;
        if fail_point == Some(FailPoint::AfterRewrite) {
            return Err("simulated failure after path rewrite".to_string());
        }
        let after = counts(&org.join(DB_FILE), &org)?;
        let after_linked = linked_existing_count(&org.join(DB_FILE), &org)?;
        if after.invoices != before.invoices
            || after.expenses != before.expenses
            || after.invoice_files != before.invoice_files
            || after.receipt_files != before.receipt_files
            || after_linked != before_linked
        {
            return Err("row or file counts differ after the move".to_string());
        }

        reg.save(app_dir)?;
        Ok(())
    })();

    match result {
        Ok(()) => {
            // Only once the move is verified AND the registry is on disk:
            // deleting these inside the guarded closure destroyed a test or
            // presentation session's databases even when the upgrade then
            // failed and rolled the layout back. They are disposable copies,
            // but only the successful path is entitled to dispose of them.
            for f in DISPOSABLE {
                crate::dbfiles::remove_db_files(&app_dir.join(f));
            }
            Ok(reg)
        }
        Err(e) => match rollback(app_dir, &org, &legacy_db, &done) {
            Ok(()) => Err(format!("upgrade failed and was rolled back to the legacy layout: {e}")),
            Err(rollback_err) => Err(format!("upgrade failed ({e}); {rollback_err}")),
        },
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
}
