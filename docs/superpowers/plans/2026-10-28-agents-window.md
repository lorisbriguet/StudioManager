# Agents Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An optional Agents page in StudioManager that lists every Claude Code agent on the Mac by project, starts, stops, deletes and re-models them, shows and sends conversation, answers waiting prompts with buttons, attaches a terminal, and posts a Mac notification when an agent waits.

**Architecture:** A new Rust module `src-tauri/src/agents/` owns everything that touches processes and `~/.claude`: it runs the `claude` CLI with argv only, keeps one pty per attached agent (with a `vt100` screen mirror used to read prompts), and polls `claude agents --json --all` every 2 s on a background thread that emits `agents:changed` and fires notifications. The React side is a thin view over Tauri commands and events: a Settings card, a sidebar entry, an Agents page with list, start form, detail pane and an xterm.js terminal.

**Tech Stack:** Tauri 2, Rust (rusqlite 0.32 already present; new: `portable-pty`, `vt100`, `base64`), React 19 + TypeScript + Tailwind 4 + Zustand, Vitest + happy-dom, `@xterm/xterm` + `@xterm/addon-fit`.

**Spec:** [2026-10-28-agents-window-design.md](../specs/2026-10-28-agents-window-design.md)

**Reference implementation (behaviour only, Node):** `~/Documents/GitHub/claude-dashboard`, branch `feat/ab-control-room`, files `server/sessions.ts`, `server/launcher.ts`, `server/terminal.ts`, `server/sendToSession.ts`, `server/transcripts.ts`, `server/trust.ts`. Read with `git -C <repo> show feat/ab-control-room:<path>`.

## Global Constraints

- One app-wide switch, off by default, stored in `<app data>/agents.json`. Missing or unreadable file = off.
- No network port, no local web server. Everything goes through Tauri commands and events.
- The webview never chooses a program or a cwd for a pty. `capabilities/default.json` gets no shell permission; `shell:allow-execute` stays absent.
- Every process: `std::process::Command` / `portable_pty::CommandBuilder` with the resolved `claude` path and argv, never `sh -c`. The one exception is the login-shell lookup in Task 2, whose script is a fixed string.
- Validation, copied verbatim: model ∈ `haiku | sonnet | opus | fable`; name `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`; task ≤ 8000 chars and not starting with `-`; short id `^[0-9a-f]{8}$`; terminal cols clamped 20–400, rows 5–200; at most 8 ptys.
- Sent messages: ≤ 20 000 chars, CRLF/CR/U+2028/U+2029 → `\n`, reject other control chars except `\t` `\n`; multi-line sent as one bracketed paste (`ESC[200~ … ESC[201~`), then `\r` after 300 ms.
- Groups: `needs-you | working | idle | done`. A needs-you agent goes quiet (shown under idle) after 2 h (7 200 000 ms) with no transcript change, or when dismissed.
- Never accept Claude's folder-trust prompt. Untrusted folders are not offered and are refused by `agents_start`.
- Never send a bare Enter to answer a prompt: `\r` is written only after re-reading the screen and confirming the chosen option is highlighted.
- Never write to `~/.claude`, `~/.claude.json` or the Art Basel hub; only the `claude` CLI does.
- Labels: `Organisation › Client › Project`, longest matching `folder_path` prefix across all organisations, including those hidden from Agent access. No match → folder name.
- Interactive (non-`--bg`) agents: list, read, stop, attach. No send, no model switch, no answer buttons.
- The repo is public: no personal paths, names or real session ids in tests or fixtures.
- UI copy in EN and FR (`src/i18n/ui.ts`); visuals follow [DESIGN-SYSTEM.md](../../../DESIGN-SYSTEM.md).
- Checks before each commit: `npx tsc --noEmit`, `npx vitest run`, `npm run lint`, and in `src-tauri`: `CARGO_TARGET_DIR=~/cargo-target-studiomanager cargo test agents` (run `bash scripts/build-mcp.sh` once first on a fresh clone; see [RELEASING.md](../../../RELEASING.md)).

## Review Focus

1. **App opened from Finder:** no shell PATH. Agents started from the app must still find `git`, `node`, etc. and `!` commands must work → spawned processes get the login-shell `PATH` (Task 2 test `spawn_env_uses_login_path`).
2. **The prompt changed between showing the buttons and the click** (agent moved on, another prompt opened): the click must do nothing harmful → `agents_answer` re-reads and refuses on label mismatch (Task 7 test `answer_refuses_when_label_changed`).
3. **`claude agents` fails or times out once:** the list must not empty out and notifications must not re-fire when it recovers → keep last good list (Task 8 test `failed_poll_keeps_last_list_and_baseline`).
4. **Same folder linked in two organisations, or nested project folders:** the label must be stable and the deepest folder wins; ties go to the first organisation in registry order (Task 3 test `nested_and_duplicate_folders`).
5. **Model switch where the resume fails** (folder no longer trusted, CLI error): the old agent stays stopped, nothing deleted, error says so (Task 4 test `switch_model_resume_failure_leaves_old_stopped`).

