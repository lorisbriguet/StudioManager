//! `studiomanager-mcp --stop-hook`: Claude Code runs this as the `Stop` hook of
//! a worker the watcher started. It may block the stop once per reason: the
//! worker has not called `report_result`, or it ends on a question it did not
//! send with `ask`. It prints only the decision, and the caller always exits 0.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

pub const RESULT_TOOL: &str = "mcp__studiomanager__report_result";
pub const ASK_TOOL: &str = "mcp__studiomanager__ask";
/// Only the end of a transcript is read, so a huge one cannot stall the hook.
pub const TRANSCRIPT_CAP: u64 = 2 * 1024 * 1024;

const RESULT_REASON: &str = "Before you stop: call report_result with what was done, what is left open, how to check it, and the branch and pull request link.";
const QUESTION_REASON: &str =
    "If you are asking the user something, send it with the ask tool, then stop.";

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HookState {
    pub result_asked: bool,
    pub question_asked: bool,
}

/// Same rule as the app's `valid_session_id` (a lower-case UUID).
fn valid_session_id(s: &str) -> bool {
    s.len() == 36 && s.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f' | '-'))
}

/// The hook's answer for one stop, or `None` to let the session stop.
pub fn decide(input: &str, transcript: &str, state: &mut HookState) -> Option<String> {
    decide_inner(input, transcript, false, state)
}

fn decide_inner(
    input: &str,
    transcript: &str,
    cut: bool,
    state: &mut HookState,
) -> Option<String> {
    let v: Value = serde_json::from_str(input).ok()?;
    if v.get("stop_hook_active").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    let entries: Vec<Value> = transcript
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .collect();

    // A cut transcript cannot prove that a result was never reported.
    if !state.result_asked && !cut && !has_tool_use(&entries, RESULT_TOOL) {
        state.result_asked = true;
        return Some(block(RESULT_REASON));
    }
    if !state.question_asked && asks_without_tool(&entries, cut) {
        state.question_asked = true;
        return Some(block(QUESTION_REASON));
    }
    None
}

fn block(reason: &str) -> String {
    serde_json::json!({ "decision": "block", "reason": reason }).to_string()
}

fn blocks(e: &Value) -> Vec<&Value> {
    match e.pointer("/message/content") {
        Some(Value::Array(a)) => a.iter().collect(),
        _ => Vec::new(),
    }
}

fn kind(e: &Value) -> &str {
    e.get("type").and_then(Value::as_str).unwrap_or("")
}

fn has_tool_use(entries: &[Value], name: &str) -> bool {
    entries.iter().filter(|e| kind(e) == "assistant").any(|e| {
        blocks(e).iter().any(|b| {
            b.get("type").and_then(Value::as_str) == Some("tool_use")
                && b.get("name").and_then(Value::as_str) == Some(name)
        })
    })
}

/// A user entry that is a real message: a string, or a `text` block. Tool
/// results are user entries too and do not count.
fn is_user_message(e: &Value) -> bool {
    kind(e) == "user"
        && match e.pointer("/message/content") {
            Some(Value::String(_)) => true,
            Some(Value::Array(a)) => a
                .iter()
                .any(|b| b.get("type").and_then(Value::as_str) == Some("text")),
            _ => false,
        }
}

fn assistant_text(e: &Value) -> String {
    blocks(e)
        .iter()
        .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|b| b.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n")
}

/// The last assistant text has a line ending in `?` and no `ask` call follows
/// the last user message.
fn asks_without_tool(entries: &[Value], cut: bool) -> bool {
    let Some(text) = entries
        .iter()
        .rev()
        .filter(|e| kind(e) == "assistant")
        .map(assistant_text)
        .find(|t| !t.trim().is_empty())
    else {
        return false;
    };
    if !text.lines().any(|l| l.trim().ends_with('?')) {
        return false;
    }
    let after = match entries.iter().rposition(is_user_message) {
        Some(i) => &entries[i + 1..],
        // No user message in a cut transcript: an ask may be before the cut.
        None if cut => return false,
        None => entries,
    };
    !has_tool_use(after, ASK_TOOL)
}

fn state_path(data_dir: &Path, session: &str) -> PathBuf {
    data_dir
        .join("watcher")
        .join("stop-hook")
        .join(format!("{session}.json"))
}

