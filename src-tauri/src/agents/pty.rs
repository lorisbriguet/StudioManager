//! Terminals attached to agents (`claude attach <short id>`) and sending messages through them.

use super::cli::{spawn_env, LoginEnv};
use super::model::{Agent, Kind};
use super::validate::{clamp_size, normalise_message, valid_short_id};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicI64, Ordering};
use std::collections::HashSet;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};

pub const MAX_TERMINALS: usize = 8;
/// Pause between the text and the Enter, as a person would type.
const ENTER_AFTER_MS: u64 = 300;
/// How long a temporary terminal stays attached after the Enter, so the agent receives the line.
const TEMP_CLOSE_AFTER_MS: u64 = 2_000;
const TEMP_COLS: u16 = 80;
const TEMP_ROWS: u16 = 24;
/// A watch terminal is closed once it has not been used for this long.
pub const WATCH_IDLE_MS: i64 = 5_000;
/// A prompt opened while the message was being typed: the Enter was not sent.
pub const PROMPT_OPENED: &str =
    "Answer the open prompt first. Your message was typed but not sent: it is still in the input.";

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
    /// Returns once `now_ms()` has reached `t`, without moving time on.
    fn sleep_until_ms(&self, t: i64);
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> i64 {
        chrono::Utc::now().timestamp_millis()
    }
    fn sleep_ms(&self, ms: u64) {
        std::thread::sleep(std::time::Duration::from_millis(ms));
    }
    fn sleep_until_ms(&self, t: i64) {
        let left = t - self.now_ms();
        if left > 0 {
            self.sleep_ms(left as u64);
        }
    }
}

/// The login environment, resolved on first use and shared with `AgentsState`.
pub type LoginCache = Arc<Mutex<Option<Arc<LoginEnv>>>>;

pub fn cached_login_env(cache: &LoginCache) -> Arc<LoginEnv> {
    let mut guard = lock(cache);
    guard.get_or_insert_with(|| Arc::new(super::cli::resolve_login_env())).clone()
}

/// Like `cached_login_env`, but looks again when the cached lookup found no `claude`, so
/// installing Claude Code then reopening the settings card is enough.
pub fn fresh_login_env(cache: &LoginCache) -> Arc<LoginEnv> {
    refresh_login_env(cache, &super::cli::resolve_login_env)
}

fn refresh_login_env(cache: &LoginCache, resolve: &dyn Fn() -> LoginEnv) -> Arc<LoginEnv> {
    let mut guard = lock(cache);
    match guard.as_ref() {
        Some(env) if env.claude.is_some() => env.clone(),
        _ => guard.insert(Arc::new(resolve())).clone(),
    }
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
    /// Opened for one send or answer, or as a watch terminal; never handed out by `existing`.
    temporary: bool,
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
    /// Short ids being sent to or answered; see `lock_agent`.
    busy: Mutex<HashSet<String>>,
    freed: Condvar,
    /// Watch terminals by short id; see `watch`.
    watches: Mutex<HashMap<String, Watch>>,
}

/// A hidden terminal kept attached while an agent's prompt is being read.
struct Watch {
    term_id: u32,
    /// Epoch ms of the latest read or answer through it.
    last_used: i64,
}

/// Holds an agent for one send, prompt read or answer; released on drop. Can be moved to the
/// thread that closes a temporary terminal, so the agent stays held until it is closed.
pub struct AgentGuard {
    hub: TerminalHub,
    short_id: String,
}

