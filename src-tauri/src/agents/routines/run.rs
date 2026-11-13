//! Running a routine: an agent routine starts a background agent, a command routine runs the
//! program the user chose (argv only, never a shell) with a timeout and a capped output.

use super::store::{find, task_text, validate, Routine, RoutineKind, Routines, Run, Status};
use crate::agents::actions;
use crate::agents::cli::Cli;
use std::collections::HashSet;
use std::io::Read;
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

/// A command still running after this is killed and the run fails.
pub const TIMEOUT: Duration = Duration::from_secs(10 * 60);
/// Only the end of a command's output is kept.
pub const TAIL_BYTES: usize = 64 * 1024;

/// What a run needs from outside.
pub struct Deps<'a> {
    /// The `claude` runner; None when it cannot be found.
    pub cli: Option<&'a dyn Cli>,
    pub trusted: &'a [String],
    /// `PATH` from the login shell.
    pub path_env: &'a str,
    pub timeout: Duration,
}

/// How a command ended.
#[derive(Debug, Clone, PartialEq)]
pub struct CommandOutcome {
    /// Exit code; None when killed by a signal or the timeout, or never started.
    pub code: Option<i32>,
    pub timed_out: bool,
    /// The last `TAIL_BYTES` of stdout and stderr, interleaved.
    pub tail: String,
    /// Why the program could not be started.
    pub error: Option<String>,
}

/// After the program exits, how long its output may still take to arrive (a background child
/// may hold the pipes open).
const READER_GRACE: Duration = Duration::from_secs(1);
/// The longest status message kept from a line of output.
const MESSAGE_CHARS: usize = 300;

/// Runs `program` with `args` in `cwd` (no shell), with `PATH` (the login shell's), `HOME`,
/// `LANG`, and `USER` and `TMPDIR` when the app has them; nothing else from the environment.
/// After `timeout` the program and everything it started are killed.
pub fn run_command(
    program: &str,
    args: &[String],
    cwd: &str,
    path_env: &str,
    timeout: Duration,
) -> CommandOutcome {
    let failed = |e: String| CommandOutcome {
        code: None,
        timed_out: false,
        tail: String::new(),
        error: Some(e),
    };
    if !Path::new(cwd).is_dir() {
        return failed(format!("Folder not found: {cwd}"));
    }
    let var = |k: &str, default: &str| std::env::var(k).unwrap_or_else(|_| default.into());
    let mut cmd = Command::new(program);
    cmd.args(args)
        .current_dir(cwd)
        .env_clear()
        .env("PATH", path_env)
        .env("HOME", var("HOME", ""))
        .env("LANG", var("LANG", "en_US.UTF-8"));
    for k in ["USER", "TMPDIR"] {
        if let Ok(v) = std::env::var(k) {
            cmd.env(k, v);
        }
    }
    let mut child = match cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Its own process group, so the timeout also stops what it started.
        .process_group(0)
        .spawn()
    {
        Ok(c) => c,
        Err(e) => return failed(format!("Failed to start {program}: {e}")),
    };
    let tail = Arc::new(Mutex::new(Vec::new()));
    let (done_tx, done_rx) = mpsc::channel();
    if let Some(out) = child.stdout.take() {
        read_into(out, tail.clone(), done_tx.clone());
    }
    if let Some(err) = child.stderr.take() {
        read_into(err, tail.clone(), done_tx);
    }
    let group = child.id() as libc::pid_t;
    track_group(group);
    let started = Instant::now();
    let mut timed_out = false;
    let code = loop {
        match try_wait_tracked(&mut child, group) {
            Ok(Some(status)) => break status.code(),
            Ok(None) if started.elapsed() >= timeout => {
                timed_out = true;
                untrack_group(group);
                kill_group(&mut child);
                break None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(_) => {
                untrack_group(group);
                kill_group(&mut child);
                break None;
            }
        }
    };
    let deadline = Instant::now() + READER_GRACE;
    for _ in 0..2 {
        let _ = done_rx.recv_timeout(deadline.saturating_duration_since(Instant::now()));
    }
    let bytes = tail.lock().unwrap_or_else(|e| e.into_inner()).clone();
    // The cut may fall inside a character: start at the next one.
    let start = bytes.iter().position(|b| b & 0xC0 != 0x80).unwrap_or(bytes.len());
    CommandOutcome {
        code,
        timed_out,
        tail: String::from_utf8_lossy(&bytes[start..]).into_owned(),
        error: None,
    }
}

/// Kills the child and everything in its process group (set when it was started).
pub(crate) fn kill_group(child: &mut std::process::Child) {
    // SAFETY: kill(2) on the child's process group (its pid, as set above).
    unsafe { libc::kill(-(child.id() as libc::pid_t), libc::SIGKILL) };
    let _ = child.kill();
    let _ = child.wait();
}

/// Process groups of the commands running now, so quitting the app can stop them.
static GROUPS: Mutex<Option<HashSet<libc::pid_t>>> = Mutex::new(None);

pub(crate) fn track_group(group: libc::pid_t) {
    GROUPS.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(HashSet::new).insert(group);
}

pub(crate) fn untrack_group(group: libc::pid_t) {
    if let Some(set) = GROUPS.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        set.remove(&group);
    }
}