---

### File map

| File | Responsibility |
|---|---|
| `src-tauri/src/agents/mod.rs` | Module root, Tauri commands, `AgentsState` |
| `src-tauri/src/agents/model.rs` | `Agent`, `Group`, parsing `claude agents --json`, grouping, quiet |
| `src-tauri/src/agents/validate.rs` | Model / name / task / id / message rules |
| `src-tauri/src/agents/cli.rs` | `Cli` trait, `RealCli`, login-shell lookup, settings file |
| `src-tauri/src/agents/projects.rs` | Folder → `ProjectLabel` across organisations; trusted folders |
| `src-tauri/src/agents/actions.rs` | start / stop / delete / switch model; `agents-state.json` (dismissed, links) |
| `src-tauri/src/agents/transcript.rs` | Locate and summarise `<sessionId>.jsonl` |
| `src-tauri/src/agents/pty.rs` | `TerminalHub`: ptys, screen mirror, send message |
| `src-tauri/src/agents/prompt.rs` | Parse a waiting prompt from a screen; answer it |
| `src-tauri/src/agents/poller.rs` | 2 s loop, `agents:changed`, notifications |
| `src/lib/agents.ts` | TS types + `invoke` wrappers + event names |
| `src/components/settings/AgentsCard.tsx` | Settings card |
| `src/pages/AgentsPage.tsx` | Page shell: list + detail |
| `src/components/agents/*.tsx` | `AgentList`, `StartAgentForm`, `AgentDetail`, `Conversation`, `PromptAnswer`, `TerminalPanel`, `useAgents` |
| `docs/agents.md` | User doc |

---

### Task 1: Agent model, parsing and grouping

**Files:**
- Create: `src-tauri/src/agents/mod.rs`, `src-tauri/src/agents/model.rs`, `src-tauri/src/agents/validate.rs`
- Modify: `src-tauri/src/lib.rs:1-8` (add `mod agents;`)

**Interfaces:**
- Produces (model.rs):
  - `enum Kind { Background, Interactive }`: serde lowercase. `"bg"` or `"background"` → Background, anything else → Interactive.
  - `enum Group { NeedsYou, Working, Idle, Done }`: serde kebab-case (`"needs-you"`).
  - `enum Quiet { Stale, Dismissed }`.
  - `struct Agent { session_id: String, short_id: Option<String>, pid: Option<u32>, name: String, cwd: String, kind: Kind, status: String, state: Option<String>, waiting_for: Option<String>, started_at: i64, group: Group, quiet: Option<Quiet>, project: Option<ProjectLabel> }`, serde camelCase. `ProjectLabel` is defined in Task 3; add it as a stub `pub struct ProjectLabel` in `projects.rs` now so this compiles.
  - `fn parse_agents(json: &str) -> Result<Vec<Agent>, String>`: entries missing `sessionId` are skipped; `name` falls back to the cwd's last segment.
  - `fn group_of(status: &str, state: Option<&str>) -> Group`: the reference's `groupOf`, unchanged.
  - `fn apply_quiet(agents: &mut [Agent], now_ms: i64, last_change_ms: &dyn Fn(&Agent) -> Option<i64>, dismissed: &HashSet<String>)`
  - `const QUIET_AFTER_MS: i64 = 7_200_000;`
- Produces (validate.rs): `fn valid_model(&str) -> bool`, `fn valid_name(&str) -> bool`, `fn valid_task(&str) -> bool`, `fn valid_short_id(&str) -> bool`, `fn normalise_message(&str) -> Option<String>`, `fn clamp_size(cols: u16, rows: u16) -> (u16, u16)`. Use plain char checks, not a regex crate.

