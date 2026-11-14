//! Running a hub's connector: an external program started as argv (never a shell) with a cleared
//! environment, its own process group, a time limit and an output cap. What it answers is read
//! by `contract.rs`; nothing here keeps or logs it.

use super::contract::{clean_text, ERROR_CHARS};
use super::retry::ErrorKind;
use super::settings::Hub;
use crate::agents::routines::run::{track_group, untrack_group};
use std::io::{Read, Write};
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

/// A read request (`counts`, `open`, `events`, `questions`) must answer within this.
pub const READ_TIMEOUT: Duration = Duration::from_secs(10);
/// A `capture` may take longer: it writes and commits first.
pub const CAPTURE_TIMEOUT: Duration = Duration::from_secs(30);
/// After the TERM signal a timed-out capture has this long to finish before it is killed.
pub const TERM_GRACE: Duration = Duration::from_secs(5);
/// More stdout than this and the connector is killed and the answer refused.
pub const STDOUT_CAP: usize = 1024 * 1024;
/// Only the first bytes of stderr are kept, for the one-line failure message.
pub const STDERR_CAP: usize = 4 * 1024;

/// After the connector exits, how long its output may still take to arrive (a background child
/// may hold the pipes open).
const READER_GRACE: Duration = Duration::from_secs(1);

/// What the app may ask a connector. There is no request that deletes, and none that answers.
#[derive(Debug, Clone, PartialEq)]
pub enum Request {
    Counts,
    Open { id: Option<String> },
    // Asked by the calendar layer (Task 8), the questions list (Task 10) and capture (Task 11).
    #[allow(dead_code)]
    Events,
    #[allow(dead_code)]
    Questions,
    #[allow(dead_code)]
    Capture { text: String },
}

impl Request {
    pub fn name(&self) -> &'static str {
        match self {
            Request::Counts => "counts",
            Request::Open { .. } => "open",
            Request::Events => "events",
            Request::Questions => "questions",
            Request::Capture { .. } => "capture",
        }
    }

    /// The last arguments after the hub's own: the name, then the id of `open <id>`.
    pub fn tail_args(&self) -> Vec<String> {
        let mut args = vec![self.name().to_string()];
        if let Request::Open { id: Some(id) } = self {
            args.push(id.clone());
        }
        args
    }

    /// `{"text":…}` for a capture; every other request has stdin closed.
    pub fn stdin(&self) -> Option<String> {
        match self {
            Request::Capture { text } => Some(serde_json::json!({ "text": text }).to_string()),
            _ => None,
        }
    }

    pub fn timeout(&self) -> Duration {
        match self {
            Request::Capture { .. } => CAPTURE_TIMEOUT,
            _ => READ_TIMEOUT,
        }
    }
}

/// How a run failed before there was an answer to read.
#[derive(Debug, Clone, PartialEq)]
pub enum RunError {
    /// The program could not be started (message cleaned).
    NotStarted(String),
    TimedOut,
    TooLarge,
    /// Non-zero exit (or killed by a signal); `line` is stderr's first non-empty line, cleaned.
    Exit { code: Option<i32>, line: String },
}

impl RunError {
    pub fn kind(&self) -> ErrorKind {
        match self {
            RunError::NotStarted(_) => ErrorKind::NotStarted,
            RunError::TimedOut => ErrorKind::TimedOut,
            RunError::TooLarge => ErrorKind::TooLarge,
            RunError::Exit { .. } => ErrorKind::Failed,
        }
    }
}

fn not_started(message: String) -> RunError {
    RunError::NotStarted(clean_text(&message, ERROR_CHARS))
}

