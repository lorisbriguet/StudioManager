//! Plan limits: what `studiomanager-mcp --statusline` captured, shown as meters with a pace
//! projection, and the alerts that follow from them.

pub mod activity;
pub mod limits;
pub mod samples;

use serde::Serialize;

/// The plan-limits view for the Usage tab.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageLimits {
    pub meters: Vec<limits::Meter>,
    /// A status line of StudioManager's is installed in Claude Code's settings.
    pub set_up: bool,
    /// When `limits.json` was last written, epoch ms.
    pub saved_at: Option<i64>,
}

#[tauri::command]
pub async fn agents_usage_limits(
    state: tauri::State<'_, super::AgentsState>,
) -> Result<UsageLimits, String> {
    super::actions::switched_on(&state)?;
    let app_dir = state.app_dir.clone();
    super::pty::blocking(move || {
        let set_up = super::statusline::is_set_up(&app_dir);
        Ok(match limits::load(&app_dir, limits::now_ms()) {
            Some((meters, saved_at)) => UsageLimits { meters, set_up, saved_at: Some(saved_at) },
            None => UsageLimits { meters: vec![], set_up, saved_at: None },
        })
    })
    .await
}