- [ ] **Step 1: Write failing tests** in `model.rs` / `validate.rs` `#[cfg(test)]`:
  - `parse_agents_reads_cli_json`: fixture `[{"pid":1,"id":"a1b2c3d4","cwd":"/x/proj","kind":"bg","startedAt":5,"sessionId":"s1","name":"fix","status":"waiting","waitingFor":"permission prompt"}]` → one Agent with `kind == Background`, `short_id == Some("a1b2c3d4")`, `group == NeedsYou`, `waiting_for == Some("permission prompt")`.
  - `group_of_table`: `("waiting",None)→NeedsYou`, `("busy",Some("done"))→Working`, `("idle",Some("completed"))→Done`, `("idle",Some("blocked"))→NeedsYou`, `("idle",Some("working"))→Idle`.
  - `quiet_after_two_hours`: a NeedsYou agent with last change `now - 7_200_001` → `group == Idle, quiet == Some(Stale)`; at `now - 7_199_999` it stays NeedsYou; a dismissed one → `Idle, Some(Dismissed)`.
  - `validation_rules`: `valid_model("fable")` true, `("gpt")` false; `valid_name("a.b_c-1")` true, `("-x")` false, 65 chars false; `valid_task("-rf")` false, 8001 chars false; `valid_short_id("0a1b2c3d")` true, `("0A1B2C3D")` false; `normalise_message("a\r\nb")==Some("a\nb")`, `("x\u{7}")==None`, 20 001 chars `None`, `("   ")==None`; `clamp_size(5, 999)==(20,200)`.
- [ ] **Step 2: Run** `cd src-tauri && CARGO_TARGET_DIR=~/cargo-target-studiomanager cargo test agents::`. Expected: FAIL (not defined).
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(agents): agent model, grouping and validation`.

### Task 2: Settings file, finding `claude`, CLI runner, Settings card

**Files:**
- Create: `src-tauri/src/agents/cli.rs`, `src/lib/agents.ts`, `src/components/settings/AgentsCard.tsx`, `src/__tests__/agentsCard.test.tsx`
- Modify: `src-tauri/src/agents/mod.rs`, `src-tauri/src/lib.rs` (register commands, `agents::init(handle)` in `setup`), `src/pages/SettingsPage.tsx:32-34,328,558` (category `"agents"` after `"agent_access"`, icon `Terminal` from lucide), `src/stores/app-store.ts` (`agentsEnabled: boolean`, `setAgentsEnabled`), `src/i18n/ui.ts` (EN + FR keys `agents`, `agents_desc`, `agents_enable`, `agents_claude_path`, `agents_claude_missing`, `agents_trust_hint`)

**Interfaces:**
- Produces (cli.rs):
  - `struct AgentsSettings { enabled: bool }` (serde camelCase, default false); `fn read_settings(dir:&Path) -> AgentsSettings`; `fn write_settings(dir:&Path, s:&AgentsSettings) -> Result<(),String>`. Atomic write as in `agent_access::write_atomic` (make that fn `pub(crate)` and reuse it).
  - `struct LoginEnv { claude: Option<PathBuf>, path: String }`; `fn parse_login_output(out:&str) -> LoginEnv`: parses the two lines printed by the fixed script `/bin/zsh -lic 'printf "%s\n%s\n" "$(command -v claude)" "$PATH"'` (use the user's `$SHELL` if it's `/bin/zsh` or `/bin/bash`, else `/bin/zsh`). If `claude` is empty, fall back to the first existing of `~/.local/bin/claude`, `~/.claude/local/claude`, `/opt/homebrew/bin/claude`, `/usr/local/bin/claude`. Resolved once, lazily, cached in `AgentsState`.
  - `struct CliOutput { code: i32, stdout: String, stderr: String }`; `trait Cli: Send + Sync { fn run(&self, args:&[String], cwd:&Path) -> CliOutput; }`; `struct RealCli { claude: PathBuf, path_env: String }` with a 10 s timeout (kill the child on timeout, code -1).
  - `fn spawn_env(env:&LoginEnv) -> Vec<(String,String)>`: `PATH` from login env, plus `HOME`, `USER`, `LANG`, `TERM=xterm-256color`.
  - Commands: `agents_get_settings() -> AgentsInfo { enabled: bool, claude_path: Option<String> }`, `agents_set_enabled(enabled: bool) -> Result<AgentsInfo,String>`. Enabling fails with `"claude not found"` when there is no path.
- Produces (agents.ts): `type AgentsInfo`, `getAgentsSettings()`, `setAgentsEnabled(enabled)`.

- [ ] **Step 1: Failing Rust tests:** `settings_missing_file_is_off`, `settings_round_trip`, `parse_login_output_two_lines` (`"/opt/x/claude\n/usr/bin:/opt/x\n"` → claude `/opt/x/claude`, path `/usr/bin:/opt/x`), `parse_login_output_missing_claude` (first line empty → `claude == None` before fallback), `spawn_env_uses_login_path` (`PATH` equals the login path, not the process's).
- [ ] **Step 2: Failing Vitest** `agentsCard.test.tsx`: with the `invoke` mock returning `{enabled:false, claudePath:null}`, the switch is disabled and `agents_claude_missing` text shows; with `"/usr/local/bin/claude"`, the path shows and toggling calls `agents_set_enabled` with `{enabled:true}` and sets `useAppStore.getState().agentsEnabled` to true.
- [ ] **Step 3: Run both** (`cargo test agents::cli`, `npx vitest run src/__tests__/agentsCard.test.tsx`). Expected: FAIL.
- [ ] **Step 4: Implement.** On startup, `App` (or `MainLayout`'s existing init effect) calls `getAgentsSettings()` and sets `agentsEnabled`. The card copies `AgentAccessCard`'s layout primitives from `SettingsPrimitives.tsx`, and shows `agents_trust_hint` ("A folder appears once you have opened Claude in it and trusted it.").
- [ ] **Step 5: Run both.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(agents): settings switch and claude lookup`.