impl Drop for AgentGuard {
    fn drop(&mut self) {
        lock(&self.hub.inner.busy).remove(&self.short_id);
        self.hub.inner.freed.notify_all();
    }
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
        Self {
            inner: Arc::new(Inner {
                spawner,
                clock,
                terms: Mutex::default(),
                busy: Mutex::default(),
                freed: Condvar::new(),
                watches: Mutex::default(),
            }),
        }
    }

    /// Waits until no other send, prompt read or answer holds `short_id`, then holds it.
    pub fn lock_agent(&self, short_id: &str) -> AgentGuard {
        let mut busy = lock(&self.inner.busy);
        while busy.contains(short_id) {
            busy = self.inner.freed.wait(busy).unwrap_or_else(|e| e.into_inner());
        }
        busy.insert(short_id.to_string());
        AgentGuard { hub: self.clone(), short_id: short_id.to_string() }
    }

    fn get(&self, term_id: u32) -> Option<Arc<Term>> {
        lock(&self.inner.terms).live.get(&term_id).cloned()
    }

    fn forget(&self, term_id: u32) -> Option<Arc<Term>> {
        lock(&self.inner.terms).live.remove(&term_id)
    }

    pub fn clock(&self) -> Arc<dyn Clock> {
        self.inner.clock.clone()
    }

    /// Number of live terminals.
    #[allow(dead_code)] // used by tests
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
        self.open_term(short_id, cols, rows, on_data, on_exit, false)
    }

    /// Attaches a terminal for one send, answer or watch: `existing` never returns it.
    pub fn open_temporary(&self, short_id: &str, cols: u16, rows: u16) -> Result<u32, String> {
        self.open_term(short_id, cols, rows, Box::new(|_, _| {}), Box::new(|_| {}), true)
    }

    fn open_term(
        &self,
        short_id: &str,
        cols: u16,
        rows: u16,
        on_data: OnData,
        on_exit: OnExit,
        temporary: bool,
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
            temporary,
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

    /// A terminal the webview opened (`open`), for its keys and size. Temporary terminals are
    /// refused: only `send_message` and `prompt::choose` write to them, after their checks.
    fn panel(&self, term_id: u32) -> Result<Arc<Term>, String> {
        self.get(term_id).filter(|t| !t.temporary).ok_or_else(|| "Terminal closed".to_string())
    }

    /// `write`, for `agents_term_write`: refuses temporary terminals.
    pub fn panel_write(&self, term_id: u32, data: &[u8]) -> Result<(), String> {
        self.panel(term_id)?;
        self.write(term_id, data)
    }

    /// `resize`, for `agents_term_resize`: refuses temporary terminals.
    pub fn panel_resize(&self, term_id: u32, cols: u16, rows: u16) -> Result<(), String> {
        self.panel(term_id)?;
        self.resize(term_id, cols, rows)
    }

    /// Kills and reaps the process; unknown ids are ignored.
    pub fn close(&self, term_id: u32) {
        if let Some(term) = self.forget(term_id) {
            term.end();
        }
    }

    /// Closes every terminal (Agents switched off). Each reader thread still runs its `on_exit`.
    pub fn close_all(&self) {
        lock(&self.inner.watches).clear();
        let terms: Vec<Arc<Term>> = lock(&self.inner.terms).live.drain().map(|(_, t)| t).collect();
        for term in terms {
            term.end();
        }
    }

    /// The agent's live watch terminal, if any. The caller holds the agent (`lock_agent`).
    pub fn watching(&self, short_id: &str) -> Option<u32> {
        let id = lock(&self.inner.watches).get(short_id).map(|w| w.term_id)?;
        self.get(id).map(|_| id)
    }

    /// The agent's watch terminal: a temporary terminal (never handed out by `existing`) reused
    /// by every prompt read, so reading every 2 s does not attach and detach every 2 s. It is
    /// closed `WATCH_IDLE_MS` after its last use (`touch_watch`). The caller holds the agent.
    pub fn watch(&self, short_id: &str, cols: u16, rows: u16) -> Result<u32, String> {
        if let Some(id) = self.watching(short_id) {
            return Ok(id);
        }
        let id = self.open_temporary(short_id, cols, rows)?;
        let last_used = self.inner.clock.now_ms();
        lock(&self.inner.watches).insert(short_id.to_string(), Watch { term_id: id, last_used });
        let hub = self.clone();
        let short_id = short_id.to_string();
        std::thread::spawn(move || hub.close_when_idle(&short_id, id));
        Ok(id)
    }

    /// Marks the agent's watch terminal as used now.
    pub fn touch_watch(&self, short_id: &str) {
        let now = self.inner.clock.now_ms();
        if let Some(w) = lock(&self.inner.watches).get_mut(short_id) {
            w.last_used = now;
        }
    }

    /// Watch thread: closes watch terminal `id` once idle, unless another watch replaced it.
    fn close_when_idle(&self, short_id: &str, id: u32) {
        let clock = self.inner.clock.clone();
        let last_used = |w: &HashMap<String, Watch>| {
            w.get(short_id).filter(|w| w.term_id == id).map(|w| w.last_used)
        };
        loop {
            let Some(last) = last_used(&lock(&self.inner.watches)) else { return };
            clock.sleep_until_ms(last + WATCH_IDLE_MS);
            // Not while a read or answer is using it.
            let _held = self.lock_agent(short_id);
            let mut watches = lock(&self.inner.watches);
            let Some(last) = last_used(&watches) else { return };
            if clock.now_ms() - last >= WATCH_IDLE_MS {
                watches.remove(short_id);
                drop(watches);
                self.close(id);
                return;
            }
        }
    }

    /// The most recently opened live terminal attached to `short_id`, temporary ones excepted.
    pub fn existing(&self, short_id: &str) -> Option<u32> {
        let t = lock(&self.inner.terms);
        t.live
            .iter()
            .filter(|(_, term)| term.short_id == short_id && !term.temporary)
            .map(|(id, _)| *id)
            .max()
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

/// Pastes `text` into a background agent, then presses Enter. An open terminal
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
    let payload = paste_payload(&text);

    let guard = hub.lock_agent(short_id);
    if let Some(id) = hub.existing(short_id) {
        refuse_if_prompt(hub, id)?;
        return type_line(hub, id, &payload);
    }

    let id = hub.open_temporary(short_id, TEMP_COLS, TEMP_ROWS)?;
    if let Err(e) = refuse_if_prompt(hub, id).and_then(|_| type_line(hub, id, &payload)) {
        hub.close(id);
        return Err(e);
    }
    let hub = hub.clone();
    std::thread::spawn(move || {
        hub.inner.clock.sleep_ms(TEMP_CLOSE_AFTER_MS);
        hub.close(id);
        drop(guard);
    });
    Ok(())
}

/// The message as one bracketed paste that Claude Code takes as plain text.
///
/// Never typed as keys: a Tab would trigger completion. A paste alone is not enough either
/// (checked against Claude Code 2.1): a leading `!` still switches the input to shell mode
/// and a leading `/` opens the slash-command menu, so the Enter would run "!rm …" in the
/// agent's folder or "/clear" its context. A space in front makes both plain text. A last
/// word starting with `@` opens the file menu, which would take the Enter: a space after it
/// closes the menu. `normalise_message` refused control characters, so the text cannot end
/// the paste early.
fn paste_payload(text: &str) -> String {
    let lead = if text.starts_with(['!', '/']) { " " } else { "" };
    let mention_last = text.rsplit(char::is_whitespace).next().is_some_and(|w| w.starts_with('@'));
    let trail = if mention_last { " " } else { "" };
    format!("\x1b[200~{lead}{text}{trail}\x1b[201~")
}

/// The CLI's status can lag: a prompt that opened since would take the typed text as an answer.
fn refuse_if_prompt(hub: &TerminalHub, id: u32) -> Result<(), String> {
    let screen = super::prompt::settled_screen(hub, id, 0)?;
    if super::prompt::parse_prompt(&screen).is_some() {
        return Err("Answer the open prompt first".into());
    }
    Ok(())
}

/// Writes the text, then the Enter 300 ms later, unless a prompt has opened meanwhile.
///
/// Invariant: only `prompt::choose` presses Enter on a prompt. A prompt that opened between
/// `refuse_if_prompt` and here would take this Enter as confirming its highlighted option
/// (often "Yes"), so the screen is read again right before it.
fn type_line(hub: &TerminalHub, id: u32, payload: &str) -> Result<(), String> {
    let since = hub.inner.clock.now_ms();
    hub.write(id, payload.as_bytes())?;
    hub.inner.clock.sleep_ms(ENTER_AFTER_MS);
    let screen = super::prompt::settled_screen(hub, id, since)?;
    if super::prompt::parse_prompt(&screen).is_some() {
        return Err(PROMPT_OPENED.into());
    }
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

pub(super) async fn blocking<T: Send + 'static>(
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
    let login = super::actions::ready(&state)?;
    let hub = state.hub.clone();
    let data_app = app.clone();
    let on_data: OnData = Box::new(move |term_id, bytes| {
        let data = base64::engine::general_purpose::STANDARD.encode(bytes);
        let _ = data_app.emit(TERM_EVENT, TermData { term_id, data });
    });
    let on_exit: OnExit = Box::new(move |term_id| {
        let _ = app.emit(TERM_EXIT_EVENT, TermExit { term_id });
    });
    blocking(move || {
        super::actions::cli(&login)?;
        hub.open(&short_id, cols, rows, on_data, on_exit)
    })
    .await
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
    blocking(move || hub.panel_write(term_id, data.as_bytes())).await
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
    blocking(move || hub.panel_resize(term_id, cols, rows)).await
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
    let login = super::actions::ready(&state)?;
    let hub = state.hub.clone();
    let cache = state.cached();
    blocking(move || {
        let cli = super::actions::cli(&login)?;
        let agent = super::actions::find_agent_cached(&cli, &cache, &session_id)?;
        send_message(&hub, &agent, &text)
    })
    .await
}

#[cfg(test)]
pub(super) mod tests {
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
    pub(in crate::agents) struct FakeClock {
        pub(in crate::agents) now: AtomicI64,
        pub(in crate::agents) sleeps: Mutex<Vec<u64>>,
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
        fn sleep_until_ms(&self, t: i64) {
            // Time moves only when a test or another sleeper moves it.
            while self.now_ms() < t {
                std::thread::sleep(Duration::from_millis(2));
            }
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
    pub(in crate::agents) fn eventually(f: impl Fn() -> bool) -> bool {
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
    fn login_env_looked_up_again_only_while_claude_missing() {
        let cache = LoginCache::default();
        let calls = std::sync::atomic::AtomicUsize::new(0);
        let found = std::cell::Cell::new(false);
        let resolve = || {
            calls.fetch_add(1, Ordering::SeqCst);
            let claude = found.get().then(|| std::path::PathBuf::from("/opt/x/claude"));
            LoginEnv { claude, path: "/usr/bin".into(), vars: vec![] }
        };
        assert_eq!(refresh_login_env(&cache, &resolve).claude, None);
        assert_eq!(refresh_login_env(&cache, &resolve).claude, None);
        assert_eq!(calls.load(Ordering::SeqCst), 2, "missing: looked up again");
        found.set(true); // Claude Code installed meanwhile
        assert!(refresh_login_env(&cache, &resolve).claude.is_some());
        assert!(refresh_login_env(&cache, &resolve).claude.is_some());
        assert_eq!(calls.load(Ordering::SeqCst), 3, "found: cached");
        assert!(cached_login_env(&cache).claude.is_some(), "shared with the cached lookup");
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

    /// The webview may only type into and resize the panels it opened: a temporary terminal
    /// (one send, one answer, a watch) belongs to the code that checks the prompt before Enter.
    #[test]
    fn panel_write_to_temporary_terminal_refused() {
        let (hub, spawner, _) = hub();
        let temp = hub.open_temporary("0a1b2c3d", 80, 24).unwrap();
        let watch = hub.watch("11111111", 80, 24).unwrap();
        for id in [temp, watch] {
            assert!(hub.panel_write(id, b"\r").is_err());
            assert!(hub.panel_resize(id, 100, 30).is_err());
        }
        assert!(spawner.handles().iter().all(|h| h.writes().is_empty()), "nothing written");
        assert!(spawner.handles().iter().all(|h| *h.size.lock().unwrap() == (80, 24)));
        // The panel's own terminal still takes keys and sizes.
        let panel = open(&hub, "0a1b2c3d").unwrap();
        hub.panel_write(panel, b"x").unwrap();
        hub.panel_resize(panel, 100, 30).unwrap();
        let h = &spawner.handles()[2];
        assert_eq!(h.writes(), vec!["x"]);
        assert_eq!(*h.size.lock().unwrap(), (100, 30));
        assert!(hub.panel_write(999, b"x").is_err(), "unknown id");
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
        assert_eq!(spawner.handles()[0].writes(), vec!["\x1b[200~hi\x1b[201~", "\r"]);
        assert_eq!(*spawner.handles()[0].size.lock().unwrap(), (80, 24));
        assert!(clock.sleeps.lock().unwrap().contains(&300));
    }

    /// Typed as keys (or pasted as is), a leading `!` would switch Claude Code to shell mode
    /// and `/` would run a slash command: every message goes in as one plain-text paste, then
    /// the Enter on its own.
    #[test]
    fn send_bang_and_slash_as_bracketed_paste() {
        for (text, pasted) in [
            // A leading space keeps Claude Code out of shell mode and the slash-command menu.
            ("!ls", "\x1b[200~ !ls\x1b[201~"),
            ("/clear", "\x1b[200~ /clear\x1b[201~"),
            ("/clear\nmore", "\x1b[200~ /clear\nmore\x1b[201~"),
            // Already plain text: unchanged.
            (" /clear", "\x1b[200~ /clear\x1b[201~"),
            ("a !b /c", "\x1b[200~a !b /c\x1b[201~"),
            ("a\tb", "\x1b[200~a\tb\x1b[201~"),
            // A trailing @word would open the file menu and take the Enter.
            ("see @notes", "\x1b[200~see @notes \x1b[201~"),
            ("@a b", "\x1b[200~@a b\x1b[201~"),
        ] {
            let (hub, spawner, _) = hub();
            send_message(&hub, &agent("bg", "idle"), text).unwrap();
            assert_eq!(spawner.handles()[0].writes(), vec![pasted, "\r"], "{text:?}");
        }
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
    fn send_refused_when_prompt_in_open_panel() {
        // The CLI still says idle, but the panel shows a prompt.
        let (hub, spawner, _) = hub();
        let id = open(&hub, "0a1b2c3d").unwrap();
        hub.write(id, "──────────\r\nDo you want to proceed?\r\n❯ 1. Yes\r\n  2. No\r\n".as_bytes()).unwrap();
        assert!(eventually(|| hub.screen(id).is_some_and(|s| s.contains("2. No"))));
        spawner.handles()[0].writes.lock().unwrap().clear();
        let err = send_message(&hub, &agent("bg", "idle"), "1").unwrap_err();
        assert_eq!(err, "Answer the open prompt first");
        assert!(spawner.handles()[0].writes().is_empty());
        assert_eq!(hub.existing("0a1b2c3d"), Some(id), "the panel stays open");
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
        assert_eq!(spawner.handles()[0].writes(), vec!["\x1b[200~hi\x1b[201~", "\r"]);
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
