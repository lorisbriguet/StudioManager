//! The live agent list: polls `claude agents`, labels and quiets the result,
//! emits `agents:changed` and raises a Mac notification when an agent starts
//! waiting for you.

use super::actions::{fetch_agents, home_dir, read_state, retain_dismissed, CopyOf};
use super::cli::read_settings;
use super::model::{apply_quiet, Agent, Group};
use super::projects::{load_index, FolderIndex};
use super::transcript::{last_change_ms, last_model, locate, model_alias, model_label};
use std::collections::{HashMap, HashSet};
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

/// Whether any agent is waiting for you (the menu bar icon turns amber).
pub fn needs_attention(agents: &[Agent]) -> bool {
    agents.iter().any(|a| a.group == Group::NeedsYou)
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

/// Drops the dismissals of agents no longer waiting (so a dismissal covers only the wait it was
/// made in), then moves dismissed and stale needs-you agents to idle.
pub fn quiet_pass(
    agents: &mut [Agent],
    app_dir: &std::path::Path,
    now_ms: i64,
    last_change_ms: &dyn Fn(&Agent) -> Option<i64>,
) {
    let waiting = |id: &str| agents.iter().any(|a| a.session_id == id && a.group == Group::NeedsYou);
    let dismissed: HashSet<String> = retain_dismissed(app_dir, waiting).into_iter().collect();
    apply_quiet(agents, now_ms, last_change_ms, &dismissed);
}

/// The full model id last read from each agent's transcript, keyed by session id, with the
/// transcript's modification time it was read at.
pub type ModelCache = HashMap<String, (i64, Option<String>)>;

/// Fills in `model` for agents the CLI didn't report one for, from their transcript's newest
/// reply. A transcript is only read again when its modification time changed.
pub fn fill_models(
    agents: &mut [Agent],
    cache: &mut ModelCache,
    mtime_of: &dyn Fn(&Agent) -> Option<i64>,
    read_model: &dyn Fn(&Agent) -> Option<String>,
) {
    for a in agents.iter_mut().filter(|a| a.model.is_none()) {
        let Some(mtime) = mtime_of(a) else { continue };
        let fresh = matches!(cache.get(&a.session_id), Some((t, _)) if *t == mtime);
        if !fresh {
            cache.insert(a.session_id.clone(), (mtime, read_model(a)));
        }
        if let Some(id) = cache.get(&a.session_id).and_then(|(_, m)| m.clone()) {
            a.model = Some(model_alias(&id));
            a.model_label = model_label(&id);
        }
    }
    // Forget agents that are gone.
    cache.retain(|id, _| agents.iter().any(|a| &a.session_id == id));
}

/// A model-switch copy that hasn't had its first message has no transcript, and the CLI
/// reports it as blocked. It is ready, not waiting on a decision: show it as idle (no
/// notification) with the model it was started on.
pub fn settle_copies(
    agents: &mut [Agent],
    copies: &std::collections::BTreeMap<String, CopyOf>,
    has_transcript: &dyn Fn(&Agent) -> bool,
) {
    for a in agents.iter_mut() {
        let Some(copy) = a.short_id.as_ref().and_then(|s| copies.get(s)) else { continue };
        if has_transcript(a) {
            continue;
        }
        if a.model.is_none() {
            a.model = Some(copy.model.clone());
        }
        if a.group == Group::NeedsYou && a.status != "waiting" {
            a.group = Group::Idle;
        }
    }
}

fn label_and_quiet(
    agents: &mut [Agent],
    index: &FolderIndex,
    app_dir: &std::path::Path,
    models: &mut ModelCache,
) {
    for a in agents.iter_mut() {
        a.project = index.label_for(&a.cwd);
    }
    let claude_dir = home_dir().join(".claude");
    let mtime = |a: &Agent| locate(&claude_dir, &a.session_id).and_then(|p| last_change_ms(&p));
    let read = |a: &Agent| locate(&claude_dir, &a.session_id).and_then(|p| last_model(&p));
    fill_models(agents, models, &mtime, &read);
    let copies = read_state(app_dir).copies;
    settle_copies(agents, &copies, &|a| locate(&claude_dir, &a.session_id).is_some());
    let last = |a: &Agent| locate(&claude_dir, &a.session_id).and_then(|p| last_change_ms(&p));
    quiet_pass(agents, app_dir, now_ms(), &last);
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
    let mut models = ModelCache::new();
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
                crate::menubar::set_attention(&app, false);
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
            label_and_quiet(&mut v, &index, &state.app_dir, &mut models);
            v
        });
        let (emit, notify) = poll_once(&mut poll, result);
        if let Ok(mut c) = state.last.lock() {
            *c = emit.clone();
        }
        // No lock is held from here on.
        let _ = app.emit(CHANGED_EVENT, &emit);
        crate::menubar::set_attention(&app, needs_attention(&emit));
        for a in &notify {
            // Logged so a missing banner can be told apart from one never sent
            // (macOS may drop notifications from an unbundled dev build).
            log::info!("[agents] notifying: {} — {}", a.name, notification_body(a));
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
            started_at: 0, group: g, quiet: None, project: None, model: None, model_label: None,
        }
    }

    #[test]
    fn a_fresh_copy_is_idle_with_its_model_until_its_first_message() {
        let mut copies = std::collections::BTreeMap::new();
        copies.insert("2ae20df5".to_string(), CopyOf { session_id: "old".into(), model: "sonnet".into() });
        let fresh = || Agent {
            short_id: Some("2ae20df5".into()),
            status: "idle".into(),
            state: Some("blocked".into()),
            ..ag("2ae20df5-x", Group::NeedsYou)
        };
        let mut v = vec![fresh()];
        settle_copies(&mut v, &copies, &|_| false);
        assert_eq!((v[0].group, v[0].model.as_deref()), (Group::Idle, Some("sonnet")));
        // Once it has a transcript, the CLI's view stands.
        let mut v = vec![fresh()];
        settle_copies(&mut v, &copies, &|_| true);
        assert_eq!((v[0].group, v[0].model.as_deref()), (Group::NeedsYou, None));
        // A copy showing a real prompt still needs you.
        let mut v = vec![Agent { status: "waiting".into(), ..fresh() }];
        settle_copies(&mut v, &copies, &|_| false);
        assert_eq!(v[0].group, Group::NeedsYou);
    }

    #[test]
    fn fill_models_reads_once_per_transcript_change() {
        use std::cell::{Cell, RefCell};
        let reads = Cell::new(0);
        let mtime = Cell::new(100);
        let model = RefCell::new("claude-opus-5-5".to_string());
        let mtime_of = |_: &Agent| Some(mtime.get());
        let read = |_: &Agent| {
            reads.set(reads.get() + 1);
            Some(model.borrow().clone())
        };
        let mut cache = ModelCache::new();

        let mut v = vec![ag("a", Group::Working)];
        fill_models(&mut v, &mut cache, &mtime_of, &read);
        assert_eq!(v[0].model.as_deref(), Some("opus"));
        assert_eq!(v[0].model_label.as_deref(), Some("Opus 5.5"));

        // Same transcript: no new read, model kept.
        let mut v = vec![ag("a", Group::Working)];
        fill_models(&mut v, &mut cache, &mtime_of, &read);
        assert_eq!((reads.get(), v[0].model.as_deref()), (1, Some("opus")));

        // Transcript changed (model switched): read again.
        mtime.set(200);
        *model.borrow_mut() = "claude-sonnet-5-5".into();
        let mut v = vec![ag("a", Group::Working)];
        fill_models(&mut v, &mut cache, &mtime_of, &read);
        assert_eq!((reads.get(), v[0].model.as_deref()), (2, Some("sonnet")));

        // A model the CLI reports wins and costs no read; gone agents leave the cache.
        let mut v = vec![Agent { model: Some("haiku".into()), ..ag("b", Group::Idle) }];
        fill_models(&mut v, &mut cache, &mtime_of, &read);
        assert_eq!((reads.get(), v[0].model.as_deref()), (2, Some("haiku")));
        assert!(cache.is_empty());
    }

    #[test]
    fn attention_follows_needs_you() {
        assert!(!needs_attention(&[]));
        assert!(!needs_attention(&[ag("a", Group::Working), ag("b", Group::Idle), ag("c", Group::Done)]));
        assert!(needs_attention(&[ag("a", Group::Working), ag("b", Group::NeedsYou)]));
        // A dismissed or stale prompt has already been moved to idle: no attention.
        let mut quiet = ag("a", Group::Idle);
        quiet.quiet = Some(Quiet::Dismissed);
        assert!(!needs_attention(&[quiet]));
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
    fn dismissal_covers_only_the_current_wait() {
        use crate::agents::actions::{dismiss, read_state};
        let dir = std::env::temp_dir().join(format!("sm-poller-dismiss-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let sid = "00000000-1111-2222-3333-444444444444";
        let no_change = |_: &Agent| None;
        let mut s = PollState::default();
        let mut pass = |group: Group| {
            let mut v = vec![ag(sid, group)];
            quiet_pass(&mut v, &dir, 0, &no_change);
            let (emit, notify) = poll_once(&mut s, Ok(v));
            (emit[0].group, emit[0].quiet, notify.len())
        };
        assert_eq!(pass(Group::Working), (Group::Working, None, 0));
        assert_eq!(pass(Group::NeedsYou), (Group::NeedsYou, None, 1));
        dismiss(&dir, sid).unwrap();
        // While the agent still waits on the prompt that was dismissed, it stays quiet.
        assert_eq!(pass(Group::NeedsYou), (Group::Idle, Some(Quiet::Dismissed), 0));
        assert_eq!(pass(Group::NeedsYou), (Group::Idle, Some(Quiet::Dismissed), 0));
        assert_eq!(read_state(&dir).dismissed, vec![sid.to_string()]);
        // It moves on: the dismissal is dropped...
        assert_eq!(pass(Group::Working), (Group::Working, None, 0));
        assert!(read_state(&dir).dismissed.is_empty());
        // ...so its next wait shows under Needs you and notifies again.
        assert_eq!(pass(Group::NeedsYou), (Group::NeedsYou, None, 1));
    }

    #[test]
    fn dismissal_of_a_gone_agent_is_dropped() {
        use crate::agents::actions::{dismiss, read_state};
        let dir = std::env::temp_dir().join(format!("sm-poller-gone-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dismiss(&dir, "00000000-1111-2222-3333-444444444444").unwrap();
        let mut v = vec![ag("other", Group::NeedsYou)];
        quiet_pass(&mut v, &dir, 0, &|_| None);
        assert!(read_state(&dir).dismissed.is_empty());
        assert_eq!(v[0].group, Group::NeedsYou);
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
