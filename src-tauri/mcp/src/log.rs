//! Change log of agent writes: `<data dir>/agent-log.jsonl`, one JSON object
//! per line. Two servers (Claude Desktop and Claude Code) may write at once,
//! so each write holds an exclusive `flock` on the file for its append and,
//! past `TRIM_AT` lines, for cutting it back to the newest `MAX_LINES`. The
//! trim writes a temp file and renames it over the log, so the app reads the
//! old file or the new one, never half of one. The rename gives the path a
//! new file: a writer that opened the old one and waited for its lock sees
//! that once it holds the lock, and opens the path again.

use std::fs::File;
use std::io::Write;
use std::os::unix::fs::MetadataExt;
use std::os::unix::io::AsRawFd;
use std::path::Path;

pub const LOG_FILE: &str = "agent-log.jsonl";
pub const MAX_LINES: usize = 500;
/// Trimming reads and rewrites the file; once per 500 writes keeps that cheap.
pub const TRIM_AT: usize = 2 * MAX_LINES;

/// Opens before giving up on a log that keeps being replaced under us.
const OPEN_TRIES: usize = 16;

/// Best effort: a log failure never fails the write it describes.
pub fn append(dir: &Path, org: &str, tool: &str, summary: &str) {
    let entry = serde_json::json!({
        "at": crate::orgs::now_iso(),
        "org": org,
        "tool": tool,
        "summary": summary,
    });
    let path = dir.join(LOG_FILE);
    let line = format!("{entry}\n");
    let Some(mut file) = open_locked(&path) else {
        return;
    };
    if file.write_all(line.as_bytes()).is_ok() {
        trim_if_due(dir, &path);
    }
    // Closing `file` releases the lock.
}

/// The log opened for appending, locked, and still the file at `path`.
fn open_locked(path: &Path) -> Option<File> {
    for _ in 0..OPEN_TRIES {
        let file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .ok()?;
        lock(&file).ok()?;
        let held = file.metadata().ok()?;
        match std::fs::metadata(path) {
            Ok(now) if now.dev() == held.dev() && now.ino() == held.ino() => return Some(file),
            // A trim renamed a new log over this one while we waited.
            _ => continue,
        }
    }
    None
}

/// Waits for the exclusive lock; it lasts until `file` is closed.
fn lock(file: &File) -> std::io::Result<()> {
    loop {
        // SAFETY: plain syscall on a descriptor `file` keeps open.
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } == 0 {
            return Ok(());
        }
        let err = std::io::Error::last_os_error();
        if err.kind() != std::io::ErrorKind::Interrupted {
            return Err(err);
        }
    }
}

/// Called with the log locked, so no line can land between the read and
/// the rename.
fn trim_if_due(dir: &Path, path: &Path) {
    let Ok(existing) = std::fs::read_to_string(path) else {
        return;
    };
    let lines: Vec<&str> = existing.lines().filter(|l| !l.trim().is_empty()).collect();
    if lines.len() <= TRIM_AT {
        return;
    }
    let mut out = lines[lines.len() - MAX_LINES..].join("\n");
    out.push('\n');
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = dir.join(format!("{LOG_FILE}.{}.{nanos}.tmp", std::process::id()));
    if std::fs::write(&tmp, out).is_ok() && std::fs::rename(&tmp, path).is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::temp_data_dir;

    fn lines(dir: &Path) -> Vec<serde_json::Value> {
        std::fs::read_to_string(dir.join(LOG_FILE))
            .unwrap()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }

    #[test]
    fn log_trims_to_500() {
        let dir = temp_data_dir();
        for i in 0..TRIM_AT {
            append(&dir, "org001", "add_task", &format!("entry {i}"));
        }
        assert_eq!(lines(&dir).len(), TRIM_AT, "no trim before {TRIM_AT} lines");
        append(&dir, "org001", "add_task", &format!("entry {TRIM_AT}"));
        let all = lines(&dir);
        assert_eq!(all.len(), 500);
        assert_eq!(all[0]["summary"], format!("entry {}", TRIM_AT + 1 - 500));
        let last = &all[499];
        assert_eq!(last["summary"], format!("entry {TRIM_AT}"));
        assert_eq!(last["org"], "org001");
        assert_eq!(last["tool"], "add_task");
        assert!(last["at"].as_str().is_some());
        let names: Vec<_> = std::fs::read_dir(&dir).unwrap().collect();
        assert_eq!(names.len(), 1, "no temp file left behind");
    }

    /// Lines left after `n` appends: every append past `TRIM_AT` cuts back
    /// to `MAX_LINES`, whoever wrote it.
    fn kept_after(n: usize) -> usize {
        (0..n).fold(0, |kept, _| if kept + 1 > TRIM_AT { MAX_LINES } else { kept + 1 })
    }

    #[test]
    fn concurrent_writers_keep_every_line() {
        // 8 writers, 1,600 lines: the file is trimmed twice while they write.
        const WRITERS: usize = 8;
        const EACH: usize = 200;
        let dir = temp_data_dir();
        let writers: Vec<_> = (0..WRITERS)
            .map(|w| {
                let dir = dir.clone();
                std::thread::spawn(move || {
                    for i in 0..EACH {
                        append(&dir, "org001", "create_task", &format!("w{w} entry {i}"));
                    }
                })
            })
            .collect();
        for w in writers {
            w.join().unwrap();
        }
        let all = lines(&dir);
        // Only trims dropped lines, and only the oldest ones.
        assert_eq!(all.len(), kept_after(WRITERS * EACH));
        for w in 0..WRITERS {
            let mine: Vec<usize> = all
                .iter()
                .filter_map(|l| l["summary"].as_str().unwrap().strip_prefix(&format!("w{w} entry ")))
                .map(|i| i.parse().unwrap())
                .collect();
            let first = EACH - mine.len();
            assert_eq!(mine, (first..EACH).collect::<Vec<_>>(), "writer {w} keeps its newest lines in order");
        }
        let names: Vec<_> = std::fs::read_dir(&dir).unwrap().collect();
        assert_eq!(names.len(), 1, "no temp file left behind");
    }
}
