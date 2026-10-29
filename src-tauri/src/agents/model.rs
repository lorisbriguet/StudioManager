use super::projects::ProjectLabel;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

/// A needs-you agent goes quiet after this long with no transcript change.
pub const QUIET_AFTER_MS: i64 = 7_200_000;

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Background,
    Interactive,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Group {
    NeedsYou,
    Working,
    Idle,
    Done,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Quiet {
    Stale,
    Dismissed,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub session_id: String,
    pub short_id: Option<String>,
    pub pid: Option<u32>,
    pub name: String,
    pub cwd: String,
    pub kind: Kind,
    pub status: String,
    pub state: Option<String>,
    pub waiting_for: Option<String>,
    pub started_at: i64,
    pub group: Group,
    pub quiet: Option<Quiet>,
    pub project: Option<ProjectLabel>,
    pub model: Option<String>,
    /// The exact model in use, e.g. "Opus 5.5", when known from the transcript.
    pub model_label: Option<String>,
}

pub fn group_of(status: &str, state: Option<&str>) -> Group {
    match status {
        "waiting" => return Group::NeedsYou,
        "busy" => return Group::Working,
        _ => {}
    }
    match state {
        Some("done" | "completed" | "exited" | "failed") => Group::Done,
        Some("needs_input" | "waiting" | "blocked") => Group::NeedsYou,
        _ => Group::Idle,
    }
}

fn str_of(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(str::to_string)
}

pub fn parse_agents(json: &str) -> Result<Vec<Agent>, String> {
    let v: Value = serde_json::from_str(json).map_err(|e| format!("Invalid agents JSON: {e}"))?;
    let items = v.as_array().ok_or("Invalid agents JSON: expected an array")?;
    let mut out = Vec::new();
    for it in items {
        let Some(session_id) = str_of(it, "sessionId").filter(|s| !s.is_empty()) else {
            continue;
        };
        let cwd = str_of(it, "cwd").unwrap_or_default();
        let name = str_of(it, "name")
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| {
                cwd.trim_end_matches('/').rsplit('/').next().unwrap_or("").to_string()
            });
        let kind = match it.get("kind").and_then(Value::as_str) {
            Some("bg" | "background") => Kind::Background,
            _ => Kind::Interactive,
        };
        let status = str_of(it, "status").unwrap_or_else(|| "idle".to_string());
        let state = str_of(it, "state");
        let group = group_of(&status, state.as_deref());
        out.push(Agent {
            session_id,
            short_id: str_of(it, "id"),
            pid: it.get("pid").and_then(Value::as_u64).and_then(|p| u32::try_from(p).ok()),
            name,
            cwd,
            kind,
            status,
            state,
            waiting_for: str_of(it, "waitingFor"),
            started_at: it.get("startedAt").and_then(Value::as_i64).unwrap_or(0),
            group,
            quiet: None,
            project: None,
            model: str_of(it, "model"),
            model_label: None,
        });
    }
    Ok(dedupe_by_session(out))
}

/// A resumed conversation keeps its session id, so the CLI can list it twice: the live process
/// and the background job it left behind (often "blocked"). One row per session id, in the place
/// of the first: a live process that needs you wins, then any live process, then the newest
/// start. The row kept takes the job id of the one dropped when it has none, so send, answer and
/// stop keep working.
fn dedupe_by_session(agents: Vec<Agent>) -> Vec<Agent> {
    let mut out: Vec<Agent> = Vec::with_capacity(agents.len());
    for a in agents {
        match out.iter().position(|o| o.session_id == a.session_id) {
            None => out.push(a),
            Some(i) => {
                let rank = |x: &Agent| {
                    let live = x.pid.is_some();
                    (live && x.group == Group::NeedsYou, live, x.started_at)
                };
                let dropped = if rank(&a) > rank(&out[i]) { std::mem::replace(&mut out[i], a) } else { a };
                if out[i].short_id.is_none() {
                    out[i].short_id = dropped.short_id;
                }
            }
        }
    }
    out
}

