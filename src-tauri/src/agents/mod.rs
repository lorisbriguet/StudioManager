#![allow(dead_code)]

pub mod actions;
pub mod cli;
pub mod model;
pub mod projects;
pub mod validate;

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::Manager;

/// Managed state of the Agents feature. Later tasks add fields.
pub struct AgentsState {
    pub app_dir: PathBuf,
    login_env: Mutex<Option<Arc<cli::LoginEnv>>>,
}

impl AgentsState {
    pub fn new(app_dir: PathBuf) -> Self {
        Self { app_dir, login_env: Mutex::new(None) }
    }

    /// The login-shell environment, resolved on first use and cached.
    pub fn login_env(&self) -> Arc<cli::LoginEnv> {
        let mut guard = self.login_env.lock().unwrap_or_else(|e| e.into_inner());
        guard
            .get_or_insert_with(|| Arc::new(cli::resolve_login_env()))
            .clone()
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
}
