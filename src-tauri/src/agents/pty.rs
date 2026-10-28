//! Terminals attached to agents (`claude attach <short id>`) and sending messages through them.

use super::cli::{spawn_env, LoginEnv};
use super::model::{Agent, Kind};
use super::validate::{clamp_size, normalise_message, valid_short_id};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

pub const MAX_TERMINALS: usize = 8;
/// How long to wait for `claude attach` to print anything before typing anyway.
const READY_TIMEOUT_MS: i64 = 3_000;
const READY_POLL_MS: u64 = 50;
/// Pause between the text and the Enter, as a person would type.
const ENTER_AFTER_MS: u64 = 300;
/// How long a temporary terminal stays attached after the Enter, so the agent receives the line.
const TEMP_CLOSE_AFTER_MS: u64 = 2_000;
const TEMP_COLS: u16 = 80;
const TEMP_ROWS: u16 = 24;

/// One process running in a pty.
pub trait PtyProcess: Send {
    fn write(&mut self, data: &[u8]) -> Result<(), String>;
    fn resize(&mut self, cols: u16, rows: u16) -> Result<(), String>;
    /// The pty output; reading returns 0 (or fails) once the process has ended.
    fn reader(&mut self) -> Result<Box<dyn Read + Send>, String>;
    /// Ends the process and reaps it.
    fn kill(&mut self);
}

pub trait PtySpawner: Send + Sync {
    fn spawn(&self, short_id: &str, cols: u16, rows: u16) -> Result<Box<dyn PtyProcess>, String>;
}

pub trait Clock: Send + Sync {
    fn now_ms(&self) -> i64;
    fn sleep_ms(&self, ms: u64);
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> i64 {
        chrono::Utc::now().timestamp_millis()
    }
    fn sleep_ms(&self, ms: u64) {
        std::thread::sleep(std::time::Duration::from_millis(ms));
    }
}

/// The login environment, resolved on first use and shared with `AgentsState`.
pub type LoginCache = Arc<Mutex<Option<Arc<LoginEnv>>>>;

pub fn cached_login_env(cache: &LoginCache) -> Arc<LoginEnv> {
    let mut guard = lock(cache);
    guard.get_or_insert_with(|| Arc::new(super::cli::resolve_login_env())).clone()
}

/// Runs exactly `claude attach <short id>` in the home folder, with `spawn_env`.
pub struct RealSpawner {
    login: LoginCache,
}

impl RealSpawner {
    pub fn new(login: LoginCache) -> Self {
        Self { login }
    }
}

impl PtySpawner for RealSpawner {
    fn spawn(&self, short_id: &str, cols: u16, rows: u16) -> Result<Box<dyn PtyProcess>, String> {
        use portable_pty::{native_pty_system, CommandBuilder, PtySize};
        let env = cached_login_env(&self.login);
        let claude = env.claude.clone().ok_or("claude not found")?;
        let pair = native_pty_system()
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| e.to_string())?;
        let mut cmd = CommandBuilder::new(claude);
        cmd.args(["attach", short_id]);
        cmd.cwd(super::actions::home_dir());
        cmd.env_clear();
        for (k, v) in spawn_env(&env) {
            cmd.env(k, v);
        }
        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        // Only the child keeps the slave open, so the reader ends when it exits.
        drop(pair.slave);
        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        Ok(Box::new(RealPty { master: pair.master, writer, child }))
    }
}

