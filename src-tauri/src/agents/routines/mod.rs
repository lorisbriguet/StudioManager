//! Routines for the Day tab: agent prompts and commands the user set up, run by id. The
//! webview only ever names a routine by its id; what runs comes from `routines.json`.

pub mod run;
pub mod schedule;
pub mod store;

use super::actions::{home_dir, ready, switched_on};
use super::cli::{real_cli, Cli};
use super::projects::read_trusted;
use super::pty::{blocking, cached_login_env, LoginCache};
use std::path::PathBuf;
use store::{RoutineKind, Routines, Run};
use tauri::{AppHandle, Emitter};

/// Emitted when the routines or a run change; the payload is empty.
pub const CHANGED_EVENT: &str = "routines:changed";

fn changed(app: &AppHandle) {
    let _ = app.emit(CHANGED_EVENT, ());
}

/// Runs the saved routine `id`, at most one run per routine at a time. Call it on a blocking
/// thread: an agent routine waits for the CLI and returns the finished run; a command routine
/// returns at once with a running run and finishes on its own thread. Each step is recorded
/// in `routine-runs.json` and announced with `routines:changed`.
pub fn launch(
    app: &AppHandle,
    app_dir: PathBuf,
    login: LoginCache,
    id: &str,
    scheduled_for: Option<String>,
) -> Result<Run, String> {
    let all = store::read_routines(&app_dir);
    let routine = store::find(&all, id)?;
    let title = routine.title.clone();
    let is_agent = matches!(routine.kind, RoutineKind::Agent { .. });
    let claim = run::claim(id)?;
    let started = run::begin(id, scheduled_for);
    if let Err(e) = store::validate(routine) {
        // E.g. the program was deleted since: the Day tab shows it and a scheduled run notifies.
        let done = run::failed(started, e);
        schedule::record_final(&app_dir, &title, &done, &|m| schedule::notify(app, &m));
        drop(claim);
        changed(app);
        return Ok(done);
    }
    store::record_run(&app_dir, &started)?;
    changed(app);
    let app = app.clone();
    let id = id.to_string();
    let running = started.clone();
    let work = move || {
        let env = cached_login_env(&login);
        let (cli, trusted) = if is_agent {
            (real_cli(&login), read_trusted(&home_dir()))
        } else {
            (None, vec![])
        };
        let deps = run::Deps {
            cli: cli.as_ref().map(|c| c as &dyn Cli),
            trusted: &trusted,
            path_env: &env.path,
            timeout: run::TIMEOUT,
        };
        let done = run::run_routine(&deps, &all, &id, started.clone()).unwrap_or_else(|e| Run {
            status: store::Status::Failed,
            message: Some(e),
            finished_at: Some(run::now_ms()),
            ..started
        });
        schedule::record_final(&app_dir, &title, &done, &|m| schedule::notify(&app, &m));
        drop(claim);
        changed(&app);
        done
    };
    if is_agent {
        Ok(work())
    } else {
        std::thread::spawn(work);
        Ok(running)
    }
}

#[tauri::command]
pub async fn routines_get(state: tauri::State<'_, super::AgentsState>) -> Result<Routines, String> {
    switched_on(&state)?;
    let dir = state.app_dir.clone();
    blocking(move || Ok(store::read_routines(&dir))).await
}

/// Validates and saves all routines (new ones get an id) and drops the runs of deleted ones.
#[tauri::command]
pub async fn routines_save(
    app: AppHandle,
    state: tauri::State<'_, super::AgentsState>,
    routines: Routines,
) -> Result<Routines, String> {
    switched_on(&state)?;
    let dir = state.app_dir.clone();
    let saved = blocking(move || {
        let _held = store::SAVE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let saved = store::save_routines(&dir, routines)?;
        let _ = store::update_runs(&dir, |runs| {
            runs.retain(|r| saved.routines.iter().any(|x| x.id == r.routine_id))
        });
        Ok(saved)
    })
    .await?;
    changed(&app);
    Ok(saved)
}

#[tauri::command]
pub async fn routines_run(
    app: AppHandle,
    state: tauri::State<'_, super::AgentsState>,
    id: String,
) -> Result<Run, String> {
    let login = ready(&state)?;
    let dir = state.app_dir.clone();
    blocking(move || launch(&app, dir, login, &id, None)).await
}

/// The last run of each saved routine.
#[tauri::command]
pub async fn routines_runs(state: tauri::State<'_, super::AgentsState>) -> Result<Vec<Run>, String> {
    switched_on(&state)?;
    let dir = state.app_dir.clone();
    blocking(move || {
        let all = store::read_routines(&dir);
        let runs = store::read_runs(&dir)
            .into_iter()
            .filter(|r| all.routines.iter().any(|x| x.id == r.routine_id))
            .collect();
        Ok(run::settle(runs, &run::is_running))
    })
    .await
}
