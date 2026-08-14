//! SQLite-aware database file operations.
//!
//! The DB runs in WAL mode (sqlx default), so a plain `fs::copy` of the main
//! file can miss recently committed transactions still sitting in `-wal`,
//! and copying OVER a file that other connections hold open corrupts state.
//! Snapshots therefore go through `VACUUM INTO` (a consistent single-file
//! image regardless of journal mode) and restores go through SQLite's online
//! backup API (which takes proper locks and works on a live database).

use std::path::{Path, PathBuf};

fn aux_path(db: &Path, suffix: &str) -> PathBuf {
    PathBuf::from(format!("{}{}", db.display(), suffix))
}

/// Delete a database file together with its `-wal` / `-shm` companions.
pub(crate) fn remove_db_files(db: &Path) {
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(aux_path(db, suffix));
    }
}

/// Write a consistent single-file snapshot of `src` to `dest` via
/// `VACUUM INTO` — includes committed transactions still in the WAL, and
/// is safe while other connections hold `src` open. Overwrites `dest`.
pub(crate) fn snapshot_db_file(src: &Path, dest: &Path) -> Result<(), String> {
    // VACUUM INTO refuses to overwrite; clear any previous snapshot first.
    remove_db_files(dest);
    let conn = rusqlite::Connection::open(src)
        .map_err(|e| format!("failed to open source DB: {e}"))?;
    conn.execute("VACUUM INTO ?1", [dest.to_string_lossy().as_ref()])
        .map_err(|e| format!("snapshot (VACUUM INTO) failed: {e}"))?;
    Ok(())
}

/// Restore `src` into `dest` through SQLite's online backup API, which
/// takes proper locks — safe even while the app holds `dest` open (open
/// connections see the restored content afterwards).
pub(crate) fn restore_db_file(src: &Path, dest: &Path) -> Result<(), String> {
    let src_conn = rusqlite::Connection::open(src)
        .map_err(|e| format!("failed to open snapshot: {e}"))?;
    let mut dst_conn = rusqlite::Connection::open(dest)
        .map_err(|e| format!("failed to open target DB: {e}"))?;
    let backup = rusqlite::backup::Backup::new(&src_conn, &mut dst_conn)
        .map_err(|e| format!("failed to start restore: {e}"))?;
    backup
        .run_to_completion(64, std::time::Duration::from_millis(50), None)
        .map_err(|e| format!("restore failed: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::path::PathBuf;

    fn temp_path(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("sm-dbfiles-{nanos}-{name}"))
    }

    /// Create a WAL-mode DB with `n` rows and return the still-open writer
    /// connection (keeping it open prevents the close-time checkpoint, so
    /// committed rows genuinely live in the -wal file).
    fn make_wal_db(path: &PathBuf, n: usize) -> Connection {
        let conn = Connection::open(path).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)", [])
            .unwrap();
        for i in 0..n {
            conn.execute("INSERT INTO t (v) VALUES (?1)", [format!("row-{i}")])
                .unwrap();
        }
        conn
    }

    fn count_rows(path: &PathBuf) -> i64 {
        let conn = Connection::open(path).unwrap();
        conn.query_row("SELECT COUNT(*) FROM t", [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn snapshot_includes_wal_content_of_an_open_db() {
        let src = temp_path("src.db");
        let dest = temp_path("snap.db");
        let _writer = make_wal_db(&src, 25); // stays open: rows live in -wal
        assert!(
            std::fs::metadata(format!("{}-wal", src.display())).map(|m| m.len() > 0).unwrap_or(false),
            "precondition: -wal must hold data"
        );

        snapshot_db_file(&src, &dest).unwrap();

        assert_eq!(count_rows(&dest), 25);
        remove_db_files(&src);
        remove_db_files(&dest);
    }

    #[test]
    fn snapshot_overwrites_a_previous_snapshot() {
        let src = temp_path("src2.db");
        let dest = temp_path("snap2.db");
        let writer = make_wal_db(&src, 3);
        snapshot_db_file(&src, &dest).unwrap();
        writer.execute("INSERT INTO t (v) VALUES ('later')", []).unwrap();
        snapshot_db_file(&src, &dest).unwrap();
        assert_eq!(count_rows(&dest), 4);
        remove_db_files(&src);
        remove_db_files(&dest);
    }

    #[test]
    fn restore_replaces_content_of_a_live_open_db() {
        let snap = temp_path("snap3.db");
        let prod = temp_path("prod3.db");
        let snap_writer = make_wal_db(&snap, 10);
        drop(snap_writer);
        let prod_conn = make_wal_db(&prod, 2); // live connection stays open

        restore_db_file(&snap, &prod).unwrap();

        // The already-open connection must see the restored data
        let n: i64 = prod_conn
            .query_row("SELECT COUNT(*) FROM t", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 10);
        drop(prod_conn);
        remove_db_files(&snap);
        remove_db_files(&prod);
    }

    #[test]
    fn remove_db_files_deletes_main_and_aux_files() {
        let db = temp_path("rm.db");
        let _writer = make_wal_db(&db, 1);
        assert!(std::fs::metadata(format!("{}-wal", db.display())).is_ok());
        remove_db_files(&db);
        assert!(std::fs::metadata(&db).is_err());
        assert!(std::fs::metadata(format!("{}-wal", db.display())).is_err());
        assert!(std::fs::metadata(format!("{}-shm", db.display())).is_err());
    }
}
