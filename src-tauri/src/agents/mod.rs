pub mod actions;
pub mod briefing;
pub mod brief;
pub mod capture;
pub mod cli;
pub mod links;
pub mod login;
pub mod model;
pub mod poller;
pub mod projects;
pub mod reminders;
pub mod prompt;
pub mod pty;
pub mod routines;
pub mod statusline;
pub mod transcript;
pub mod uploads;
pub mod usage;
pub mod validate;
pub mod watcher;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::Manager;

/// Managed state of the Agents feature. Later tasks add fields.
pub struct AgentsState {
    pub app_dir: PathBuf,
    login_env: pty::LoginCache,
    /// Open terminals; the hub's spawner shares the login environment above.
    pub hub: pty::TerminalHub,
    /// The last list the poller emitted (labelled, quiet applied).
    pub last: Mutex<Vec<model::Agent>>,
    /// Epoch ms of the poller's last SUCCESSFUL agent list; 0 before the first (or while Agents
    /// is off). The brief scheduler trusts "not listed" only after a list newer than its start.
    listed_at: std::sync::atomic::AtomicI64,
    /// The transcript scan behind the Usage tab, and its last result (60 s cache).
    pub activity: Arc<Mutex<usage::activity::ActivityCache>>,
    /// The last `claude auth status` (see login.rs); None before the first check.
    pub login: Mutex<Option<login::LoginStatus>>,
}

impl AgentsState {
    pub fn new(app_dir: PathBuf) -> Self {
        let login_env = pty::LoginCache::default();
        let hub = pty::TerminalHub::new(
            Arc::new(pty::RealSpawner::new(login_env.clone())),
            Arc::new(pty::SystemClock),
        );
        Self { app_dir, login_env, hub, last: Mutex::new(Vec::new()), listed_at: Default::default(), activity: Default::default(), login: Mutex::new(None) }
    }

    /// The cached login-shell environment, for use on a blocking thread: resolving it runs a
    /// login shell (up to 10 s).
    pub fn login_cache(&self) -> pty::LoginCache {
        self.login_env.clone()
    }

    /// A copy of the poller's last list (empty before the first pass).
    pub fn cached(&self) -> Vec<model::Agent> {
        self.last.lock().map(|c| c.clone()).unwrap_or_default()
    }

    /// When the poller last listed the agents successfully.
    pub fn listed_at(&self) -> Option<i64> {
        Some(self.listed_at.load(std::sync::atomic::Ordering::Relaxed)).filter(|t| *t > 0)
    }

    pub fn set_listed_at(&self, ms: i64) {
        self.listed_at.store(ms, std::sync::atomic::Ordering::Relaxed);
    }

    /// A runner for the `claude` CLI, or None when it cannot be found. May run the login-shell
    /// lookup: call it off the async runtime.
    pub fn real_cli(&self) -> Option<cli::RealCli> {
        cli::real_cli(&self.login_env)
    }
}

/// Create and manage the state; called from `setup`.
pub fn init(handle: &tauri::AppHandle) {
    let app_dir = crate::app_data_dir(handle).unwrap_or_default();
    handle.manage(AgentsState::new(app_dir));
    poller::start(handle);
    routines::schedule::start(handle);
    briefing::start(handle);
    links::start(handle);
    reminders::start(handle);
    // The morning brief's comments (see brief.rs); started by the Agents switch otherwise.
    if cli::read_settings(&handle.state::<AgentsState>().app_dir).enabled {
        brief::start(handle);
    }
    // Old attached images; best effort, off the startup path.
    let dir = handle.state::<AgentsState>().app_dir.clone();
    std::thread::spawn(move || uploads::clean_old(&dir, std::time::SystemTime::now()));
}
