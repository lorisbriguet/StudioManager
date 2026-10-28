pub mod actions;
pub mod cli;
pub mod model;
pub mod poller;
pub mod projects;
pub mod prompt;
pub mod pty;
pub mod statusline;
pub mod transcript;
pub mod uploads;
pub mod usage;
pub mod validate;

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
    /// The transcript scan behind the Usage tab, and its last result (60 s cache).
    pub activity: Arc<Mutex<usage::activity::ActivityCache>>,
}

impl AgentsState {
    pub fn new(app_dir: PathBuf) -> Self {
        let login_env = pty::LoginCache::default();
        let hub = pty::TerminalHub::new(
            Arc::new(pty::RealSpawner::new(login_env.clone())),
            Arc::new(pty::SystemClock),
        );
        Self { app_dir, login_env, hub, last: Mutex::new(Vec::new()), activity: Default::default() }
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
    // Old attached images; best effort, off the startup path.
    let dir = handle.state::<AgentsState>().app_dir.clone();
    std::thread::spawn(move || uploads::clean_old(&dir, std::time::SystemTime::now()));
}
