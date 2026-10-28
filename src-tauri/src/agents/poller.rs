//! The live agent list: polls `claude agents`, labels and quiets the result,
//! emits `agents:changed` and raises a Mac notification when an agent starts
//! waiting for you.

use super::actions::{fetch_agents, home_dir, read_state};
use super::cli::read_settings;
use super::model::{apply_quiet, Agent, Group};
use super::projects::{load_index, FolderIndex};
use super::transcript::{last_change_ms, locate};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{Emitter, Listener, Manager};
use tauri_plugin_notification::NotificationExt;

pub const CHANGED_EVENT: &str = "agents:changed";
const POLL_INTERVAL: Duration = Duration::from_secs(2);
const INDEX_RELOAD: Duration = Duration::from_secs(30);

/// What the poller remembers between passes.
#[derive(Default)]
pub struct PollState {
    pub last_good: Vec<Agent>,
    pub groups: HashMap<String, Group>,
    pub baseline_done: bool,
}

/// Feed one pass. Returns the list to emit and the agents to notify about.
/// A failed pass re-emits the last good list and changes nothing else.
pub fn poll_once(
    state: &mut PollState,
    result: Result<Vec<Agent>, String>,
) -> (Vec<Agent>, Vec<Agent>) {
    let Ok(agents) = result else {
        return (state.last_good.clone(), vec![]);
    };
    let notify = if state.baseline_done {
        agents
            .iter()
            .filter(|a| {
                a.group == Group::NeedsYou
                    && state.groups.get(&a.session_id) != Some(&Group::NeedsYou)
            })
            .cloned()
            .collect()
    } else {
        vec![]
    };
    state.groups = agents.iter().map(|a| (a.session_id.clone(), a.group)).collect();
    state.baseline_done = true;
    state.last_good = agents.clone();
    (agents, notify)
}

/// `Organisation › Client › Project`, or the folder's last segment.
fn place(a: &Agent) -> String {
    match &a.project {
        Some(p) => format!("{} › {} › {}", p.org_name, p.client_name, p.project_name),
        None => a.cwd.trim_end_matches('/').rsplit('/').next().unwrap_or("").to_string(),
    }
}