/// `try_wait` under the groups lock: once the child is reaped its pid can be reused, so it
/// leaves the set before `stop_all` could signal a stranger's group.
pub(crate) fn try_wait_tracked(
    child: &mut std::process::Child,
    group: libc::pid_t,
) -> std::io::Result<Option<std::process::ExitStatus>> {
    let mut held = GROUPS.lock().unwrap_or_else(|e| e.into_inner());
    let res = child.try_wait();
    if !matches!(res, Ok(None)) {
        if let Some(set) = held.as_mut() {
            set.remove(&group);
        }
    }
    res
}

/// Whether a command with this process group is running now.
#[cfg(test)]
pub(crate) fn is_tracked(group: libc::pid_t) -> bool {
    GROUPS.lock().unwrap_or_else(|e| e.into_inner()).as_ref().is_some_and(|s| s.contains(&group))
}

/// Kills every running command and what it started. Called when the app quits: a command
/// must not outlive StudioManager with nobody to record how it ended (the Day tab then shows
/// it as interrupted). Returns how many were stopped.
pub fn stop_all() -> usize {
    stop_where(|_| true)
}

pub(crate) fn stop_where(pick: impl Fn(libc::pid_t) -> bool) -> usize {
    let held = GROUPS.lock().unwrap_or_else(|e| e.into_inner());
    let groups: Vec<libc::pid_t> = held.iter().flatten().copied().filter(|g| pick(*g)).collect();
    for g in &groups {
        // SAFETY: kill(2) on a process group of a child that is not reaped yet (the lock is
        // held, and a reaped child leaves the set under it).
        unsafe { libc::kill(-g, libc::SIGKILL) };
    }
    groups.len()
}

/// Reads a pipe on a thread into the shared tail, keeping its last `TAIL_BYTES`.
fn read_into<R: Read + Send + 'static>(
    mut r: R,
    tail: Arc<Mutex<Vec<u8>>>,
    done: mpsc::Sender<()>,
) {
    std::thread::spawn(move || {
        let mut chunk = [0u8; 8192];
        while let Ok(n) = r.read(&mut chunk) {
            if n == 0 {
                break;
            }
            let mut buf = tail.lock().unwrap_or_else(|e| e.into_inner());
            buf.extend_from_slice(&chunk[..n]);
            if buf.len() > TAIL_BYTES {
                let cut = buf.len() - TAIL_BYTES;
                buf.drain(..cut);
            }
        }
        let _ = done.send(());
    });
}

/// How a command run ended, as recorded.
#[derive(Debug, Clone, PartialEq)]
pub struct CommandResult {
    pub status: Status,
    /// Why it failed, in the app's words ("Exited with code 3"): written to the runs file.
    pub message: Option<String>,
    /// The last non-empty output line: shown in the panel, never written or notified.
    pub output: Option<String>,
}

