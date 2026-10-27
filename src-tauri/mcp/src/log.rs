//! Change log of agent writes: `<data dir>/agent-log.jsonl`, one JSON object
//! per line, the newest 500 kept.

use std::path::Path;

pub const LOG_FILE: &str = "agent-log.jsonl";
pub const MAX_LINES: usize = 500;

/// Best effort: a log failure never fails the write it describes.
pub fn append(dir: &Path, org: &str, tool: &str, summary: &str) {
    let entry = serde_json::json!({
        "at": crate::orgs::now_iso(),
        "org": org,
        "tool": tool,
        "summary": summary,
    });
    let path = dir.join(LOG_FILE);
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    let mut lines: Vec<String> = existing
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(str::to_string)
        .collect();
    lines.push(entry.to_string());
    let skip = lines.len().saturating_sub(MAX_LINES);
    let mut out = lines[skip..].join("\n");
    out.push('\n');
    let tmp = dir.join(format!("{LOG_FILE}.tmp"));
    if std::fs::write(&tmp, out).is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::temp_data_dir;

    #[test]
    fn log_trims_to_500() {
        let dir = temp_data_dir();
        for i in 0..510 {
            append(&dir, "org001", "add_task", &format!("entry {i}"));
        }
        let raw = std::fs::read_to_string(dir.join(LOG_FILE)).unwrap();
        let lines: Vec<&str> = raw.lines().collect();
        assert_eq!(lines.len(), 500);
        let first: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(first["summary"], "entry 10");
        let last: serde_json::Value = serde_json::from_str(lines[499]).unwrap();
        assert_eq!(last["summary"], "entry 509");
        assert_eq!(last["org"], "org001");
        assert_eq!(last["tool"], "add_task");
        assert!(last["at"].as_str().is_some());
    }
}
