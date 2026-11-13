# Agent Orchestrator, Part 4: Hubs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Loris adds a hub in Settings › Agents with a name, a colour, the hub's folder and a connector program. The app asks the connector, never more often than its retry rules allow, how many questions wait there, and shows one line per hub in Needs you with that count and "Open in the hub"; the count joins the sidebar and the menu bar while it is fresh. The hub's dated items show as a read-only, all-day layer in the Calendar, in the hub's colour, with a switch in the header; a click opens the item in the hub. Then the hub's open questions are listed inline (read only), and the capture field can send a thought into a hub. A project in a hub's folder, or marked as a hub's, is never merged alone, whatever the connector does. Part 4 starts no model session.

**Architecture:** No migration. A new Rust module, `src-tauri/src/agents/hubs/`, keeps the hubs in `<app data>/hubs.json` (StudioManager's own settings), the approved connectors as fingerprints in the Keychain (as command routines do), and the retry counters in `<app data>/hubs-state.json` (times and error kinds only, never connector output). The connector is run as argv (never a shell) in the hub's folder, with a timeout, an output cap and a cleared environment; its stdout must be one JSON object of a versioned contract, parsed strictly. What it returns is held in memory in a managed `HubsState` and refetched; commands return what is held at once and refresh in the background, so a slow or broken connector never holds up a screen, the watcher or Needs you. `open` targets are checked in Rust (https, loopback http, or a path inside the hub's folder revealed in Finder) and opened there. The merge rule of part 3 reads `hubs.json` fresh and refuses a project whose folder is inside a hub's folder. The UI gets a Hubs card in Settings, a "Connected hubs" group in Needs you, a calendar layer, and hubs in the capture field's picker.

**Tech Stack:** Rust (Tauri 2, serde, `sha2`, `chrono`, `libc`; the Keychain through `connectors::keychain`), the connector as an external program, React 19 + TypeScript, TanStack Query, FullCalendar 6, Vitest + Testing Library.

**Spec:** [2026-11-12-agent-orchestrator-design.md](../specs/2026-11-12-agent-orchestrator-design.md), part 4 ("4. Hubs", "The hub's timeline in the calendar"), goal 7, "Non-goals", "Data and tools", "Leeway" (a hub's project is never merged alone), "Decisions", "Build order" item 4, and part 3's line "A line per connected hub shows how many entries wait there". Mockups: [the four screens](../mockups/2026-11-12-agent-orchestrator.html), screens 2 and 4.

Builds on [part 1, capture and briefing](2026-11-12-agent-orchestrator-1-capture.md) (the capture field, the capture panel and its project picker), [part 2, a task carries its agent](2026-11-13-agent-orchestrator-2-task-agent.md), and [part 3, the watcher, the lead and "Needs you"](2026-11-13-agent-orchestrator-3-watcher-lead.md) (the Needs you tab, its count on the sidebar and the menu bar, `projects.hub_project`, merging alone).

Rules this plan follows: [CLAUDE.md](../../../CLAUDE.md), [DESIGN-SYSTEM.md](../../../DESIGN-SYSTEM.md), [Agent access](../../agent-access.md), [Agents](../../agents.md), [Menu bar](../../menu-bar.md), "Adding a Rust command" in [the README](../../../README.md#building-from-source), and [RELEASING.md, step 1](../../../RELEASING.md#1-pre-release-validation-all-must-pass).

## Calls made in this plan (the owner can overrule each)

The design leaves these open or the code forces them. Each is marked *my call* where it is used. The ones most likely to need his word come first.

1. **A hub's count joins the sidebar and menu bar count while it is fresh.** The number is open entries plus briefs plus each hub's "waiting" read in the last 15 minutes; a hub that could not be reached adds nothing and its line says why. The design's aim is one place to look; the cost is a badge that stays above zero while the hub has old questions (overrule: count hubs on their line only).
2. **The calendar layer is built now, on FullCalendar 6.** [IDEAS.md](../../../IDEAS.md) defers the move to 7 "only when v7 features are wanted", with no date; waiting would hold back the first-version item for nothing. The layer is a list of plain `EventInput` objects made by one pure function, so the move to 7 changes nothing in it beyond what the move changes for the page's other read-only events (invoices, quotes, upkeep).
3. **How a project is tied to a hub: the stored flag plus the folder, never the connector.** A project counts as a hub's for merging when `projects.hub_project` is 1 or its folder is the folder of a hub listed in `hubs.json`, or inside it. Saving a hub, and removing one, ticks `hub_project` (and turns `merge_alone` off) on every project of every organisation in that folder; removing a hub changes nothing else, so no project becomes mergeable by a removal. No migration and no project-to-hub column: nothing needs to know which hub, only that it is one.
4. **Hubs are part of Agents and app-wide.** They are set in Settings › Agents, need the Agents switch, and show whatever the active organisation is; `hubs.json` sits beside `agents.json`. A hub is not an organisation's data, and one list is simpler than one per organisation.
5. **Later items in this plan: the questions inline (read only) and capture into a hub.** `answer` is left out: in the client hub, recording an answer removes the question's line and writes a numbered decision, and part 4 must never delete in a hub; its questions also carry no recommendation or options to show as buttons. The hub's agents grouped under its name and one day brief with a section per hub are left out too (see "What is deliberately left out").
6. **Three PRs.** PR A (Tasks 1 to 7): the contract and fixture connector, running a connector, settings and approval, the count line, the project tie. PR B (Tasks 8 and 9): `events` and the calendar layer. PR C (Tasks 10 and 11): questions inline, capture into a hub. Task 12 is the docs. Each PR is hand-checked by Loris in the dev build with the fixture connector before the next is built. The first real hub is a separate, agreed, read-only step after the hub's repository provides its connector.
7. **The connector is approved like a command routine.** `hubs.json` is in the app data folder, which the webview can write; so each connector's program, arguments and folder are kept as a SHA-256 in the Keychain once Loris allows them in a native dialog, and a connector runs only while its fingerprint is there. No MCP tool reads or writes hubs.
8. **The request is the last argument; a payload goes on stdin.** The app runs `<program> <arguments…> <request> [<id>]`, with stdin closed for reads and one JSON object on stdin for `capture`. An id is passed back only if the connector listed it, and only when it matches `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`, so it is never read as an option.
9. **Strict answers, item by item.** The whole stdout must be one JSON object with `"version": 1` and only the known keys; anything else and the answer is refused. Inside a list, an item that breaks a rule (a bad date, a title too long, an unknown key) is dropped and counted ("2 items skipped"); the rest shows.
10. **Timeouts and caps.** Reads: 10 seconds, stdout at most 1 MiB (over it the program is killed and the answer refused), stderr's first line kept to 200 characters for the error. Capture: 30 seconds, then the process group gets SIGTERM and, 5 seconds later, SIGKILL (a hub may be in the middle of a git commit).
11. **Retries.** After a failure the next automatic try waits 1, 2, 4, 8, 16, then 32 minutes (capped at 60); after 6 failures in a row automatic tries stop until Loris presses "Try again". Even when it works, a request runs at most once per 30 seconds per hub, one at a time. The counters are in `hubs-state.json`, so a restart keeps them. Capture is never retried by the app.
12. **Refresh rhythm.** Counts every 5 minutes while the app runs and Agents is on (and when Needs you opens, if older than a minute); events when the Calendar shows with that hub's switch on, then every 15 minutes; questions when their list is opened.
13. **`open` opens only:** `https://` links with a host and no user name or password; `http://` only on `127.0.0.1`, `localhost` or `[::1]`; and absolute paths that resolve (symlinks followed) inside the hub's folder, which are opened in Finder (a folder) or revealed (a file), never launched, through the existing `finder` rules. Everything else is refused with its reason: `file:`, `javascript:`, `data:`, `mailto:`, any app scheme, a relative path, a path outside the folder, an application or script.
14. **Any organisation in test or presentation mode stops every connector call** (as call 11 of part 3 stops the watcher), and saving or removing a hub is refused then. The hub's data is not test data, and the tie writes to the real databases.
15. **Capture into a hub waits for the answer and never loses the text.** The field says "Saving to <hub>…"; a refusal or a timeout keeps the text and offers "Save in the inbox instead" (Loris's own words go to StudioManager's inbox, nothing from the hub). The MCP `capture` tool does not reach hubs.
16. **The questions list is read only.** Each question shows its text, its date when given, the recommendation when the hub gives one, and "Open in the hub". No option buttons until `answer` exists.
17. **At most 5 hubs.** Each has an id the app makes (`h` and 8 hex characters), never derived from its name.
18. **Colours are the tag colour names** (`TAG_COLOR_NAMES`), never a free CSS value, so a hub's colour cannot carry styles into the page.

Three candidate ideas were passed to this plan on 2026-11-13 from another session, as coming from Loris after he compared the orchestrator with another project's public contribution process. The planning session did not hear them from him directly, so each is a call to confirm:

19. **Numbered, testable behaviours in a brief: out of part 4, kept in [IDEAS.md](../../../IDEAS.md).** It changes what the brief session writes, what `report_result` takes and what the lead reads (parts 1 to 3), not hubs. It is the most useful of the three and the cheapest: a convention in the brief and in two prompts, no schema change. Suggested as the first follow-up after part 3's hand checks.
20. **Proof attached to a result: out of part 4, kept in IDEAS.md, after call 19.** A test named per numbered behaviour is proof the check command already runs; screenshots need a rule for where a worker may write them and how the Check entry shows a file a worker chose (the same care as `open` here: a path inside the worktree, revealed, never launched). The watcher must never touch the screen.
21. **"Needs mocks" as a state: out of part 4, kept in IDEAS.md.** Today a task is started only when it is Ready, and the brief session sets Ready only when the brief has no unclear point; a visual task with no design can already be left at Briefed with "needs a design" as its unclear point. A stage of its own is worth it only if that proves not enough.

## What protects Loris's work and usage

Part 4 runs a program that is not StudioManager's, unattended, and shows what it prints. Each limit below is checked in code before the action it guards, and each has a test.

| Limit | Where it is enforced | Test |
|---|---|---|
| **No model session.** Part 4 starts no `claude` session and spends no plan usage, so the budget rule (`watcher::budget::budget`) is not reached. The contract forbids a connector to start one; the app cannot stop a program the owner chose from doing it, so the contract doc says it and the hub's connector is reviewed for it. | No call to `actions::start`, `start_with` or the `claude` CLI in `agents/hubs/` | `hubs_start_no_session` (source scan, Task 2) |
| **Demo build first.** Every hub command checks `crate::host::is_demo` before it reads `hubs.json` or runs anything; `settings::read_hubs` returns nothing in the demo without reading the file. | `hubs::gate`, first line of each command | `demo_reads_no_file_and_runs_nothing` (Task 4), `every_host_command_is_gated_for_the_demo` (existing, covers `agents/`) |
| **Test and presentation mode, Agents off.** No connector runs while the Agents switch is off or any organisation has a `briefing::MODE_FILES` file; saving or removing a hub is refused then. | `hubs::gate(demo, agents_on, any_mode)`, in that order | `gate_order_demo_agents_mode` (Task 4) |
| **Set by the owner in the app only.** A connector runs only while the Keychain holds the fingerprint of its program, arguments and folder, written after a native "Allow this connector?" dialog. No MCP tool reads or writes hubs; the MCP tool count is unchanged. | `settings::approved` before every run; `hubs_save` shows the dialog | `edited_file_does_not_run` (Task 3), `protocol.rs` counts unchanged (Task 7) |
| **Argv, never a shell; cleared environment.** `PATH` (login shell), `HOME`, `LANG`, `USER`, `TMPDIR` only, as `routines::run::run_command`. | `run::run_connector` | `runs_without_a_shell` (a `;` in an argument reaches the program as text, Task 2) |
| **Timeout and output cap.** Reads 10 s, capture 30 s; stdout 1 MiB, stderr 4 KiB; the whole process group is stopped; quitting the app stops it too (`routines::run::stop_all`). | `run::run_connector` | `slow_connector_is_killed`, `huge_output_is_refused_and_killed`, `quit_stops_a_connector` (Task 2) |
| **Strict parsing; output is data.** One JSON object, version 1, known keys only; text has control characters removed and is cut to its cap; it is shown as plain text, never as HTML or Markdown, never typed into an agent, never logged. | `contract::parse_*`, `contract::clean_text` | `garbage_is_refused`, `trailing_text_is_refused`, `unknown_key_is_refused`, `control_characters_removed` (Task 2) |
| **Retry caps, kept over a restart.** 1 to 60 minutes between automatic tries, none after 6 failures until "Try again"; at most one run per request per hub per 30 s, one at a time; capture never retried. A connector that fails never blocks a screen: commands return what is held and refresh in the background. | `retry::may_run`, `retry::after_failure`, `HubsState` busy set | `backoff_doubles_and_pauses_after_six`, `restart_keeps_the_counters`, `clock_jumped_back_is_not_a_long_wait`, `one_run_at_a_time` (Task 3, Task 4) |
| **Nothing from a hub is stored.** No hub output goes into an organisation database, a backup, the agent log, `localStorage` or a log line; `hubs-state.json` holds times and an error kind, never text from the connector. The calendar switch stores only "on" or "off". | `retry::Tries` has no text field; `src/lib/hubs.ts` has no `logInfo`, `logWarn` or storage call | `state_file_holds_no_output` (Task 3), `hubs_ts_logs_and_stores_nothing` (source scan, Task 6) |
| **Never sent to Apple Calendar.** Hub events exist only in the Calendar page's memory; `src/lib/appleCalendar.ts` syncs tasks from the database. | No import of `src/lib/hubs.ts` in `appleCalendar.ts` | `apple_calendar_never_sees_hub_events` (source scan, Task 9) |
| **`open` targets** are https, loopback http, or a path inside the hub's folder revealed in Finder (call 13). | `open::check_target`, then `open::open` | `open_target_*` (Task 4) |
| **Nothing deletes in a hub.** The app sends only `counts`, `open`, `events`, `questions` and `capture`; there is no `answer` or delete request. Read requests must write nothing (contract); capture appends. | `run::Request` has exactly these five | `requests_are_exactly_the_five` (Task 2) |
| **A hub's project is never merged alone.** The merge refuses when `hub_project` is 1, when the project's folder is inside any hub in `hubs.json`, or when `hubs.json` exists and cannot be read. Removing a hub first ticks `hub_project` on the projects in its folder. A failing or absent connector changes nothing: the rule never asks it. | `watcher::lead::read_facts` (with `hubs::tie::in_any_hub`), `hubs::tie::mark_hub_projects` | `merge_refused_in_a_hub_folder`, `merge_refused_when_hubs_unreadable`, `removing_a_hub_keeps_its_projects_out` (Task 7) |
| **Real data untouched by tests.** Rust tests use temporary folders, temporary scripts and `MemoryStore`; Vitest mocks `invoke`. | test helpers | every test |

## Global Constraints

- **Schema:** no migration. `LATEST_VERSION` stays 18 (`src-tauri/src/migrate.rs`). The tie uses part 3's `projects.hub_project` and `projects.merge_alone`. `ensureSchema` is not touched; `src/lib/backup.ts` `TABLES` is not touched.
- **Feature gates:** hubs are part of Agents (`actions::switched_on`). Every command calls `hubs::gate` first: `crate::host::is_demo`, then the Agents switch, then any organisation in a mode (`briefing::in_mode` over the organisations, as the watcher's private `org_dbs`; made `pub(crate)` for this). In the app: `isDemoBuild()`, `useAppStore` `agentsEnabled`.
- **New Rust commands** go in the three lists (`generate_handler!` in `src-tauri/src/lib.rs`, `COMMANDS` in `src-tauri/build.rs`, `src-tauri/permissions/windows.toml`): all in `main-window`; `hubs_capture_targets` and `hubs_capture` also in `capture-window` and `menubar-window` (Task 11). `window_command_lists_match_the_handler` and `every_host_command_is_gated_for_the_demo` must pass.
- **No deletes** through the MCP server (no MCP change at all in part 4). Nothing in part 4 deletes anything in a hub. Removing a hub removes StudioManager's own setting and approval only.
- **Labels** in `src/i18n/labels/agents.ts`, EN and FR, added in the task that shows them. No emojis. Icons from `ICONS` (`openExternal`, `openFolder`, `calendar`, `warning`, `agents`).
- **Reuse, and new pieces flagged.** New: `HubsCard` (Settings), `HubForm` (in a `FormModal`), `HubLine` (Needs you), `HubQuestions` (Needs you), and the hub rows of the capture picker inside `CaptureField`. Reused: `SettingsCard`, `SettingRow`, `FormModal`, `Input`, `Textarea`, `DropdownSelect`, `Toggle`, `Button`, `Badge`, `FilterChip`, `Callout`, `EmptyState`, `useConfirm`, the Needs you `Group` row, `getNamedTagColor`, FullCalendar's own event rendering.
- **Money:** untouched.
- **Public repo:** made-up names only ("Demo hub", "Studio A", "Poster tool"); no client name, person's name, personal path, or content or file name of the client hub, in code, fixtures, tests, docs or commit messages.
- **Cargo:** from inside `src-tauri` with `CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager`; from inside `src-tauri/mcp` with `CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager-mcp` and `--locked`. Never the repo root. Never `cargo fmt` in `src-tauri/mcp`. `apple::tests::vision_ocr_reads_fixture_text` times out in background sessions: run it in a terminal or `--skip` it.
- **Hand checks** are Loris's, in the dev build (`npm run dev:test`, identifier `ch.studiomanager.dev`, its own data folder and Keychain service, fictional data), with the fixture connector of Task 1. None starts a model session. The real client hub is used only in the last, separate step agreed with Loris, read only.

## Risk for the owner's real work

| Task | What could touch real work | What limits it |
|---|---|---|
| 2. Running a connector | Runs a program on the Mac | Only an approved one; argv; 10 s; capped; group killed; stopped at quit |
| 3. Settings and approval | A changed `hubs.json` could point at another program | The Keychain fingerprint; a changed program, argument or folder asks again |
| 4. Commands, `open` | Opens a link or a path the connector chose | https, loopback http, or reveal in Finder inside the hub's folder only |
| 5 and 6. Count line, sidebar | A wrong number on the sidebar and the menu bar | Only fresh counts; a failing hub adds nothing and says why |
| 7. Tie | Writes `hub_project = 1`, `merge_alone = 0` on projects in every organisation | Only projects in the hub's folder; only makes merging stricter; refused in a mode |
| 9. Calendar layer | Could be dragged, or reach Apple Calendar | `editable: false`; never in the database; the sync reads the database only |
| 11. Capture into a hub | Writes into a client's repository (the hub commits and may push) | Only on Loris's Enter with the hub picked; append only; one try; the text is kept on failure; a timeout ends with SIGTERM before SIGKILL |
| Last step: the real hub | Reads the client hub | Read-only requests only, after its connector exists and Loris agrees; capture only when he says so |

## Review Focus

- **The connector missing, not approved or not executable:** the program was moved, the folder deleted, the Keychain entry missing (dev build or a fresh Mac), a permission denied. Each gives one line "Not reached: …", no run for an unapproved one, and the backoff. (Tests in Task 2 and Task 3.)
- **Slow, silent or stuck:** sleeps 60 s, never closes stdout, starts a child that keeps the pipe open, asks for input on stdin. Killed at 10 s with its group; stdin is closed for reads; Needs you and the sidebar keep showing what was held. (Tests in Task 2 and Task 4.)
- **Garbage or huge output:** a stack trace, two JSON objects, JSON then text, invalid UTF-8, `"version": 2`, an unknown key, 5 MiB of events, a `waiting` of `-1` or `1e9` or `"3"`. Each is refused as a whole and counts as a failure. (Tests in Task 2.)
- **Bad dates:** `2026-02-30`, `2026-13-01`, `26-1-5`, a time in the date, an end before its start, a span over 366 days, a year before 2000 or after 2100. Each drops that event only and is counted. The end is inclusive in the contract and exclusive in FullCalendar: an event of one day has no end or `end == start`. (Tests in Task 8.)
- **A hostile `open` target:** `file:///etc/hosts`, `javascript:alert(1)`, `https://user:pw@host`, `http://example.com`, `vscode://…`, `-a Terminal`, a relative path, `../` out of the folder, a symlink in the folder pointing out of it, an `.app` or a `.command` inside the folder. Each is refused with its reason and nothing is opened. (Tests in Task 4.)
- **Removing a hub or changing its folder:** its projects stay out of merging alone; a merge in progress during the change reads `hubs.json` again and refuses. (Tests in Task 7.)

---

### Task 1: The connector contract and the fixture connector

**Files:**
- Create: `docs/hub-connector.md` (the contract, written for whoever writes a connector)
- Create: `src-tauri/src/agents/hubs/fixtures/demo-hub/connector.sh`, `src-tauri/src/agents/hubs/fixtures/demo-hub/notes.txt`
- Test: `src-tauri/src/agents/hubs/fixtures/demo-hub/connector.sh` is run by the tests of Task 2

**The contract** (what `docs/hub-connector.md` says, version 1):

| Request (last argument) | Stdin | Stdout |
|---|---|---|
| `counts` | closed | `{"version":1,"waiting":3}`, 0 to 9999 |
| `open` | closed | `{"version":1,"url":"https://…"}` or `{"version":1,"path":"/absolute/path"}`: the hub itself |
| `open <id>` | closed | the same, for one item the connector listed |
| `events` | closed | `{"version":1,"events":[{"id":"…","title":"…","start":"YYYY-MM-DD","end":"YYYY-MM-DD","note":"…"}]}`; `end` is the last day, inclusive, optional; `note` optional |
| `questions` | closed | `{"version":1,"questions":[{"id":"…","text":"…","since":"YYYY-MM-DD","recommendation":"…"}]}`; only questions waiting on the owner; `since` and `recommendation` optional |
| `capture` | `{"text":"…"}` | `{"version":1,"saved":true}` |
| anything else | | `{"version":1,"error":"unsupported"}` |

- A failure: `{"version":1,"error":"<one line>"}`, or a non-zero exit. `"error":"unsupported"` means the request is not offered: the app hides that feature for the hub and does not count it as a failure.
- Limits: id 1 to 128 characters of `A-Z a-z 0-9 . _ : -`, not starting with a punctuation mark, stable from one call to the next; title at most 200 characters; note and question text at most 1000; recommendation at most 500; at most 2000 events and 200 questions; an event spans at most 366 days, between 2000-01-01 and 2100-12-31. No other key, at any level.
- What a connector must do: answer within 10 seconds (30 for `capture`, so write and commit first and push afterwards, detached); write nothing for `counts`, `open`, `events` and `questions`; never delete; start no model session and no agent; print nothing else on stdout (logs go to stderr); treat the capture text as plain data.
- What the app does with it: listed in "What protects" above, in words for a reader of the contract.

**The fixture** is a POSIX `sh` script with no dependency, for tests and hand checks. It reads a mode from `${TMPDIR:-/tmp}/sm-demo-hub-mode` (default `ok`): `ok` (3 waiting; six events over the current and next month, one of them three days long; three questions; `open` gives the fixture's `notes.txt` for the hub and `https://example.com/demo-hub/<id>` for an item); `slow` (sleeps 60 s); `garbage` (prints a stack trace); `huge` (prints 2 MiB); `fail` (exits 1 with an error on stderr); `bad-dates` (the `ok` events plus five bad ones); `hostile-open` (`open` answers `file:///etc/hosts`, then a path outside its folder); `unsupported` (every request unsupported); `capture-slow` (sleeps 40 s on `capture`). `capture` in `ok` mode appends nothing: it answers `saved` and writes the text to stderr only. Made-up titles only ("Poster tool: presets", "Winter fair", "Upkeep: template check").

- [ ] **Step 1:** Write `docs/hub-connector.md` with the table, the limits, the duties, what the app does, and relative links to [the Agents guide](../../agents.md) (from that file: `agents.md`) and the [design](../specs/2026-11-12-agent-orchestrator-design.md) (from that file: `superpowers/specs/…`). Write the fixture and `notes.txt` ("Demo hub: a made-up hub for StudioManager's tests.").
- [ ] **Step 2:** Run it by hand for each mode: `sh src-tauri/src/agents/hubs/fixtures/demo-hub/connector.sh counts` and so on (no app, no session). Commit `docs(hubs): the connector contract and a fixture connector`.

### Task 2: Running a connector and reading its answer

**Files:**
- Create: `src-tauri/src/agents/hubs/mod.rs` (module declarations only in this task), `hubs/run.rs`, `hubs/contract.rs`
- Modify: `src-tauri/src/agents/mod.rs` (`pub mod hubs;`), `src-tauri/src/agents/routines/run.rs` (`track_group`, `untrack_group` and `kill_group` become `pub(crate)`, so `stop_all` also stops a connector at quit)
- Test: unit tests in `run.rs` (temporary scripts written by the test, and the fixture) and `contract.rs`

**Interfaces:**
- `pub const READ_TIMEOUT: Duration = Duration::from_secs(10); pub const CAPTURE_TIMEOUT: Duration = Duration::from_secs(30); pub const TERM_GRACE: Duration = Duration::from_secs(5); pub const STDOUT_CAP: usize = 1024 * 1024; pub const STDERR_CAP: usize = 4 * 1024;`
- `pub enum Request { Counts, Open { id: Option<String> }, Events, Questions, Capture { text: String } }` with `fn name(&self) -> &'static str`, `fn tail_args(&self) -> Vec<String>` (the name, then the id), `fn stdin(&self) -> Option<String>` (`{"text":…}` for `Capture`, else None), `fn timeout(&self) -> Duration`.
- `pub fn valid_id(id: &str) -> bool` — the rule of call 8.
- `pub enum RunError { NotStarted(String), TimedOut, TooLarge, Exit { code: Option<i32>, line: String } }` with `fn kind(&self) -> retry::ErrorKind` (Task 3).
- `pub fn run_connector(program: &str, args: &[String], cwd: &str, path_env: &str, stdin: Option<&[u8]>, timeout: Duration) -> Result<Vec<u8>, RunError>` — as `run_command` (no shell, `env_clear`, own process group, tracked for `stop_all`), but stdout and stderr read apart; stdout read up to `STDOUT_CAP + 1` bytes, over it the group is killed and `TooLarge` returned; stderr keeps its first `STDERR_CAP` bytes; stdin written then closed, or `Stdio::null()`; on timeout SIGTERM to the group, SIGKILL after `TERM_GRACE` for capture, SIGKILL at once for reads; exit code non-zero → `Exit` with stderr's first non-empty line cleaned and cut to 200 characters.
- `pub trait Connector: Send + Sync { fn run(&self, hub: &settings::Hub, req: &Request, path_env: &str) -> Result<Vec<u8>, RunError>; }`, `pub struct RealConnector;` (tests use a fake that records calls).
- `contract.rs`: `pub const VERSION: u32 = 1;` the limits of Task 1 as constants (`MAX_WAITING`, `TITLE_CHARS`, `NOTE_CHARS`, `TEXT_CHARS`, `RECOMMENDATION_CHARS`, `MAX_EVENTS`, `MAX_QUESTIONS`, `MAX_SPAN_DAYS`, `ERROR_CHARS`); `pub enum Answer<T> { Ok(T), Unsupported, Failed(String) }`; `pub struct Counts { pub waiting: u32 }`; `pub enum Target { Url(String), Path(String) }`; `pub fn parse_counts(b: &[u8]) -> Result<Answer<Counts>, String>`; `pub fn parse_open(b: &[u8]) -> Result<Answer<Target>, String>` (exactly one of `url`, `path`); `pub fn parse_capture(b: &[u8]) -> Result<Answer<()>, String>`; `pub fn clean_text(s: &str, max_chars: usize) -> String` (control characters removed, runs of white space made one space, trimmed, cut at a character boundary). Every top-level struct uses `#[serde(deny_unknown_fields)]`; `version` must equal `VERSION`; `serde_json::from_slice` on the whole stdout (trailing text is an error).

- [ ] **Step 1: Write failing tests:** `requests_are_exactly_the_five` (the names, and that no request is called `answer` or contains `delete`); `runs_without_a_shell` (a test script echoes its arguments; the argument `a; touch x` arrives whole and no `x` is made); `stdin_closed_for_reads` (a script that reads stdin ends at once); `capture_gets_its_json_on_stdin`; `slow_connector_is_killed` (a 2-second sleep with a 300 ms test timeout: `TimedOut`, and its child, `sleep 30 &`, is gone too); `capture_timeout_terms_before_kill` (a script that traps TERM and writes a marker: the marker is written); `huge_output_is_refused_and_killed` (2 MiB: `TooLarge`, under a second); `exit_code_gives_the_first_stderr_line`; `quit_stops_a_connector` (`stop_all` during a run ends it); `garbage_is_refused`; `trailing_text_is_refused` (`{"version":1,"waiting":1} ok`); `two_objects_are_refused`; `unknown_key_is_refused`; `version_2_is_refused`; `waiting_out_of_range_is_refused` (`-1`, `10000`, `"3"`, `3.5`); `unsupported_is_not_a_failure`; `open_needs_exactly_one_target`; `control_characters_removed` (`\x1b[31m`, `‮`, NUL); `invalid_utf8_is_refused`; `valid_id` (accepts `ms-a.1:2`; refuses empty, `-x`, `.x`, 129 characters, `a b`, `a/b`); `hubs_start_no_session` (no file under `agents/hubs/` contains `start_with(`, `actions::start`, `real_cli` or `"claude"`); the fixture in `ok` mode parses.
- [ ] **Step 2:** Run `(cd src-tauri && CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager cargo test agents::hubs agents::routines::run)` — FAIL. **Step 3:** Implement. **Step 4:** Rerun, plus `cargo clippy --all-targets -- -D warnings` there — PASS. Commit `feat(hubs): run a hub's connector as argv with a timeout and an output cap`.

### Task 3: Hub settings, approval and retry counters

**Files:**
- Create: `src-tauri/src/agents/hubs/settings.rs`, `hubs/retry.rs`
- Test: unit tests in both (temporary folders, `connectors::keychain::MemoryStore`)

**Interfaces:**
- `pub const HUBS_FILE: &str = "hubs.json"; pub const MAX_HUBS: usize = 5; pub const NAME_CHARS: usize = 40; pub const MAX_ARGS: usize = 8; pub const ARG_CHARS: usize = 300; pub const KEYCHAIN_ACCOUNT: &str = "hub-connectors"; pub const COLOURS: [&str; 9]` (the names of `TAG_COLOR_NAMES` in `src/lib/tagColors.ts`; a test compares them).
- `#[serde(rename_all = "camelCase", deny_unknown_fields)] pub struct Hub { pub id: String, pub name: String, pub colour: String, pub folder: String, pub program: String, pub args: Vec<String> }`; `pub struct HubsFile { pub hubs: Vec<Hub> }`.
- `pub enum HubsRead { Absent, Hubs(Vec<Hub>), Unreadable(String) }`; `pub fn read_hubs(app_dir: &Path, demo: bool) -> HubsRead` — `demo` returns `Absent` before any read.
- `pub fn validate(input: HubInput, existing: &[Hub]) -> Result<Hub, String>` — name 1 to 40 characters, no control character, unique; colour in `COLOURS`; folder absolute, an existing folder, stored canonical, not `/` and not the home folder; program absolute, an existing file; at most 8 arguments, each at most 300 characters with no NUL or line break; at most 5 hubs; a new id `h` + 8 hex characters.
- `pub fn fingerprint(h: &Hub) -> String` — SHA-256 of the JSON of `(program, args, folder)`, as `routines::approve::fingerprint`.
- `pub fn approved(store: &dyn SecretStore, h: &Hub) -> bool`; `pub fn allow(store: &dyn SecretStore, h: &Hub) -> Result<(), String>`; `pub fn forget(store: &dyn SecretStore, h: &Hub) -> Result<(), String>` — one Keychain account holding one fingerprint per line, as `routines::approve::{load, save}`; an unreadable Keychain means nothing is approved.
- `pub fn write_hubs(app_dir: &Path, hubs: &[Hub]) -> Result<(), String>` — through `agent_access::write_atomic`, under a module lock.
- `retry.rs`: `pub const STATE_FILE: &str = "hubs-state.json"; pub const FIRST_WAIT_MS: i64 = 60_000; pub const MAX_WAIT_MS: i64 = 3_600_000; pub const MAX_AUTO_FAILS: u32 = 6; pub const MIN_GAP_MS: i64 = 30_000;`
- `pub enum ErrorKind { NotApproved, NotStarted, TimedOut, TooLarge, BadAnswer, Failed }`; `pub struct Tries { pub fails: u32, pub next_try_at: i64, pub last_run_at: i64, pub last_ok_at: Option<i64>, pub last_error: Option<ErrorKind> }` — no text field.
- `pub enum Wait { Gap(i64), Backoff(i64), Paused }`; `pub fn may_run(t: &Tries, now: i64, by_hand: bool) -> Result<(), Wait>` — by hand skips the backoff and the pause, never the gap; a `next_try_at` more than `MAX_WAIT_MS` ahead of `now` (the clock went back) counts as due.
- `pub fn after_failure(t: &mut Tries, kind: ErrorKind, now: i64)` (wait `min(FIRST_WAIT_MS << (fails - 1), MAX_WAIT_MS)`); `pub fn after_success(t: &mut Tries, now: i64)`; `pub fn read_tries(app_dir: &Path) -> HashMap<String, Tries>` (unreadable → empty; every hub then waits its gap only); `pub fn write_tries(app_dir: &Path, all: &HashMap<String, Tries>) -> Result<(), String>`. Keyed by hub id and request name.

- [ ] **Step 1: Write failing tests:** `validate` for each rule; `colours_match_the_tag_colours` (reads `src/lib/tagColors.ts` and compares the list); `fingerprint_keeps_argument_boundaries` (`["a b"]` is not `["a","b"]`); `edited_file_does_not_run` (a hub approved, then its `program` changed in `hubs.json` by hand: `approved` is false); `unreadable_keychain_approves_nothing`; `read_hubs_in_demo_reads_nothing` (a file that would fail to parse is not opened: `Absent`); `garbled_file_is_unreadable` (not `Absent`); `backoff_doubles_and_pauses_after_six` (1, 2, 4, 8, 16, 32 minutes, then `Paused`; by hand runs); `gap_holds_even_by_hand`; `restart_keeps_the_counters` (write, read back); `clock_jumped_back_is_not_a_long_wait`; `state_file_holds_no_output` (after a failure with a stderr line "secret line", the file does not contain it).
- [ ] **Step 2:** Run `(cd src-tauri && CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager cargo test agents::hubs)` — FAIL. **Step 3:** Implement. **Step 4:** Rerun, clippy — PASS. Commit `feat(hubs): hub settings, connector approval and retry counters`.

### Task 4: Commands, the in-memory cache and opening a target

**Files:**
- Modify: `src-tauri/src/agents/hubs/mod.rs` (`HubsState`, `gate`, the commands), `src-tauri/src/agents/mod.rs` (`init` manages `HubsState` and starts the 5-minute counts refresh), `src-tauri/src/agents/watcher/mod.rs` (`org_dbs` becomes `pub(crate)`)
- Create: `src-tauri/src/agents/hubs/open.rs`
- Modify: the three command lists
- Test: tests in `mod.rs` (fake `Connector`, `MemoryStore`, temporary app folder) and `open.rs` (temporary folders)

**Interfaces:**
- `pub enum Off { Demo, AgentsOff, Mode }`; `pub fn gate(demo: bool, agents_on: bool, any_mode: bool) -> Option<Off>` — that order; `any_mode` is any organisation with a `MODE_FILES` file, and an unreadable registry counts as a mode (fails closed).
- `pub const FRESH_MS: i64 = 15 * 60_000; pub const COUNTS_EVERY_MS: i64 = 5 * 60_000; pub const HUBS_CHANGED_EVENT: &str = "hubs-changed";`
- `pub struct HubsState { cache: Mutex<HashMap<String, Held>>, busy: Mutex<HashSet<(String, &'static str)>> }` — `Held { waiting: Option<(u32, i64)>, events: Option<(Vec<HubEvent>, usize, i64)>, questions: Option<(Vec<HubQuestion>, usize, i64)>, problem: Option<String>, unsupported: HashSet<&'static str> }`; memory only.
- `#[serde(rename_all = "camelCase")] pub struct HubView { id, name, colour, folder, approved: bool, waiting: Option<u32>, fresh: bool, checked_at: Option<i64>, problem: Option<String>, next_try_at: Option<i64>, paused: bool, busy: bool, offers: Vec<&'static str> }`.
- `pub struct HubInput { id: Option<String>, name, colour, folder, program, args }`.
- Commands (each `hubs::gate` first, then the work on a blocking thread):
  - `hubs_list() -> Vec<HubView>` — what is held; runs nothing.
  - `hubs_save(hub: HubInput) -> Result<HubView, String>` — validate; when the fingerprint is not approved, the native dialog "Allow this connector?" (program, arguments, folder in full; "Allow" and "Cancel", warning kind, as `routines::confirm_commands`); Cancel saves nothing; then `tie::mark_hub_projects` (Task 7), `write_hubs`, `allow`; a changed program, argument or folder drops the old fingerprint.
  - `hubs_remove(id: String) -> Result<(), String>` — the app confirms in the page; here `tie::mark_hub_projects` first, then the hub out of `hubs.json`, then `forget`; the held data and counters for it dropped.
  - `hubs_counts() -> Vec<HubView>` — returns at once; for each approved hub whose counts are older than a minute and `may_run`, starts one background run (skipped when busy); each run ends with `HUBS_CHANGED_EVENT`.
  - `hubs_refresh(id: String) -> Result<HubView, String>` — "Try again": `may_run(by_hand = true)`, runs counts in the background.
  - `hubs_open(id: String, item: Option<String>) -> Result<(), String>` — the item, when given, must be an id the cache holds for that hub (from events or questions) and `valid_id`; runs `open`, `open::check_target`, `open::open`. Not retried; a failure is returned as the error.
- `open.rs`: `pub const URL_CHARS: usize = 2048;` `pub enum Opener { Url(String), Finder(Vec<std::ffi::OsString>) }`; `pub fn check_target(t: &contract::Target, hub_folder: &Path) -> Result<Opener, String>` (call 13; a URL parsed with `tauri::Url` and passed on as the parser prints it; a path canonicalised, inside the canonical hub folder by path components, then `finder::path_open_args`); `pub fn open(o: &Opener) -> Result<(), String>` (`finder::run_open`, argv).

- [ ] **Step 1: Write failing tests:** `gate_order_demo_agents_mode`; `demo_reads_no_file_and_runs_nothing` (demo: the fake connector records no call and `hubs.json`, made unreadable, is not opened); `mode_stops_every_run` (a `studiomanager_test.db` beside one organisation's database: no call); `unapproved_hub_never_runs` (`problem` says it needs allowing); `counts_return_at_once_while_a_run_is_slow` (a fake that blocks: `hubs_counts` answers from the cache in under 50 ms, `busy` true); `one_run_at_a_time` (two calls during one slow run: one run); `failure_keeps_the_last_count_but_not_fresh` (after 15 minutes `fresh` is false); `unsupported_hides_the_feature`; `open_target_https_ok`; `open_target_loopback_http_ok` and `open_target_other_http_refused`; `open_target_userinfo_refused`; `open_target_schemes_refused` (`file`, `javascript`, `data`, `mailto`, `vscode`, `x-apple.systempreferences`); `open_target_path_inside_revealed` (args `-R <canonical>`); `open_target_folder_opens_in_finder`; `open_target_relative_refused`; `open_target_dotdot_out_refused`; `open_target_symlink_out_refused`; `open_target_app_inside_refused`; `open_item_not_listed_is_refused` (an id the cache does not hold runs nothing); `save_cancelled_writes_nothing` (dialog stubbed to false: no file, no Keychain entry).
- [ ] **Step 2:** Run `(cd src-tauri && CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager cargo test agents::hubs)` — FAIL. **Step 3:** Implement. **Step 4:** Rerun, plus `cargo test window_command_lists_match_the_handler every_host_command_is_gated_for_the_demo` and clippy — PASS. Commit `feat(hubs): hub commands, a cache in memory and safe opening`.

### Task 5: Hubs in the app's data layer

**Files:**
- Create: `src/lib/hubs.ts` (invoke wrappers and types: `HubView`, `HubInput`, `listHubs`, `saveHub`, `removeHub`, `hubCounts`, `refreshHub`, `openInHub`), `src/hooks/useHubs.ts`
- Modify: `src/db/queryKeys.ts` (`hubs: { all: ["hubs"], list: ["hubs", "list"] }`), `src/db/hooks/useNeedsYou.ts` (`useNeedsYouCount` adds the fresh hub counts, call 1)
- Test: `src/__tests__/hubs.test.ts`, `src/__tests__/agentsNeedsYou.test.tsx` (count)

**Interfaces:**
- `useHubs()` — `useQuery({ queryKey: qk.hubs.list, queryFn: hubCounts, refetchInterval: 5 * 60_000, enabled: agentsEnabled && !isDemoBuild() })`, and a listener on `hubs-changed` that invalidates `qk.hubs.all`.
- `useHubWaiting(): number` — the sum of `waiting` over hubs with `fresh` true.
- `useNeedsYouCount()` becomes `open.length + briefs.length + useHubWaiting()`.
- `src/lib/hubs.ts` calls no `logInfo`, `logWarn`, `logError`, `localStorage` or `sessionStorage`.

- [ ] **Step 1: Write failing tests:** the wrappers call the right commands with the right arguments; `useHubWaiting` counts only fresh hubs; the Needs you count adds 3 for a fresh hub with 3 waiting and 0 for a stale one; `hubs_ts_logs_and_stores_nothing` (source scan of `src/lib/hubs.ts` and `src/hooks/useHubs.ts`); in the demo build `useHubs` never invokes.
- [ ] **Step 2:** Run `npx vitest run src/__tests__/hubs.test.ts src/__tests__/agentsNeedsYou.test.tsx` — FAIL. **Step 3:** Implement. **Step 4:** Rerun — PASS. Commit `feat(hubs): hubs and their counts in the app's data layer`.

### Task 6: Settings › Agents › Hubs, and the hub's line in Needs you

**Files:**
- Create: `src/components/settings/HubsCard.tsx` (new piece), `src/components/settings/HubForm.tsx` (new piece), `src/components/agents/HubLine.tsx` (new piece)
- Modify: `src/pages/SettingsPage.tsx` (`HubsCard` after `AgentsCard`, shown while Agents is on), `src/components/agents/NeedsYouTab.tsx` (a "Connected hubs" group last, as in the mockup; the empty state only when there are no entries and no hubs), `src/i18n/labels/agents.ts`
- Test: `src/__tests__/hubsCard.test.tsx`, `src/__tests__/agentsNeedsYou.test.tsx`, `src/__tests__/Sidebar.test.tsx`

**HubsCard** (`SettingsCard`, title "Hubs", description "Another store of work with its own files, such as a client's knowledge repository. StudioManager asks its connector for counts and dates and keeps nothing."): one `SettingRow` per hub with a dot in its colour, its name, its folder, and a state line: "3 waiting, checked 2 minutes ago", "Not reached: timed out after 10 seconds. Next try at 14:05", "Paused after 6 failed tries", "Needs allowing: open it and save". Buttons: Edit, Try again, Remove (`useConfirm`: "Remove Demo hub? Its projects stay marked as a hub's, so the lead never merges them alone."). "Add a hub" opens `HubForm`.
**HubForm** (`FormModal`): Name (`Input`), Colour (`DropdownSelect` of the tag colour names, with a dot), Folder (`Input` and "Choose…" with the folder dialog), Program (`Input` and "Choose…"), Arguments (`Textarea`, one per line, "The request name is added after these."). Save calls `saveHub`; the native dialog follows; Cancel there leaves the form open with "Not allowed: nothing was saved."
**HubLine** (mockup screen 2): the dot, the name, `Badge` "3 waiting" (none at 0), or a muted "Not reached: …" with "Try again"; "Open in the hub" (`Button`, ghost, `ICONS.openExternal`) calls `openInHub(id)`; an error from it shows under the line.

- [ ] **Step 1: Write failing tests:** the card lists two hubs with their states; Remove asks, then calls `removeHub`; the form refuses an empty name and sends the arguments split by line; a cancelled approval keeps the form open with its message; Needs you shows the Connected hubs group with "3 waiting" and the link; a stale hub shows "Not reached" and Try again; Needs you with no entries but one hub shows the group, not the empty state; the sidebar badge includes the fresh hub count.
- [ ] **Step 2:** Run `npx vitest run src/__tests__/hubsCard.test.tsx src/__tests__/agentsNeedsYou.test.tsx src/__tests__/Sidebar.test.tsx` — FAIL. **Step 3:** Implement. **Step 4:** Rerun — PASS. Commit `feat(hubs): add a hub in Settings and see its count in Needs you`.

### Task 7: The tie: a hub's projects are never merged alone

**Files:**
- Create: `src-tauri/src/agents/hubs/tie.rs`
- Modify: `src-tauri/src/agents/watcher/lead.rs` (`read_facts` sets `MergeFacts.hub_project` to true also when `tie::in_any_hub` says so, or when `hubs.json` is unreadable; it already runs before the first refusal and again after the check), `src/components/project/ProjectAgentSettings.tsx` ("Belongs to a hub" shown on and disabled, "In the folder of Demo hub", when the project's folder is in a hub's folder), `src/i18n/labels/agents.ts`
- Test: `tie.rs` tests, `src-tauri/src/agents/watcher/lead/tests.rs`, `src/__tests__/projectAgentSettings.test.tsx`, `src-tauri/mcp/tests/protocol.rs` (run, unchanged)

**Interfaces:**
- `pub fn folder_in(folder: &str, root: &str) -> bool` — the rule of `projects::FolderIndex::label_for` (path components, a trailing `/` ignored), on canonical paths when both exist, compared without case (the Mac's default file system).
- `pub fn in_any_hub(app_dir: &Path, folder: Option<&str>) -> Result<bool, String>` — `Absent` → false; `Unreadable` → `Err` (the merge treats it as a hub); no folder → false.
- `pub fn mark_hub_projects(app_dir: &Path, hub_folder: &str) -> Result<usize, String>` — for each organisation (`Registry::load`, `org_dir`, `DB_FILE`), under `crate::org_shared()`, read `id, folder_path` of projects, decide with `folder_in` in Rust (no `LIKE`: a `%` or `_` in a folder name would match too much), then `UPDATE projects SET hub_project = 1, merge_alone = 0 WHERE id = ?1` in one transaction per organisation. Refused while any organisation is in a mode. Returns how many projects changed.
- `src/lib/hubs.ts`: `hubForFolder(folder: string | null, hubs: HubView[]): HubView | null` — the same rule, for the display only.

- [ ] **Step 1: Write failing tests:** `folder_in` (equal, inside, a sibling with the same prefix `hub-old` not inside, trailing slash, case); `mark_hub_projects` marks two projects in two organisations and leaves a third outside; it turns `merge_alone` off; it is refused with a mode file; `merge_refused_in_a_hub_folder` (a project with `hub_project = 0`, `merge_alone = 1`, its folder inside a hub's: the accept path ends "the project belongs to a hub", nothing run); `merge_refused_when_hubs_unreadable`; `removing_a_hub_keeps_its_projects_out` (a project made in the folder after the hub was saved, then the hub removed: `hub_project = 1`, and the merge refuses); `hub_ticked_during_the_check_stops_the_merge` (the second `read_facts` sees the new hub); the project settings show the disabled switch with the hub's name; `protocol.rs` and `tool_count_follows_allow_money` pass unchanged.
- [ ] **Step 2:** Run `(cd src-tauri && CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager cargo test agents::hubs::tie agents::watcher::lead)` and `npx vitest run src/__tests__/projectAgentSettings.test.tsx` — FAIL. **Step 3:** Implement. **Step 4:** Rerun, plus `(cd src-tauri/mcp && CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager-mcp cargo test --locked)` and clippy — PASS.
- [ ] **Step 5:** Full checks of [RELEASING.md, step 1](../../../RELEASING.md#1-pre-release-validation-all-must-pass). Hand check (Loris, dev build, no session): (1) Settings › Agents › Hubs › Add a hub: "Demo hub", purple, folder `<repo>/src-tauri/src/agents/hubs/fixtures/demo-hub`, program `/bin/sh`, argument `<repo>/src-tauri/src/agents/hubs/fixtures/demo-hub/connector.sh`; the native dialog shows them; Allow. (2) Needs you shows "Demo hub · 3 waiting"; the sidebar and the menu bar number rise by 3. (3) "Open in the hub" reveals `notes.txt` in Finder. (4) In a terminal, `echo slow > "$TMPDIR/sm-demo-hub-mode"`, then Try again: the line says it timed out after 10 seconds; the app stays responsive throughout; the count leaves the sidebar after 15 minutes. (5) Modes `garbage`, `huge`, `fail`, `hostile-open`: each gives its reason, nothing opens. (6) Edit `hubs.json` by hand to another program: the hub says it needs allowing and nothing runs. (7) A fictional project with its folder inside the fixture folder: its "Belongs to a hub" switch is on and disabled. (8) Test mode on: nothing runs, Save is refused. `echo ok > "$TMPDIR/sm-demo-hub-mode"` at the end. Commit `feat(hubs): a hub's projects are never merged alone`. **End of PR A.**

### Task 8: `events`: reading the hub's dates

**Files:**
- Modify: `src-tauri/src/agents/hubs/contract.rs` (`HubEvent`, `parse_events`), `hubs/mod.rs` (command `hubs_events`), the three command lists, `src/lib/hubs.ts`, `src/hooks/useHubs.ts`, `src/db/queryKeys.ts` (`hubs.events(id)`)
- Test: `contract.rs` tests, `mod.rs` tests, `src/__tests__/hubs.test.ts`

**Interfaces:**
- `#[serde(rename_all = "camelCase")] pub struct HubEvent { pub id: String, pub title: String, pub start: String, pub end: Option<String>, pub note: Option<String> }` (dates `YYYY-MM-DD`, checked, `end` omitted when equal to `start`).
- `pub fn parse_date(s: &str) -> Option<chrono::NaiveDate>` — exactly `\d{4}-\d{2}-\d{2}`, then `NaiveDate::from_ymd_opt`, 2000-01-01 to 2100-12-31.
- `pub fn parse_events(b: &[u8]) -> Result<Answer<(Vec<HubEvent>, usize)>, String>` — the list and how many items were skipped; over `MAX_EVENTS` items → refused as a whole.
- `hubs_events(id: String) -> Result<HubEventsView, String>` with `HubEventsView { events: Vec<HubEvent>, skipped: usize, checked_at: Option<i64>, problem: Option<String>, busy: bool }` — returns what is held; starts a background run when older than 15 minutes and `may_run`.
- `useHubEvents(id: string, enabled: boolean)`.

- [ ] **Step 1: Write failing tests:** each bad date of the Review Focus drops one item and counts it; `end` before `start` dropped; 367 days dropped; `end == start` gives no `end`; a title of 201 characters dropped; an unknown key on one event drops it (strict per item, call 9); 2001 events refused as a whole; the fixture in `bad-dates` mode gives 6 events and 5 skipped; `hubs_events` answers from the cache while a run is slow; the events are kept in memory only (`hubs-state.json` holds no title after a run).
- [ ] **Step 2:** Run `(cd src-tauri && CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager cargo test agents::hubs)` and `npx vitest run src/__tests__/hubs.test.ts` — FAIL. **Step 3:** Implement. **Step 4:** Rerun, clippy, the command list tests — PASS. Commit `feat(hubs): read a hub's dated items`.

### Task 9: The calendar layer

**Files:**
- Create: `src/lib/hubCalendar.ts` (`hubEventInputs(hub: HubView, events: HubEvent[]): EventInput[]`)
- Modify: `src/pages/CalendarPage.tsx` (one `FilterChip` per hub in the header, before the upkeep chips, remembered per organisation with the existing `readFlag` and `toggleFlag` under `calendarShowHub:<id>`; the hub events joined to `events` while on; `handleEventClick` handles `type: "hub"` with `openInHub(hubId, itemId)`; a small muted line under the header when a hub shown could not be reached or skipped items: "Demo hub: 2 items skipped"), `src/i18n/labels/agents.ts`
- Test: `src/__tests__/hubCalendar.test.ts`, `src/__tests__/calendarHubLayer.test.tsx`, `src/__tests__/appleCalendarSync.test.ts` (one more case)

**Interfaces:**
- `hubEventInputs` — for each event: `id: "hub-<hubId>-<eventId>"`, `title`, `start`, `end` = the day after the inclusive end (FullCalendar's end is exclusive), `allDay: true`, `editable: false`, `startEditable: false`, `durationEditable: false`, `backgroundColor` and `textColor` from `getNamedTagColor(hub.colour)`, `extendedProps: { type: "hub", hubId, itemId, note }`. Pure: no call, no store.
- The note shows as the event's tooltip (`title` attribute through `eventDidMount`), as plain text.
- `calendarAgentTarget` already returns null for an unknown type, so no "Start work with agent" menu on a hub event (checked by a test, no change).

- [ ] **Step 1: Write failing tests:** `hubEventInputs` gives an exclusive end one day after the inclusive end; a one-day event has no end; colours from the tag colour; nothing editable. Page: the chip shows per hub and hides its events when off; the choice is remembered; a click calls `openInHub` with the hub and item ids; dragging a hub event calls no update (`handleEventChange` never sees `type: "hub"`); a right-click shows no agent menu; the "skipped" line shows; in the demo build no chip and no call. `apple_calendar_never_sees_hub_events`: `src/lib/appleCalendar.ts` does not import `hubs`, and a sync after hub events were shown sends only the database's tasks.
- [ ] **Step 2:** Run `npx vitest run src/__tests__/hubCalendar.test.ts src/__tests__/calendarHubLayer.test.tsx src/__tests__/appleCalendarSync.test.ts` — FAIL. **Step 3:** Implement. **Step 4:** Rerun, plus the full checks of RELEASING.md step 1 — PASS.
- [ ] **Step 5: Hand check (Loris, dev build, no session):** (1) Calendar: a "Demo hub" chip in the header; on, six purple all-day events this month and next, one over three days. (2) Dragging or resizing one does nothing. (3) A click opens `https://example.com/demo-hub/<id>` in the browser. (4) Mode `bad-dates`: "Demo hub: 5 items skipped", the six good ones stay. (5) Mode `slow`: the calendar shows at once with the last events. (6) The Apple Calendar named in Settings gets no hub event after a sync. (7) The chip off, a restart: it stays off. Commit `feat(hubs): a hub's dates as a read-only layer in the calendar`. **End of PR B.**

### Task 10: The hub's questions inline, read only

**Files:**
- Modify: `src-tauri/src/agents/hubs/contract.rs` (`HubQuestion`, `parse_questions`), `hubs/mod.rs` (`hubs_questions`), the three command lists, `src/lib/hubs.ts`, `src/hooks/useHubs.ts`, `src/db/queryKeys.ts` (`hubs.questions(id)`)
- Create: `src/components/agents/HubQuestions.tsx` (new piece)
- Modify: `src/components/agents/HubLine.tsx` (a "Show the questions" toggle, with `ChevronRight` as the Briefs item, when the hub offers `questions`), `src/i18n/labels/agents.ts`
- Test: `contract.rs` tests, `src/__tests__/agentsNeedsYou.test.tsx`

**Interfaces:**
- `pub struct HubQuestion { pub id: String, pub text: String, pub since: Option<String>, pub recommendation: Option<String> }`; `pub fn parse_questions(b: &[u8]) -> Result<Answer<(Vec<HubQuestion>, usize)>, String>`.
- `hubs_questions(id: String) -> Result<HubQuestionsView, String>` — as `hubs_events`; fetched when the list is opened, then kept 5 minutes.
- `HubQuestions`: one row per question (the Needs you row style), the text, "Since 12 Nov." when given, "Recommended: …" when given, "Open in the hub" (`openInHub(hubId, questionId)`). No option buttons and no answer field (call 16). The hub's count on the line stays the `counts` answer.

- [ ] **Step 1: Write failing tests:** parse rules (text cut and cleaned, a bad `since` drops the item, 201 questions refused); the toggle shows only for a hub that offers questions; rows show text, date and recommendation as plain text (a `<b>` in the text shows as `<b>`); Open calls `openInHub` with the question id; nothing is written to the database (no query call).
- [ ] **Step 2:** Run the Rust and Vitest tests above — FAIL. **Step 3:** Implement. **Step 4:** Rerun, clippy — PASS. Commit `feat(hubs): list a hub's questions in Needs you`.

### Task 11: Capture into a hub

**Files:**
- Modify: `src-tauri/src/agents/hubs/mod.rs` (`hubs_capture_targets`, `hubs_capture`), the three command lists (both also in `capture-window` and `menubar-window`), `src/lib/hubs.ts`, `src/components/agents/CaptureField.tsx` (hub rows first in the Tab picker, under "Hubs", then the projects; a picked hub shows as the target tag; Enter calls `captureInHub`), `src/i18n/labels/agents.ts`
- Test: `mod.rs` tests, `src/__tests__/captureField.test.tsx`, `src/__tests__/capturePanelCommands.test.ts`, `src/__tests__/menuBarCommands.test.ts`

**Interfaces:**
- `hubs_capture_targets() -> Vec<CaptureHub { id, name, colour }>` — approved hubs not marked `unsupported` for capture; no run.
- `hubs_capture(id: String, text: String) -> Result<(), String>` — gate; text trimmed, 1 to 2000 characters, control characters but line breaks removed; `may_run` gap only; one run with `CAPTURE_TIMEOUT`; `parse_capture`; never retried; the error is the connector's line cleaned to 200 characters, or "Timed out: the hub may have saved it."
- `CaptureField`: while saving, "Saving to Demo hub…" and the field locked; on success, as today (`onSaved`); on failure, the text stays with the reason and a button "Save in the inbox instead" (`addCapture` with the same text, no project).

- [ ] **Step 1: Write failing tests:** the picker lists hubs before projects; saving to a hub calls only `hubs_capture`; a refusal keeps the text and shows the reason; "Save in the inbox instead" calls `capture_add` with the text; the capture panel's command list test now allows exactly `capture_add`, `capture_hide`, `capture_projects`, `hubs_capture`, `hubs_capture_targets`; the menu bar's list likewise; `capture_is_never_retried` (a failing fake is called once); a 2001-character text is refused before any run; in a mode, refused with the existing `CAPTURE_MODE` wording.
- [ ] **Step 2:** Run `(cd src-tauri && CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager cargo test agents::hubs)` and `npx vitest run src/__tests__/captureField.test.tsx src/__tests__/capturePanelCommands.test.ts src/__tests__/menuBarCommands.test.ts` — FAIL. **Step 3:** Implement. **Step 4:** Rerun, the full checks — PASS.
- [ ] **Step 5: Hand check (Loris, dev build, no session):** (1) Control-Option-Space, Tab: "Demo hub" first; pick it, type "Try a wider grid", Enter: the panel closes; the dev build's terminal shows the fixture's stderr line. (2) Mode `capture-slow`: the field says "Saving to Demo hub…", then after 30 seconds "Timed out: the hub may have saved it." with the text kept; "Save in the inbox instead" puts it in the Inbox tab. (3) Mode `unsupported`: the hub is not offered in the picker after the next refresh. (4) Needs you: "Show the questions" lists three made-up questions; Open goes to example.com. Commit `feat(hubs): capture into a hub from the capture field`. **End of PR C.**

### Task 12: Docs and the spec's list of plans

- Create or finish: `docs/hub-connector.md` (Task 1) with a link back to [the Agents guide](../../agents.md) and to this plan.
- Modify: `docs/agents.md` — a section "Hubs": adding one, the approval, the line in Needs you and the count, the calendar layer and its switch, the questions, capture into a hub, what the app keeps (nothing), what it opens, the retry rhythm, the tie with merging alone; links to the connector contract (`docs/hub-connector.md`, new in Task 1), the [design](../specs/2026-11-12-agent-orchestrator-design.md) and this plan.
- Modify: `docs/menu-bar.md` (the number includes fresh hub counts; capture into a hub from the panel's field), `docs/agent-access.md` (one line under the safety rules: no tool reads, writes or runs a hub connector; the tool count is unchanged).
- Modify: `IDEAS.md` (the line "Hubs: a connector for another store of work…": built, awaiting hand checks, with links to this plan and the contract; and the left-out items of this plan as open lines), the spec's header list of plans (part 4, this file).
- [ ] Run the checks of [RELEASING.md, step 1](../../../RELEASING.md#1-pre-release-validation-all-must-pass) in both crates and the app. All pass. Commit `docs(hubs): hubs, the connector contract and the calendar layer`.

---

## Spikes owed

None of them starts a model session.

- **Before PR A, Task 4: the native dialog from a hub command in the dev build.** Routines already show one from a blocking thread; check it shows over Settings and that the dev build's Keychain service keeps the approval across a restart. Fallback: the approval asked in the page with `useConfirm`, and the fingerprint still in the Keychain (weaker against a webview that writes files; say so in the docs).
- **Before PR A, Task 2: killing a connector's whole group.** A Python connector that starts `git`: does SIGKILL of the group leave nothing behind? Tried with the fixture and a test script; no real hub. Fallback: none needed for reads (they must start nothing that writes).
- **Before PR C, Task 11: does the capture panel stay up while it waits?** The panel is a borderless window that hides on Save and Esc; whether it hides when it loses focus during a 30-second wait is *not verified*. Fallback: the save goes on in Rust, the result comes back as a notification through the existing `notify`, and a failure saves the text in the inbox with the reason in its text.
- **Owed in the hub's repository (separate work, not built here):** a connector program that answers the contract. For the client hub this means: `counts` from its open questions waiting on the owner (snoozed ones left out, as its own checks do); `events` from the same sources its calendar feed uses today, which is put together by its separate dashboard and not by the hub repository, so that logic has to move into the hub or be called from it; stable ids for events (its feed already has them) and for questions (it has none today: for example a hash of a question's date and text, which changes when the text is edited); `open` as an https link to the item in the hub's private remote or a path inside the hub; `capture` as its existing inbox append, answering once the line is committed and pushing after; reads writing nothing; no model session started. Its own dashboard is retired there, later, as the design says.
- **The first real hub (last, separate step, agreed with Loris):** in the dev build, add the client hub with its connector, read-only requests only (`counts`, `events`, `questions`, `open`); compare the count and the dates with the hub's own view; no capture until Loris says so. Costs no session.

## What is deliberately left out

- **`answer`.** In the client hub, an answer removes the question's line and writes a numbered decision: a delete and a numbering only the hub's own session should do. Its questions have no recommendation or options to show as buttons. Owed first in the hub's repository: an append-only answer record its session settles. Until then, Loris answers in the hub; "Open in the hub" takes him there.
- **The hub's agents grouped under its name.** Agents working in the hub's folder are already listed in All agents, and labelled with a project when the hub's folder is a project's folder (`FolderIndex::label_for`). A separate hub group would duplicate the state groups (needs you, working, idle, done); left for when Loris asks.
- **One day brief with a section per hub.** The morning and end-of-day briefs are rendered outside this repo. They can ask the hub through its own tools; nothing here changes.
- **Hubs per organisation.** One app-wide list (call 4).
- **Writing back dates.** The layer is read only: dates are changed in the hub.
- **Notifications for hub changes.** An anti-goal of the design.
- **A connector over the network.** Only a program on this Mac; no URL connector.
- **Numbered behaviours in a brief, proof on a result, a "needs mocks" state** (calls 19 to 21): not hubs; listed in [IDEAS.md](../../../IDEAS.md) by the docs PR of part 3.
- **From part 2's and part 3's lists:** "Hubs (part 4)" is this plan. The rule that a hub's project is never merged alone was built in part 3 and is kept and widened here (Task 7). Part 3's other left-out items (the Running tab, agents on a second machine, removing worktrees and branches) stay left out; part 4 does not touch them.

## Design gaps and decisions taken in this plan

Points where the design did not say enough for code, or where the code differs from what it assumed. Each is a call the owner can overturn. Verified in the code at f1fa8a3 unless marked *not verified*.

1. **"Built with or after the planned move to FullCalendar 7".** The move is deferred with no date ([IDEAS.md](../../../IDEAS.md): "upgrade only when v7 features are wanted"); `package.json` has FullCalendar 6. Built now on 6 (call 2). Whether v7 changes `EventInput`'s `editable`, `backgroundColor` and `extendedProps` is *not verified*; the layer uses nothing else.
2. **The client hub's dates are not produced by the hub's repository.** The design says the hub "already produces exactly this list for its own calendar feed". The list (id, title, start, inclusive end, note) exists, but it is built by the hub's separate dashboard, which is to be retired. The connector must carry that logic (Spikes owed). The contract keeps the same shape, with the end inclusive.
3. **The hub's questions have no ids, no recommendation and no options.** `questions` returns them when the hub has them; the list is read only (call 16).
4. **Answering in the client hub deletes.** `answer` is left out (call 5).
5. **No hub existed in the data, so "a project that belongs to a connected hub" had no meaning beyond part 3's `projects.hub_project` flag** (`watcher::store::MergeFacts`, `merge::Refusal::HubProject`). Decided: the flag or the folder, never the connector; saving and removing a hub ticks the flag (call 3). The MCP `update_project` and `link_folder` tools can change a project's folder, so the stored flag is the main guard and the folder rule a second one while the hub is listed.
6. **"Added in Settings with a name, a colour and a connector command"** does not say where the connector runs or what `open` may point at. A hub also needs its folder: the connector runs there, a path from `open` must be inside it, and the tie uses it.
7. **The connector command is a program run unattended**, and `hubs.json` is in a folder the webview can write (the fs scope of `src-tauri/capabilities/default.json` includes the app data folder). The routines' answer is reused: a native dialog and a Keychain fingerprint (call 7).
8. **"Connector output is held in memory and refetched"** leaves the retry state open. Times and error kinds are kept in `hubs-state.json` so a restart keeps the caps; no text from the connector is written (call 11).
9. **`open` "returns a link or path".** The app never launches a file: a path is opened in Finder or revealed, as `finder::path_open_args` does for every path the app opens (call 13). A file the hub would rather open in an editor is shown in Finder.
10. **The design's sidebar and menu bar count** was defined for part 3's entries. Hub counts join it while fresh (call 1).
11. **Hubs and organisations.** The design does not say; app-wide (call 4).
12. **`routines::run::run_command` interleaves stdout and stderr and keeps the last 64 KB**, which cannot carry a JSON answer: a sibling runner reads them apart and refuses over the cap (Task 2). The process tracking for quit is shared.
13. **The capture panel and the menu bar panel** may call only the commands of their sets in `src-tauri/permissions/windows.toml`; the two capture commands are added there (Task 11). The MCP `capture` tool stays StudioManager's inbox only.
14. **A connector could start a model session** behind the app's back. The app starts none; the contract forbids it; the hub's connector is reviewed for it. The budget rule cannot see it.
15. **The demo build and the modes.** `cli::in_build` turns Agents off in the demo, so hubs are off there twice over; the hub commands still check `crate::host::is_demo` first. The modes stop every connector call (call 14).
16. **The dev build has its own data folder and Keychain service**, so a hub added there is separate from the installed app's; the hand checks use the fixture.
