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

/// The first thing that holds, in this order: gone, finished, asked, stuck, at a prompt, old,
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
        assert_eq!(notice(&reported, Some(&a), false, None, at, None), None);
        assert_eq!(notice(&l, Some(&a), false, Some(7), at, None), Some(Event::Asked { entry: 7 }));
    }

    #[test]
    fn old_after_a_day_idle_and_not_a_millisecond_before() {
        let l = WatcherLink { reported: true, seen_since: Some(T0), ..link() };
        let a = agent("idle", None);
        assert_eq!(notice(&l, Some(&a), false, None, T0 + OLD_MS - 1, None), None);
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
