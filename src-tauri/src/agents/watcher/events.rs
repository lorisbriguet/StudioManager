//! What the watcher notices about one of its links, from the agent list and the database. Pure:
//! it decides nothing about what to do (later tasks do).

use super::super::briefing::LISTED_GRACE_MS;
use super::super::model::{Agent, Group};
use super::store::WatcherLink;

/// Idle (or at a prompt) this long without an answer, the agent is old.
pub const OLD_MS: i64 = 86_400_000;
/// Idle this long without a result or a question: it stopped for no reason.
pub const IDLE_NO_RESULT_MS: i64 = 30 * 60_000;
/// Waiting on a permission prompt this long: a person has to look.
pub const AT_PROMPT_MS: i64 = 2 * 60_000;

/// Idle this long on a connection error: the watcher asks the worker to continue.
pub const STUCK_IDLE_MS: i64 = 2 * 60_000;
/// Idle this long with a result reported: the work is handed in (`Finished`).
pub const REPORTED_IDLE_MS: i64 = 2 * 60_000;
/// How much of the end of a transcript `stuck_in` is given.
pub const TAIL_BYTES: u64 = 64 * 1024;

/// Whether a session stopped on a lost connection: the last parseable line of the transcript's
/// tail is an assistant entry flagged `isApiErrorMessage` with `error` `server_error`. Other
/// errors (`rate_limit`, `authentication_failed`) are not: a resume would spend usage or fail
/// again. The tail may start in the middle of a line, and lines that are not JSON objects are
/// skipped.
pub fn stuck_in(transcript_tail: &str) -> bool {
    for line in transcript_tail.lines().rev() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        if !v.is_object() {
            continue;
        }
        return v["type"] == "assistant" && v["isApiErrorMessage"] == true && v["error"] == "server_error";
    }
    false
}

#[derive(Clone, Debug, PartialEq)]
pub enum Event {
    /// The worker asked a question: the open `decide` entry.
    Asked { entry: i64 },
    AtPrompt { since: i64 },
    Finished { reported: bool },
    Stuck,
    IdleNoResult { since: i64 },
    Old,
    Gone,
}

