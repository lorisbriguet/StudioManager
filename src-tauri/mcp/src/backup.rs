//! Safety copy before the first agent write: SQLite backup API into
//! `<data dir>/backups/agent/<org>-<yyyyMMdd-HHmmss>-<pid>.db`, newest 20
//! kept. The process id keeps two servers (Claude Desktop and Claude Code)
//! starting in the same second from writing the same file.

use crate::guard::Org;
use std::path::{Path, PathBuf};

pub const KEEP: usize = 20;

pub fn backup_dir(dir: &Path) -> PathBuf {
    dir.join("backups").join("agent")
}

/// `<org>-yyyyMMdd-HHmmss-<pid>.db` (or, from older versions, without the
/// pid) for exactly this organisation id.
fn is_backup_of(name: &str, org_id: &str) -> bool {
    let Some(rest) = name
        .strip_prefix(org_id)
        .and_then(|r| r.strip_prefix('-'))
        .and_then(|r| r.strip_suffix(".db"))
    else {
        return false;
    };
    let stamp = match rest.get(15..) {
        Some(pid) if !pid.is_empty() => match pid.strip_prefix('-') {
            Some(digits) if !digits.is_empty() && digits.bytes().all(|c| c.is_ascii_digit()) => &rest[..15],
            _ => return false,
        },
        _ => rest,
    };
    let b = stamp.as_bytes();
    b.len() == 15
        && b[8] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 8 || c.is_ascii_digit())
}

pub fn ensure(dir: &Path, org: &Org) -> Result<(), String> {
    let bdir = backup_dir(dir);
    std::fs::create_dir_all(&bdir).map_err(|e| format!("create backup folder: {e}"))?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let dest = bdir.join(format!("{}-{stamp}-{}.db", org.id, std::process::id()));

    let src =
        rusqlite::Connection::open_with_flags(&org.db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| format!("backup: open database: {e}"))?;
    src.busy_timeout(std::time::Duration::from_millis(5000))
        .map_err(|e| format!("backup: busy_timeout: {e}"))?;
    if let Err(e) = copy_into(&src, &dest) {
        // Never leave a partial file that pruning would count as a backup.
        crate::dbfiles::remove_db_files(&dest);
        return Err(e);
    }

    prune(&bdir, &org.id);
    Ok(())
}

fn copy_into(src: &rusqlite::Connection, dest: &Path) -> Result<(), String> {
    let mut dst =
        rusqlite::Connection::open(dest).map_err(|e| format!("backup: create file: {e}"))?;
    rusqlite::backup::Backup::new(src, &mut dst)
        .map_err(|e| format!("backup: start: {e}"))?
        .run_to_completion(64, std::time::Duration::from_millis(50), None)
        .map_err(|e| format!("backup failed: {e}"))?;
    Ok(())
}

/// Keep the `KEEP` newest backups of `org_id`; the timestamp in the name
/// sorts chronologically.
fn prune(bdir: &Path, org_id: &str) {
    let Ok(entries) = std::fs::read_dir(bdir) else {
        return;
    };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| is_backup_of(n, org_id))
        .collect();
    names.sort();
    let excess = names.len().saturating_sub(KEEP);
    for name in &names[..excess] {
        crate::dbfiles::remove_db_files(&bdir.join(name));
    }
}

#[cfg(test)]
mod tests {
    use crate::guard;
    use crate::test_support::ready_dir;

    fn backups(dir: &std::path::Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir.join("backups").join("agent"))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn backup_once_and_keeps_20() {
        let dir = ready_dir("bkp001", "Studio");
        let bdir = dir.join("backups").join("agent");
        std::fs::create_dir_all(&bdir).unwrap();
        for i in 0..25 {
            std::fs::write(bdir.join(format!("bkp001-20200101-0000{i:02}.db")), "old").unwrap();
        }
        // Another organisation's backups are never pruned.
        std::fs::write(bdir.join("other1-20200101-000000.db"), "old").unwrap();

        let org = guard::resolve_org(&dir, None).unwrap();
        guard::open_write(&dir, &org).unwrap();
        guard::open_write(&dir, &org).unwrap();

        let all = backups(&dir);
        let mine: Vec<&String> = all.iter().filter(|n| n.starts_with("bkp001-")).collect();
        assert_eq!(mine.len(), 20);
        let fresh: Vec<&&String> = mine
            .iter()
            .filter(|n| !n.starts_with("bkp001-2020"))
            .collect();
        assert_eq!(fresh.len(), 1, "one backup per process per org: {mine:?}");
        assert!(all.contains(&"other1-20200101-000000.db".to_string()));
        // The fresh backup is a real database copy.
        let conn = rusqlite::Connection::open(bdir.join(fresh[0])).unwrap();
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name='wiki_articles'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn backup_names_carry_the_process_id() {
        let dir = ready_dir("pid001", "Studio");
        let org = guard::resolve_org(&dir, None).unwrap();
        super::ensure(&dir, &org).unwrap();
        let names = backups(&dir);
        assert_eq!(names.len(), 1);
        assert!(names[0].ends_with(&format!("-{}.db", std::process::id())), "{names:?}");
        assert!(super::is_backup_of(&names[0], "pid001"));
    }

    #[test]
    fn backup_name_forms() {
        use super::is_backup_of;
        assert!(is_backup_of("org1-20261029-120000.db", "org1"));
        assert!(is_backup_of("org1-20261029-120000-4242.db", "org1"));
        assert!(!is_backup_of("org1-20261029-120000-.db", "org1"));
        assert!(!is_backup_of("org1-20261029-120000-42x.db", "org1"));
        assert!(!is_backup_of("org1-20261029-1200.db", "org1"));
        assert!(!is_backup_of("org10-20261029-120000.db", "org1"));
        assert!(!is_backup_of("org1-20261029-120000.db-wal", "org1"));
    }

    #[test]
    fn failed_backup_leaves_no_partial_file() {
        let dir = crate::test_support::temp_data_dir();
        let db = dir.join("orgs").join("bad001").join("studiomanager.db");
        std::fs::create_dir_all(db.parent().unwrap()).unwrap();
        std::fs::write(&db, vec![0x5au8; 8192]).unwrap(); // not a database
        let org = guard::Org {
            id: "bad001".into(),
            name: "Bad".into(),
            db,
        };
        assert!(super::ensure(&dir, &org).is_err());
        assert!(backups(&dir).is_empty(), "{:?}", backups(&dir));
    }
}
