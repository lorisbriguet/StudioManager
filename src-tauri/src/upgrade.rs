#![allow(dead_code)]
//! One-time move from the legacy single-database layout to `orgs/<id>/`.
//! Same-volume renames (atomic per file), a snapshot first, row/file counts
//! before and after, and a full rollback of completed renames on any error.
//!
//! `#![allow(dead_code)]`: nothing outside `upgrade.rs` uses this module yet.
//! Task 5 wires it into Tauri commands and this allow should be removed then.

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