struct RealPty {
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

impl PtyProcess for RealPty {
    fn write(&mut self, data: &[u8]) -> Result<(), String> {
        self.writer.write_all(data).and_then(|_| self.writer.flush()).map_err(|e| e.to_string())
    }
    fn resize(&mut self, cols: u16, rows: u16) -> Result<(), String> {
        let size = portable_pty::PtySize { rows, cols, pixel_width: 0, pixel_height: 0 };
        self.master.resize(size).map_err(|e| e.to_string())
    }
    fn reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
        self.master.try_clone_reader().map_err(|e| e.to_string())
    }
    fn kill(&mut self) {
        // SIGHUP, then SIGKILL after a short grace; `claude attach` only detaches, the agent runs on.
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub type OnData = Box<dyn Fn(u32, &[u8]) + Send>;
pub type OnExit = Box<dyn FnOnce(u32) + Send>;

struct Term {
    short_id: String,
    /// Taken by whoever ends the process first (`close`, or the reader at end of output).
    process: Mutex<Option<Box<dyn PtyProcess>>>,
    parser: Mutex<vt100::Parser>,
    /// Epoch ms of the latest output; 0 before any.
    last_output: AtomicI64,
}

impl Term {
    fn end(&self) {
        let process = lock(&self.process).take();
        if let Some(mut p) = process {
            p.kill();
        }
    }
}

#[derive(Default)]
struct Terms {
    live: HashMap<u32, Arc<Term>>,
    /// Slots reserved by `open` calls still spawning.
    pending: usize,
    next_id: u32,
}

struct Inner {
    spawner: Arc<dyn PtySpawner>,
    clock: Arc<dyn Clock>,
    terms: Mutex<Terms>,
}

/// The open terminals, each running `claude attach`. Cheap to clone.
///
/// The `terms` lock is only held to look up, add or remove entries: never across pty I/O,
/// process kills or callbacks.
#[derive(Clone)]
pub struct TerminalHub {
    inner: Arc<Inner>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl TerminalHub {
    pub fn new(spawner: Arc<dyn PtySpawner>, clock: Arc<dyn Clock>) -> Self {
        Self { inner: Arc::new(Inner { spawner, clock, terms: Mutex::default() }) }
    }

    fn get(&self, term_id: u32) -> Option<Arc<Term>> {
        lock(&self.inner.terms).live.get(&term_id).cloned()
    }

    fn forget(&self, term_id: u32) -> Option<Arc<Term>> {
        lock(&self.inner.terms).live.remove(&term_id)
    }

    /// Number of live terminals.
    pub fn len(&self) -> usize {
        lock(&self.inner.terms).live.len()
    }

    /// Attaches a terminal. `on_data` gets every chunk of output and `on_exit` runs once the
    /// process has ended, both on the terminal's reader thread.
    pub fn open(
        &self,
        short_id: &str,
        cols: u16,
        rows: u16,
        on_data: OnData,
        on_exit: OnExit,
    ) -> Result<u32, String> {
        if !valid_short_id(short_id) {
            return Err("Invalid agent id".into());
        }
        let (cols, rows) = clamp_size(cols, rows);
        {
            let mut t = lock(&self.inner.terms);
            if t.live.len() + t.pending >= MAX_TERMINALS {
                return Err("Too many terminals open".into());
            }
            t.pending += 1;
        }
        let spawned = self.inner.spawner.spawn(short_id, cols, rows).and_then(|mut p| {
            match p.reader() {
                Ok(r) => Ok((p, r)),
                Err(e) => {
                    p.kill();
                    Err(e)
                }
            }
        });
        let mut t = lock(&self.inner.terms);
        t.pending -= 1;
        let (process, reader) = spawned?;
        t.next_id = t.next_id.wrapping_add(1).max(1);
        let id = t.next_id;
        let term = Arc::new(Term {
            short_id: short_id.to_string(),
            process: Mutex::new(Some(process)),
            parser: Mutex::new(vt100::Parser::new(rows, cols, 0)),
            last_output: AtomicI64::new(0),
        });
        t.live.insert(id, term.clone());
        drop(t);
        let hub = self.clone();
        std::thread::spawn(move || hub.pump(id, term, reader, on_data, on_exit));
        Ok(id)
    }

    /// Reader thread: feeds the screen and `on_data` until the process ends, then cleans up.
    fn pump(
        &self,
        id: u32,
        term: Arc<Term>,
        mut reader: Box<dyn Read + Send>,
        on_data: OnData,
        on_exit: OnExit,
    ) {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    lock(&term.parser).process(&buf[..n]);
                    term.last_output.store(self.inner.clock.now_ms(), Ordering::SeqCst);
                    on_data(id, &buf[..n]);
                }
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
                Err(_) => break,
            }
        }
        self.forget(id);
        term.end();
        on_exit(id);
    }