/// The end of the transcript file (at most `cap` bytes, whole lines only) and
/// whether the start was cut off.
fn read_tail(path: &Path, cap: u64) -> Option<(String, bool)> {
    let mut f = File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    let cut = len > cap;
    if cut {
        f.seek(SeekFrom::Start(len - cap)).ok()?;
    }
    let mut bytes = Vec::new();
    f.take(cap).read_to_end(&mut bytes).ok()?;
    let mut text = String::from_utf8_lossy(&bytes).into_owned();
    if cut {
        // The first line is probably partial.
        text = text.split_once('\n').map(|(_, rest)| rest.to_string())?;
    }
    Some((text, cut))
}

/// Runs the hook for one stdin payload: reads the transcript and the state,
/// and keeps the state. Any error means no decision (nothing is blocked), and
/// a state that cannot be written never blocks.
pub fn handle(data_dir: &Path, input: &str, cap: u64) -> Option<String> {
    let v: Value = serde_json::from_str(input).ok()?;
    let session = v.get("session_id")?.as_str()?;
    if !valid_session_id(session) {
        return None;
    }
    let transcript = v.get("transcript_path")?.as_str()?;
    let (text, cut) = read_tail(Path::new(transcript), cap)?;
    let path = state_path(data_dir, session);
    let mut state: HookState = fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let reason = decide_inner(input, &text, cut, &mut state)?;
    fs::create_dir_all(path.parent()?).ok()?;
    fs::write(&path, serde_json::to_string(&state).ok()?).ok()?;
    Some(reason)
}