### Task 3: Project labels across organisations, trusted folders

**Files:**
- Create: `src-tauri/src/agents/projects.rs`

**Interfaces:**
- Produces:
  - `struct ProjectLabel { org_id: String, org_name: String, client_name: String, project_id: i64, project_name: String, folder: String }`, serde camelCase.
  - `struct FolderIndex(Vec<ProjectLabel>)`; `fn load_index(app_dir:&Path) -> FolderIndex`: for each organisation in `orgs::Registry::load` order, open `orgs::org_dir(app_dir,id)/studiomanager.db` **read-only** (`OpenFlags::SQLITE_OPEN_READ_ONLY`), run `SELECT p.id, p.name, c.name, p.folder_path FROM projects p JOIN clients c ON c.id = p.client_id WHERE p.folder_path IS NOT NULL AND p.folder_path != ''`. A missing or unreadable database is skipped.
  - `fn FolderIndex::label_for(&self, cwd:&str) -> Option<ProjectLabel>`: longest `folder` that equals `cwd` or is a path-component prefix of it (`/a/b` matches `/a/b/c`, not `/a/bc`); trailing `/` ignored; ties → first in index order.
  - `fn trusted_folders(claude_json:&str) -> Vec<String>`: keys of `projects` whose value has `hasTrustDialogAccepted == true`.
  - `struct StartFolder { path: String, label: Option<ProjectLabel> }`; `fn start_folders(trusted:Vec<String>, index:&FolderIndex) -> Vec<StartFolder>`: linked first (sorted by org, client, project), then the rest by path.
  - Command `agents_start_folders() -> Vec<StartFolder>`: reads `~/.claude.json` fresh each call.
- Index refresh: the poller (Task 8) reloads it every 30 s and when the `db-changed` event fires.

- [ ] **Step 1: Failing tests** with a temp app dir holding two org databases built with the real migrations (reuse `src-tauri/tests/fixtures` helpers if present, else create `projects`/`clients` minimal tables). Tests: `label_exact_and_child`, `no_match_for_sibling_prefix` (`/a/bc` vs `/a/b`), `nested_and_duplicate_folders` (registry order A, B; `/w` linked in A, `/w/x` linked in both A and B → `/w/x/y` gets A's `/w/x` project; `/w/z` gets A's `/w` project), `missing_db_skipped`, `trusted_folders_filters_flag`, `start_folders_linked_first`.
- [ ] **Step 2: Run** `cargo test agents::projects`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(agents): label agents by project across organisations`.

### Task 4: Actions: start, stop, delete, switch model, dismiss

**Files:**
- Create: `src-tauri/src/agents/actions.rs`
- Modify: `src-tauri/src/agents/mod.rs`, `src/lib/agents.ts`

**Interfaces:**
- Consumes: `Cli`, validators, `trusted_folders`, `read_settings`.
- Produces:
  - `fn start(cli:&dyn Cli, trusted:&[String], folder:&str, task:&str, model:&str, name:&str) -> Result<String /*short id*/, String>`: args `["--bg","--model",model,"--name",name,task]`, cwd `folder`. Refuse if `folder` is not in `trusted` (exact string match after trimming a trailing `/`). Short id from the last stdout line matching `backgrounded · <8 hex>`.
  - `fn stop(cli, short_id) -> Result<(),String>`: `["stop",id]`, cwd home; ok only if stdout contains `stopped <id>`.
  - `fn delete(cli, short_id) -> Result<(),String>`: `["rm",id]`, cwd home.
  - `fn switch_model(cli, agent:&Agent, model:&str, state_dir:&Path) -> Result<String /*new short id*/, String>`: stop; then `["--resume",session_id,"--bg","--model",model,"--name",name]` in `agent.cwd`; record `old session_id → new short id` in `agents-state.json` `links`. On resume failure return `Err("Stopped the old agent; starting the copy failed: <first stderr line>")` and write nothing. Background only.
  - `struct AgentsStateFile { dismissed: Vec<String>, links: BTreeMap<String,String> }`; `fn dismiss(state_dir, session_id)`.
  - Commands: `agents_start{folder,task,model,name}`, `agents_stop{shortId}`, `agents_delete{shortId}`, `agents_switch_model{sessionId,model}`, `agents_dismiss{sessionId}`. Each validates inputs first and returns `Err` with a readable message. All refuse when the switch is off.
- [ ] **Step 1: Failing tests** with a `FakeCli` that records `(args, cwd)` and returns scripted output: `start_builds_argv`, `start_refuses_untrusted_folder` (no CLI call recorded), `start_refuses_bad_model_name_task`, `start_parses_short_id`, `stop_requires_confirmation_text`, `switch_model_records_link`, `switch_model_resume_failure_leaves_old_stopped` (two calls recorded, `links` empty, error text starts with "Stopped the old agent"), `switch_model_refuses_interactive`.
- [ ] **Step 2: Run** `cargo test agents::actions`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(agents): start, stop, delete, switch model`.