    pub fn write(&self, term_id: u32, data: &[u8]) -> Result<(), String> {
        let term = self.get(term_id).ok_or("Terminal closed")?;
        let mut process = lock(&term.process);
        process.as_mut().ok_or("Terminal closed")?.write(data)
    }

    pub fn resize(&self, term_id: u32, cols: u16, rows: u16) -> Result<(), String> {
        let (cols, rows) = clamp_size(cols, rows);
        let term = self.get(term_id).ok_or("Terminal closed")?;
        lock(&term.parser).screen_mut().set_size(rows, cols);
        let mut process = lock(&term.process);
        process.as_mut().ok_or("Terminal closed")?.resize(cols, rows)
    }

    /// Kills and reaps the process; unknown ids are ignored.
    pub fn close(&self, term_id: u32) {
        if let Some(term) = self.forget(term_id) {
            term.end();
        }
    }

    /// Closes every terminal (Agents switched off). Each reader thread still runs its `on_exit`.
    pub fn close_all(&self) {
        let terms: Vec<Arc<Term>> = lock(&self.inner.terms).live.drain().map(|(_, t)| t).collect();
        for term in terms {
            term.end();
        }
    }

    /// The most recently opened live terminal attached to `short_id`.
    pub fn existing(&self, short_id: &str) -> Option<u32> {
        let t = lock(&self.inner.terms);
        t.live.iter().filter(|(_, term)| term.short_id == short_id).map(|(id, _)| *id).max()
    }

    pub fn screen(&self, term_id: u32) -> Option<String> {
        let term = self.get(term_id)?;
        let contents = lock(&term.parser).screen().contents();
        Some(contents)
    }

    /// Epoch ms of the terminal's latest output; None before any output or once closed.
    pub fn last_output_ms(&self, term_id: u32) -> Option<i64> {
        let ms = self.get(term_id)?.last_output.load(Ordering::SeqCst);
        (ms != 0).then_some(ms)
    }
}

/// Types `text` into a background agent, as the reference `sendToSession` does. An open terminal
/// is reused and left open; otherwise a temporary one is attached and closed 2 s after the Enter.
pub fn send_message(hub: &TerminalHub, agent: &Agent, text: &str) -> Result<(), String> {
    if agent.kind != Kind::Background {
        return Err("Only background agents take messages".into());
    }
    if agent.status == "waiting" {
        return Err("Answer the open prompt first".into());
    }
    let text = normalise_message(text).ok_or("Invalid message")?;
    let short_id = agent.short_id.as_deref().ok_or("Agent has no id")?;
    let payload = if text.contains('\n') {
        format!("\x1b[200~{text}\x1b[201~")
    } else {
        // Typed as keys: a Tab would trigger the TUI's completion.
        text.replace('\t', "  ")
    };

    if let Some(id) = hub.existing(short_id) {
        return type_line(hub, id, &payload);
    }

    let clock = hub.inner.clock.clone();
    let id = hub.open(short_id, TEMP_COLS, TEMP_ROWS, Box::new(|_, _| {}), Box::new(|_| {}))?;
    let start = clock.now_ms();
    loop {
        if hub.get(id).is_none() {
            return Err("Could not attach to the agent".into());
        }
        if hub.last_output_ms(id).is_some() || clock.now_ms() - start >= READY_TIMEOUT_MS {
            break;
        }
        clock.sleep_ms(READY_POLL_MS);
    }
    if let Err(e) = type_line(hub, id, &payload) {
        hub.close(id);
        return Err(e);
    }
    let hub = hub.clone();
    std::thread::spawn(move || {
        clock.sleep_ms(TEMP_CLOSE_AFTER_MS);
        hub.close(id);
    });
    Ok(())
}

