pub mod actions;
pub mod cli;
pub mod model;
pub mod poller;
pub mod projects;
pub mod prompt;
pub mod pty;
pub mod transcript;
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
}

impl AgentsState {
    pub fn new(app_dir: PathBuf) -> Self {
        let login_env = pty::LoginCache::default();
        let hub = pty::TerminalHub::new(
            Arc::new(pty::RealSpawner::new(login_env.clone())),
            Arc::new(pty::SystemClock),
        );
        Self { app_dir, login_env, hub, last: Mutex::new(Vec::new()) }
    }

    /// The login-shell environment, resolved on first use and cached.
    pub fn login_env(&self) -> Arc<cli::LoginEnv> {
        pty::cached_login_env(&self.login_env)
    }

    /// A copy of the poller's last list (empty before the first pass).
    pub fn cached(&self) -> Vec<model::Agent> {
        self.last.lock().map(|c| c.clone()).unwrap_or_default()
    }

    /// A runner for the `claude` CLI, or None when it cannot be found.
    pub fn real_cli(&self) -> Option<cli::RealCli> {
        let env = self.login_env();
        let claude = env.claude.clone()?;
        Some(cli::RealCli { claude, path_env: env.path.clone() })
    }
}

/// Create and manage the state; called from `setup`.
pub fn init(handle: &tauri::AppHandle) {
    let app_dir = crate::app_data_dir(handle).unwrap_or_default();
    handle.manage(AgentsState::new(app_dir));
    poller::start(handle);
}
