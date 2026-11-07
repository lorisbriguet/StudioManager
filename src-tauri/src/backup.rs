//! Backups of one organisation into a backup folder.
//!
//! Each run writes `backup-<org id>-<timestamp>/` (with `-pre-restore` after
//! the timestamp for the safety backup taken before a restore) holding:
//! - `studiomanager.db`: a `VACUUM INTO` snapshot, the exact and consistent
//!   copy of the database at one moment;
//! - `data/<table>.csv`: every table, read from that snapshot (not from the
//!   live database), so all CSVs describe the same moment. The format matches
//!   `serializeCsv` in src/lib/backup.ts, which restore reads;
//! - `manifest.json`: which receipts and invoice PDFs belonged to this backup.
//!
//! Receipts and invoice PDFs go to one shared `files-<org id>/` folder next to
//! the backups, copying only new or changed files, so keeping many backups
//! does not keep many copies of the same PDFs. Rotation never deletes from it.
//!
//! Any error fails the whole backup and removes its half-written folder: a
//! backup either holds everything or does not exist.

use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const SNAPSHOT_FILE: &str = "studiomanager.db";
pub const MANIFEST_FILE: &str = "manifest.json";
/// Document folders inside an organisation folder (see src/lib/orgPaths.ts).
pub const FILE_FOLDERS: [&str; 2] = ["receipts", "invoices"];

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BackupTarget {
    pub org_id: String,
    pub dir: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupOutcome {
    pub org_id: String,
    pub dir: String,
    /// The new backup folder, when the backup succeeded.
    pub path: Option<String>,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub version: u32,
    pub org_id: String,
    pub org_name: String,
    /// Shared files folder, relative to the backup folder's parent.
    pub files_dir: String,
    pub receipts: Vec<String>,
    pub invoices: Vec<String>,
    /// Tables the organisation's database does not have yet (an organisation
    /// not opened since a newer version added them): nothing to back up.
    pub missing_tables: Vec<String>,
}

pub fn files_dir_name(org_id: &str) -> String {
    format!("files-{org_id}")
}

/// A table name as listed in TABLES (src/lib/backup.ts): lowercase letters,
/// digits and underscores, so it is safe to put in SQL.
fn is_table_name(name: &str) -> bool {
    !name.is_empty() && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

/// One CSV field, the same way `escapeCsv` in src/lib/backup.ts writes it:
/// NULL is an empty unquoted field, an empty string is `""`.
fn csv_field(value: ValueRef) -> String {
    let s = match value {
        ValueRef::Null => return String::new(),
        ValueRef::Integer(i) => i.to_string(),
        ValueRef::Real(f) => f.to_string(),
        ValueRef::Text(t) | ValueRef::Blob(t) => String::from_utf8_lossy(t).into_owned(),
    };
    csv_text(&s)
}

fn csv_text(s: &str) -> String {
    if s.is_empty() {
        return "\"\"".to_string();
    }
    if s.contains([',', '"', '\n', '\r']) {
        return format!("\"{}\"", s.replace('"', "\"\""));
    }
    s.to_string()
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |r| r.get::<_, i64>(0),
    )
    .map(|n| n > 0)
    .map_err(|e| format!("{table}: {e}"))
}

/// The table as CSV, or `None` when it has no rows (no file is written then,
/// like the TypeScript export did).
fn table_csv(conn: &Connection, table: &str) -> Result<Option<String>, String> {
    let err = |e: rusqlite::Error| format!("{table}: {e}");
    let mut stmt = conn.prepare(&format!("SELECT * FROM {table}")).map_err(err)?;
    let columns: Vec<String> = stmt.column_names().iter().map(|c| csv_text(c)).collect();
    let n = columns.len();
    let mut lines = vec![columns.join(",")];
    let mut rows = stmt.query([]).map_err(err)?;
    while let Some(row) = rows.next().map_err(err)? {
        let mut fields = Vec::with_capacity(n);
        for i in 0..n {
            fields.push(csv_field(row.get_ref(i).map_err(err)?));
        }
        lines.push(fields.join(","));
    }
    Ok(if lines.len() > 1 { Some(lines.join("\n")) } else { None })
}

/// Export every table of the snapshot to `data/`. Returns the tables the
/// snapshot does not have.
fn export_csvs(snapshot: &Path, data_dir: &Path, tables: &[String]) -> Result<Vec<String>, String> {
    let conn = Connection::open_with_flags(snapshot, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("open snapshot: {e}"))?;
    let mut missing = Vec::new();
    for table in tables {
        if !is_table_name(table) {
            return Err(format!("invalid table name: {table}"));
        }
        if !table_exists(&conn, table)? {
            missing.push(table.clone());
            continue;
        }
        if let Some(csv) = table_csv(&conn, table)? {
            std::fs::write(data_dir.join(format!("{table}.csv")), csv)
                .map_err(|e| format!("write {table}.csv: {e}"))?;
        }
    }
    Ok(missing)
}

/// Copy every file of `src` into `store` unless the store already has it
/// with the same size and modification time. Returns the file names, sorted.
/// A missing `src` folder has no files.
pub fn sync_files(src: &Path, store: &Path) -> Result<Vec<String>, String> {
    if !src.exists() {
        return Ok(Vec::new());
    }
    std::fs::create_dir_all(store).map_err(|e| format!("create {}: {e}", store.display()))?;
    let mut names = Vec::new();
    let entries = std::fs::read_dir(src).map_err(|e| format!("read {}: {e}", src.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("read {}: {e}", src.display()))?;
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            return Err(format!("file name is not valid text in {}", src.display()));
        };
        // Hidden files (.DS_Store and the like) are not documents.
        if name.starts_with('.') {
            continue;
        }
        let from = entry.path();
        let meta = std::fs::metadata(&from).map_err(|e| format!("{name}: {e}"))?;
        if !meta.is_file() {
            continue;
        }
        let to = store.join(&name);
        if needs_copy(&meta, &to) {
            copy_with_mtime(&from, &to, &meta).map_err(|e| format!("copy {name}: {e}"))?;
        }
        names.push(name);
    }
    names.sort();
    Ok(names)
}