### Task 5: Reading the conversation

**Files:**
- Create: `src-tauri/src/agents/transcript.rs`

**Interfaces:**
- Produces:
  - `fn locate(claude_dir:&Path, session_id:&str) -> Option<PathBuf>`: first `projects/*/<session_id>.jsonl`. `session_id` must be `[0-9a-f-]{1,64}`, else `None`.
  - `enum Item { User{text,at}, Assistant{text,at}, Tool{name,summary,at} }`, serde tag `kind`.
  - `fn summarise(jsonl:&str, limit:usize) -> Vec<Item>`: the last `limit` items. User and assistant text blocks become text. `tool_use` becomes `Tool{name, summary}`, where summary is the tool's `description`, `command` or `file_path` input, truncated to 200 chars. `tool_result` and system lines are skipped. Unparseable lines are skipped.
  - `fn last_change_ms(path) -> Option<i64>`: the file mtime, used by `apply_quiet`.
  - Command `agents_conversation{sessionId} -> Vec<Item>`, limit 300.
- [ ] **Step 1: Failing tests** with a hand-written fixture `src-tauri/tests/fixtures/agents/transcript.jsonl` (fake ids, `/tmp/demo` paths only): `summarise_text_and_tools`, `summarise_limit_keeps_tail`, `bad_lines_skipped`, `locate_rejects_path_tricks` (`"../x"` → None).
- [ ] **Step 2: Run** `cargo test agents::transcript`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(agents): read an agent's conversation`.

### Task 6: Terminal hub and sending messages

**Files:**
- Create: `src-tauri/src/agents/pty.rs`
- Modify: `src-tauri/Cargo.toml` (`portable-pty`, `vt100`, `base64`: latest versions compatible with `rust-version = "1.77.2"`), `src-tauri/src/agents/mod.rs`

**Interfaces:**
- Consumes: `LoginEnv`/`spawn_env`, `clamp_size`, `valid_short_id`, `normalise_message`.
- Produces:
  - `trait PtySpawner: Send + Sync { fn spawn(&self, short_id:&str, cols:u16, rows:u16) -> Result<Box<dyn PtyProcess>,String>; }`. `PtyProcess` exposes `write(&[u8])`, `resize(cols,rows)`, `reader() -> Box<dyn Read + Send>`, `kill()`. The real spawner runs exactly `claude attach <short_id>` with cwd = home and `spawn_env`.
  - `struct TerminalHub`, with `const MAX_TERMINALS: usize = 8`:
    - `open(short_id, cols, rows, on_data: Box<dyn Fn(&[u8]) + Send>) -> Result<u32 /*term id*/, String>`. A reader thread feeds `on_data` and a `vt100::Parser` (scrollback 0).
    - `write(term_id, &[u8])`, `resize(term_id, cols, rows)`, `close(term_id)`.
    - `existing(short_id) -> Option<u32>`.
    - `screen(term_id) -> Option<String>`, which is `parser.screen().contents()`.
    - `last_output_ms(term_id) -> Option<i64>`.
  - `fn send_message(hub, agent:&Agent, text:&str) -> Result<(),String>`. It follows the reference `sendToSession`:
    - Refuse when the agent is not background, or when `status == "waiting"` (`"Answer the open prompt first"`).
    - Reuse an existing terminal, or open a temporary one at 80×24. Wait up to 3 s for the first output.
    - Write the text, using bracketed paste when it is multi-line. After 300 ms, write `\r`.
    - Close a temporary terminal after 2 s.
  - Commands:
    - `agents_term_open{shortId,cols,rows} -> u32`. Output is emitted as event `agents:term` with payload `{termId, data}`, where `data` is base64.
    - `agents_term_write{termId,data}` takes UTF-8 text from xterm's `onData`.
    - `agents_term_resize`, `agents_term_close`.
    - `agents_send{sessionId,text}`.
