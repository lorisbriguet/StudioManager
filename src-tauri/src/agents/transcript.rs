//! Reading an agent's conversation from its transcript under `~/.claude/projects`.

use super::actions::{cli, home_dir, ready, valid_session_id};
use serde::Serialize;
use serde_json::Value;
use std::collections::VecDeque;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

const LIMIT: usize = 300;
const SUMMARY_MAX: usize = 200;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Item {
    User { text: String, at: Option<String> },
    Assistant { text: String, at: Option<String> },
    Tool { name: String, summary: String, at: Option<String> },
}

/// First `projects/*/<session_id>.jsonl`; None for anything but a plain session id.
pub fn locate(claude_dir: &Path, session_id: &str) -> Option<PathBuf> {
    if !valid_session_id(session_id) {
        return None;
    }
    for entry in std::fs::read_dir(claude_dir.join("projects")).ok()?.flatten() {
        let p = entry.path().join(format!("{session_id}.jsonl"));
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

/// The transcript file's modification time in ms since the epoch.
pub fn last_change_ms(path: &Path) -> Option<i64> {
    let t = std::fs::metadata(path).ok()?.modified().ok()?;
    Some(t.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as i64)
}

fn truncate(s: &str) -> String {
    s.chars().take(SUMMARY_MAX).collect()
}

/// The items one transcript line contributes (none for tool results, system lines, junk).
fn line_items(line: &str) -> Vec<Item> {
    let Ok(v) = serde_json::from_str::<Value>(line) else { return vec![] };
    let kind = v.get("type").and_then(Value::as_str).unwrap_or("");
    if kind != "user" && kind != "assistant" {
        return vec![];
    }
    let at = v.get("timestamp").and_then(Value::as_str).map(String::from);
    let blocks: Vec<Value> = match v.pointer("/message/content") {
        Some(Value::String(s)) => vec![serde_json::json!({"type": "text", "text": s})],
        Some(Value::Array(a)) => a.clone(),
        _ => return vec![],
    };
    let mut out = Vec::new();
    for b in &blocks {
        match b.get("type").and_then(Value::as_str) {
            Some("text") => {
                let text = b.get("text").and_then(Value::as_str).unwrap_or("").trim();
                if text.is_empty() {
                    continue;
                }
                let text = text.to_string();
                out.push(if kind == "user" {
                    Item::User { text, at: at.clone() }
                } else {
                    Item::Assistant { text, at: at.clone() }
                });
            }
            Some("tool_use") if kind == "assistant" => {
                let name = b.get("name").and_then(Value::as_str).unwrap_or("").to_string();
                let input = b.get("input");
                let summary = ["description", "command", "file_path"]
                    .iter()
                    .find_map(|k| {
                        input.and_then(|i| i.get(*k)).and_then(Value::as_str).filter(|s| !s.is_empty())
                    })
                    .map(truncate)
                    .unwrap_or_default();
                out.push(Item::Tool { name, summary, at: at.clone() });
            }
            _ => {}
        }
    }
    out
}

fn summarise_lines<I: Iterator<Item = String>>(lines: I, limit: usize) -> Vec<Item> {
    let mut tail: VecDeque<Item> = VecDeque::with_capacity(limit.min(1024));
    if limit == 0 {
        return vec![];
    }
    for line in lines {
        for item in line_items(&line) {
            if tail.len() == limit {
                tail.pop_front();
            }
            tail.push_back(item);
        }
    }
    tail.into()
}

/// The last `limit` items of a transcript.
#[allow(dead_code)] // used by tests
pub fn summarise(jsonl: &str, limit: usize) -> Vec<Item> {
    summarise_lines(jsonl.lines().map(String::from), limit)
}

/// Streams the file line by line, keeping only the tail in memory.
pub fn read_tail(path: &Path, limit: usize) -> Vec<Item> {
    let Ok(f) = std::fs::File::open(path) else { return vec![] };
    summarise_lines(BufReader::new(f).lines().map_while(Result::ok), limit)
}

#[tauri::command]
pub async fn agents_conversation(
    state: tauri::State<'_, super::AgentsState>,
    session_id: String,
) -> Result<Vec<Item>, String> {
    let login = ready(&state)?;
    let claude_dir = home_dir().join(".claude");
    super::pty::blocking(move || {
        cli(&login)?;
        Ok(locate(&claude_dir, &session_id).map(|p| read_tail(&p, LIMIT)).unwrap_or_default())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = include_str!("../../tests/fixtures/agents/transcript.jsonl");

    #[test]
    fn summarise_text_and_tools() {
        let items = summarise(FIXTURE, 300);
        assert_eq!(items.len(), 7);
        assert_eq!(items[0], Item::User { text: "Add a README to the demo project".into(), at: Some("2026-01-01T10:00:01.000Z".into()) });
        assert_eq!(items[1], Item::Assistant { text: "I will look at the folder first.".into(), at: Some("2026-01-01T10:00:02.000Z".into()) });
        assert_eq!(items[2], Item::Tool { name: "Bash".into(), summary: "List the demo folder".into(), at: Some("2026-01-01T10:00:02.000Z".into()) });
        assert!(matches!(&items[3], Item::Tool { name, summary, .. } if name == "Read" && summary == "/tmp/demo/a.txt"));
        assert!(matches!(&items[4], Item::Tool { summary, .. } if summary == "echo hi"));
        assert!(matches!(&items[5], Item::User { text, .. } if text == "Thanks, now write it."));
        assert!(matches!(&items[6], Item::Assistant { text, .. } if text == "Done."));
        let json = serde_json::to_value(&items[0]).unwrap();
        assert_eq!(json["kind"], "user");
    }

    #[test]
    fn summarise_limit_keeps_tail() {
        let items = summarise(FIXTURE, 2);
        assert_eq!(items.len(), 2);
        assert!(matches!(&items[0], Item::User { text, .. } if text == "Thanks, now write it."));
        assert!(matches!(&items[1], Item::Assistant { text, .. } if text == "Done."));
    }

    #[test]
    fn tool_summary_truncated() {
        let long = "x".repeat(500);
        let line = format!(
            r#"{{"type":"assistant","message":{{"content":[{{"type":"tool_use","name":"Bash","input":{{"command":"{long}"}}}}]}}}}"#
        );
        let items = summarise(&line, 10);
        assert!(matches!(&items[0], Item::Tool { summary, .. } if summary.chars().count() == 200));
    }

    #[test]
    fn bad_lines_skipped() {
        let items = summarise("garbage\n{\"type\":\n\n[1,2]\n", 10);
        assert!(items.is_empty());
    }

    #[test]
    fn locate_rejects_path_tricks() {
        let dir = std::env::temp_dir();
        assert_eq!(locate(&dir, "../x"), None);
        assert_eq!(locate(&dir, ""), None);
        assert_eq!(locate(&dir, "a/b"), None);
    }

    #[test]
    fn locate_and_read_from_disk() {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("sm-agents-tr-{nanos}"));
        let proj = dir.join("projects").join("-tmp-demo");
        std::fs::create_dir_all(&proj).unwrap();
        let id = "00000000-0000-4000-8000-000000000001";
        let file = proj.join(format!("{id}.jsonl"));
        std::fs::write(&file, FIXTURE).unwrap();
        assert_eq!(locate(&dir, id), Some(file.clone()));
        assert_eq!(locate(&dir, "00000000-0000-4000-8000-000000000002"), None);
        assert_eq!(read_tail(&file, 3).len(), 3);
        assert!(last_change_ms(&file).is_some());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