/// The first thing that holds, in this order: gone, finished, asked, stuck, reported and idle (finished), at a prompt, old,
/// idle without a result. `stuck` is the caller's reading of the transcript; `open_ask` the open
/// `decide` entry of the link. `link.seen_since` is when the agent entered its current idle or
/// needs-you state (unknown counts as now, so nothing fires on the first sight).
pub fn notice(
    link: &WatcherLink,
    agent: Option<&Agent>,
    stuck: bool,
    open_ask: Option<i64>,
    now: i64,
    listed_at: Option<i64>,
) -> Option<Event> {
    let Some(agent) = agent else {
        // Gone only after a list made once the agent had time to appear.
        return listed_at.is_some_and(|t| t > link.started_at + LISTED_GRACE_MS).then_some(Event::Gone);
    };
    if agent.group == Group::Done {
        return Some(Event::Finished { reported: link.reported });
    }
    if let Some(entry) = open_ask {
        return Some(Event::Asked { entry });
    }
    if stuck {
        return Some(Event::Stuck);
    }
    let since = link.seen_since.unwrap_or(now);
    // A result is reported and the agent has gone quiet: the work is handed in, whether or not the
    // agent also ended (what `check` handles for a done agent).
    if agent.group == Group::Idle && link.reported && now - since >= REPORTED_IDLE_MS {
        return Some(Event::Finished { reported: true });
    }
    match agent.group {
        Group::NeedsYou if agent.status == "waiting" && now - since >= AT_PROMPT_MS => Some(Event::AtPrompt { since }),
        Group::Idle if now - link.started_at >= OLD_MS => Some(Event::Old),
        Group::Idle if !link.reported && now - since >= IDLE_NO_RESULT_MS => Some(Event::IdleNoResult { since }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::links::ItemKind;
    use crate::agents::model::parse_agents;

    const T0: i64 = 1_800_000_000_000;
    const MIN: i64 = 60_000;

    fn link() -> WatcherLink {
        WatcherLink {
            org: "org1".into(),
            id: 1,
            kind: ItemKind::Task,
            item_id: 1,
            short_id: "0a1b2c3d".into(),
            session_id: Some("00000000-1111-2222-3333-444444444444".into()),
            worktree: None,
            base_ref: None,
            check_state: None,
            reported: false,
            started_at: T0,
            wrap_asked_at: None,
            resumes: 0,
            check_fails: 0,
            sent_back: 0,
            question_sessions: 0,
            check_sessions: 0,
            seen_since: None,
        }
    }

    fn agent(status: &str, state: Option<&str>) -> Agent {
        let state = state.map(|s| format!(r#","state":"{s}""#)).unwrap_or_default();
        let json = format!(
            r#"[{{"sessionId":"00000000-1111-2222-3333-444444444444","id":"0a1b2c3d","name":"work","cwd":"/x","kind":"bg","status":"{status}"{state}}}]"#
        );
        parse_agents(&json).unwrap().remove(0)
    }

    #[test]
    fn at_prompt_after_two_minutes_waiting_and_not_a_millisecond_before() {
        let l = WatcherLink { seen_since: Some(T0 + MIN), ..link() };
        let a = agent("waiting", None);
        let at = T0 + MIN + AT_PROMPT_MS;
        assert_eq!(notice(&l, Some(&a), false, None, at - 1, None), None);
        assert_eq!(notice(&l, Some(&a), false, None, at, None), Some(Event::AtPrompt { since: T0 + MIN }));
        // Needs you for another reason than a prompt is not a prompt.
        let blocked = agent("idle", Some("blocked"));
        assert_eq!(notice(&l, Some(&blocked), false, None, at + MIN, None), None);
    }

    #[test]
    fn idle_without_result_after_thirty_minutes_and_not_a_millisecond_before() {
        let l = WatcherLink { seen_since: Some(T0), ..link() };
        let a = agent("idle", None);
        let at = T0 + IDLE_NO_RESULT_MS;
        assert_eq!(notice(&l, Some(&a), false, None, at - 1, None), None);
        assert_eq!(notice(&l, Some(&a), false, None, at, None), Some(Event::IdleNoResult { since: T0 }));
        // With a result written, or a question open, it is not "without a result".
        let reported = WatcherLink { reported: true, ..l.clone() };
        assert_eq!(notice(&reported, Some(&a), false, None, at, None), Some(Event::Finished { reported: true }));
        assert_eq!(notice(&l, Some(&a), false, Some(7), at, None), Some(Event::Asked { entry: 7 }));
    }

    #[test]
    fn reported_and_idle_is_finished_after_two_minutes_and_not_a_millisecond_before() {
        let l = WatcherLink { reported: true, seen_since: Some(T0), ..link() };
        let a = agent("idle", None);
        assert_eq!(notice(&l, Some(&a), false, None, T0 + REPORTED_IDLE_MS - 1, None), None);
        assert_eq!(notice(&l, Some(&a), false, None, T0 + REPORTED_IDLE_MS, None), Some(Event::Finished { reported: true }));
        // Before Old and IdleNoResult.
        assert_eq!(notice(&l, Some(&a), false, None, T0 + OLD_MS, None), Some(Event::Finished { reported: true }));
        // Not reported: not finished. A working agent, or an open question: not finished either.
        let unreported = WatcherLink { reported: false, ..l.clone() };
        assert_eq!(notice(&unreported, Some(&a), false, None, T0 + MIN * 10, None), None);
        assert_eq!(notice(&l, Some(&agent("busy", None)), false, None, T0 + MIN * 10, None), None);
        assert_eq!(notice(&l, Some(&a), false, Some(4), T0 + MIN * 10, None), Some(Event::Asked { entry: 4 }));
    }

    #[test]
    fn old_after_a_day_idle_and_not_a_millisecond_before() {
        let l = WatcherLink { seen_since: Some(T0), ..link() };
        let a = agent("idle", None);
        assert_eq!(notice(&l, Some(&a), false, None, T0 + OLD_MS - 1, None), Some(Event::IdleNoResult { since: T0 }));
        assert_eq!(notice(&l, Some(&a), false, None, T0 + OLD_MS, None), Some(Event::Old));
        // A working agent is never old.
        let busy = agent("busy", None);
        assert_eq!(notice(&l, Some(&busy), false, None, T0 + OLD_MS, None), None);
    }

    #[test]
    fn gone_only_after_a_list_made_past_the_grace() {
        let l = link();
        let at = T0 + LISTED_GRACE_MS;
        assert_eq!(notice(&l, None, false, None, at + 5 * MIN, None), None, "never listed");
        assert_eq!(notice(&l, None, false, None, at + 5 * MIN, Some(at)), None, "the list is not past the grace");
        assert_eq!(notice(&l, None, false, None, at + 5 * MIN, Some(at + 1)), Some(Event::Gone));
    }

    fn entry(error: &str) -> String {
        format!(
            r#"{{"type":"assistant","isApiErrorMessage":true,"error":"{error}","message":{{"content":[{{"type":"text","text":"API Error: Connection lost mid-response"}}]}}}}"#
        )
    }
    const WENT_ON: &str = r#"{"type":"user","message":{"content":"Continue where you stopped."}}"#;

    #[test]
    fn stuck_in_is_a_lost_connection_as_the_last_entry_and_nothing_else() {
        let ok = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Done."}]}}"#;
        assert!(stuck_in(&format!("{ok}\n{}\n", entry("server_error"))));
        // Other errors are not stuck: a resume would spend usage or fail again.
        assert!(!stuck_in(&format!("{ok}\n{}\n", entry("rate_limit"))));
        assert!(!stuck_in(&format!("{ok}\n{}\n", entry("authentication_failed"))));
        // The session went on after the error.
        assert!(!stuck_in(&format!("{}\n{WENT_ON}\n", entry("server_error"))));
        // A user entry or a plain assistant entry with the same fields is not it.
        assert!(!stuck_in(&format!("{ok}\n")));
        assert!(!stuck_in(&entry("server_error").replace("assistant", "user")));
        assert!(!stuck_in(&entry("server_error").replace("true", "false")));
        assert!(!stuck_in(""));
    }

    #[test]
    fn stuck_in_copes_with_a_cut_first_line_and_garbage() {
        let cut = r#"ssage":{"content":"x"}}"#;
        assert!(stuck_in(&format!("{cut}\n{}", entry("server_error"))), "no trailing new line");
        assert!(!stuck_in(cut), "only a cut line");
        // Lines that are not JSON, or not objects, are skipped; the last parseable one decides.
        assert!(stuck_in(&format!("{WENT_ON}\n{}\nnot json at all\n42\n\n", entry("server_error"))));
        assert!(!stuck_in(&format!("{}\n{WENT_ON}\n{{broken", entry("server_error"))));
    }

    #[test]
    fn finished_asked_and_stuck() {
        let l = WatcherLink { reported: true, ..link() };
        assert_eq!(
            notice(&l, Some(&agent("idle", Some("done"))), false, None, T0, None),
            Some(Event::Finished { reported: true })
        );
        let busy = agent("busy", None);
        assert_eq!(notice(&l, Some(&busy), false, Some(3), T0, None), Some(Event::Asked { entry: 3 }));
        assert_eq!(notice(&l, Some(&busy), true, None, T0, None), Some(Event::Stuck));
        assert_eq!(notice(&l, Some(&busy), false, None, T0, None), None);
    }
}