- [ ] **Step 1: Failing tests** with a `FakeSpawner`, whose process echoes writes into its reader and records them:
  - `open_validates_id_and_clamps`
  - `ninth_terminal_refused`
  - `screen_reflects_output` (feed `"hello"` → `screen` contains `hello`)
  - `send_single_line` (recorded writes `["hi", "\r"]`)
  - `send_multiline_bracketed` (`"\x1b[200~a\nb\x1b[201~"`, then `"\r"`)
  - `send_refused_when_waiting`
  - `send_refused_for_interactive`
  - `temp_terminal_closed_after_send`
- [ ] **Step 2: Run** `cargo test agents::pty`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use injected sleeps or a clock so the tests don't wait for real time.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Manual check.** Start any background agent with `claude --bg`. Open it with a small debug `invoke` from the dev console and confirm the screen text, then close it.
- [ ] **Step 6: Commit** `feat(agents): attached terminals and sending messages`.

### Task 7: Reading and answering a waiting prompt

**Files:**
- Create: `src-tauri/src/agents/prompt.rs`, plus fixtures `src-tauri/tests/fixtures/agents/prompt-*.txt`

**Interfaces:**
- Consumes: `TerminalHub` (`existing`, `open`, `screen`, `write`, `last_output_ms`).
- Produces:
  - `struct PromptOption { number: u8, label: String, selected: bool }` and `struct Prompt { question: String, options: Vec<PromptOption> }` (camelCase).
  - `fn parse_prompt(screen:&str) -> Option<Prompt>`. It looks in the bottom block of the screen for a run of 2–9 consecutive lines shaped like `<marker?> <n>. <label>`, with n = 1, 2, 3… in order. The selected line carries Claude's pointer (`❯`, or `>` as fallback). The question is the nearest non-empty line above the options that isn't box-drawing. Return `None` unless exactly one option is selected.
  - `fn answer(hub, short_id, number:u8, expected_label:&str) -> Result<(),String>`:
    1. Get the screen. Open a temporary terminal if none exists and wait until there has been no output for 400 ms (max 3 s).
    2. Parse it. Return `Err("The prompt changed")` if the prompt is missing or option `number`'s label ≠ `expected_label`.
    3. Write `ESC[A` or `ESC[B` × |delta| to move from the selected option to the target. Wait for the screen to settle again, then re-parse.
    4. If the target is not `selected`, return `Err("Could not select that option; use the terminal")` and write nothing more.
    5. Otherwise write `\r`.
    6. Close a temporary terminal after 1 s.
  - Commands `agents_prompt{shortId} -> Option<Prompt>` and `agents_answer{shortId,number,label}`. Both apply to background agents only.
- [ ] **Step 1: Capture fixtures.** Trigger a real permission prompt and a real multiple-choice question in a throwaway background agent, for example in `/tmp/demo`. Save `hub.screen()` text into `prompt-permission.txt` and `prompt-choice.txt`. Replace any personal path or name with `/tmp/demo`. Also add `prompt-none.txt`, a plain idle screen.
- [ ] **Step 2: Failing tests:**
  - `parses_permission_prompt` (options and selected = 1, as captured)
  - `parses_choice_prompt`
  - `none_when_no_prompt`
  - `none_when_two_selected`
  - `answer_moves_then_confirms`: a FakeSpawner screen script where moving down changes which line holds the pointer. Expected writes `["\x1b[B", "\r"]`.
  - `answer_refuses_when_label_changed`: no writes.
  - `answer_never_enters_when_selection_did_not_move`: the screen stays unchanged after the arrow. Expected writes `["\x1b[B"]` only, then an error.
