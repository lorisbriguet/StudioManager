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

/// The saved target of a routine's result link or of a section's `index`-th link. The webview
/// only names an id (and an index); what opens comes from `routines.json`.
fn stored_target(all: &Routines, id: &str, index: Option<usize>) -> Result<String, String> {
    match index {
        None => store::find(all, id)?
            .result_link
            .clone()
            .ok_or_else(|| "This routine has no result link".to_string()),
        Some(i) => all
            .sections
            .iter()
            .find(|s| s.id == id)
            .and_then(|s| s.links.get(i))
            .map(|l| l.target.clone())
            .ok_or_else(|| "No such link".to_string()),
    }
}

/// The folder a routine works in: an agent's folder or a command's cwd.
fn stored_folder(all: &Routines, id: &str) -> Result<String, String> {
    Ok(match &store::find(all, id)?.kind {
        RoutineKind::Agent { folder, .. } => folder.clone(),
        RoutineKind::Command { cwd, .. } => cwd.clone(),
    })
}

/// Opens an http(s) URL in the browser or an existing absolute path in its default app
/// (a folder in Finder), through the system `open`; `--` keeps a target from reading as a flag.
fn open_target(target: &str) -> Result<(), String> {
    // A hand-edited routines.json must not open file: or custom schemes.
    if !store::link_target(target) {
        return Err("Only an absolute path or an http(s) URL can be opened".into());
    }
    let is_url = target.starts_with("http://") || target.starts_with("https://");
    if !is_url && !std::path::Path::new(target).exists() {
        return Err(format!("Not found: {target}"));
    }
    let out = std::process::Command::new("open").arg("--").arg(target).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Opens the result link of the saved routine `id`.
#[tauri::command]
pub async fn routines_open_result(state: tauri::State<'_, super::AgentsState>, id: String) -> Result<(), String> {
    switched_on(&state)?;
    let dir = state.app_dir.clone();
    blocking(move || open_target(&stored_target(&store::read_routines(&dir), &id, None)?)).await
}

/// Opens the working folder of the saved routine `id` in Finder.
#[tauri::command]
pub async fn routines_open_folder(state: tauri::State<'_, super::AgentsState>, id: String) -> Result<(), String> {
    switched_on(&state)?;
    let dir = state.app_dir.clone();
    blocking(move || open_target(&stored_folder(&store::read_routines(&dir), &id)?)).await
}

/// Opens the `index`-th link of the saved section `section_id`.
#[tauri::command]
pub async fn routines_open_link(
    state: tauri::State<'_, super::AgentsState>,
    section_id: String,
    index: usize,
) -> Result<(), String> {
    switched_on(&state)?;
    let dir = state.app_dir.clone();
    blocking(move || open_target(&stored_target(&store::read_routines(&dir), &section_id, Some(index))?)).await
}

#[cfg(test)]
mod open_tests {
    use super::*;
    use store::{Link, Routine, RoutineKind, Section};

    #[test]
    fn stored_target_comes_from_the_saved_routines() {
        let all = Routines {
            sections: vec![Section {
                id: "s1".into(),
                name: "Personal".into(),
                links: vec![Link { label: "Docs".into(), target: "https://example.com".into() }],
            }],
            routines: vec![Routine {
                id: "r1".into(),
                section_id: "s1".into(),
                title: "Hours".into(),
                idle_hint: String::new(),
                kind: RoutineKind::Command { program: "/bin/echo".into(), args: vec![], cwd: "/tmp".into() },
                result_link: Some("/tmp/out.md".into()),
                schedule: None,
            }],
        };
        assert_eq!(stored_target(&all, "r1", None).unwrap(), "/tmp/out.md");
        assert_eq!(stored_target(&all, "s1", Some(0)).unwrap(), "https://example.com");
        assert_eq!(stored_folder(&all, "r1").unwrap(), "/tmp");
        assert!(stored_folder(&all, "nope").is_err());
        assert!(stored_target(&all, "s1", Some(1)).is_err());
        assert!(stored_target(&all, "nope", None).is_err());
        assert!(stored_target(&all, "nope", Some(0)).is_err());
    }

    #[test]
    fn open_refuses_a_missing_path() {
        assert!(open_target("/definitely/not/here-12345").is_err());
    }

    #[test]
    fn open_refuses_other_schemes_and_relative_paths() {
        for t in ["file:///etc/hosts", "javascript:alert(1)", "x-custom://a", "relative/path", "https://a.example/\nb"] {
            assert!(open_target(t).unwrap_err().contains("Only an absolute path"), "{t}");
        }
    }
}
