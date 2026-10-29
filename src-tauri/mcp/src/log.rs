//! Change log of agent writes: `<data dir>/agent-log.jsonl`, one JSON object
//! per line. Each line is one `O_APPEND` write, so two servers (Claude
//! Desktop and Claude Code) writing at once both keep their line. Past
//! `TRIM_AT` lines the file is cut back to the newest `MAX_LINES`.

use std::io::Write;
use std::path::Path;

pub const LOG_FILE: &str = "agent-log.jsonl";
pub const MAX_LINES: usize = 500;
/// Trimming rewrites the file; doing it once per 500 writes keeps the
/// moment another server's append could land in between rare.
pub const TRIM_AT: usize = 2 * MAX_LINES;

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
    let appended = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut f| f.write_all(line.as_bytes()));
    if appended.is_ok() {
        trim_if_due(dir, &path);
    }
}

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

    #[test]
    fn concurrent_writers_keep_every_line() {
        let dir = temp_data_dir();
        let writers: Vec<_> = (0..8)
            .map(|w| {
                let dir = dir.clone();
                std::thread::spawn(move || {
                    for i in 0..50 {
                        append(&dir, "org001", "create_task", &format!("w{w} entry {i}"));
                    }
                })
            })
            .collect();
        for w in writers {
            w.join().unwrap();
        }
        let all = lines(&dir);
        assert_eq!(all.len(), 400);
        for w in 0..8 {
            let mine = all
                .iter()
                .filter(|l| l["summary"].as_str().unwrap().starts_with(&format!("w{w} ")))
                .count();
            assert_eq!(mine, 50, "writer {w}");
        }
    }
}