/// Runs `program` with `args` in `cwd` (no shell) with `PATH` (the login shell's), `HOME`, `LANG`
/// and `USER` and `TMPDIR` when the app has them; nothing else from the environment. Stdin is
/// closed, or `stdin` is written and then closed (a capture). Stdout and stderr are read apart:
/// stdout up to `STDOUT_CAP` (over it the group is killed: `TooLarge`), stderr its first
/// `STDERR_CAP` bytes. After `timeout` the whole process group is stopped: at once for a read,
/// with a TERM signal and up to `TERM_GRACE` before the kill for a capture (the run that has
/// stdin). However the run ends (exit, timeout, too large), the whole group is then killed:
/// nothing a connector started outlives it.
/// Returns stdout when the connector exits with code 0.
pub fn run_connector(
    program: &str,
    args: &[String],
    cwd: &str,
    path_env: &str,
    stdin: Option<&[u8]>,
    timeout: Duration,
) -> Result<Vec<u8>, RunError> {
    if !Path::new(cwd).is_dir() {
        return Err(not_started(format!("Folder not found: {cwd}")));
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
    let mut child = cmd
        .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Its own process group, so a stop also reaches what it started.
        .process_group(0)
        .spawn()
        .map_err(|e| not_started(format!("Failed to start {program}: {e}")))?;
    let group = child.id() as libc::pid_t;
    track_group(group);

    if let (Some(data), Some(mut pipe)) = (stdin, child.stdin.take()) {
        let data = data.to_vec();
        // On a thread: a connector that never reads must not block the timeout. The pipe is
        // closed when the thread ends.
        std::thread::spawn(move || {
            let _ = pipe.write_all(&data);
        });
    }

    let out = Arc::new(Mutex::new(Vec::new()));
    let err = Arc::new(Mutex::new(Vec::new()));
    let over = Arc::new(AtomicBool::new(false));
    let (done_tx, done_rx) = mpsc::channel();
    if let Some(pipe) = child.stdout.take() {
        read_stdout(pipe, out.clone(), over.clone(), done_tx.clone());
    }
    if let Some(pipe) = child.stderr.take() {
        read_stderr(pipe, err.clone(), done_tx);
    }

    let started = Instant::now();
    let status = loop {
        if over.load(Ordering::Relaxed) {
            end_group(&mut child, group);
            return Err(RunError::TooLarge);
        }
        match has_exited(group) {
            Ok(true) => break end_group(&mut child, group),
            Ok(false) if started.elapsed() >= timeout => {
                if stdin.is_some() {
                    stop_politely(group);
                }
                end_group(&mut child, group);
                return Err(RunError::TimedOut);
            }
            Ok(false) => std::thread::sleep(Duration::from_millis(10)),
            Err(e) => {
                end_group(&mut child, group);
                return Err(RunError::Exit { code: None, line: clean_text(&e.to_string(), ERROR_CHARS) });
            }
        }
    };
    let Some(status) = status else {
        return Err(RunError::Exit { code: None, line: String::new() });
    };

    let deadline = Instant::now() + READER_GRACE;
    for _ in 0..2 {
        let _ = done_rx.recv_timeout(deadline.saturating_duration_since(Instant::now()));
    }
    if over.load(Ordering::Relaxed) {
        return Err(RunError::TooLarge);
    }
    if status.success() {
        return Ok(out.lock().unwrap_or_else(|e| e.into_inner()).clone());
    }
    let stderr = err.lock().unwrap_or_else(|e| e.into_inner()).clone();
    Err(RunError::Exit { code: status.code(), line: first_line(&stderr) })
}

/// The first non-empty line of stderr, cleaned and cut.
fn first_line(stderr: &[u8]) -> String {
    String::from_utf8_lossy(stderr)
        .lines()
        .map(|l| clean_text(l, ERROR_CHARS))
        .find(|l| !l.is_empty())
        .unwrap_or_default()
}

/// Whether the connector (the group's leader) has exited, without reaping it: until `end_group`
/// reaps it, its process group id cannot be reused by a stranger.
fn has_exited(group: libc::pid_t) -> std::io::Result<bool> {
    // SAFETY: waitid(2) with WNOWAIT on our own unreaped child; `info` is zeroed plain data.
    unsafe {
        let mut info: libc::siginfo_t = std::mem::zeroed();
        let r = libc::waitid(libc::P_PID, group as libc::id_t, &mut info, libc::WEXITED | libc::WNOHANG | libc::WNOWAIT);
        if r != 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(info.si_pid != 0)
    }
}

/// However a connector ended, nothing it started stays: the whole group is killed (the leader is
/// not reaped yet, so the group id is still ours), then the leader is reaped. Returns its status.
fn end_group(child: &mut std::process::Child, group: libc::pid_t) -> Option<std::process::ExitStatus> {
    untrack_group(group);
    // SAFETY: kill(2) on the process group of a child that is not reaped yet.
    unsafe { libc::kill(-group, libc::SIGKILL) };
    child.wait().ok()
}

/// TERM to the group, then up to `TERM_GRACE` for the connector (its leader) to exit, so it can
/// finish what it was writing. The caller then kills the group.
fn stop_politely(group: libc::pid_t) {
    // SAFETY: kill(2) on the process group of a child that is not reaped yet.
    unsafe { libc::kill(-group, libc::SIGTERM) };
    let until = Instant::now() + TERM_GRACE;
    while matches!(has_exited(group), Ok(false)) && Instant::now() < until {
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn read_stdout<R: Read + Send + 'static>(
    mut r: R,
    out: Arc<Mutex<Vec<u8>>>,
    over: Arc<AtomicBool>,
    done: mpsc::Sender<()>,
) {
    std::thread::spawn(move || {
        let mut chunk = [0u8; 8192];
        while let Ok(n) = r.read(&mut chunk) {
            if n == 0 {
                break;
            }
            let mut buf = out.lock().unwrap_or_else(|e| e.into_inner());
            let room = STDOUT_CAP + 1 - buf.len();
            buf.extend_from_slice(&chunk[..n.min(room)]);
            if buf.len() > STDOUT_CAP {
                over.store(true, Ordering::Relaxed);
                break;
            }
        }
        let _ = done.send(());
    });
}

/// Keeps the first `STDERR_CAP` bytes and drains the rest, so a chatty connector never blocks.
fn read_stderr<R: Read + Send + 'static>(mut r: R, err: Arc<Mutex<Vec<u8>>>, done: mpsc::Sender<()>) {
    std::thread::spawn(move || {
        let mut chunk = [0u8; 8192];
        while let Ok(n) = r.read(&mut chunk) {
            if n == 0 {
                break;
            }
            let mut buf = err.lock().unwrap_or_else(|e| e.into_inner());
            let room = STDERR_CAP.saturating_sub(buf.len());
            buf.extend_from_slice(&chunk[..n.min(room)]);
        }
        let _ = done.send(());
    });
}

/// Runs a hub's connector for one request; a trait so the commands' tests can answer without a
/// process.
pub trait Connector: Send + Sync {
    fn run(&self, hub: &Hub, req: &Request, path_env: &str) -> Result<Vec<u8>, RunError>;
}

/// The real connector: the hub's program with its arguments, then the request's.
pub struct RealConnector;

impl Connector for RealConnector {
    fn run(&self, hub: &Hub, req: &Request, path_env: &str) -> Result<Vec<u8>, RunError> {
        let mut args = hub.args.clone();
        args.extend(req.tail_args());
        let stdin = req.stdin();
        run_connector(&hub.program, &args, &hub.folder, path_env, stdin.as_deref().map(str::as_bytes), req.timeout())
    }
}

#[cfg(test)]
mod tests {
    use super::super::contract::{parse_capture, parse_counts, parse_open, Answer, Counts, Target};
    use super::*;
    use std::path::PathBuf;

    const PATH: &str = "/usr/bin:/bin";
    const FIXTURE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/src/agents/hubs/fixtures/demo-hub/connector.sh");

    /// A fresh temporary folder for one test.
    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sm-hubs-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Writes `body` as a script in `dir` and runs it with `sh`, in `dir`.
    fn sh(
        dir: &Path,
        body: &str,
        args: &[&str],
        stdin: Option<&[u8]>,
        timeout: Duration,
    ) -> Result<Vec<u8>, RunError> {
        let script = dir.join("connector.sh");
        std::fs::write(&script, body).unwrap();
        let mut argv = vec![script.display().to_string()];
        argv.extend(args.iter().map(|s| s.to_string()));
        run_connector("/bin/sh", &argv, &dir.display().to_string(), PATH, stdin, timeout)
    }

    fn pid_from(file: &Path) -> libc::pid_t {
        std::fs::read_to_string(file).unwrap_or_else(|_| panic!("{} was not written", file.display())).trim().parse().unwrap()
    }

    /// Waits (bounded) for a killed process to be reaped.
    fn assert_gone(pid: libc::pid_t) {
        let by = Instant::now() + Duration::from_secs(3);
        // SAFETY: signal 0 only checks whether the process exists.
        while unsafe { libc::kill(pid, 0) } == 0 {
            assert!(Instant::now() < by, "process {pid} outlived the stop");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn the_real_connector_passes_the_request_name_last() {
        let dir = tmp("real-connector");
        let script = dir.join("echo-args.sh");
        std::fs::write(&script, "#!/bin/sh\nprintf '%s|' \"$@\"\n").unwrap();
        let hub = Hub {
            id: "h00000001".into(),
            name: "Demo hub".into(),
            colour: "purple".into(),
            folder: dir.display().to_string(),
            program: "/bin/sh".into(),
            args: vec![script.display().to_string(), "--flag".into()],
        };
        let out = RealConnector.run(&hub, &Request::Open { id: Some("n1".into()) }, PATH).unwrap();
        assert_eq!(String::from_utf8(out).unwrap(), "--flag|open|n1|");
        let out = RealConnector.run(&hub, &Request::Counts, PATH).unwrap();
        assert_eq!(String::from_utf8(out).unwrap(), "--flag|counts|");
    }

    #[test]
    fn requests_are_exactly_the_five() {
        let all = [
            Request::Counts,
            Request::Open { id: None },
            Request::Events,
            Request::Questions,
            Request::Capture { text: "t".into() },
        ];
        let names: Vec<&str> = all.iter().map(|r| r.name()).collect();
        assert_eq!(names, ["counts", "open", "events", "questions", "capture"]);
        assert_eq!(Request::Open { id: Some("a:1".into()) }.tail_args(), ["open", "a:1"]);
        assert_eq!(Request::Open { id: None }.tail_args(), ["open"]);
        assert_eq!(Request::Counts.tail_args(), ["counts"]);
        assert_eq!(Request::Counts.stdin(), None);
        assert_eq!(Request::Capture { text: "a \"b\"".into() }.stdin().as_deref(), Some(r#"{"text":"a \"b\""}"#));
        assert_eq!(Request::Events.timeout(), READ_TIMEOUT);
        assert_eq!(Request::Capture { text: String::new() }.timeout(), CAPTURE_TIMEOUT);
    }

    #[test]
    fn runs_without_a_shell() {
        let dir = tmp("noshell");
        let out = sh(&dir, "printf '%s' \"$1\"", &["a; touch x"], None, Duration::from_secs(5)).unwrap();
        assert_eq!(out, b"a; touch x");
        assert!(!dir.join("x").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn stdin_closed_for_reads() {
        let dir = tmp("stdin-closed");
        let started = Instant::now();
        // `cat` would wait for ever on an open stdin.
        let out = sh(&dir, "cat; echo done", &[], None, Duration::from_secs(5)).unwrap();
        assert_eq!(out, b"done\n");
        assert!(started.elapsed() < Duration::from_secs(4));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn capture_gets_its_json_on_stdin() {
        let dir = tmp("capture-stdin");
        let json = Request::Capture { text: "a \"quoted\"\nline; $HOME".into() }.stdin().unwrap();
        let out = sh(&dir, "cat", &[], Some(json.as_bytes()), Duration::from_secs(5)).unwrap();
        assert_eq!(String::from_utf8(out).unwrap(), json);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn slow_connector_is_killed() {
        let dir = tmp("slow");
        let pid_file = dir.join("child");
        let body = format!("sleep 30 &\necho $! > '{}'\nwait", pid_file.display());
        let started = Instant::now();
        let res = sh(&dir, &body, &[], None, Duration::from_millis(700));
        assert_eq!(res, Err(RunError::TimedOut));
        assert!(started.elapsed() < Duration::from_secs(3), "{:?}", started.elapsed());
        assert_gone(pid_from(&pid_file));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn slow_connector_grandchild_is_killed_too() {
        let dir = tmp("grandchild");
        let child = dir.join("child");
        let grand = dir.join("grand");
        let body = format!(
            "sh -c \"sleep 30 & echo \\$! > '{}'; wait\" &\necho $! > '{}'\nwait",
            grand.display(),
            child.display()
        );
        let started = Instant::now();
        let res = sh(&dir, &body, &[], None, Duration::from_millis(900));
        assert_eq!(res, Err(RunError::TimedOut));
        assert!(started.elapsed() < Duration::from_secs(3), "{:?}", started.elapsed());
        assert_gone(pid_from(&child));
        assert_gone(pid_from(&grand));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_read_that_exits_leaves_nothing_running() {
        let dir = tmp("exit-leaves-nothing");
        let pid_file = dir.join("child");
        let body = format!("sleep 30 &\necho $! > '{}'\necho '{{}}'\nexit 0", pid_file.display());
        let out = sh(&dir, &body, &[], None, Duration::from_secs(5)).unwrap();
        assert_eq!(out, b"{}\n");
        assert_gone(pid_from(&pid_file));
        // A failing exit too.
        let body = format!("sleep 30 &\necho $! > '{}'\nexit 4", pid_file.display());
        assert!(sh(&dir, &body, &[], None, Duration::from_secs(5)).is_err());
        assert_gone(pid_from(&pid_file));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_capture_that_exits_inside_the_grace_leaves_no_grandchild() {
        let dir = tmp("capture-grandchild");
        let pid_file = dir.join("child");
        // Ends on TERM but leaves its `sleep` running.
        let body = format!("sleep 30 &\necho $! > '{}'\ntrap 'exit 0' TERM\nwhile :; do sleep 1; done", pid_file.display());
        let started = Instant::now();
        let res = sh(&dir, &body, &[], Some(b"{}"), Duration::from_millis(700));
        assert_eq!(res, Err(RunError::TimedOut));
        assert!(started.elapsed() < TERM_GRACE, "{:?}", started.elapsed());
        assert_gone(pid_from(&pid_file));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn capture_timeout_terms_before_kill() {
        let dir = tmp("capture-term");
        let marker = dir.join("marker");
        let body = format!(
            "sleep 30 &\npid=$!\ntrap 'kill $pid; echo term > \"{}\"; exit 0' TERM\nwait",
            marker.display()
        );
        let res = sh(&dir, &body, &[], Some(b"{}"), Duration::from_millis(700));
        assert_eq!(res, Err(RunError::TimedOut));
        assert!(marker.exists(), "the connector never saw the TERM signal");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn capture_that_ignores_term_is_killed_after_the_grace() {
        // Only a read is killed at once; a capture that ignores TERM is killed after TERM_GRACE.
        let dir = tmp("capture-ignores");
        let body = "trap '' TERM\nwhile :; do sleep 1; done";
        let started = Instant::now();
        let res = sh(&dir, body, &[], Some(b"{}"), Duration::from_millis(300));
        assert_eq!(res, Err(RunError::TimedOut));
        assert!(started.elapsed() >= TERM_GRACE, "{:?}", started.elapsed());
        assert!(started.elapsed() < TERM_GRACE + Duration::from_secs(4), "{:?}", started.elapsed());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn huge_output_is_refused_and_killed() {
        let dir = tmp("huge");
        let started = Instant::now();
        let res = sh(&dir, "head -c 2097152 /dev/zero | tr '\\0' x", &[], None, Duration::from_secs(10));
        assert_eq!(res, Err(RunError::TooLarge));
        assert!(started.elapsed() < Duration::from_secs(2), "{:?}", started.elapsed());
        // Exactly the cap is fine.
        let body = format!("head -c {STDOUT_CAP} /dev/zero | tr '\\0' x");
        let out = sh(&dir, &body, &[], None, Duration::from_secs(10)).unwrap();
        assert_eq!(out.len(), STDOUT_CAP);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn chatty_stderr_does_not_block_or_leak_into_stdout() {
        let dir = tmp("stderr-flood");
        let out = sh(&dir, "head -c 1048576 /dev/zero >&2; echo ok", &[], None, Duration::from_secs(10)).unwrap();
        assert_eq!(out, b"ok\n");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn exit_code_gives_the_first_stderr_line() {
        let dir = tmp("exit");
        let body = "echo out\nprintf '\\n   \\nfirst \\033[0mline\\nsecond\\n' >&2\nexit 3";
        let err = sh(&dir, body, &[], None, Duration::from_secs(5)).unwrap_err();
        assert_eq!(err, RunError::Exit { code: Some(3), line: "first [0mline".into() });
        assert_eq!(err.kind(), ErrorKind::Failed);
        // No stderr: an empty line. A long line is cut.
        let err = sh(&dir, "exit 1", &[], None, Duration::from_secs(5)).unwrap_err();
        assert_eq!(err, RunError::Exit { code: Some(1), line: String::new() });
        let err = sh(&dir, "head -c 500 /dev/zero | tr '\\0' y >&2; exit 2", &[], None, Duration::from_secs(5)).unwrap_err();
        assert_eq!(err, RunError::Exit { code: Some(2), line: "y".repeat(ERROR_CHARS) });
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn not_started_is_reported() {
        let dir = tmp("nostart");
        let cwd = dir.display().to_string();
        let err = run_connector("/no/such/program", &[], &cwd, PATH, None, READ_TIMEOUT).unwrap_err();
        assert!(matches!(err, RunError::NotStarted(_)));
        assert_eq!(err.kind(), ErrorKind::NotStarted);
        let err = run_connector("/bin/echo", &[], "/no/such/folder", PATH, None, READ_TIMEOUT).unwrap_err();
        assert!(matches!(err, RunError::NotStarted(_)));
        assert_eq!(RunError::TimedOut.kind(), ErrorKind::TimedOut);
        assert_eq!(RunError::TooLarge.kind(), ErrorKind::TooLarge);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn quit_stops_a_connector() {
        // The script prints its pid (= its process group) to a file and waits; stopping that
        // group (what `stop_all` does for every group) ends the run long before the sleep.
        let dir = tmp("quit");
        let pid_file = dir.join("pid");
        let body = format!("echo $$ > '{}'\nsleep 30 &\nwait", pid_file.display());
        let started = Instant::now();
        let runner = {
            let dir = dir.clone();
            std::thread::spawn(move || sh(&dir, &body, &[], None, READ_TIMEOUT))
        };
        let group: libc::pid_t = loop {
            // Tracked, not just started: the script can write its pid before the run tracks it.
            if let Some(g) = std::fs::read_to_string(&pid_file).ok().and_then(|s| s.trim().parse().ok()) {
                if crate::agents::routines::run::is_tracked(g) {
                    break g;
                }
            }
            assert!(started.elapsed() < Duration::from_secs(5), "connector never started");
            std::thread::sleep(Duration::from_millis(10));
        };
        // Only this test's group: other tests run commands at the same time.
        assert_eq!(crate::agents::routines::run::stop_where(|g| g == group), 1);
        let res = runner.join().unwrap();
        assert!(started.elapsed() < Duration::from_secs(5), "{:?}", started.elapsed());
        assert!(matches!(res, Err(RunError::Exit { code: None, .. })), "{res:?}");
        std::fs::remove_dir_all(&dir).ok();
    }

    /// Runs the fixture in `mode` with its own TMPDIR, so a mode file in the real one never
    /// changes the result.
    fn fixture(name: &str, mode: Option<&str>, args: &[&str]) -> Result<Vec<u8>, RunError> {
        fixture_with(name, mode, args, None)
    }

    fn fixture_with(name: &str, mode: Option<&str>, args: &[&str], stdin: Option<&[u8]>) -> Result<Vec<u8>, RunError> {
        let dir = tmp(name);
        if let Some(m) = mode {
            std::fs::write(dir.join("sm-demo-hub-mode"), m).unwrap();
        }
        let mut argv = vec![format!("TMPDIR={}", dir.display()), "sh".to_string(), FIXTURE.to_string()];
        argv.extend(args.iter().map(|s| s.to_string()));
        let res = run_connector("/usr/bin/env", &argv, &dir.display().to_string(), PATH, stdin, Duration::from_secs(10));
        std::fs::remove_dir_all(&dir).ok();
        res
    }

    #[test]
    fn the_fixture_in_ok_mode_parses() {
        let out = fixture("fixture-counts", None, &["counts"]).unwrap();
        assert_eq!(parse_counts(&out), Ok(Answer::Ok(Counts { waiting: 3 })));
        let out = fixture("fixture-ok", Some("ok"), &["counts"]).unwrap();
        assert_eq!(parse_counts(&out), Ok(Answer::Ok(Counts { waiting: 3 })));
        let out = fixture("fixture-open", None, &["open"]).unwrap();
        match parse_open(&out) {
            Ok(Answer::Ok(Target::Path(p))) => assert!(p.ends_with("/demo-hub/notes.txt"), "{p}"),
            other => panic!("{other:?}"),
        }
        let out = fixture("fixture-open-id", None, &["open", "q-1"]).unwrap();
        assert_eq!(parse_open(&out), Ok(Answer::Ok(Target::Url("https://example.com/demo-hub/q-1".into()))));
        let out = fixture("fixture-unknown-request", None, &["nope"]).unwrap();
        assert_eq!(parse_counts(&out), Ok(Answer::Unsupported));
        // A capture in ok mode: the text goes in on stdin, `saved` comes back.
        let json = Request::Capture { text: "A note for the demo hub".into() }.stdin().unwrap();
        let out = fixture_with("fixture-capture", None, &["capture"], Some(json.as_bytes())).unwrap();
        assert_eq!(parse_capture(&out), Ok(Answer::Ok(())));
    }

    #[test]
    fn the_fixture_modes_fail_as_named() {
        assert!(parse_counts(&fixture("fixture-garbage", Some("garbage"), &["counts"]).unwrap()).is_err());
        assert_eq!(
            fixture("fixture-fail", Some("fail"), &["counts"]),
            Err(RunError::Exit { code: Some(1), line: "Demo hub: the store is locked".into() })
        );
        assert_eq!(fixture("fixture-huge", Some("huge"), &["counts"]), Err(RunError::TooLarge));
        let out = fixture("fixture-unsupported", Some("unsupported"), &["counts"]).unwrap();
        assert_eq!(parse_counts(&out), Ok(Answer::Unsupported));
    }
}