/// Writes the text, then the Enter 300 ms later.
fn type_line(hub: &TerminalHub, id: u32, payload: &str) -> Result<(), String> {
    hub.write(id, payload.as_bytes())?;
    hub.inner.clock.sleep_ms(ENTER_AFTER_MS);
    hub.write(id, b"\r")
}

// ---------------------------------------------------------------- commands

pub const TERM_EVENT: &str = "agents:term";
pub const TERM_EXIT_EVENT: &str = "agents:term-exit";

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TermData {
    term_id: u32,
    /// Base64 of the raw output bytes.
    data: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TermExit {
    term_id: u32,
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn agents_term_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, super::AgentsState>,
    short_id: String,
    cols: u16,
    rows: u16,
) -> Result<u32, String> {
    use base64::Engine;
    use tauri::Emitter;
    super::actions::ready(&state)?;
    let hub = state.hub.clone();
    let data_app = app.clone();
    let on_data: OnData = Box::new(move |term_id, bytes| {
        let data = base64::engine::general_purpose::STANDARD.encode(bytes);
        let _ = data_app.emit(TERM_EVENT, TermData { term_id, data });
    });
    let on_exit: OnExit = Box::new(move |term_id| {
        let _ = app.emit(TERM_EXIT_EVENT, TermExit { term_id });
    });
    blocking(move || hub.open(&short_id, cols, rows, on_data, on_exit)).await
}

/// `data` is the UTF-8 text from xterm's `onData`.
#[tauri::command]
pub async fn agents_term_write(
    state: tauri::State<'_, super::AgentsState>,
    term_id: u32,
    data: String,
) -> Result<(), String> {
    super::actions::switched_on(&state)?;
    let hub = state.hub.clone();
    blocking(move || hub.write(term_id, data.as_bytes())).await
}

#[tauri::command]
pub async fn agents_term_resize(
    state: tauri::State<'_, super::AgentsState>,
    term_id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    super::actions::switched_on(&state)?;
    let hub = state.hub.clone();
    blocking(move || hub.resize(term_id, cols, rows)).await
}

#[tauri::command]
pub async fn agents_term_close(
    state: tauri::State<'_, super::AgentsState>,
    term_id: u32,
) -> Result<(), String> {
    // No switched-off guard: closing must always work.
    let hub = state.hub.clone();
    blocking(move || {
        hub.close(term_id);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn agents_send(
    state: tauri::State<'_, super::AgentsState>,
    session_id: String,
    text: String,
) -> Result<(), String> {
    let cli = super::actions::ready(&state)?;
    let hub = state.hub.clone();
    blocking(move || {
        let agent = super::actions::find_agent(&cli, &session_id)?;
        send_message(&hub, &agent, &text)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::model::{parse_agents, Agent};
    use std::io::Read;
    use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
    use std::sync::mpsc::{channel, Receiver, Sender};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    /// What a test can see of one fake process.
    #[derive(Clone)]
    struct FakeHandle {
        short_id: String,
        size: Arc<Mutex<(u16, u16)>>,
        writes: Arc<Mutex<Vec<String>>>,
        tx: Arc<Mutex<Option<Sender<Vec<u8>>>>>,
        killed: Arc<AtomicBool>,
    }

    impl FakeHandle {
        /// The process ends on its own.
        fn exit(&self) {
            self.tx.lock().unwrap().take();
        }
        fn writes(&self) -> Vec<String> {
            self.writes.lock().unwrap().clone()
        }
    }

    struct FakeProc {
        h: FakeHandle,
        rx: Option<Receiver<Vec<u8>>>,
    }

    struct ChannelReader {
        rx: Receiver<Vec<u8>>,
        buf: Vec<u8>,
    }

    impl Read for ChannelReader {
        fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
            if self.buf.is_empty() {
                match self.rx.recv() {
                    Ok(b) => self.buf = b,
                    Err(_) => return Ok(0),
                }
            }
            let n = out.len().min(self.buf.len());
            out[..n].copy_from_slice(&self.buf[..n]);
            self.buf.drain(..n);
            Ok(n)
        }
    }

    impl PtyProcess for FakeProc {
        fn write(&mut self, data: &[u8]) -> Result<(), String> {
            self.h.writes.lock().unwrap().push(String::from_utf8_lossy(data).into_owned());
            if let Some(tx) = self.h.tx.lock().unwrap().as_ref() {
                let _ = tx.send(data.to_vec());
            }
            Ok(())
        }
        fn resize(&mut self, cols: u16, rows: u16) -> Result<(), String> {
            *self.h.size.lock().unwrap() = (cols, rows);
            Ok(())
        }
        fn reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
            let rx = self.rx.take().ok_or("reader taken")?;
            Ok(Box::new(ChannelReader { rx, buf: vec![] }))
        }
        fn kill(&mut self) {
            self.h.killed.store(true, Ordering::SeqCst);
            self.h.exit();
        }
    }

    #[derive(Default)]
    struct FakeSpawner {
        spawned: Mutex<Vec<FakeHandle>>,
    }

    impl FakeSpawner {
        fn handles(&self) -> Vec<FakeHandle> {
            self.spawned.lock().unwrap().clone()
        }
    }

    impl PtySpawner for FakeSpawner {
        fn spawn(&self, short_id: &str, cols: u16, rows: u16) -> Result<Box<dyn PtyProcess>, String> {
            let (tx, rx) = channel();
            let h = FakeHandle {
                short_id: short_id.to_string(),
                size: Arc::new(Mutex::new((cols, rows))),
                writes: Arc::default(),
                tx: Arc::new(Mutex::new(Some(tx))),
                killed: Arc::default(),
            };
            self.spawned.lock().unwrap().push(h.clone());
            Ok(Box::new(FakeProc { h, rx: Some(rx) }))
        }
    }

    /// Virtual time: sleeping advances it at once and records the duration.
    #[derive(Default)]
    struct FakeClock {
        now: AtomicI64,
        sleeps: Mutex<Vec<u64>>,
    }

    impl Clock for FakeClock {
        fn now_ms(&self) -> i64 {
            self.now.load(Ordering::SeqCst)
        }
        fn sleep_ms(&self, ms: u64) {
            self.sleeps.lock().unwrap().push(ms);
            self.now.fetch_add(ms as i64, Ordering::SeqCst);
            // Let the reader threads run.
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    fn hub() -> (TerminalHub, Arc<FakeSpawner>, Arc<FakeClock>) {
        let spawner = Arc::new(FakeSpawner::default());
        let clock = Arc::new(FakeClock { now: AtomicI64::new(1_000), ..Default::default() });
        (TerminalHub::new(spawner.clone(), clock.clone()), spawner, clock)
    }

    fn open(hub: &TerminalHub, short_id: &str) -> Result<u32, String> {
        hub.open(short_id, 80, 24, Box::new(|_, _| {}), Box::new(|_| {}))
    }

    /// Polls `f` for up to two real seconds.
    fn eventually(f: impl Fn() -> bool) -> bool {
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(2) {
            if f() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        f()
    }

    fn agent(kind: &str, status: &str) -> Agent {
        let json = format!(
            r#"[{{"sessionId":"00000000-1111-2222-3333-444444444444","id":"0a1b2c3d","kind":"{kind}","status":"{status}"}}]"#
        );
        parse_agents(&json).unwrap().remove(0)
    }

    #[test]
    fn open_validates_id_and_clamps() {
        let (hub, spawner, _) = hub();
        assert!(open(&hub, "nope").is_err());
        assert!(open(&hub, "0A1B2C3D").is_err());
        assert!(spawner.handles().is_empty());
        let id = hub.open("0a1b2c3d", 5, 999, Box::new(|_, _| {}), Box::new(|_| {})).unwrap();
        let h = &spawner.handles()[0];
        assert_eq!(h.short_id, "0a1b2c3d");
        assert_eq!(*h.size.lock().unwrap(), (20, 200));
        hub.resize(id, 999, 1).unwrap();
        assert_eq!(*h.size.lock().unwrap(), (400, 5));
        assert_eq!(hub.existing("0a1b2c3d"), Some(id));
        assert_eq!(hub.existing("11111111"), None);
    }

    #[test]
    fn ninth_terminal_refused() {
        let (hub, spawner, _) = hub();
        let ids: Vec<u32> = (0..MAX_TERMINALS).map(|_| open(&hub, "0a1b2c3d").unwrap()).collect();
        assert!(open(&hub, "0a1b2c3d").is_err());
        assert_eq!(spawner.handles().len(), MAX_TERMINALS);
        // Closing one frees its slot and kills its process.
        hub.close(ids[0]);
        assert!(spawner.handles()[0].killed.load(Ordering::SeqCst));
        open(&hub, "0a1b2c3d").unwrap();
        assert!(open(&hub, "0a1b2c3d").is_err());
        // So does a process that ends by itself.
        spawner.handles()[1].exit();
        assert!(eventually(|| hub.len() == MAX_TERMINALS - 1));
        assert!(spawner.handles()[1].killed.load(Ordering::SeqCst), "exited process reaped");
        open(&hub, "0a1b2c3d").unwrap();
    }

    #[test]
    fn close_all_ends_every_terminal() {
        let (hub, spawner, _) = hub();
        let exits = Arc::new(Mutex::new(Vec::new()));
        let ids: Vec<u32> = (0..MAX_TERMINALS)
            .map(|_| {
                let e = exits.clone();
                hub.open("0a1b2c3d", 80, 24, Box::new(|_, _| {}), Box::new(move |id| {
                    e.lock().unwrap().push(id);
                }))
                .unwrap()
            })
            .collect();
        hub.close_all();
        assert_eq!(hub.len(), 0);
        assert!(spawner.handles().iter().all(|h| h.killed.load(Ordering::SeqCst)));
        assert!(eventually(|| exits.lock().unwrap().len() == MAX_TERMINALS), "term-exit for each");
        let mut seen = exits.lock().unwrap().clone();
        seen.sort();
        assert_eq!(seen, ids);
        for _ in 0..MAX_TERMINALS {
            open(&hub, "0a1b2c3d").unwrap();
        }
        assert!(open(&hub, "0a1b2c3d").is_err());
    }

    #[test]
    fn exit_is_reported() {
        let (hub, spawner, _) = hub();
        let exited = Arc::new(Mutex::new(None));
        let e = exited.clone();
        let id = hub
            .open("0a1b2c3d", 80, 24, Box::new(|_, _| {}), Box::new(move |id| {
                *e.lock().unwrap() = Some(id);
            }))
            .unwrap();
        spawner.handles()[0].exit();
        assert!(eventually(|| *exited.lock().unwrap() == Some(id)));
        assert_eq!(hub.existing("0a1b2c3d"), None);
        assert!(hub.write(id, b"x").is_err());
    }

    #[test]
    fn screen_reflects_output() {
        let (hub, _, clock) = hub();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let s = seen.clone();
        let id = hub
            .open("0a1b2c3d", 80, 24, Box::new(move |id, d| {
                s.lock().unwrap().push((id, d.to_vec()));
            }), Box::new(|_| {}))
            .unwrap();
        assert_eq!(hub.last_output_ms(id), None);
        hub.write(id, b"hello").unwrap();
        assert!(eventually(|| hub.screen(id).is_some_and(|s| s.contains("hello"))));
        assert_eq!(seen.lock().unwrap()[0], (id, b"hello".to_vec()));
        assert_eq!(hub.last_output_ms(id), Some(clock.now_ms()));
        hub.close(id);
        assert_eq!(hub.screen(id), None);
    }

    #[test]
    fn send_single_line() {
        let (hub, spawner, clock) = hub();
        send_message(&hub, &agent("bg", "idle"), "hi").unwrap();
        assert_eq!(spawner.handles()[0].writes(), vec!["hi", "\r"]);
        assert_eq!(*spawner.handles()[0].size.lock().unwrap(), (80, 24));
        assert!(clock.sleeps.lock().unwrap().contains(&300));
    }

    #[test]
    fn send_multiline_bracketed() {
        let (hub, spawner, _) = hub();
        send_message(&hub, &agent("bg", "working"), "a\r\nb").unwrap();
        assert_eq!(spawner.handles()[0].writes(), vec!["\x1b[200~a\nb\x1b[201~", "\r"]);
    }

    #[test]
    fn send_refused_when_waiting() {
        let (hub, spawner, _) = hub();
        let err = send_message(&hub, &agent("bg", "waiting"), "hi").unwrap_err();
        assert_eq!(err, "Answer the open prompt first");
        assert!(spawner.handles().is_empty());
    }

    #[test]
    fn send_refused_for_interactive() {
        let (hub, spawner, _) = hub();
        assert!(send_message(&hub, &agent("interactive", "idle"), "hi").is_err());
        assert!(send_message(&hub, &agent("bg", "idle"), "bad\u{7}").is_err());
        assert!(spawner.handles().is_empty());
    }

    #[test]
    fn temp_terminal_closed_after_send() {
        let (hub, spawner, clock) = hub();
        send_message(&hub, &agent("bg", "idle"), "hi").unwrap();
        assert!(eventually(|| hub.len() == 0));
        assert!(spawner.handles()[0].killed.load(Ordering::SeqCst));
        assert!(clock.sleeps.lock().unwrap().contains(&2_000));
    }

    #[test]
    fn send_reuses_open_terminal() {
        let (hub, spawner, _) = hub();
        let id = open(&hub, "0a1b2c3d").unwrap();
        send_message(&hub, &agent("bg", "idle"), "hi").unwrap();
        assert_eq!(spawner.handles().len(), 1);
        assert_eq!(spawner.handles()[0].writes(), vec!["hi", "\r"]);
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(hub.existing("0a1b2c3d"), Some(id), "the panel stays open");
    }

    #[test]
    fn send_fails_when_attach_exits() {
        let spawner = Arc::new(ExitingSpawner);
        let hub = TerminalHub::new(spawner, Arc::new(FakeClock::default()));
        assert!(send_message(&hub, &agent("bg", "idle"), "hi").is_err());
        assert_eq!(hub.len(), 0);
    }

    /// Spawns processes that end at once without output.
    struct ExitingSpawner;

    impl PtySpawner for ExitingSpawner {
        fn spawn(&self, _: &str, _: u16, _: u16) -> Result<Box<dyn PtyProcess>, String> {
            Ok(Box::new(Exiting))
        }
    }

    struct Exiting;

    impl PtyProcess for Exiting {
        fn write(&mut self, _: &[u8]) -> Result<(), String> {
            Err("closed".into())
        }
        fn resize(&mut self, _: u16, _: u16) -> Result<(), String> {
            Ok(())
        }
        fn reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
            Ok(Box::new(std::io::empty()))
        }
        fn kill(&mut self) {}
    }

    /// Attaches to a real agent. Run by hand with `SM_TEST_SHORT_ID=<id> cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn real_attach_shows_screen() {
        let short_id = std::env::var("SM_TEST_SHORT_ID").expect("SM_TEST_SHORT_ID");
        let cache = Arc::new(Mutex::new(None));
        let hub = TerminalHub::new(Arc::new(RealSpawner::new(cache)), Arc::new(SystemClock));
        let id = hub.open(&short_id, 100, 30, Box::new(|_, _| {}), Box::new(|_| {})).unwrap();
        let start = Instant::now();
        let mut screen = String::new();
        while start.elapsed() < Duration::from_secs(5) {
            screen = hub.screen(id).unwrap_or_default();
            if !screen.trim().is_empty() {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        hub.close(id);
        assert!(!screen.trim().is_empty(), "empty screen");
    }
}