pub fn notification_body(a: &Agent) -> String {
    format!("{} — {}", place(a), a.waiting_for.as_deref().unwrap_or("waiting for you"))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn label_and_quiet(agents: &mut [Agent], index: &FolderIndex, app_dir: &std::path::Path) {
    for a in agents.iter_mut() {
        a.project = index.label_for(&a.cwd);
    }
    let dismissed = read_state(app_dir).dismissed.into_iter().collect();
    let claude_dir = home_dir().join(".claude");
    let last = |a: &Agent| locate(&claude_dir, &a.session_id).and_then(|p| last_change_ms(&p));
    apply_quiet(agents, now_ms(), &last, &dismissed);
}

/// Start the poller thread; called from `init` once `AgentsState` is managed.
pub fn start(app: &tauri::AppHandle) {
    let reload = Arc::new(AtomicBool::new(false));
    let flag = reload.clone();
    app.listen(crate::agent_access::CHANGED_EVENT, move |_| flag.store(true, Ordering::Relaxed));
    let handle = app.clone();
    let spawned = std::thread::Builder::new()
        .name("agents-poller".into())
        .spawn(move || run(handle, reload));
    if let Err(e) = spawned {
        log::warn!("[agents] could not start the poller: {e}");
    }
}

fn run(app: tauri::AppHandle, reload: Arc<AtomicBool>) {
    let mut poll = PollState::default();
    let mut index = FolderIndex::default();
    let mut index_at: Option<Instant> = None;
    loop {
        std::thread::sleep(POLL_INTERVAL);
        let Some(state) = app.try_state::<super::AgentsState>() else {
            continue;
        };
        if !read_settings(&state.app_dir).enabled {
            // Off: forget everything so turning it on starts a new baseline.
            if poll.baseline_done || !poll.last_good.is_empty() {
                poll = PollState::default();
                if let Ok(mut c) = state.last.lock() {
                    c.clear();
                }
            }
            continue;
        }
        let Some(cli) = state.real_cli() else {
            continue;
        };
        if reload.swap(false, Ordering::Relaxed)
            || index_at.map_or(true, |t| t.elapsed() >= INDEX_RELOAD)
        {
            index = load_index(&state.app_dir);
            index_at = Some(Instant::now());
        }
        let result = fetch_agents(&cli).map(|mut v| {
            label_and_quiet(&mut v, &index, &state.app_dir);
            v
        });
        let (emit, notify) = poll_once(&mut poll, result);
        if let Ok(mut c) = state.last.lock() {
            *c = emit.clone();
        }
        // No lock is held from here on.
        let _ = app.emit(CHANGED_EVENT, &emit);
        for a in &notify {
            let shown = app
                .notification()
                .builder()
                .title(&a.name)
                .body(notification_body(a))
                .show();
            if let Err(e) = shown {
                log::warn!("[agents] notification failed: {e}");
            }
        }
    }
}

#[tauri::command]
pub async fn agents_list(
    state: tauri::State<'_, super::AgentsState>,
) -> Result<Vec<Agent>, String> {
    super::actions::switched_on(&state)?;
    Ok(state.cached())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::model::{Kind, Quiet};
    use crate::agents::projects::ProjectLabel;

    fn ag(id: &str, g: Group) -> Agent {
        Agent {
            session_id: id.into(), short_id: None, pid: None, name: id.into(), cwd: "/x/proj".into(),
            kind: Kind::Background, status: "busy".into(), state: None, waiting_for: None,
            started_at: 0, group: g, quiet: None, project: None, model: None,
        }
    }

    #[test]
    fn first_poll_is_baseline() {
        let mut s = PollState::default();
        let (emit, notify) = poll_once(&mut s, Ok(vec![ag("a", Group::NeedsYou)]));
        assert_eq!(emit.len(), 1);
        assert!(notify.is_empty());
        assert!(s.baseline_done);
    }

    #[test]
    fn transition_to_needs_you_notifies_once() {
        let mut s = PollState::default();
        poll_once(&mut s, Ok(vec![ag("a", Group::Working)]));
        let (_, n) = poll_once(&mut s, Ok(vec![ag("a", Group::NeedsYou)]));
        assert_eq!(n.len(), 1);
        let (_, n) = poll_once(&mut s, Ok(vec![ag("a", Group::NeedsYou)]));
        assert!(n.is_empty());
    }

    #[test]
    fn new_agent_already_waiting_notifies() {
        let mut s = PollState::default();
        poll_once(&mut s, Ok(vec![ag("a", Group::Working)]));
        let (_, n) = poll_once(&mut s, Ok(vec![ag("a", Group::Working), ag("b", Group::NeedsYou)]));
        assert_eq!(n.len(), 1);
        assert_eq!(n[0].session_id, "b");
    }

    #[test]
    fn quiet_agent_not_notified() {
        let mut s = PollState::default();
        poll_once(&mut s, Ok(vec![ag("a", Group::Working)]));
        let mut quiet = ag("a", Group::Idle);
        quiet.quiet = Some(Quiet::Stale);
        let (_, n) = poll_once(&mut s, Ok(vec![quiet]));
        assert!(n.is_empty());
    }

    #[test]
    fn failed_poll_keeps_last_list_and_baseline() {
        let mut s = PollState::default();
        poll_once(&mut s, Ok(vec![ag("a", Group::Working)]));
        let (_, n) = poll_once(&mut s, Ok(vec![ag("a", Group::NeedsYou)]));
        assert_eq!(n.len(), 1);
        let (emit, n) = poll_once(&mut s, Err("boom".into()));
        assert_eq!(emit.len(), 1);
        assert_eq!(emit[0].group, Group::NeedsYou);
        assert!(n.is_empty());
        let (_, n) = poll_once(&mut s, Ok(vec![ag("a", Group::NeedsYou)]));
        assert!(n.is_empty());
    }

    #[test]
    fn notification_body_uses_label_or_folder() {
        let mut a = ag("a", Group::NeedsYou);
        assert_eq!(notification_body(&a), "proj — waiting for you");
        a.waiting_for = Some("permission prompt".into());
        a.project = Some(ProjectLabel {
            org_id: "o".into(), org_name: "Org".into(), client_name: "Client".into(),
            project_id: 1, project_name: "Project".into(), folder: "/x/proj".into(),
        });
        assert_eq!(notification_body(&a), "Org › Client › Project — permission prompt");
    }
}
