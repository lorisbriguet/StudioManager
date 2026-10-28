//! Reading the prompt a background agent waits on, and answering it by moving Claude's pointer.
//!
//! Answering only ever sends arrow keys and, once the re-read screen shows the chosen option
//! highlighted, a single Enter. Digit keys are never sent: in Claude Code a digit selects and
//! confirms in one keystroke, which would skip that check.

use super::actions::fetch_agents;
use super::cli::Cli;
use super::model::Kind;
use super::pty::TerminalHub;
use super::validate::valid_short_id;
use serde::Serialize;

const CHANGED: &str = "The prompt changed";
const NOT_SELECTED: &str = "Could not select that option; use the terminal";
const UP: &[u8] = b"\x1b[A";
const DOWN: &[u8] = b"\x1b[B";
/// The screen counts as settled after this long without output...
const QUIET_MS: i64 = 400;
/// ...or once this long has passed in any case.
const SETTLE_MAX_MS: i64 = 3_000;
const POLL_MS: u64 = 50;
/// Pause between two arrow keys, so the TUI reads them as separate keys.
const KEY_GAP_MS: u64 = 50;
/// How long a temporary terminal stays attached after the Enter, so the agent receives it.
const TEMP_CLOSE_AFTER_MS: u64 = 1_000;
/// Wide and tall enough that option labels rarely wrap.
const TEMP_COLS: u16 = 120;
const TEMP_ROWS: u16 = 40;
/// Lines allowed between two options: an option's description, or a rule.
const MAX_GAP_LINES: usize = 3;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PromptOption {
    pub number: u8,
    pub label: String,
    pub selected: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Prompt {
    pub question: String,
    pub options: Vec<PromptOption>,
}

fn is_box_drawing(c: char) -> bool {
    ('\u{2500}'..='\u{257F}').contains(&c)
}

/// The line without box borders and surrounding spaces.
fn strip(line: &str) -> &str {
    line.trim_matches(|c: char| c.is_whitespace() || is_box_drawing(c))
}

/// `<pointer?> <n>. <label>`, with n from 1 to 9.
fn option_line(line: &str) -> Option<PromptOption> {
    let s = strip(line);
    let (selected, rest) = match s.strip_prefix('❯').or_else(|| s.strip_prefix('>')) {
        Some(r) => (true, r.trim_start()),
        None => (false, s),
    };
    let mut chars = rest.chars();
    let number = chars.next()?.to_digit(10).filter(|&d| d > 0)? as u8;
    let label = chars.as_str().strip_prefix('.')?;
    if !label.starts_with(char::is_whitespace) {
        return None;
    }
    let label = label.trim();
    (!label.is_empty()).then(|| PromptOption { number, label: label.to_string(), selected })
}

type Run = (usize, Vec<PromptOption>);

/// Keeps `run` as the latest candidate if it has 2-9 options.
fn finish(run: &mut Option<Run>, last: &mut Option<Run>) {
    if let Some(r) = run.take() {
        if (2..=9).contains(&r.1.len()) {
            *last = Some(r);
        }
    }
}

/// The prompt at the bottom of the screen: the last run of 2-9 options numbered 1, 2, 3...,
/// exactly one of them carrying the pointer. Up to three non-blank lines (an option's
/// description, a rule) may sit between two options.
pub fn parse_prompt(screen: &str) -> Option<Prompt> {
    let lines: Vec<&str> = screen.lines().collect();
    // (index of the first option's line, options)
    let mut last: Option<Run> = None;
    let mut run: Option<Run> = None;
    let mut gap = 0;
    for (i, line) in lines.iter().enumerate() {
        if let Some(opt) = option_line(line) {
            if let Some((_, opts)) = run.as_mut() {
                if opt.number as usize == opts.len() + 1 {
                    opts.push(opt);
                    gap = 0;
                    continue;
                }
            }
            finish(&mut run, &mut last);
            if opt.number == 1 {
                run = Some((i, vec![opt]));
                gap = 0;
            }
        } else if run.is_some() {
            gap += 1;
            if line.trim().is_empty() || gap > MAX_GAP_LINES {
                finish(&mut run, &mut last);
            }
        }
    }
    finish(&mut run, &mut last);

    let (first, options) = last?;
    if options.iter().filter(|o| o.selected).count() != 1 {
        return None;
    }
    let question = lines[..first]
        .iter()
        .rev()
        .map(|l| strip(l))
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .to_string();
    Some(Prompt { question, options })
}

/// The screen once output has paused for 400 ms (giving up waiting after 3 s), counting only
/// output from `since` (epoch ms) on.
fn settled_screen(hub: &TerminalHub, id: u32, since: i64) -> Result<String, String> {
    let clock = hub.clock();
    let start = clock.now_ms();
    loop {
        let now = clock.now_ms();
        let quiet = hub.last_output_ms(id).is_some_and(|t| t >= since && now - t >= QUIET_MS);
        let screen = hub.screen(id).ok_or("Could not attach to the agent")?;
        if quiet || now - start >= SETTLE_MAX_MS {
            return Ok(screen);
        }
        clock.sleep_ms(POLL_MS);
    }
}

/// The agent's open terminal, or a new temporary one (`true`).
fn attach(hub: &TerminalHub, short_id: &str) -> Result<(u32, bool), String> {
    if !valid_short_id(short_id) {
        return Err("Invalid agent id".into());
    }
    match hub.existing(short_id) {
        Some(id) => Ok((id, false)),
        None => {
            let id =
                hub.open(short_id, TEMP_COLS, TEMP_ROWS, Box::new(|_, _| {}), Box::new(|_| {}))?;
            Ok((id, true))
        }
    }
}

/// The prompt the agent waits on, if any.
pub fn read_prompt(hub: &TerminalHub, short_id: &str) -> Result<Option<Prompt>, String> {
    let (id, temp) = attach(hub, short_id)?;
    let screen = settled_screen(hub, id, 0);
    if temp {
        hub.close(id);
    }
    Ok(parse_prompt(&screen?))
}

/// Chooses option `number`, provided it still reads `expected_label`: moves the pointer with
/// arrow keys, re-reads the screen, and presses Enter only if that option is now highlighted.
pub fn answer(
    hub: &TerminalHub,
    short_id: &str,
    number: u8,
    expected_label: &str,
) -> Result<(), String> {
    let (id, temp) = attach(hub, short_id)?;
    let result = choose(hub, id, number, expected_label);
    if temp {
        if result.is_ok() {
            let hub = hub.clone();
            std::thread::spawn(move || {
                hub.clock().sleep_ms(TEMP_CLOSE_AFTER_MS);
                hub.close(id);
            });
        } else {
            hub.close(id);
        }
    }
    result
}

fn choose(hub: &TerminalHub, id: u32, number: u8, expected_label: &str) -> Result<(), String> {
    let clock = hub.clock();
    let prompt = parse_prompt(&settled_screen(hub, id, 0)?).ok_or(CHANGED)?;
    if !prompt.options.iter().any(|o| o.number == number && o.label == expected_label) {
        return Err(CHANGED.into());
    }
    let current = prompt.options.iter().find(|o| o.selected).map(|o| o.number).ok_or(CHANGED)?;
    let key = if number > current { DOWN } else { UP };
    let moves = number.abs_diff(current);
    // No key, no new output to wait for: settle on what is there.
    let since = if moves == 0 { 0 } else { clock.now_ms() };
    for i in 0..moves {
        if i > 0 {
            clock.sleep_ms(KEY_GAP_MS);
        }
        hub.write(id, key)?;
    }
    let highlighted = parse_prompt(&settled_screen(hub, id, since)?).is_some_and(|p| {
        p.options.iter().any(|o| o.number == number && o.label == expected_label && o.selected)
    });
    if !highlighted {
        return Err(NOT_SELECTED.into());
    }
    hub.write(id, b"\r")
}

/// Prompts are read and answered for background agents only.
fn require_background(cli: &dyn Cli, short_id: &str) -> Result<(), String> {
    if !valid_short_id(short_id) {
        return Err("Invalid agent id".into());
    }
    let agent = fetch_agents(cli)?
        .into_iter()
        .find(|a| a.short_id.as_deref() == Some(short_id))
        .ok_or("Agent not found")?;
    if agent.kind != Kind::Background {
        return Err("Only background agents can be answered here".into());
    }
    Ok(())
}

// ---------------------------------------------------------------- commands

#[tauri::command]
pub async fn agents_prompt(
    state: tauri::State<'_, super::AgentsState>,
    short_id: String,
) -> Result<Option<Prompt>, String> {
    let cli = super::actions::ready(&state)?;
    let hub = state.hub.clone();
    super::pty::blocking(move || {
        require_background(&cli, &short_id)?;
        read_prompt(&hub, &short_id)
    })
    .await
}

#[tauri::command]
pub async fn agents_answer(
    state: tauri::State<'_, super::AgentsState>,
    short_id: String,
    number: u8,
    label: String,
) -> Result<(), String> {
    let cli = super::actions::ready(&state)?;
    let hub = state.hub.clone();
    super::pty::blocking(move || {
        require_background(&cli, &short_id)?;
        answer(&hub, &short_id, number, &label)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::pty::tests::{eventually, FakeClock};
    use crate::agents::pty::{PtyProcess, PtySpawner};
    use std::io::Read;
    use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
    use std::sync::mpsc::{channel, Receiver, Sender};
    use std::sync::{Arc, Mutex};

    const PERMISSION: &str = include_str!("../../tests/fixtures/agents/prompt-permission.txt");
    const CHOICE: &str = include_str!("../../tests/fixtures/agents/prompt-choice.txt");
    const NONE: &str = include_str!("../../tests/fixtures/agents/prompt-none.txt");

    fn opt(number: u8, label: &str, selected: bool) -> PromptOption {
        PromptOption { number, label: label.into(), selected }
    }

    #[test]
    fn parses_permission_prompt() {
        let p = parse_prompt(PERMISSION).expect("prompt");
        assert_eq!(p.question, "Do you want to proceed?");
        assert_eq!(
            p.options,
            vec![
                opt(1, "Yes", true),
                opt(2, "Yes, and always allow access to /tmp/sm-agents-fixture from this project", false),
                opt(3, "Yes, and switch to auto mode · auto mode handles these prompts for you", false),
                opt(4, "No", false),
            ]
        );
    }

    #[test]
    fn parses_choice_prompt() {
        // Descriptions under each option and the rule above option 5 do not break the run.
        let p = parse_prompt(CHOICE).expect("prompt");
        assert_eq!(p.question, "Which colour should the demo use?");
        assert_eq!(
            p.options,
            vec![
                opt(1, "Red", true),
                opt(2, "Green", false),
                opt(3, "Blue", false),
                opt(4, "Type something.", false),
                opt(5, "Chat about this", false),
            ]
        );
    }

    #[test]
    fn none_when_no_prompt() {
        assert_eq!(parse_prompt(NONE), None);
        assert_eq!(parse_prompt(""), None);
        // A numbered list in the agent's reply has no pointer.
        assert_eq!(parse_prompt("Steps:\n1. Build\n2. Test\n"), None);
    }

    #[test]
    fn none_when_two_selected() {
        assert_eq!(parse_prompt("Pick one\n❯ 1. Yes\n❯ 2. No\n"), None);
    }

    #[test]
    fn tolerates_borders_and_ascii_pointer() {
        let screen = "╭──────────────╮\n│ Proceed?     │\n│ > 1. Yes     │\n│   2. No      │\n╰──────────────╯\n";
        let p = parse_prompt(screen).expect("prompt");
        assert_eq!(p.question, "Proceed?");
        assert_eq!(p.options, vec![opt(1, "Yes", true), opt(2, "No", false)]);
    }

    #[test]
    fn single_option_is_not_a_prompt() {
        assert_eq!(parse_prompt("Proceed?\n❯ 1. Yes\n"), None);
    }

    // ------------------------------------------------------------ answering

    /// A fake `claude attach`: shows `first`, and `after_down` once it receives an arrow down.
    struct ScriptSpawner {
        first: String,
        after_down: Option<String>,
        writes: Arc<Mutex<Vec<String>>>,
        killed: Arc<AtomicBool>,
    }

    fn draw(screen: &str) -> Vec<u8> {
        format!("\x1b[2J\x1b[H{}", screen.replace('\n', "\r\n")).into_bytes()
    }

    impl PtySpawner for ScriptSpawner {
        fn spawn(&self, _: &str, _: u16, _: u16) -> Result<Box<dyn PtyProcess>, String> {
            let (tx, rx) = channel();
            tx.send(draw(&self.first)).unwrap();
            Ok(Box::new(ScriptProc {
                after_down: self.after_down.clone(),
                writes: self.writes.clone(),
                killed: self.killed.clone(),
                tx: Mutex::new(Some(tx)),
                rx: Some(rx),
            }))
        }
    }

    struct ScriptProc {
        after_down: Option<String>,
        writes: Arc<Mutex<Vec<String>>>,
        killed: Arc<AtomicBool>,
        tx: Mutex<Option<Sender<Vec<u8>>>>,
        rx: Option<Receiver<Vec<u8>>>,
    }

    struct ChannelReader(Receiver<Vec<u8>>, Vec<u8>);

    impl Read for ChannelReader {
        fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
            if self.1.is_empty() {
                match self.0.recv() {
                    Ok(b) => self.1 = b,
                    Err(_) => return Ok(0),
                }
            }
            let n = out.len().min(self.1.len());
            out[..n].copy_from_slice(&self.1[..n]);
            self.1.drain(..n);
            Ok(n)
        }
    }

    impl PtyProcess for ScriptProc {
        fn write(&mut self, data: &[u8]) -> Result<(), String> {
            self.writes.lock().unwrap().push(String::from_utf8_lossy(data).into_owned());
            if data == b"\x1b[B" {
                if let (Some(next), Some(tx)) = (&self.after_down, self.tx.lock().unwrap().as_ref()) {
                    let _ = tx.send(draw(next));
                }
            }
            Ok(())
        }
        fn resize(&mut self, _: u16, _: u16) -> Result<(), String> {
            Ok(())
        }
        fn reader(&mut self) -> Result<Box<dyn Read + Send>, String> {
            Ok(Box::new(ChannelReader(self.rx.take().ok_or("taken")?, vec![])))
        }
        fn kill(&mut self) {
            self.killed.store(true, Ordering::SeqCst);
            self.tx.lock().unwrap().take();
        }
    }

    const FIRST: &str = "Do you want to proceed?\n❯ 1. Yes\n  2. No\n";
    const MOVED: &str = "Do you want to proceed?\n  1. Yes\n❯ 2. No\n";

    fn hub(after_down: Option<&str>) -> (TerminalHub, Arc<Mutex<Vec<String>>>, Arc<AtomicBool>) {
        let writes = Arc::new(Mutex::new(vec![]));
        let killed = Arc::new(AtomicBool::new(false));
        let spawner = ScriptSpawner {
            first: FIRST.into(),
            after_down: after_down.map(String::from),
            writes: writes.clone(),
            killed: killed.clone(),
        };
        let clock = Arc::new(FakeClock { now: AtomicI64::new(1_000), ..Default::default() });
        (TerminalHub::new(Arc::new(spawner), clock), writes, killed)
    }

    #[test]
    fn answer_moves_then_confirms() {
        let (hub, writes, killed) = hub(Some(MOVED));
        answer(&hub, "0a1b2c3d", 2, "No").unwrap();
        assert_eq!(*writes.lock().unwrap(), vec!["\x1b[B", "\r"]);
        assert!(eventually(|| hub.len() == 0), "temporary terminal closed");
        assert!(killed.load(Ordering::SeqCst));
    }

    #[test]
    fn answer_selected_option_sends_only_enter() {
        let (hub, writes, _) = hub(None);
        answer(&hub, "0a1b2c3d", 1, "Yes").unwrap();
        assert_eq!(*writes.lock().unwrap(), vec!["\r"]);
    }

    #[test]
    fn answer_refuses_when_label_changed() {
        let (hub, writes, _) = hub(Some(MOVED));
        assert_eq!(answer(&hub, "0a1b2c3d", 2, "Maybe").unwrap_err(), "The prompt changed");
        assert_eq!(answer(&hub, "0a1b2c3d", 3, "No").unwrap_err(), "The prompt changed");
        assert!(writes.lock().unwrap().is_empty());
    }

    #[test]
    fn answer_never_enters_when_selection_did_not_move() {
        let (hub, writes, _) = hub(None);
        let err = answer(&hub, "0a1b2c3d", 2, "No").unwrap_err();
        assert_eq!(err, "Could not select that option; use the terminal");
        assert_eq!(*writes.lock().unwrap(), vec!["\x1b[B"]);
        assert!(eventually(|| hub.len() == 0), "temporary terminal closed");
    }

    #[test]
    fn read_prompt_through_temporary_terminal() {
        let (hub, writes, killed) = hub(None);
        let p = read_prompt(&hub, "0a1b2c3d").unwrap().expect("prompt");
        assert_eq!(p.options, vec![opt(1, "Yes", true), opt(2, "No", false)]);
        assert!(writes.lock().unwrap().is_empty());
        assert_eq!(hub.len(), 0);
        assert!(killed.load(Ordering::SeqCst));
        assert!(read_prompt(&hub, "nope").is_err());
    }

    #[test]
    fn answer_reuses_open_terminal() {
        let (hub, writes, _) = hub(Some(MOVED));
        let id = hub.open("0a1b2c3d", 80, 24, Box::new(|_, _| {}), Box::new(|_| {})).unwrap();
        answer(&hub, "0a1b2c3d", 2, "No").unwrap();
        assert_eq!(*writes.lock().unwrap(), vec!["\x1b[B", "\r"]);
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert_eq!(hub.existing("0a1b2c3d"), Some(id), "the panel stays open");
    }
}