/// Moves needs-you agents to idle when dismissed or untouched for `QUIET_AFTER_MS`.
pub fn apply_quiet(
    agents: &mut [Agent],
    now_ms: i64,
    last_change_ms: &dyn Fn(&Agent) -> Option<i64>,
    dismissed: &HashSet<String>,
) {
    for a in agents.iter_mut() {
        if a.group != Group::NeedsYou {
            continue;
        }
        if dismissed.contains(&a.session_id) {
            a.group = Group::Idle;
            a.quiet = Some(Quiet::Dismissed);
        } else if last_change_ms(a).is_some_and(|t| now_ms - t > QUIET_AFTER_MS) {
            a.group = Group::Idle;
            a.quiet = Some(Quiet::Stale);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_agents_reads_cli_json() {
        let j = r#"[{"pid":1,"id":"a1b2c3d4","cwd":"/x/proj","kind":"bg","startedAt":5,"sessionId":"s1","name":"fix","status":"waiting","waitingFor":"permission prompt"},{"cwd":"/x/y"}]"#;
        let a = parse_agents(j).unwrap();
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].kind, Kind::Background);
        assert_eq!(a[0].short_id.as_deref(), Some("a1b2c3d4"));
        assert_eq!(a[0].group, Group::NeedsYou);
        assert_eq!(a[0].waiting_for.as_deref(), Some("permission prompt"));
        assert_eq!(a[0].pid, Some(1));
        assert_eq!(a[0].started_at, 5);
    }

    #[test]
    fn parse_agents_name_fallback_and_model() {
        let j = r#"[{"sessionId":"s2","cwd":"/x/proj/","kind":"interactive","status":"idle","model":"opus"}]"#;
        let a = parse_agents(j).unwrap();
        assert_eq!(a[0].name, "proj");
        assert_eq!(a[0].kind, Kind::Interactive);
        assert_eq!(a[0].model.as_deref(), Some("opus"));
        assert!(parse_agents("nope").is_err());
    }

    #[test]
    fn a_resumed_session_listed_twice_shows_once_as_the_live_one() {
        let stale = r#"{"id":"3bec7f97","cwd":"/x","kind":"background","startedAt":1,"sessionId":"s","name":"dropdown","state":"blocked"}"#;
        let live = r#"{"pid":8601,"cwd":"/x/wt","kind":"interactive","startedAt":2,"sessionId":"s","name":"dropdown","status":"busy"}"#;
        for j in [format!("[{stale},{live}]"), format!("[{live},{stale}]")] {
            let a = parse_agents(&j).unwrap();
            assert_eq!(a.len(), 1);
            assert_eq!((a[0].pid, a[0].group), (Some(8601), Group::Working));
        }
    }

    #[test]
    fn a_resumed_session_keeps_its_prompt_and_job_id() {
        // The background job is live and waiting; the interactive resume is newer but busy.
        let job = r#"{"pid":100,"id":"3bec7f97","cwd":"/x","kind":"background","startedAt":1,"sessionId":"s","name":"d","status":"waiting","waitingFor":"permission prompt"}"#;
        let live = r#"{"pid":200,"cwd":"/x/wt","kind":"interactive","startedAt":2,"sessionId":"s","name":"d","status":"busy"}"#;
        for j in [format!("[{job},{live}]"), format!("[{live},{job}]")] {
            let a = parse_agents(&j).unwrap();
            assert_eq!(a.len(), 1);
            assert_eq!((a[0].pid, a[0].group, a[0].short_id.as_deref()), (Some(100), Group::NeedsYou, Some("3bec7f97")));
        }
        // Both busy: the newest wins but inherits the job id.
        let job = r#"{"pid":100,"id":"3bec7f97","cwd":"/x","kind":"background","startedAt":1,"sessionId":"s","name":"d","status":"busy"}"#;
        let a = parse_agents(&format!("[{job},{live}]")).unwrap();
        assert_eq!((a[0].pid, a[0].short_id.as_deref()), (Some(200), Some("3bec7f97")));
    }

    #[test]
    fn group_of_table() {
        assert_eq!(group_of("waiting", None), Group::NeedsYou);
        assert_eq!(group_of("busy", Some("done")), Group::Working);
        assert_eq!(group_of("idle", Some("completed")), Group::Done);
        assert_eq!(group_of("idle", Some("blocked")), Group::NeedsYou);
        assert_eq!(group_of("idle", Some("working")), Group::Idle);
    }

    fn ag(id: &str, g: Group) -> Agent {
        Agent {
            session_id: id.into(), short_id: None, pid: None, name: id.into(), cwd: "/x".into(),
            kind: Kind::Background, status: "waiting".into(), state: None, waiting_for: None,
            started_at: 0, group: g, quiet: None, project: None, model: None, model_label: None,
        }
    }

    #[test]
    fn quiet_after_two_hours() {
        let now = 10_000_000_000;
        let mut v = vec![ag("old", Group::NeedsYou), ag("fresh", Group::NeedsYou), ag("dis", Group::NeedsYou)];
        let mut dis = HashSet::new();
        dis.insert("dis".to_string());
        let last = |a: &Agent| match a.session_id.as_str() {
            "old" => Some(now - 7_200_001),
            "fresh" => Some(now - 7_199_999),
            _ => Some(now),
        };
        apply_quiet(&mut v, now, &last, &dis);
        assert_eq!((v[0].group, v[0].quiet), (Group::Idle, Some(Quiet::Stale)));
        assert_eq!((v[1].group, v[1].quiet), (Group::NeedsYou, None));
        assert_eq!((v[2].group, v[2].quiet), (Group::Idle, Some(Quiet::Dismissed)));
    }
}
