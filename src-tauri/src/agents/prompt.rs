//! Reading the prompt a background agent waits on, and answering it by moving Claude's pointer.
//!
//! Answering only ever sends arrow keys and, once the re-read screen shows the chosen option
//! highlighted, a single Enter. Digit keys are never sent: in Claude Code a digit selects and
//! confirms in one keystroke, which would skip that check.

use super::actions::fetch_agents;
use super::cli::Cli;
use super::model::{Agent, Kind};
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
/// How far above the options to look for the rule that opens the prompt block.
const MAX_BLOCK_LINES: usize = 20;
/// Non-blank lines allowed below the last option: a footer, a rule with the agent's name.
const MAX_TRAILING_LINES: usize = 3;

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
    /// What the prompt is about (the command, the file...): the block's lines above the question.
    pub detail: String,
    pub options: Vec<PromptOption>,
    /// The whole block, from the rule that opens it through the last option, with borders,
    /// pointer and spacing normalised. Two different prompts with the same options differ here;
    /// moving the pointer does not change it.
    pub fingerprint: String,
}

fn is_box_drawing(c: char) -> bool {
    ('\u{2500}'..='\u{257F}').contains(&c)
}

/// The line without box borders and surrounding spaces.
fn strip(line: &str) -> &str {
    line.trim_matches(|c: char| c.is_whitespace() || is_box_drawing(c))
}