- [ ] **Step 3: Run** `cargo test agents::prompt`. Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(agents): answer waiting prompts safely`.

### Task 8: Poller, live list and notifications

**Files:**
- Create: `src-tauri/src/agents/poller.rs`
- Modify: `src-tauri/src/agents/mod.rs`, `src-tauri/src/lib.rs` (start in `setup` after `agent_access::start_poller`)

**Interfaces:**
- Consumes: `Cli`, `parse_agents`, `apply_quiet`, `FolderIndex`, `transcript::last_change_ms`, `AgentsStateFile`.
- Produces:
  - `struct PollState { last_good: Vec<Agent>, groups: HashMap<String, Group>, baseline_done: bool }`.
  - `fn poll_once(state:&mut PollState, result:Result<Vec<Agent>,String>) -> (Vec<Agent> /*to emit*/, Vec<Agent> /*to notify*/)`:
    - On `Err`: emit `last_good` and notify nobody. `groups` and `baseline_done` are unchanged.
    - On the first `Ok`: set the baseline and notify nobody.
    - On a later `Ok`: notify each agent whose group is now `NeedsYou` (not quiet) and whose previous group wasn't `NeedsYou`, or which is new and already `NeedsYou`.
  - A background thread loops every 2 s while the switch is on (it sleeps and re-reads settings while off). Each pass runs `claude agents --json --all`, labels the agents (index reloaded every 30 s), applies quiet, emits `agents:changed` with `Vec<Agent>`, and sends notifications through `tauri_plugin_notification::NotificationExt`: title = agent name, body = `"<Org › Client › Project or folder> — <waitingFor or 'waiting for you'>"`.
  - Command `agents_list() -> Vec<Agent>` returns the last emitted list, for the page's first render.
- [ ] **Step 1: Failing tests** on `poll_once`:
  - `first_poll_is_baseline`
  - `transition_to_needs_you_notifies_once` (three polls: working → needs-you → needs-you notifies exactly once)
  - `new_agent_already_waiting_notifies`
  - `quiet_agent_not_notified`
  - `failed_poll_keeps_last_list_and_baseline` (ok → err → ok with the same data: no notifications, the err pass emits the previous list)
- [ ] **Step 2: Run** `cargo test agents::poller`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(agents): live agent list and Mac notifications`.

### Task 9: Sidebar entry and Agents page: list and start form

**Files:**
- Create:
  - `src/pages/AgentsPage.tsx`
  - `src/components/agents/useAgents.ts`, `AgentList.tsx`, `StartAgentForm.tsx`
  - `src/__tests__/agentsPage.test.tsx`
- Modify:
  - `src/App.tsx:193` (route `agents`)
  - `src/components/layout/Sidebar.tsx:62-78,184-188`: item `{to:"/agents", labelKey:"agents"}` placed after Wiki, hidden unless `agentsEnabled`
  - `src/__tests__/Sidebar.test.tsx`
  - `src/lib/agents.ts`
  - `src/i18n/ui.ts`

**Interfaces:**
- Consumes all commands and events above. `agents.ts` exports the TS mirrors `Agent`, `Group`, `ProjectLabel`, `StartFolder`, `Item`, `Prompt` and one wrapper per command: `listAgents`, `startFolders`, `startAgent`, `stopAgent`, `deleteAgent`, `switchModel`, `dismissAgent`, `conversation`, `sendMessage`, `getPrompt`, `answerPrompt`, `termOpen`, `termWrite`, `termResize`, `termClose`. It also exports `AGENTS_CHANGED = "agents:changed"` and `AGENTS_TERM = "agents:term"`.
- `useAgents(): { agents: Agent[], byGroup: Record<Group, Agent[]> }` fills from `listAgents()` and then from `listen(AGENTS_CHANGED)`.
- **Page layout** (left to the builder within [DESIGN-SYSTEM.md](../../../DESIGN-SYSTEM.md)): the list on the left, grouped in the order needs you, working, idle, done. Each row shows the name, model (if known), label `Org › Client › Project` or the folder name, and the `waitingFor` text. A "New agent" button opens `StartAgentForm`.
- **`StartAgentForm`:**
  - Folder select from `startFolders()`, with linked folders shown under their label.
  - Task textarea, max 8000.
  - Model select (`sonnet` by default).
  - Name: follows a slug of the task until edited, using the same allowed characters.
  - Inline errors come from the command's `Err`.
- [ ] **Step 1: Failing tests:**
  - `Sidebar.test.tsx`: "Agents" hidden when `agentsEnabled=false`, shown when true.
  - `agentsPage.test.tsx`: with mocked `listAgents` returning one agent per group, the group headings appear in order and the label reads `Org › Client › Project`.
  - The start form: it submits `startAgent` with `{folder, task, model:"sonnet", name}`, the name follows the task (`"Fix the login bug"` → `"fix-the-login-bug"`) until edited, and a task starting with `-` disables submit.
- [ ] **Step 2: Run** `npx vitest run src/__tests__/Sidebar.test.tsx src/__tests__/agentsPage.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** The vitest config has no alias for `@tauri-apps/api/event`; add `listen`/`emit` stubs to `src/__mocks__/tauri-api.ts` and map them in `vitest.config.ts`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(agents): agents page, list and start form`.