impl CommandResult {
    /// What the panel shows: the output line, else the message.
    #[cfg(test)]
    pub fn shown(&self) -> Option<&str> {
        self.output.as_deref().or(self.message.as_deref())
    }
}

/// Done on exit code 0, failed otherwise; `output` is the last non-empty output line.
pub fn command_result(o: &CommandOutcome) -> CommandResult {
    let failed = |m: String| CommandResult { status: Status::Failed, message: Some(m), output: None };
    if let Some(e) = &o.error {
        return failed(e.clone());
    }
    if o.timed_out {
        return failed("Timed out".into());
    }
    let output = o
        .tail
        .lines()
        .map(str::trim)
        .rfind(|l| !l.is_empty())
        .map(|l| l.chars().take(MESSAGE_CHARS).collect::<String>());
    let (status, message) = match o.code {
        Some(0) => (Status::Done, None),
        Some(code) => (Status::Failed, Some(format!("Exited with code {code}"))),
        None => (Status::Failed, Some("Stopped by a signal".into())),
    };
    CommandResult { status, message, output }
}

pub fn now_ms() -> i64 {
    crate::agents::usage::limits::now_ms()
}

/// A run that has just started.
pub fn begin(routine_id: &str, scheduled_for: Option<String>) -> Run {
    Run {
        routine_id: routine_id.to_string(),
        started_at: now_ms(),
        finished_at: None,
        status: Status::Running,
        message: None,
        agent_short_id: None,
        scheduled_for,
        last_scheduled_for: None,
        output: None,
    }
}

/// Runs `routine` to its end and returns `run` finished. Blocks: up to `deps.timeout` for a
/// command, one CLI call for an agent.
pub fn finish(deps: &Deps, routine: &Routine, mut run: Run) -> Run {
    match &routine.kind {
        RoutineKind::Agent { folder, model, name, prompt } => {
            let started = match deps.cli {
                Some(cli) => {
                    actions::start(cli, deps.trusted, folder, &task_text(prompt), model, name)
                }
                None => Err("claude not found".to_string()),
            };
            match started {
                Ok(short_id) => {
                    run.status = Status::Done;
                    run.agent_short_id = Some(short_id);
                }
                Err(e) => {
                    run.status = Status::Failed;
                    run.message = Some(e);
                }
            }
        }
        RoutineKind::Command { program, args, cwd } => {
            let outcome = run_command(program, args, cwd, deps.path_env, deps.timeout);
            let r = command_result(&outcome);
            (run.status, run.message, run.output) = (r.status, r.message, r.output);
        }
    }
    run.finished_at = Some(now_ms());
    run
}

/// `run` finished as failed with `message`.
pub fn failed(mut run: Run, message: String) -> Run {
    run.status = Status::Failed;
    run.message = Some(message);
    run.finished_at = Some(now_ms());
    run
}

/// Looks the routine up by id among the saved ones and runs it to its end, finishing `run`
/// (from `begin`).
pub fn run_routine(deps: &Deps, all: &Routines, id: &str, run: Run) -> Result<Run, String> {
    let routine = find(all, id)?;
    validate(routine)?;
    Ok(finish(deps, routine, run))
}

// ---------------------------------------------------------------- running set

/// Routines running in this process.
static RUNNING: Mutex<Option<HashSet<String>>> = Mutex::new(None);

pub fn is_running(id: &str) -> bool {
    RUNNING.lock().unwrap_or_else(|e| e.into_inner()).as_ref().is_some_and(|s| s.contains(id))
}

/// The error of a launch while the routine is still running.
pub const ALREADY_RUNNING: &str = "Already running";

/// Marks a routine as running until the guard drops; "Already running" if it is.
pub struct Claim(String);