/// A full-width solid rule or a box's top edge: where a prompt block begins.
/// (Dashed rules, `╌╌╌`, sit inside permission prompts.)
fn is_block_top(line: &str) -> bool {
    let t = line.trim();
    t.chars().count() >= 3 && t.chars().all(|c| matches!(c, '─' | '━' | '╭' | '╮' | '┌' | '┐'))
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

/// A run of options: the indexes of its first and last option lines, and the options.
struct Run {
    first: usize,
    last: usize,
    options: Vec<PromptOption>,
}

/// Keeps `run` as the latest candidate if it has 2-9 options.
fn finish(run: &mut Option<Run>, found: &mut Option<Run>) {
    if let Some(r) = run.take() {
        if (2..=9).contains(&r.options.len()) {
            *found = Some(r);
        }
    }
}

/// Whether the run ending at line `last` sits at the bottom of the screen: no solid rule, no
/// pointer line (Claude's input box shows `❯` when no prompt is open) and at most
/// `MAX_TRAILING_LINES` non-blank lines (a footer such as `Esc to cancel`) below it. A numbered
/// message higher up in the conversation is followed by the input box, so it never qualifies.
fn at_bottom(lines: &[&str], last: usize) -> bool {
    let below: Vec<&str> =
        lines[last + 1..].iter().copied().filter(|l| !l.trim().is_empty()).collect();
    below.len() <= MAX_TRAILING_LINES
        && !below.iter().any(|l| is_block_top(l) || strip(l).starts_with('❯'))
}

/// The prompt at the bottom of the screen: the last run of 2-9 options numbered 1, 2, 3...,
/// exactly one of them carrying the pointer. Up to three non-blank lines (an option's
/// description, a rule) may sit between two options. The run must be the last thing on screen
/// (see `at_bottom`) and the rule opening its block must be within `MAX_BLOCK_LINES` above it;
/// otherwise there is no prompt to answer here, and the terminal is the place to look.
pub fn parse_prompt(screen: &str) -> Option<Prompt> {
    let lines: Vec<&str> = screen.lines().collect();
    let mut found: Option<Run> = None;
    let mut run: Option<Run> = None;
    let mut gap = 0;
    for (i, line) in lines.iter().enumerate() {
        if let Some(opt) = option_line(line) {
            if let Some(r) = run.as_mut() {
                if opt.number as usize == r.options.len() + 1 {
                    r.options.push(opt);
                    r.last = i;
                    gap = 0;
                    continue;
                }
            }
            finish(&mut run, &mut found);
            if opt.number == 1 {
                run = Some(Run { first: i, last: i, options: vec![opt] });
                gap = 0;
            }
        } else if run.is_some() {
            gap += 1;
            if line.trim().is_empty() || gap > MAX_GAP_LINES {
                finish(&mut run, &mut found);
            }
        }
    }
    finish(&mut run, &mut found);

    let Run { first, last, options } = found?;
    if options.iter().filter(|o| o.selected).count() != 1 || !at_bottom(&lines, last) {
        return None;
    }
    // A block whose top is out of reach would be shown and fingerprinted only in part.
    let floor = first.saturating_sub(MAX_BLOCK_LINES);
    let top = (floor..first).rev().find(|&i| is_block_top(lines[i]))? + 1;
    let question_at = (top..first).rev().find(|&i| !strip(lines[i]).is_empty());
    let question = question_at.map_or("", |i| strip(lines[i])).to_string();
    let detail = lines[top..question_at.unwrap_or(top)]
        .iter()
        .map(|l| strip(l))
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    let fingerprint = lines[top..=last]
        .iter()
        .map(|l| match option_line(l) {
            Some(o) => format!("{}. {}", o.number, o.label),
            None => strip(l).to_string(),
        })
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    Some(Prompt { question, detail, options, fingerprint })
}

/// The screen once output has paused for 400 ms (giving up waiting after 3 s), counting only
/// output from `since` (epoch ms) on.
pub(super) fn settled_screen(hub: &TerminalHub, id: u32, since: i64) -> Result<String, String> {
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

/// The agent's open panel, or a new temporary terminal (`true`).
fn attach(hub: &TerminalHub, short_id: &str) -> Result<(u32, bool), String> {
    match hub.existing(short_id) {
        Some(id) => Ok((id, false)),
        None => Ok((hub.open_temporary(short_id, TEMP_COLS, TEMP_ROWS)?, true)),
    }
}

/// The prompt the agent waits on, if any.
pub fn read_prompt(hub: &TerminalHub, short_id: &str) -> Result<Option<Prompt>, String> {
    if !valid_short_id(short_id) {
        return Err("Invalid agent id".into());
    }
    let _held = hub.lock_agent(short_id);
    let (id, temp) = attach(hub, short_id)?;
    let screen = settled_screen(hub, id, 0);
    if temp {
        hub.close(id);
    }
    Ok(parse_prompt(&screen?))
}

/// Chooses option `number` of the prompt read earlier, provided the screen still shows that
/// prompt (`fingerprint`) with that option (`expected_label`): moves the pointer with arrow keys,
/// re-reads the screen, and presses Enter only if it is still that prompt and the option is now
/// highlighted.
pub fn answer(
    hub: &TerminalHub,
    short_id: &str,
    number: u8,
    expected_label: &str,
    fingerprint: &str,
) -> Result<(), String> {
    if !valid_short_id(short_id) {
        return Err("Invalid agent id".into());
    }
    let held = hub.lock_agent(short_id);
    let (id, temp) = attach(hub, short_id)?;
    let result = choose(hub, id, number, expected_label, fingerprint);
    if temp {
        if result.is_ok() {
            // The agent stays held until its temporary terminal is gone.
            let hub = hub.clone();
            std::thread::spawn(move || {
                hub.clock().sleep_ms(TEMP_CLOSE_AFTER_MS);
                hub.close(id);
                drop(held);
            });
        } else {
            hub.close(id);
        }
    }
    result
}

/// The prompt on screen, if it is the one identified by `fingerprint` and option `number` reads
/// `label`.
fn same_prompt(screen: &str, number: u8, label: &str, fingerprint: &str) -> Option<Prompt> {
    parse_prompt(screen).filter(|p| {
        p.fingerprint == fingerprint
            && p.options.iter().any(|o| o.number == number && o.label == label)
    })
}

fn choose(
    hub: &TerminalHub,
    id: u32,
    number: u8,
    label: &str,
    fingerprint: &str,
) -> Result<(), String> {
    let clock = hub.clock();
    let screen = settled_screen(hub, id, 0)?;
    let prompt = same_prompt(&screen, number, label, fingerprint).ok_or(CHANGED)?;
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
    let screen = settled_screen(hub, id, since)?;
    let prompt = same_prompt(&screen, number, label, fingerprint).ok_or(CHANGED)?;
    if !prompt.options.iter().any(|o| o.number == number && o.selected) {
        return Err(NOT_SELECTED.into());
    }
    hub.write(id, b"\r")
}

/// Prompts are read and answered for background agents only.
/// Looks in `cache` (the poller's last list) first, then asks the CLI.
fn require_background(cli: &dyn Cli, cache: &[Agent], short_id: &str) -> Result<(), String> {
    if !valid_short_id(short_id) {
        return Err("Invalid agent id".into());
    }
    let is_it = |a: &&Agent| a.short_id.as_deref() == Some(short_id);
    let agent = match cache.iter().find(is_it) {
        Some(a) => a.clone(),
        None => fetch_agents(cli)?
            .into_iter()
            .find(|a| a.short_id.as_deref() == Some(short_id))
            .ok_or("Agent not found")?,
    };
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
    let cache = state.cached();
    super::pty::blocking(move || {
        require_background(&cli, &cache, &short_id)?;
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
    fingerprint: String,
) -> Result<(), String> {
    let cli = super::actions::ready(&state)?;
    let hub = state.hub.clone();
    let cache = state.cached();
    super::pty::blocking(move || {
        require_background(&cli, &cache, &short_id)?;
        answer(&hub, &short_id, number, &label, &fingerprint)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::model::{parse_agents, Agent};
    use crate::agents::pty::tests::{eventually, FakeClock};
    use crate::agents::pty::{send_message, PtyProcess, PtySpawner};
    use std::io::Read;
    use std::sync::atomic::{AtomicBool, AtomicI64, AtomicUsize, Ordering};
    use std::sync::mpsc::{channel, Receiver, Sender};
    use std::sync::{Arc, Mutex};

    const PERMISSION: &str = include_str!("../../tests/fixtures/agents/prompt-permission.txt");
    const CHOICE: &str = include_str!("../../tests/fixtures/agents/prompt-choice.txt");
    const NONE: &str = include_str!("../../tests/fixtures/agents/prompt-none.txt");

    fn opt(number: u8, label: &str, selected: bool) -> PromptOption {
        PromptOption { number, label: label.into(), selected }
    }

    fn fingerprint(screen: &str) -> String {
        parse_prompt(screen).expect("prompt").fingerprint
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
        assert_eq!(
            p.detail,
            "Bash command\n\
             Tip: auto mode handles these prompts for you — choose \"switch to auto mode\" below\n\
             Create empty file y.txt in fixture directory\n\
             touch /tmp/sm-agents-fixture/y.txt"
        );
        assert!(p.fingerprint.starts_with("Bash command "));
        assert!(p.fingerprint.contains("touch /tmp/sm-agents-fixture/y.txt Do you want to proceed? 1. Yes 2. Yes"));
        assert!(p.fingerprint.ends_with("4. No"));
        assert!(!p.fingerprint.contains('❯'));
    }

    #[test]
    fn parses_choice_prompt() {
        // Descriptions under each option and the rule above option 5 do not break the run.
        let p = parse_prompt(CHOICE).expect("prompt");
        assert_eq!(p.question, "Which colour should the demo use?");
        assert_eq!(p.detail, "☐ Colour");
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
    fn fingerprint_ignores_pointer() {
        let moved = CHOICE.replacen("❯ 1. Red", "  1. Red", 1).replacen("  2. Green", "❯ 2. Green", 1);
        assert_eq!(parse_prompt(&moved).unwrap().options[1], opt(2, "Green", true));
        assert_eq!(fingerprint(&moved), fingerprint(CHOICE));
        assert_eq!(fingerprint(MOVED), fingerprint(FIRST));
    }

    #[test]
    fn fingerprint_tells_prompts_with_same_options_apart() {
        assert_ne!(fingerprint(OTHER), fingerprint(FIRST));
        assert_eq!(parse_prompt(OTHER).unwrap().options, parse_prompt(FIRST).unwrap().options);
    }

    #[test]
    fn none_when_no_prompt() {
        assert_eq!(parse_prompt(NONE), None);
        assert_eq!(parse_prompt(""), None);
        // A numbered list in the agent's reply has no pointer.
        assert_eq!(parse_prompt("Steps:\n1. Build\n2. Test\n"), None);
    }

    /// A past user message that is a numbered list, as Claude Code draws it: `❯` on its first line.
    const NUMBERED_MESSAGE: &str = "❯ 1. Build the demo\n  2. Run the tests\n";

    #[test]
    fn numbered_message_above_real_prompt_is_ignored() {
        let screen = format!("{NUMBERED_MESSAGE}\n⏺ On it.\n\n{PERMISSION}");
        assert_eq!(parse_prompt(&screen), parse_prompt(PERMISSION));
        assert_eq!(parse_prompt(&screen).unwrap().options[0], opt(1, "Yes", true));
    }

    #[test]
    fn numbered_message_without_prompt_is_not_a_prompt() {
        // In the conversation history...
        let screen = NONE.replacen(
            "❯ Now run this exact Bash command once and nothing else: touch /tmp/sm-agents-fixture/y.txt",
            NUMBERED_MESSAGE.trim_end(),
            1,
        );
        assert!(screen.contains("❯ 1. Build the demo"));
        assert_eq!(parse_prompt(&screen), None);
        // ...or the last thing above the input box, under a rule as a prompt would be.
        let rule = "─".repeat(40);
        let screen = format!(
            "{rule}\n{NUMBERED_MESSAGE}\n✻ Thinking…\n\n{rule}\n❯ \n{rule}\n  ⏸ manual mode on\n"
        );
        assert_eq!(parse_prompt(&screen), None);
    }

    #[test]
    fn none_when_block_top_out_of_reach() {
        let rule = "─".repeat(40);
        let body: String = (0..25).map(|i| format!(" echo line {i}\n")).collect();
        let tall = format!("{rule}\n Bash command\n{body} Do you want to proceed?\n ❯ 1. Yes\n   2. No\n");
        assert_eq!(parse_prompt(&tall), None);
        // The same prompt with a short command is read.
        let short = format!("{rule}\n Bash command\n echo hi\n Do you want to proceed?\n ❯ 1. Yes\n   2. No\n");
        assert_eq!(parse_prompt(&short).unwrap().detail, "Bash command\necho hi");
        // No rule at all: nothing to anchor the block on.
        assert_eq!(parse_prompt("Do you want to proceed?\n❯ 1. Yes\n  2. No\n"), None);
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
        assert_eq!(p.detail, "");
        assert_eq!(p.options, vec![opt(1, "Yes", true), opt(2, "No", false)]);
        assert_eq!(p.fingerprint, "Proceed? 1. Yes 2. No");
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
        /// Processes alive now, and the most ever alive at once.
        live: Arc<AtomicUsize>,
        max_live: Arc<AtomicUsize>,
    }

    fn draw(screen: &str) -> Vec<u8> {
        format!("\x1b[2J\x1b[H{}", screen.replace('\n', "\r\n")).into_bytes()
    }

    impl PtySpawner for ScriptSpawner {
        fn spawn(&self, _: &str, _: u16, _: u16) -> Result<Box<dyn PtyProcess>, String> {
            let (tx, rx) = channel();
            tx.send(draw(&self.first)).unwrap();
            let live = self.live.fetch_add(1, Ordering::SeqCst) + 1;
            self.max_live.fetch_max(live, Ordering::SeqCst);
            Ok(Box::new(ScriptProc {
                after_down: self.after_down.clone(),
                writes: self.writes.clone(),
                killed: self.killed.clone(),
                live: self.live.clone(),
                tx: Mutex::new(Some(tx)),
                rx: Some(rx),
            }))
        }
    }

    struct ScriptProc {
        after_down: Option<String>,
        writes: Arc<Mutex<Vec<String>>>,
        killed: Arc<AtomicBool>,
        live: Arc<AtomicUsize>,
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
            self.live.fetch_sub(1, Ordering::SeqCst);
            self.tx.lock().unwrap().take();
        }
    }

    const FIRST: &str = "agent output\n──────────\n Bash command\n touch /tmp/demo/a\n Do you want to proceed?\n ❯ 1. Yes\n   2. No\n";
    const MOVED: &str = "agent output\n──────────\n Bash command\n touch /tmp/demo/a\n Do you want to proceed?\n   1. Yes\n ❯ 2. No\n";
    /// The next permission prompt: same question and options, another command.
    const OTHER: &str = "agent output\n──────────\n Bash command\n rm -rf /tmp/demo\n Do you want to proceed?\n ❯ 1. Yes\n   2. No\n";
    const OTHER_MOVED: &str = "agent output\n──────────\n Bash command\n rm -rf /tmp/demo\n Do you want to proceed?\n   1. Yes\n ❯ 2. No\n";

    struct Fake {
        hub: TerminalHub,
        writes: Arc<Mutex<Vec<String>>>,
        killed: Arc<AtomicBool>,
        max_live: Arc<AtomicUsize>,
    }

    impl Fake {
        fn writes(&self) -> Vec<String> {
            self.writes.lock().unwrap().clone()
        }
    }

    fn fake(first: &str, after_down: Option<&str>) -> Fake {
        let writes = Arc::new(Mutex::new(vec![]));
        let killed = Arc::new(AtomicBool::new(false));
        let max_live = Arc::new(AtomicUsize::new(0));
        let spawner = ScriptSpawner {
            first: first.into(),
            after_down: after_down.map(String::from),
            writes: writes.clone(),
            killed: killed.clone(),
            live: Arc::default(),
            max_live: max_live.clone(),
        };
        let clock = Arc::new(FakeClock { now: AtomicI64::new(1_000), ..Default::default() });
        Fake { hub: TerminalHub::new(Arc::new(spawner), clock), writes, killed, max_live }
    }

    #[test]
    fn answer_moves_then_confirms() {
        let f = fake(FIRST, Some(MOVED));
        answer(&f.hub, "0a1b2c3d", 2, "No", &fingerprint(FIRST)).unwrap();
        assert_eq!(f.writes(), vec!["\x1b[B", "\r"]);
        assert!(eventually(|| f.hub.len() == 0), "temporary terminal closed");
        assert!(f.killed.load(Ordering::SeqCst));
    }

    #[test]
    fn answer_selected_option_sends_only_enter() {
        let f = fake(FIRST, None);
        answer(&f.hub, "0a1b2c3d", 1, "Yes", &fingerprint(FIRST)).unwrap();
        assert_eq!(f.writes(), vec!["\r"]);
    }

    #[test]
    fn answer_refuses_when_label_changed() {
        let f = fake(FIRST, Some(MOVED));
        let fp = fingerprint(FIRST);
        assert_eq!(answer(&f.hub, "0a1b2c3d", 2, "Maybe", &fp).unwrap_err(), "The prompt changed");
        assert_eq!(answer(&f.hub, "0a1b2c3d", 3, "No", &fp).unwrap_err(), "The prompt changed");
        assert!(f.writes().is_empty());
    }

    #[test]
    fn answer_refuses_another_prompt_with_same_options() {
        // The prompt the user saw was answered elsewhere and the next one opened.
        let f = fake(OTHER, Some(OTHER_MOVED));
        let err = answer(&f.hub, "0a1b2c3d", 1, "Yes", &fingerprint(FIRST)).unwrap_err();
        assert_eq!(err, "The prompt changed");
        assert!(f.writes().is_empty());
        assert_eq!(f.hub.len(), 0);
    }

    #[test]
    fn answer_refuses_when_prompt_replaced_while_moving() {
        let f = fake(FIRST, Some(OTHER_MOVED));
        let err = answer(&f.hub, "0a1b2c3d", 2, "No", &fingerprint(FIRST)).unwrap_err();
        assert_eq!(err, "The prompt changed");
        assert_eq!(f.writes(), vec!["\x1b[B"]);
    }

    #[test]
    fn answer_never_enters_when_selection_did_not_move() {
        let f = fake(FIRST, None);
        let err = answer(&f.hub, "0a1b2c3d", 2, "No", &fingerprint(FIRST)).unwrap_err();
        assert_eq!(err, "Could not select that option; use the terminal");
        assert_eq!(f.writes(), vec!["\x1b[B"]);
        assert!(eventually(|| f.hub.len() == 0), "temporary terminal closed");
    }

    #[test]
    fn answer_reuses_open_terminal() {
        let f = fake(FIRST, Some(MOVED));
        let id = f.hub.open("0a1b2c3d", 80, 24, Box::new(|_, _| {}), Box::new(|_| {})).unwrap();
        answer(&f.hub, "0a1b2c3d", 2, "No", &fingerprint(FIRST)).unwrap();
        assert_eq!(f.writes(), vec!["\x1b[B", "\r"]);
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert_eq!(f.hub.existing("0a1b2c3d"), Some(id), "the panel stays open");
    }

    #[test]
    fn read_prompt_through_temporary_terminal() {
        let f = fake(FIRST, None);
        let p = read_prompt(&f.hub, "0a1b2c3d").unwrap().expect("prompt");
        assert_eq!(p.options, vec![opt(1, "Yes", true), opt(2, "No", false)]);
        assert_eq!(p.detail, "Bash command\ntouch /tmp/demo/a");
        assert!(f.writes().is_empty());
        assert_eq!(f.hub.len(), 0);
        assert!(f.killed.load(Ordering::SeqCst));
        assert!(read_prompt(&f.hub, "nope").is_err());
    }

    #[test]
    fn temporary_terminal_is_not_existing() {
        let f = fake(FIRST, None);
        let id = f.hub.open_temporary("0a1b2c3d", 80, 24).unwrap();
        assert_eq!(f.hub.existing("0a1b2c3d"), None);
        assert!(f.hub.screen(id).is_some());
    }

    #[test]
    fn one_temporary_terminal_per_agent() {
        let f = fake(FIRST, None);
        let threads: Vec<_> = (0..4)
            .map(|_| {
                let hub = f.hub.clone();
                std::thread::spawn(move || read_prompt(&hub, "0a1b2c3d"))
            })
            .collect();
        for t in threads {
            assert!(t.join().unwrap().unwrap().is_some());
        }
        // An answer's terminal lingers for a second; a read meanwhile waits for it to close.
        answer(&f.hub, "0a1b2c3d", 1, "Yes", &fingerprint(FIRST)).unwrap();
        read_prompt(&f.hub, "0a1b2c3d").unwrap();
        assert_eq!(f.max_live.load(Ordering::SeqCst), 1);
    }

    fn idle_agent() -> Agent {
        let json = r#"[{"sessionId":"00000000-1111-2222-3333-444444444444","id":"0a1b2c3d","kind":"bg","status":"idle"}]"#;
        parse_agents(json).unwrap().remove(0)
    }

    #[test]
    fn send_refused_when_prompt_on_screen() {
        // The CLI still says idle, but a prompt has opened: a typed "1" would confirm it.
        let f = fake(FIRST, None);
        let err = send_message(&f.hub, &idle_agent(), "1").unwrap_err();
        assert_eq!(err, "Answer the open prompt first");
        assert!(f.writes().is_empty());
        assert_eq!(f.hub.len(), 0);
    }
}