### Task 10: Agent detail: conversation, send, actions, answer buttons

**Files:**
- Create: `src/components/agents/AgentDetail.tsx`, `Conversation.tsx`, `PromptAnswer.tsx`, `src/__tests__/agentDetail.test.tsx`
- Modify: `src/pages/AgentsPage.tsx`, `src/i18n/ui.ts`

**Interfaces:**
- Consumes the Task 9 wrappers.
- `AgentDetail({agent})`:
  - **Header:** name, label, status.
  - **Actions:** Stop; Delete (with a confirm in the app's existing confirm dialog, not `window.confirm`); a model select that calls `switchModel`; Dismiss (only in needs you); Open terminal.
  - **`Conversation`:** refetches every 3 s while the agent is working.
  - **Message box:** enabled only when `kind === "background"` and `status !== "waiting"`.
  - **`PromptAnswer`:** shown when `group === "needs-you"` and kind is background.
- `PromptAnswer({shortId})` calls `getPrompt` every 2 s.
  - When it gets a prompt: show the question and one button per option. A click calls `answerPrompt(shortId, number, label)` and disables all buttons until the call returns.
  - On `Err` or no prompt: show "Answer this one in the terminal" with an Open terminal button.
- [ ] **Step 1: Failing tests:**
  - `message box disabled when waiting`
  - `message box disabled for interactive`
  - `no switch-model for interactive`
  - `prompt buttons call answerPrompt with number and label`
  - `prompt error falls back to terminal hint`
  - `buttons disabled while answering`
- [ ] **Step 2: Run** `npx vitest run src/__tests__/agentDetail.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(agents): agent detail, messages and prompt buttons`.

### Task 11: Terminal panel

**Files:**
- Create: `src/components/agents/TerminalPanel.tsx`, `src/__tests__/terminalPanel.test.tsx`
- Modify: `package.json` (`@xterm/xterm`, `@xterm/addon-fit`, installed with `npx -y npm@11 install`), `src/components/agents/AgentDetail.tsx`

**Interfaces:**
- Consumes: `termOpen`, `termWrite`, `termResize`, `termClose`, `AGENTS_TERM`.
- `TerminalPanel({shortId, onClose})`:
  - On mount, fit the terminal, then `termOpen(shortId, cols, rows)`.
  - Subscribe to `AGENTS_TERM` filtered by `termId`. Decode the base64 into a `Uint8Array` and pass it to `term.write`.
  - Send `onData` through `termWrite`. Call `termResize` on ResizeObserver changes.
  - On unmount, `termClose` and dispose.
  - Import `@xterm/xterm/css/xterm.css`. The CSP already allows inline styles; no CSP change.
  - The panel sits below or beside the detail pane.
  - When `termOpen` errors (for example, the ninth terminal), show the error text instead.
- [ ] **Step 1: Failing test** with `@xterm/xterm` mocked by `vi.mock`: `opens with fitted size and closes on unmount`, `writes decoded data for its termId only`, `shows open error`.
- [ ] **Step 2: Run** `npx vitest run src/__tests__/terminalPanel.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Manual end-to-end check** in `npm run tauri dev`, launching the built app from Finder rather than a terminal for the PATH check:
  1. Turn the switch on.
  2. Start an agent in a linked folder and see it labelled.
  3. Trigger a permission prompt and receive a Mac notification.
  4. Answer it with a button.
  5. Send a message.
  6. Open the terminal and run `! git status`.
  7. Switch model.
  8. Stop and delete.
  9. Turn the switch off: the sidebar entry disappears and no polling continues (check with `ps` that no `claude agents` processes appear).
- [ ] **Step 6: Commit** `feat(agents): attached terminal panel`.

### Task 12: Docs

**Files:**
- Create: `docs/agents.md`
- Modify: `README.md` (link it next to Agent access), `docs/agent-access.md` (one line pointing to [agents.md](../../agents.md)), `IDEAS.md` (tick the Agents window line)

- [ ] **Step 1:** Write `docs/agents.md` covering what the page does, the switch, the `claude` requirement, trusted folders, what answer buttons will and won't do, alerts only while the app is open, and the fact that the terminal only ever attaches to an agent. From `docs/agents.md`, link `superpowers/specs/2026-10-28-agents-window-design.md` and `agent-access.md` with relative Markdown links; from `README.md`, link `docs/agents.md`; from `docs/agent-access.md`, link `agents.md`.
- [ ] **Step 2: Run** the full check list from Global Constraints. Expected: all green, lint exit 0.
- [ ] **Step 3: Commit** `docs(agents): user guide for the Agents page`.