pub fn claim(id: &str) -> Result<Claim, String> {
    let mut set = RUNNING.lock().unwrap_or_else(|e| e.into_inner());
    if !set.get_or_insert_with(HashSet::new).insert(id.to_string()) {
        return Err(ALREADY_RUNNING.into());
    }
    Ok(Claim(id.to_string()))
}

impl Drop for Claim {
    fn drop(&mut self) {
        if let Some(set) = RUNNING.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
            set.remove(&self.0);
        }
    }
}

/// A run still marked running that no longer runs (the app quit meanwhile) shows as failed.
pub fn settle(runs: Vec<Run>, running: &dyn Fn(&str) -> bool) -> Vec<Run> {
    runs.into_iter()
        .map(|mut r| {
            if r.status == Status::Running && !running(&r.routine_id) {
                r.status = Status::Failed;
                r.message = Some("Interrupted".into());
            }
            r
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::cli::CliOutput;
    use crate::agents::routines::store::{save_routines, Prompt, Section};
    use std::path::{Path, PathBuf};

    const PATH: &str = "/usr/bin:/bin";

    fn sh(script: &str, timeout: Duration) -> CommandOutcome {
        run_command("/bin/sh", &["-c".into(), script.into()], "/tmp", PATH, timeout)
    }

    #[test]
    fn command_status_is_last_line() {
        let o = sh("echo one; echo '  two  '; echo; echo '   '", TIMEOUT);
        assert_eq!(o.code, Some(0));
        let done = CommandResult { status: Status::Done, message: None, output: Some("two".into()) };
        assert_eq!(command_result(&o), done);
        // stderr counts as output too, and the environment is the one given.
        let o = sh("echo \"$PATH\" >&2", TIMEOUT);
        assert_eq!(command_result(&o).shown(), Some(PATH));
        // Arguments are passed as is, never through a shell.
        let o = run_command("/bin/echo", &["$HOME; ls".into()], "/tmp", PATH, TIMEOUT);
        assert_eq!(command_result(&o).shown(), Some("$HOME; ls"));
        // It runs in the folder given.
        let o = run_command("/bin/pwd", &[], "/usr", PATH, TIMEOUT);
        assert_eq!(command_result(&o).shown(), Some("/usr"));
    }

    #[test]
    fn command_environment_is_cleared_but_for_a_few() {
        let o = sh("echo \"[$SM_ROUTINE_SECRET][$USER][$TMPDIR]\"", TIMEOUT);
        let want = format!(
            "[][{}][{}]",
            std::env::var("USER").unwrap_or_default(),
            std::env::var("TMPDIR").unwrap_or_default()
        );
        // The test process's own variables (here a made-up one) are not passed on.
        assert!(std::env::var("SM_ROUTINE_SECRET").is_err());
        assert_eq!(command_result(&o).shown(), Some(want.as_str()));
    }

    #[test]
    fn command_failure_by_exit_code() {
        let o = sh("echo 'Missing end time'; exit 3", TIMEOUT);
        assert_eq!(o.code, Some(3));
        // The output line is shown; the recorded message is the app's own.
        let r = command_result(&o);
        assert_eq!(r.status, Status::Failed);
        assert_eq!(r.output.as_deref(), Some("Missing end time"));
        assert_eq!(r.message.as_deref(), Some("Exited with code 3"));
        assert_eq!(r.shown(), Some("Missing end time"));
        let o = sh("exit 2", TIMEOUT);
        let r = command_result(&o);
        assert_eq!((r.status, r.shown()), (Status::Failed, Some("Exited with code 2")));
        let o = run_command("/bin/echo", &[], "/no/such/folder", PATH, TIMEOUT);
        assert!(o.error.is_some());
        assert_eq!(command_result(&o).status, Status::Failed);
    }

    #[test]
    fn command_timeout_and_tail() {
        let started = std::time::Instant::now();
        let o = run_command("/bin/sleep", &["5".into()], "/tmp", PATH, Duration::from_millis(100));
        assert!(started.elapsed() < Duration::from_secs(3), "{:?}", started.elapsed());
        assert!(o.timed_out);
        let r = command_result(&o);
        assert_eq!(r.status, Status::Failed);
        assert!(r.message.unwrap().contains("Timed out"));

        // A child that keeps running in the background is killed with it: no wait for the
        // readers' grace period (1 s) on pipes it would hold open.
        let started = std::time::Instant::now();
        let o = sh("sleep 5 & echo started; wait", Duration::from_millis(300));
        assert!(o.timed_out);
        assert!(started.elapsed() < Duration::from_secs(1), "{:?}", started.elapsed());
        assert!(o.tail.contains("started"));

        // 200 KB of output: only the last 64 KB is kept, ending with the last line.
        let o = sh("i=0; while [ $i -lt 2000 ]; do printf '%0100d\\n' $i; i=$((i+1)); done; echo last", TIMEOUT);
        assert!(o.tail.len() <= TAIL_BYTES, "{}", o.tail.len());
        assert!(o.tail.len() > TAIL_BYTES - 200, "{}", o.tail.len());
        assert!(o.tail.ends_with("last\n"));
        assert_eq!(command_result(&o).shown(), Some("last"));
    }

    struct FakeCli {
        calls: Mutex<Vec<(Vec<String>, PathBuf)>>,
        reply: CliOutput,
    }

    impl Cli for FakeCli {
        fn run(&self, a: &[String], cwd: &Path) -> CliOutput {
            self.calls.lock().unwrap().push((a.to_vec(), cwd.to_path_buf()));
            self.reply.clone()
        }
    }

    fn fake(stdout: &str, code: i32) -> FakeCli {
        FakeCli {
            calls: Mutex::new(vec![]),
            reply: CliOutput { code, stdout: stdout.into(), stderr: String::new() },
        }
    }

    fn agent_routine(prompt: Prompt) -> Routine {
        Routine {
            id: "r1".into(),
            section_id: "s1".into(),
            title: "Brief".into(),
            idle_hint: String::new(),
            kind: RoutineKind::Agent {
                folder: "/work/proj".into(),
                model: "opus".into(),
                name: "brief".into(),
                prompt,
            },
            result_link: None,
            schedule: None,
        }
    }

    fn deps<'a>(cli: Option<&'a dyn Cli>, trusted: &'a [String]) -> Deps<'a> {
        Deps { cli, trusted, path_env: PATH, timeout: TIMEOUT }
    }

    #[test]
    fn agent_routine_uses_start() {
        let trusted = vec!["/work/proj".to_string()];
        let all = Routines {
            sections: vec![],
            routines: vec![agent_routine(Prompt::File("/work/proj/brief.md".into()))],
        };
        let cli = fake("backgrounded · 0a1b2c3d\n", 0);
        let run = run_routine(&deps(Some(&cli), &trusted), &all, "r1", begin("r1", None)).unwrap();
        assert_eq!(run.status, Status::Done);
        assert_eq!(run.agent_short_id.as_deref(), Some("0a1b2c3d"));
        assert!(run.finished_at.is_some());
        let calls = cli.calls.lock().unwrap().clone();
        assert_eq!(calls.len(), 1);
        assert_eq!(
            calls[0].0,
            ["--bg", "--model", "opus", "--name", "brief", "--", "Read and follow the instructions in /work/proj/brief.md."]
        );
        assert_eq!(calls[0].1, PathBuf::from("/work/proj"));

        // The CLI's error becomes the failed run's message.
        let cli = fake("Workspace not trusted: /work/proj\n", 1);
        let run = run_routine(&deps(Some(&cli), &trusted), &all, "r1", begin("r1", None)).unwrap();
        assert_eq!(run.status, Status::Failed);
        assert!(run.message.unwrap().contains("not trusted"));
        // A folder that is no longer trusted never reaches the CLI.
        let cli = fake("", 0);
        let run = run_routine(&deps(Some(&cli), &[]), &all, "r1", begin("r1", None)).unwrap();
        assert_eq!(run.status, Status::Failed);
        assert!(cli.calls.lock().unwrap().is_empty());
        // No claude: failed, not an error.
        let run = run_routine(&deps(None, &trusted), &all, "r1", begin("r1", None)).unwrap();
        assert_eq!(run.status, Status::Failed);
    }

    #[test]
    fn run_by_id_only() {
        let dir = std::env::temp_dir().join(format!("sm-routines-byid-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let section = Section { id: "s1".into(), name: "Day".into(), links: vec![] };
        let routine = Routine {
            id: String::new(),
            kind: RoutineKind::Command {
                program: "/bin/echo".into(),
                args: vec!["saved".into()],
                cwd: "/tmp".into(),
            },
            ..agent_routine(Prompt::Text("x".into()))
        };
        let saved =
            save_routines(&dir, Routines { sections: vec![section], routines: vec![routine] })
                .unwrap();
        let id = saved.routines[0].id.clone();
        let all = crate::agents::routines::store::read_routines(&dir);
        let cli = fake("", 0);
        let d = deps(Some(&cli), &[]);
        let run = run_routine(&d, &all, &id, begin(&id, None)).unwrap();
        assert_eq!((run.status, run.output.as_deref()), (Status::Done, Some("saved")));
        assert_eq!(run.message, None);
        assert_eq!(run.routine_id, id);
        assert_eq!(run_routine(&d, &all, "nope", begin("r", None)).unwrap_err(), "Unknown routine");
        assert_eq!(run_routine(&d, &all, "", begin("r", None)).unwrap_err(), "Unknown routine");

        // One run at a time per routine.
        let held = claim(&id).unwrap();
        assert!(is_running(&id));
        assert_eq!(claim(&id).err().as_deref(), Some(ALREADY_RUNNING));
        drop(held);
        assert!(!is_running(&id));
        assert!(claim(&id).is_ok());
    }

    #[test]
    fn quitting_stops_running_commands() {
        // The script prints its pid (= its process group) to a file, starts a grandchild and
        // waits; stopping must end both, long before the sleep would.
        let dir = std::env::temp_dir().join(format!("sm-quit-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let pid_file = dir.join("pid");
        let script = format!("echo $$ > '{}'; sleep 30 & wait", pid_file.display());
        let started = std::time::Instant::now();
        let runner = std::thread::spawn(move || sh(&script, TIMEOUT));

        let group = loop {
            if let Some(g) = std::fs::read_to_string(&pid_file).ok().and_then(|s| s.trim().parse().ok()) {
                if is_tracked(g) {
                    break g;
                }
            }
            assert!(started.elapsed() < Duration::from_secs(5), "command never started");
            std::thread::sleep(Duration::from_millis(10));
        };
        // Only this test's command: other tests run commands at the same time.
        assert_eq!(stop_where(|g| g == group), 1);
        let o = runner.join().unwrap();
        assert!(started.elapsed() < Duration::from_secs(5), "{:?}", started.elapsed());
        assert_eq!(o.code, None);
        assert!(!o.timed_out);
        assert_eq!(command_result(&o).message.as_deref(), Some("Stopped by a signal"));
        assert!(!is_tracked(group));
        // The killed grandchild is orphaned and reaped by launchd/init a moment later; until
        // then it still counts as a group member, so wait (bounded) for the group to go.
        // SAFETY: signal 0 only checks whether the group still exists.
        let gone_by = std::time::Instant::now() + Duration::from_secs(2);
        while unsafe { libc::kill(-group, 0) } == 0 {
            assert!(std::time::Instant::now() < gone_by, "the grandchild outlived the stop");
            std::thread::sleep(Duration::from_millis(10));
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn stale_running_runs_settle_as_failed() {
        let mut a = begin("a", None);
        let b = begin("b", None);
        a.status = Status::Running;
        let out = settle(vec![a, b], &|id| id == "b");
        assert_eq!(out[0].status, Status::Failed);
        assert_eq!(out[0].message.as_deref(), Some("Interrupted"));
        assert_eq!(out[1].status, Status::Running);
    }
}