fn needs_copy(src: &std::fs::Metadata, dest: &Path) -> bool {
    let Ok(d) = std::fs::metadata(dest) else { return true };
    d.len() != src.len() || d.modified().ok() != src.modified().ok()
}

/// Copy through a temporary name, then rename, so the store never holds a
/// half-copied file under the real name. The copy gets the source's
/// modification time, which is what `needs_copy` compares.
fn copy_with_mtime(from: &Path, to: &Path, meta: &std::fs::Metadata) -> std::io::Result<()> {
    let name = to.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let tmp = to.with_file_name(format!(".{name}.partial"));
    std::fs::copy(from, &tmp)?;
    if let Ok(mtime) = meta.modified() {
        std::fs::File::options().write(true).open(&tmp)?.set_modified(mtime)?;
    }
    std::fs::rename(&tmp, to)
}

/// Back up one organisation (its folder `org_dir`) into `backup_dir`.
/// Returns the new backup folder. On any error the folder is removed.
pub fn backup_org(
    org_dir: &Path,
    org_id: &str,
    org_name: &str,
    backup_dir: &Path,
    stamp: &str,
    tables: &[String],
) -> Result<PathBuf, String> {
    if !backup_dir.is_dir() {
        return Err(format!("backup folder not found: {}", backup_dir.display()));
    }
    let src_db = org_dir.join(crate::orgs::DB_FILE);
    if !src_db.is_file() {
        return Err(format!("database not found: {}", src_db.display()));
    }
    let folder = backup_dir.join(format!("backup-{org_id}-{stamp}"));
    if folder.exists() {
        return Err(format!("backup already exists: {}", folder.display()));
    }
    let result = (|| -> Result<(), String> {
        let data_dir = folder.join("data");
        std::fs::create_dir_all(&data_dir).map_err(|e| format!("create backup folder: {e}"))?;
        let snapshot = folder.join(SNAPSHOT_FILE);
        crate::dbfiles::snapshot_db_file(&src_db, &snapshot)?;
        let missing_tables = export_csvs(&snapshot, &data_dir, tables)?;

        let files_dir = files_dir_name(org_id);
        let store = backup_dir.join(&files_dir);
        let receipts = sync_files(&org_dir.join(FILE_FOLDERS[0]), &store.join(FILE_FOLDERS[0]))?;
        let invoices = sync_files(&org_dir.join(FILE_FOLDERS[1]), &store.join(FILE_FOLDERS[1]))?;

        let manifest = Manifest {
            version: 1,
            org_id: org_id.to_string(),
            org_name: org_name.to_string(),
            files_dir,
            receipts,
            invoices,
            missing_tables,
        };
        let json = serde_json::to_string_pretty(&manifest).map_err(|e| format!("manifest: {e}"))?;
        // Written last: a folder with a manifest is a finished backup.
        std::fs::write(folder.join(MANIFEST_FILE), json).map_err(|e| format!("write manifest: {e}"))?;
        Ok(())
    })();
    if let Err(e) = result {
        let _ = std::fs::remove_dir_all(&folder);
        return Err(e);
    }
    Ok(folder)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sm-backup-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// An organisation folder with a WAL database, a receipt and an invoice.
    fn make_org(root: &Path) -> (PathBuf, Connection) {
        let org = root.join("org");
        std::fs::create_dir_all(org.join("receipts")).unwrap();
        std::fs::create_dir_all(org.join("invoices")).unwrap();
        std::fs::write(org.join("receipts/r1.pdf"), b"receipt").unwrap();
        std::fs::write(org.join("receipts/.DS_Store"), b"x").unwrap();
        std::fs::write(org.join("invoices/F-001.pdf"), b"invoice").unwrap();
        let conn = Connection::open(org.join(crate::orgs::DB_FILE)).unwrap();
        conn.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE clients (id TEXT, name TEXT, notes TEXT, rate REAL, n INTEGER);
             INSERT INTO clients VALUES ('C-001', 'ACME, Inc', 'has \"quotes\"', 1.5, 3);
             INSERT INTO clients VALUES ('C-002', '', NULL, 100.0, 0);
             CREATE TABLE expenses (id TEXT);",
        )
        .unwrap();
        (org, conn)
    }

    fn tables(names: &[&str]) -> Vec<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn csv_fields_match_the_typescript_format() {
        assert_eq!(csv_field(ValueRef::Null), "");
        assert_eq!(csv_field(ValueRef::Text(b"")), "\"\"");
        assert_eq!(csv_field(ValueRef::Text(b"plain")), "plain");
        assert_eq!(csv_field(ValueRef::Text(b"a,b")), "\"a,b\"");
        assert_eq!(csv_field(ValueRef::Text(b"say \"hi\"")), "\"say \"\"hi\"\"\"");
        assert_eq!(csv_field(ValueRef::Text(b"two\nlines")), "\"two\nlines\"");
        assert_eq!(csv_field(ValueRef::Integer(42)), "42");
        assert_eq!(csv_field(ValueRef::Real(1.5)), "1.5");
        assert_eq!(csv_field(ValueRef::Real(100.0)), "100");
    }

    #[test]
    fn backs_up_snapshot_csvs_files_and_manifest() {
        let root = temp_dir("full");
        let (org, _open) = make_org(&root);
        let backups = root.join("backups");
        std::fs::create_dir_all(&backups).unwrap();

        let folder = backup_org(&org, "abc123", "Studio", &backups, "2026-11-06-10-00-00",
            &tables(&["clients", "expenses", "not_there_yet"])).unwrap();

        assert_eq!(folder, backups.join("backup-abc123-2026-11-06-10-00-00"));
        // The snapshot holds the rows committed to the WAL of the open DB
        let snap = Connection::open(folder.join(SNAPSHOT_FILE)).unwrap();
        let n: i64 = snap.query_row("SELECT COUNT(*) FROM clients", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 2);

        let csv = std::fs::read_to_string(folder.join("data/clients.csv")).unwrap();
        assert_eq!(
            csv,
            "id,name,notes,rate,n\nC-001,\"ACME, Inc\",\"has \"\"quotes\"\"\",1.5,3\nC-002,\"\",,100,0"
        );
        // Empty table: no file
        assert!(!folder.join("data/expenses.csv").exists());

        let manifest: Manifest =
            serde_json::from_str(&std::fs::read_to_string(folder.join(MANIFEST_FILE)).unwrap()).unwrap();
        assert_eq!(manifest.files_dir, "files-abc123");
        assert_eq!(manifest.receipts, vec!["r1.pdf"]);
        assert_eq!(manifest.invoices, vec!["F-001.pdf"]);
        assert_eq!(manifest.missing_tables, vec!["not_there_yet"]);
        assert_eq!(std::fs::read(backups.join("files-abc123/receipts/r1.pdf")).unwrap(), b"receipt");
        assert!(!backups.join("files-abc123/receipts/.DS_Store").exists());
        // Receipts are no longer copied into the backup folder itself
        assert!(!folder.join("receipts").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn files_are_copied_only_when_new_or_changed() {
        let root = temp_dir("sync");
        let src = root.join("src");
        let store = root.join("store");
        std::fs::create_dir_all(&src).unwrap();
        std::fs::write(src.join("a.pdf"), b"one").unwrap();

        sync_files(&src, &store).unwrap();
        // Mark the stored copy: an unchanged source must leave it alone
        let marker = std::fs::metadata(store.join("a.pdf")).unwrap().modified().unwrap();
        std::fs::write(store.join("a.pdf"), b"two").unwrap(); // same size, new mtime
        std::fs::File::options().write(true).open(store.join("a.pdf")).unwrap().set_modified(marker).unwrap();
        sync_files(&src, &store).unwrap();
        assert_eq!(std::fs::read(store.join("a.pdf")).unwrap(), b"two");

        // A changed source (different size) is copied again
        std::fs::write(src.join("a.pdf"), b"three").unwrap();
        sync_files(&src, &store).unwrap();
        assert_eq!(std::fs::read(store.join("a.pdf")).unwrap(), b"three");
        assert!(!store.join(".a.pdf.partial").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_failure_removes_the_half_written_backup() {
        let root = temp_dir("fail");
        let (org, _open) = make_org(&root);
        let backups = root.join("backups");
        std::fs::create_dir_all(&backups).unwrap();
        // The receipts store path is taken by a file: copying receipts fails
        std::fs::write(backups.join("files-abc123"), b"in the way").unwrap();

        let err = backup_org(&org, "abc123", "Studio", &backups, "2026-11-06-10-00-00", &tables(&["clients"]))
            .unwrap_err();
        assert!(err.contains("create"), "{err}");
        assert!(!backups.join("backup-abc123-2026-11-06-10-00-00").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_unsafe_table_names_and_missing_folders() {
        let root = temp_dir("reject");
        let (org, _open) = make_org(&root);
        let backups = root.join("backups");
        std::fs::create_dir_all(&backups).unwrap();
        let err = backup_org(&org, "abc123", "S", &backups, "t1", &tables(&["clients; DROP TABLE clients"]))
            .unwrap_err();
        assert!(err.contains("invalid table name"), "{err}");
        assert!(backup_org(&org, "abc123", "S", &root.join("nope"), "t2", &tables(&["clients"])).is_err());
        assert!(backup_org(&root.join("no-org"), "abc123", "S", &backups, "t3", &tables(&["clients"])).is_err());
        let _ = std::fs::remove_dir_all(&root);
    }
}