/// Reads stdin and prints the decision, if any.
pub fn run(data_dir: &Path) {
    let mut input = Vec::new();
    let _ = std::io::stdin().read_to_end(&mut input);
    if let Some(out) = handle(data_dir, &String::from_utf8_lossy(&input), TRANSCRIPT_CAP) {
        println!("{out}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::temp_data_dir;
    use serde_json::json;

    const SID: &str = "0b3f6c1e-2d4a-4b8e-9c1d-5a7e8f901234";

    fn input(sid: &str, active: bool) -> String {
        json!({"session_id": sid, "stop_hook_active": active, "transcript_path": "/x"}).to_string()
    }
    fn user(text: &str) -> String {
        json!({"type":"user","message":{"content":text}}).to_string()
    }
    fn tool_result() -> String {
        json!({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t","content":"ok"}]}}).to_string()
    }
    fn say(text: &str) -> String {
        json!({"type":"assistant","message":{"content":[{"type":"text","text":text}]}}).to_string()
    }
    fn tool(name: &str) -> String {
        json!({"type":"assistant","message":{"content":[{"type":"tool_use","name":name,"input":{}}]}}).to_string()
    }
    fn lines(l: &[String]) -> String {
        l.join("\n")
    }
    fn reason(out: &str) -> String {
        let v: Value = serde_json::from_str(out).unwrap();
        assert_eq!(v["decision"], "block");
        v["reason"].as_str().unwrap().to_string()
    }

    #[test]
    fn hook_blocks_once_per_reason() {
        let mut st = HookState::default();
        let t = lines(&[user("go"), say("Done.")]);
        let out = decide(&input(SID, false), &t, &mut st).unwrap();
        assert_eq!(reason(&out), RESULT_REASON);
        assert!(decide(&input(SID, false), &t, &mut st).is_none());

        let mut st = HookState::default();
        let t = lines(&[user("go"), tool(RESULT_TOOL), say("Which colour?")]);
        let out = decide(&input(SID, false), &t, &mut st).unwrap();
        assert_eq!(reason(&out), QUESTION_REASON);
        assert!(decide(&input(SID, false), &t, &mut st).is_none());
    }

    #[test]
    fn both_reasons_block_the_result_first_and_mark_only_it() {
        let mut st = HookState::default();
        let t = lines(&[user("go"), say("Which colour?")]);
        let out = decide(&input(SID, false), &t, &mut st).unwrap();
        assert_eq!(reason(&out), RESULT_REASON);
        assert!(st.result_asked && !st.question_asked);
        let out = decide(&input(SID, false), &t, &mut st).unwrap();
        assert_eq!(reason(&out), QUESTION_REASON);
        assert!(decide(&input(SID, false), &t, &mut st).is_none());
    }

    #[test]
    fn a_result_in_the_transcript_does_not_block() {
        let mut st = HookState::default();
        let t = lines(&[user("go"), tool(RESULT_TOOL), say("All done.")]);
        assert!(decide(&input(SID, false), &t, &mut st).is_none());
    }

    #[test]
    fn a_question_sent_with_ask_does_not_block() {
        let mut st = HookState::default();
        let t = lines(&[user("go"), tool(RESULT_TOOL), tool(ASK_TOOL), say("Which colour?")]);
        assert!(decide(&input(SID, false), &t, &mut st).is_none());
        // An ask before the last user message does not count.
        let t = lines(&[tool(ASK_TOOL), user("blue"), tool(RESULT_TOOL), say("Sure?")]);
        assert!(decide(&input(SID, false), &t, &mut st).is_some());
    }

    #[test]
    fn tool_results_do_not_count_as_the_last_user_message() {
        let mut st = HookState::default();
        let t = lines(&[
            user("go"),
            tool(RESULT_TOOL),
            tool(ASK_TOOL),
            tool_result(),
            say("Which colour?"),
        ]);
        assert!(decide(&input(SID, false), &t, &mut st).is_none());
    }

    #[test]
    fn a_question_line_is_any_trimmed_line_ending_in_a_question_mark() {
        let mut st = HookState::default();
        let t = lines(&[user("go"), tool(RESULT_TOOL), say("Plan:\n```\nwhy?  \n```")]);
        assert!(decide(&input(SID, false), &t, &mut st).is_some());
        let mut st = HookState::default();
        let t = lines(&[user("go"), tool(RESULT_TOOL), say("Is it ok? Yes it is.")]);
        assert!(decide(&input(SID, false), &t, &mut st).is_none());
    }

    #[test]
    fn stop_hook_active_never_blocks() {
        let mut st = HookState::default();
        let t = lines(&[user("go"), say("Which colour?")]);
        assert!(decide(&input(SID, true), &t, &mut st).is_none());
        assert_eq!(st, HookState::default());
    }

    #[test]
    fn bad_input_and_bad_lines_block_nothing_wrongly() {
        let mut st = HookState::default();
        assert!(decide("not json", "", &mut st).is_none());
        let t = format!("garbage\n{}\n{{\"type\":\"summary\"}}", tool(RESULT_TOOL));
        assert!(decide(&input(SID, false), &t, &mut st).is_none());
    }

    fn write_transcript(dir: &Path, body: &str) -> PathBuf {
        let p = dir.join("t.jsonl");
        fs::write(&p, body).unwrap();
        p
    }
    fn payload(sid: &str, transcript: &Path) -> String {
        json!({"session_id": sid, "stop_hook_active": false, "transcript_path": transcript}).to_string()
    }

    #[test]
    fn output_is_the_block_json_and_state_is_kept() {
        let dir = temp_data_dir();
        let t = write_transcript(&dir, &lines(&[user("go"), say("Done.")]));
        let out = handle(&dir, &payload(SID, &t), TRANSCRIPT_CAP).unwrap();
        assert_eq!(reason(&out), RESULT_REASON);
        assert!(state_path(&dir, SID).exists());
        assert!(handle(&dir, &payload(SID, &t), TRANSCRIPT_CAP).is_none());
    }

    #[test]
    fn a_session_id_with_a_slash_writes_nothing() {
        let dir = temp_data_dir();
        let t = write_transcript(&dir, &lines(&[user("go"), say("Done.")]));
        assert!(handle(&dir, &payload("../evil", &t), TRANSCRIPT_CAP).is_none());
        assert!(!dir.join("watcher").exists());
    }

    #[test]
    fn an_unreadable_transcript_blocks_nothing() {
        let dir = temp_data_dir();
        let missing = dir.join("nope.jsonl");
        assert!(handle(&dir, &payload(SID, &missing), TRANSCRIPT_CAP).is_none());
    }

    #[test]
    fn an_unwritable_state_folder_blocks_nothing() {
        let dir = temp_data_dir();
        fs::write(dir.join("watcher"), "a file, not a folder").unwrap();
        let t = write_transcript(&dir, &lines(&[user("go"), say("Done.")]));
        assert!(handle(&dir, &payload(SID, &t), TRANSCRIPT_CAP).is_none());
    }

    #[test]
    fn a_transcript_larger_than_the_cap_does_not_block_for_a_missing_result() {
        let dir = temp_data_dir();
        // The result call is in the part that is cut off.
        let mut body = lines(&[tool(RESULT_TOOL)]);
        for _ in 0..50 {
            body.push('\n');
            body.push_str(&say("filler"));
        }
        let t = write_transcript(&dir, &body);
        assert!(handle(&dir, &payload(SID, &t), 400).is_none());
        // A small transcript with no result still blocks.
        let t = write_transcript(&dir, &say("filler"));
        assert!(handle(&dir, &payload(SID, &t), TRANSCRIPT_CAP).is_some());
    }
}
