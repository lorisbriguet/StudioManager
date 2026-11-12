# Agent Orchestrator, Part 1: Capture and Briefing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A thought is captured in one gesture (Control-Option-Space, the menu bar panel, an agent, or a reminder from the phone) into the active organisation's inbox. Every 15 minutes at most, one background Opus "brief session" files the new captures under projects as tasks or subtasks with a brief, and the ones that need Loris's word show under "Needs you" › Briefs on the Agents page.

**Architecture:** One migration adds `captures` and the `brief` and `stage` columns. Captures are written by a Rust module (`src-tauri/src/agents/capture.rs`) that both webviews without SQL access (the menu bar panel and a new capture panel) call, and by four new Agent access tools in the MCP server. The Agents page gets tabs (Needs you, Inbox, All agents). The brief session is a new scheduler thread (`src-tauri/src/agents/briefing.rs`) on the model of `routines::schedule::start`: it starts the session with the existing `actions::start` (`claude --bg`), watches it in the poller's list (`AgentsState::cached`), then stops it. Reminders come last, read with a fixed AppleScript in `src-tauri/src/apple.rs`, after a spike.

**Tech Stack:** Rust (Tauri 2.12, rusqlite 0.32, tauri-nspanel, new `tauri-plugin-global-shortcut`), the `studiomanager-mcp` crate (rmcp `#[tool]` router), React 19 + TypeScript, TanStack Query, Vitest + Testing Library, AppleScript through `osascript`.

**Spec:** [2026-11-12-agent-orchestrator-design.md](../specs/2026-11-12-agent-orchestrator-design.md), part 1 ("1. Capture and briefing", "Data and tools", "Decisions", "Build order" item 1). Mockups: [the four screens](../mockups/2026-11-12-agent-orchestrator.html), screens 1 and 2 (Briefs group only).

Rules this plan follows: [CLAUDE.md](../../../CLAUDE.md), [DESIGN-SYSTEM.md](../../../DESIGN-SYSTEM.md), [Agent access](../../agent-access.md), [Agents](../../agents.md), [Menu bar](../../menu-bar.md), "Adding a Rust command" in [the README](../../../README.md#building-from-source), and [RELEASING.md, step 1](../../../RELEASING.md#1-pre-release-validation-all-must-pass). Previous plan in the same format: [Start an agent from a task](2026-11-05-agent-from-task.md).

## Global Constraints

- **Schema:** only through migration `016_captures.sql`, listed in `MIGRATIONS` in `src-tauri/src/migrate.rs` (`LATEST_VERSION` becomes 16). `ensureSchema` in `src/db/index.ts` is not touched. The MCP server's `check_schema` (`src-tauri/mcp/src/guard.rs`) then refuses an organisation the app has not opened since the update ("Open StudioManager once with this organisation, then try again."): expected, say it in the release notes.
- **Which database:** a capture always goes to the **active organisation** (`active_org(&app)` in `src-tauri/src/lib.rs`, `Registry::active()` in the MCP server when no `org` is given). Never to a test or presentation database: while a mode is on, the Rust capture command refuses with `CAPTURE_MODE` (below) and the MCP tools refuse with `guard::MODE_ACTIVE`, as every write tool does.
- **Feature gate:** everything in this plan is part of the Agents feature: hidden or refused while `AgentsSettings.enabled` is false (`switched_on` in `src-tauri/src/agents/actions.rs`), and so always off in the demo build (`cli::in_build` turns the switch off there). Rust commands that read or write this Mac check `crate::host::is_demo` or `switched_on` first (`every_host_command_is_gated_for_the_demo` in `src-tauri/src/host.rs` scans `agents/`).
- **New Rust commands** go in the three lists: `generate_handler!` in `src-tauri/src/lib.rs`, `COMMANDS` in `src-tauri/build.rs`, and `src-tauri/permissions/windows.toml` (`main-window` always; `menubar-window` and the new `capture-window` only for what those windows call). `window_command_lists_match_the_handler` checks it; its panel count (16 today) moves with each addition.
- **No deletes.** Captures are dismissed (`status = 'dismissed'`), never removed, in the app and in the tools.
- **Labels** in `src/i18n/labels/agents.ts`, EN and FR, added in the task that shows them. No emojis. Icons from `ICONS`; one new icon, `inbox: Inbox` (lucide), added to `src/components/ui/icons.ts` and to the Icon Choices table in DESIGN-SYSTEM.md.
- **New UI pieces are flagged** (DESIGN-SYSTEM.md "Reuse First"): `CaptureField` (`src/components/agents/CaptureField.tsx`) and the capture panel window are new; everything else reuses `TabList`/`TabItem`/`tabIds`, `SegmentedControl`, `EmptyState`, `Button`, `Dropdown`, `Textarea`, `ConfirmDialog`, `notify`.
- **Public repo:** fixtures and tests use made-up names ("Studio A", "Identity", "Poster tool"), never a client name, a personal path or a real reminder.
- **Cargo:** from inside `src-tauri` or `src-tauri/mcp`, never the repo root. Never `cargo fmt` in `src-tauri/mcp`.

## Review Focus

- **Hotkey already taken.** macOS itself uses Control-Option-Space for "Select next source in Input menu" when more than one input source is set up, and the retired AgentBar used the same keys. Registration failing must not stop the app: it is logged, Settings › Agents says the shortcut is taken and by what it may be, and the menu bar field still works. (Test in Task 8.)
- **Database busy or locked** (an agent writing through the MCP server, a backup running): `capture_add` waits up to 5 s (`busy_timeout`, as `execute_batch_now`), then fails with the error shown in the field; the typed text stays in the field. (Test in Task 2.)
- **Test or presentation mode:** a capture is refused with a clear message, never written to the disposable copy where it would vanish when the mode ends; the field keeps the text. The brief session and the Reminders import skip an organisation in a mode. (Tests in Tasks 2, 10, 12.)
- **Two organisations:** the hotkey and the panel write to the active organisation and the picker lists only its projects; switching organisation while the capture panel is open must not file into the new one with a project id of the old one (the command re-checks that the project id exists in the database it writes to). (Test in Task 2.)
- **A capture arriving while the brief session runs:** the session handles only the ids written in its prompt; the new one waits for the next slot. (Test in Task 10.)
- **Loris files or dismisses a capture by hand while the session runs:** `file_capture` refuses a capture that is no longer `new` ("Capture 12 is already filed."), the session moves on, nothing is filed twice. (Test in Task 3.)
- **A session that hangs, asks a question or never starts:** stopped after 20 minutes or after 2 minutes waiting on a prompt; its captures stay `new` with one more try counted; after 3 tries they show as "Briefing failed" and are no longer sent. (Test in Task 10.)
- **Budget:** no session while the recorded five-hour percentage is at or above 80%; a skipped slot counts no try. A `limits.json` whose five-hour window already reset gives no meter, which counts as under 80%. (Test in Task 10.)
- **The same reminder read twice** (the completion failed, the app restarted, the active organisation changed in between): never two captures. (Test in Task 12.)
- **Trust:** the session's folder is trusted in Claude Code only after Loris says yes, in the same dialog as the start form (`confirmTrust` in `src/lib/agentStart.ts`). (Test in Task 9.)
- **The panel windows:** the menu bar panel and the capture panel can call the capture commands and nothing new beyond them; neither gets SQL. (Tests in Tasks 7 and 8.)

---

### Task 1: Migration 016: `captures`, `brief`, `stage`

**Files:**
- Create: `src-tauri/migrations/016_captures.sql`
- Modify: `src-tauri/src/migrate.rs` (`MIGRATIONS`, `LATEST_VERSION`)
- Modify: `src/lib/backup.ts` (`TABLES`: `captures` after `subtasks`), `src/__tests__/backupCsv.test.ts` (`EXPECTED_ORDER` and the FK edges list, as the comment on `TABLES` asks)
- Modify: `src/types/task.ts` (`TaskStage`, `brief`, `stage` on `Task` and `Subtask`)
- Create: `src/types/capture.ts`
- Test: `src-tauri/src/migrate.rs` (tests module), `src/__tests__/backupSchema.test.ts` (existing, must stay green), `src/__tests__/capturesSchema.test.ts`

**Interfaces:**
- Produces the SQL below, and:
  - `type TaskStage = "briefed" | "ready" | "running" | "to_check"`
  - `interface Capture { id: number; text: string; source: CaptureSource; status: CaptureStatus; project_id: number | null; task_id: number | null; subtask_id: number | null; outcome: CaptureOutcome | null; inbox_reason: string | null; brief_tries: number; reminder_id: string | null; created_at: string; updated_at: string }`
  - `type CaptureSource = "hotkey" | "menubar" | "agent" | "reminders"`, `type CaptureStatus = "new" | "filed" | "dismissed"`, `type CaptureOutcome = "note" | "needs_word" | "ready"`

```sql
-- Agent orchestrator, part 1: captures and briefs.
-- See docs/superpowers/specs/2026-11-12-agent-orchestrator-design.md.
CREATE TABLE IF NOT EXISTS captures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('hotkey', 'menubar', 'agent', 'reminders')),
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'filed', 'dismissed')),
    -- The project picked when capturing (Tab), then the one it was filed under.
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    subtask_id INTEGER REFERENCES subtasks(id) ON DELETE SET NULL,
    outcome TEXT CHECK (outcome IN ('note', 'needs_word', 'ready')),
    -- Set by the brief session when no project fits: the capture stays new
    -- and is not sent to a session again.
    inbox_reason TEXT,
    brief_tries INTEGER NOT NULL DEFAULT 0,
    -- Apple Reminders' id of the reminder it came from: read once only.
    reminder_id TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_captures_status ON captures(status);
ALTER TABLE tasks ADD COLUMN brief TEXT DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN stage TEXT DEFAULT NULL CHECK (stage IN ('briefed', 'ready', 'running', 'to_check'));
ALTER TABLE subtasks ADD COLUMN brief TEXT DEFAULT NULL;
ALTER TABLE subtasks ADD COLUMN stage TEXT DEFAULT NULL CHECK (stage IN ('briefed', 'ready', 'running', 'to_check'));
```

**Why the CHECK already lists `running` and `to_check`:** SQLite cannot change a CHECK constraint; widening one later means rebuilding the table, as `009_paperless.sql` had to do for `connections`. For `tasks` that rebuild would have to carry every table that references it (subtasks, time entries, workload rows, captures). So the column accepts all five stages of the design from the start, and part 1 limits what is written in code: `file_capture` writes only `briefed` or `ready`, the app clears it to null, nothing writes `running` or `to_check` until parts 2 and 3. `NULL` passes the CHECK. The `result` column and `task_agents` are part 2's migration.

The migration only adds columns after its `CREATE TABLE IF NOT EXISTS`, so it is listed with `columns_if_missing: true` (as 014 and 015): a re-run skips the columns that exist.

**Not in the design's column list, added here** (see "Design gaps" at the end): `project_id`, `subtask_id`, `outcome`, `inbox_reason`, `brief_tries`, `reminder_id`, `updated_at`.

- [ ] **Step 1: Write failing tests**
  - `migrate.rs`: a fresh file migrated to 16 has `captures` with the columns above, `tasks.brief`, `tasks.stage`, `subtasks.brief`, `subtasks.stage`; `INSERT INTO tasks (..., stage) VALUES (..., 'shipped')` fails with a CHECK error; `stage` null, `briefed`, `to_check` pass; `INSERT INTO captures (text, source) VALUES ('x', 'email')` fails; a second `reminder_id` with the same value fails (UNIQUE); running 016 twice (the `columns_if_missing` path) succeeds.
  - `capturesSchema.test.ts` (with `freshRealDb()` from `src/__tests__/fixtures/realSqlite.ts`): deleting a task sets `captures.task_id` to null and keeps the capture.
- [ ] **Step 2:** Run `(cd src-tauri && cargo test migrate)` and `npx vitest run src/__tests__/capturesSchema.test.ts src/__tests__/backupSchema.test.ts` — FAIL.
- [ ] **Step 3:** Add the file, the `MIGRATIONS` entry, `LATEST_VERSION = 16`, `captures` in `TABLES`, the backupCsv order and edges, the types.
- [ ] **Step 4:** Rerun, plus `(cd src-tauri/mcp && cargo test)` (its `db_behind_the_latest_migration_refused` follows `MIGRATIONS`) — PASS.
- [ ] **Step 5:** Commit `feat(db): captures table, brief and stage on tasks and subtasks (migration 016)`.

### Task 2: Rust capture store and the `capture_add` / `capture_projects` commands

**Files:**
- Create: `src-tauri/src/agents/capture.rs` (declared in `src-tauri/src/agents/mod.rs`)
- Modify: `src-tauri/src/lib.rs` (`active_org` and `org_shared` become `pub(crate)`; `generate_handler!`), `src-tauri/build.rs` (`COMMANDS`), `src-tauri/permissions/windows.toml` (`main-window` only for now)
- Modify: `src/lib/agentChangeKeys.ts` (`capture`, `list_captures`, `file_capture`, `set_brief` keys, ready for Task 3), `src/db/queryKeys.ts` (`captures` root)
- Create: `src/lib/captures.ts` (invoke wrappers)
- Test: `src-tauri/src/agents/capture.rs` (tests module), `src/__tests__/agentChangeKeys.test.ts`

**Interfaces:**
- Produces (Rust, `agents::capture`):
  - `pub enum Source { Hotkey, Menubar, Agent, Reminders }` with `as_str()`
  - `pub const CAPTURE_MODE: &str = "StudioManager is in test or presentation mode: the capture was not saved."`
  - `pub fn add(db: &Path, text: &str, source: Source, project_id: Option<i64>, reminder_id: Option<&str>) -> Result<Option<i64>, String>` — trims; empty → `Err("Nothing to capture")`; over 1 MB → refused (same cap as the MCP server's `capped`); a `project_id` that is not in this database → `Err("That project is not in this organisation")`; `reminder_id` already present → `Ok(None)`. Opens with `foreign_keys` on and `busy_timeout(5000)`, as `execute_batch_now`.
  - `pub fn open_projects(db: &Path) -> Result<Vec<CaptureProject>, String>` — projects with `status = 'active'`, by client then name: `CaptureProject { id: i64, name: String, client: String }`
  - Commands: `capture_add(app, state, text: String, project_id: Option<i64>, source: String) -> Result<i64, String>` (accepts only `"hotkey"` and `"menubar"` from a webview; checks `switched_on`, then `active_org(&app)`, refuses `CAPTURE_MODE` when `org.in_mode()`, holds `org_shared()`, writes to `org.prod_db_path()`, then emits `crate::agent_access::CHANGED_EVENT` with `["capture"]`) and `capture_projects(app, state) -> Result<Vec<CaptureProject>, String>`. Both `async` with `pty::blocking`.
- Produces (TS, `src/lib/captures.ts`): `addCapture(text: string, source: "hotkey" | "menubar", projectId: number | null): Promise<number>`, `captureProjects(): Promise<CaptureProject[]>`.

The `db-changed` event is what `useDbChangedListener` already refreshes on; `keysForTools(["capture"])` maps to `["captures"]`, `file_capture` and `set_brief` to `["captures", ...TASKS]`, `list_captures` to nothing.

- [ ] **Step 1: Write failing tests** (temp folder, a database migrated with `migrate::MIGRATIONS`):
  - `add` returns an id; the row has `source = 'hotkey'`, `status = 'new'`, the text trimmed.
  - empty and whitespace-only text refused; a project id from no row refused; a valid one kept.
  - the same `reminder_id` twice → second returns `Ok(None)`, one row.
  - a database held by another connection in `BEGIN IMMEDIATE` for 6 s → `add` returns an error after about 5 s, not a panic, and no row.
  - `capture_add` source `"agent"` or `"reminders"` from a webview → refused.
  - an org whose `db_name` is the test file → `CAPTURE_MODE`, nothing written to either file.
  - `agentChangeKeys.test.ts`: the four tool names map as above.
- [ ] **Step 2:** Run `(cd src-tauri && cargo test agents::capture)` and `npx vitest run src/__tests__/agentChangeKeys.test.ts` — FAIL.
- [ ] **Step 3:** Implement; register both commands in the three lists (main window only).
- [ ] **Step 4:** Rerun, plus `cargo test window_command_lists_match_the_handler every_host_command_is_gated_for_the_demo` — PASS.
- [ ] **Step 5:** Commit `feat(agents): store captures in the active organisation`.

### Task 3: Agent access tools `capture`, `list_captures`, `file_capture`, `set_brief`

**Files:**
- Create: `src-tauri/mcp/src/write/captures.rs`, `src-tauri/mcp/src/read/captures.rs` (declared in `write/mod.rs` and `read/mod.rs`)
- Modify: `src-tauri/mcp/src/server.rs` (four `#[tool]` methods and their input structs; `tool_router.list_all().len()` test 40 → 44)
- Modify: `src-tauri/mcp/src/read/mod.rs` (`Task`, `Subtask`, `TaskRow` get `brief: Option<String>` and `stage: Option<String>`, skipped when none), `src-tauri/mcp/src/read/tasks.rs`, `src-tauri/mcp/src/read/projects.rs` (select them)
- Modify: `src-tauri/mcp/tests/protocol.rs` (`stdio_round_trip`: 40 → 44, the four names listed; `money_tools_hidden_when_off_at_startup`: 35 → 39)
- Test: unit tests in the two new files

**Interfaces:**
- `capture(text, project?, org?)` → `{ org, id, status: "new" }`. Source `agent`. `project` (name or id, through `read::resolve_project`) only sets `project_id` as a hint. Log line: `Captured "<first 60 chars>" (id N)`.
- `list_captures(status?, org?)` → `[{ id, text, source, status, project_id, project, created_at, brief_tries, inbox_reason }]`, status defaults to `new`, newest last, at most 50. Read only.
- `file_capture(capture_id, project?, task?, title?, brief?, outcome?, reason?, org?)`, in one `write(...)` transaction (`write/mod.rs`, so backup before the first write and the change log come with it):
  - capture not found → error; `status != 'new'` → `"Capture N is already filed."` or `"... dismissed."`.
  - **no `project`:** requires `reason`; sets `inbox_reason`, keeps `status = 'new'`. Log `Left capture N in the inbox: <reason>`.
  - **with `project`:** requires `title` (`required`, at most 200 characters), `brief` (`capped`) and `outcome` in `note | needs_word | ready`. With `task` (an id of an open task of that project, else error): creates a subtask (`create_subtask`'s insert and `next_sort_order`); without: creates a task with `notes = "Captured <created_at date>: <text>"` (the original words, as the design asks; subtasks have no notes column, so for a subtask the words stay on the capture row it links to). Sets on the new row `brief`, and `stage` = `briefed` for `needs_word`, `ready` for `ready`, null for `note`. Sets the capture `status = 'filed'`, `project_id`, `task_id` or `subtask_id` (with its `task_id`), `outcome`. Returns `{ org, capture_id, kind: "task" | "subtask", id, title, project, outcome }`.
- `set_brief(task_id? | subtask_id?, brief, org?)` — exactly one id; writes `brief` only (the stage is never set by this tool, per "Data and tools" in the spec). Returns the `TaskResult` or `SubtaskResult`.
- Descriptions (each on the tool): `capture`: "Save a thought for later in the StudioManager inbox, without choosing where it goes. Use when the user says to note something for later." `list_captures`: "List captures in the inbox (new by default)." `file_capture`: "File a new capture under a project as a task or a subtask with a brief, or leave it in the inbox with a reason when no project fits." `set_brief`: "Write the brief of a task or subtask: what to do, what done looks like, what is unclear."
- The server's `INSTRUCTIONS` stay as they are (7 of the 8 lines `instructions_fit_in_eight_lines` allows).

- [ ] **Step 1: Write failing tests** (the crate's `write/test_util.rs` and `read/test_util.rs` fixtures):
  - `capture` adds a `new` row with source `agent`; refused in test mode (`write_refused_in_test_mode` pattern) with `MODE_ACTIVE`; the first write takes the backup (existing guard).
  - `file_capture` to a new task: task created with notes holding the original words, brief set, stage `briefed` for `needs_word`, `ready` for `ready`, null for `note`; capture filed with `task_id` and outcome; one log line.
  - to a subtask: subtask created under the given task, capture has `subtask_id` and `task_id`; a task of another project → error, nothing written.
  - no project + reason → `inbox_reason` set, status still `new`; no project and no reason → error.
  - an already filed or dismissed capture → refused, nothing written (the race with Loris filing by hand).
  - outcome `running` or `to_check` → refused.
  - `set_brief` on a task and on a subtask writes only `brief` (`stage`, `status`, `updated_at` aside, the row is unchanged); both ids or none → error.
  - `get_project` and `list_tasks` show `brief` and `stage` when set and omit them when null.
  - protocol: 44 tools listed with the four names; 39 with money off.
- [ ] **Step 2:** Run `(cd src-tauri/mcp && CARGO_TARGET_DIR=~/cargo-target-studiomanager-mcp cargo test --locked)` — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun, plus `cargo clippy --locked --all-targets -- -D warnings` there — PASS.
- [ ] **Step 5:** Commit `feat(agent-access): capture, list_captures, file_capture and set_brief tools`.

### Task 4: Captures in the app's data layer

**Files:**
- Create: `src/db/queries/captures.ts`, `src/db/hooks/useCaptures.ts`
- Modify: `src/db/queryKeys.ts` (`captures: { all, byStatus(status), briefs }`)
- Test: `src/__tests__/captureQueries.test.ts` (real SQLite fixture)

**Interfaces:**
- `getCaptures(status: CaptureStatus): Promise<CaptureRow[]>` — `CaptureRow = Capture & { project_name: string | null; task_title: string | null; subtask_title: string | null }`, newest first.
- `getBriefEntries(): Promise<BriefEntry[]>` — filed captures with `outcome = 'needs_word'`, joined to the task or subtask (`brief`, title) and project.
- `dismissCapture(id)`, `restoreCapture(id)` (dismissed → new)
- `fileCaptureByHand({ captureId, projectId, taskId, title }): Promise<{ kind; id }>` — one `execute_batch` like `createTask`/`createSubtask`: the task (notes = original words) or subtask, then the capture `status = 'filed'`, `outcome = 'note'`, ids set. Refuses (no write) when the capture is no longer `new`.
- `keepAsTask(captureId)` — capture `outcome = 'note'`; the task or subtask `stage = NULL`.
- `markStarted(captureId)` — capture `outcome = 'ready'`; the task or subtask `stage = NULL` (part 2 replaces this with `running` and a `task_agents` row).
- `setBrief(kind: "task" | "subtask", id, brief)`, `briefAgain(captureId)` (`brief_tries = 0`, `inbox_reason = NULL`)
- Hooks: `useCaptures(status)`, `useBriefEntries()`, `useDismissCapture()`, `useRestoreCapture()`, `useFileCaptureByHand()`, `useKeepAsTask()`, `useMarkStarted()`, `useSetBrief()`, `useBriefAgain()`; each mutation invalidates `captures` and, when it touches a task, `invalidateTaskViews` (`src/db/queryKeys.ts`).

- [ ] **Step 1:** Failing tests: each query against `freshRealDb()`; filing by hand creates the task with the notes ("Captured YYYY-MM-DD: <words>", the capture's created date, as the agent tool writes) and links it; filing a capture filed meanwhile throws and writes nothing; dismiss then restore; `getBriefEntries` lists only `needs_word` filed captures.
- [ ] **Step 2:** Run `npx vitest run src/__tests__/captureQueries.test.ts` — FAIL. **Step 3:** Implement. **Step 4:** Rerun — PASS. Commit `feat(captures): queries and hooks`.

### Task 5: Agents page tabs and the Inbox tab

**Files:**
- Modify: `src/pages/AgentsPage.tsx`
- Create: `src/components/agents/InboxTab.tsx`, `src/components/agents/FileCaptureForm.tsx`
- Modify: `src/i18n/labels/agents.ts`, `src/components/ui/icons.ts` (`inbox`), DESIGN-SYSTEM.md (Icon Choices row)
- Test: `src/__tests__/agentsInbox.test.tsx`, `src/__tests__/agentsPage.test.tsx` (existing, extended)

Today the page is one list-and-detail split with `?agent=`, `?new=1` and `?started=` parameters and no tabs. Part 1 adds a `TabList` under the `PageHeader`, as `UpkeepPage` does (`tabIds`, `?tab=`): **Needs you**, **Inbox**, **All agents**, in that order (the design's order; "Running" from the mockup comes with parts 2 and 3). The tab is `?tab=needs-you` or `?tab=inbox`; no `tab` means All agents, so every existing link (`?agent=`, `?started=`, the menu bar's `openMainWindow({ agent })`) keeps landing on the agent. `?agent=`, `?new=1` and `?started=` always show All agents. Part 3 makes Needs you the default. The existing split moves unchanged into the All agents panel. Each tab label carries a plain count when it has entries (Inbox: new captures; Needs you: brief entries).

Inbox tab: a `SegmentedControl` New / Filed / Dismissed over flat rows (DESIGN-SYSTEM.md "Flat list-and-detail pages": hairlines, `hover-row`). A row: the text (two lines, full on hover title), a muted line with source, time, the picked or filed project, and a tag "Briefing failed" (`brief_tries >= 3`) or "No project fits: <reason>" (`inbox_reason`). Actions on a new row: **File…** (opens `FileCaptureForm` in the right column: project `Select` from the active organisation's open projects, optional open task "as a subtask of", title prefilled with the first line, at most 80 characters), **Dismiss**, and on a failed or no-project row **Brief again**. Filed rows link to their project (`/projects/:id`); dismissed rows have **Restore**.

Labels (EN / FR): `agents_tab_needs_you` "Needs you" / "Pour vous", `agents_tab_inbox` "Inbox" / "Boîte de réception", `agents_tab_all` "All agents" / "Tous les agents", `capture_status_new` "New" / "Nouvelles", `capture_status_filed` "Filed" / "Classées", `capture_status_dismissed` "Dismissed" / "Écartées", `capture_file` "File…" / "Classer…", `capture_dismiss` "Dismiss" / "Écarter", `capture_restore` "Restore" / "Rétablir", `capture_brief_again` "Brief again" / "Relancer le brief", `capture_failed` "Briefing failed" / "Brief échoué", `capture_no_project` "No project fits: {reason}" / "Aucun projet ne convient : {reason}", `capture_as_subtask` "As a subtask of" / "Comme sous-tâche de", `capture_inbox_empty` "Nothing captured. Press Control-Option-Space anywhere to note a thought." / "Rien de noté. Control-Option-Espace, n'importe où, pour noter une idée.", `capture_source_hotkey` / `_menubar` / `_agent` / `_reminders` "Shortcut" / "Menu bar" / "Agent" / "Reminders" ("Raccourci" / "Barre des menus" / "Agent" / "Rappels").

- [ ] **Step 1: Write failing tests** (mock the hooks of Task 4):
  - no `tab` → All agents panel with the agent list; `?tab=inbox` → Inbox; `?agent=x&tab=inbox` → All agents with x selected.
  - clicking a tab sets `?tab=` with `replace`; the tablist has three tabs in order Needs you, Inbox, All agents.
  - Inbox lists new captures; Dismiss calls the hook; File… then submit calls `fileCaptureByHand` with the project, the optional task and the title; a failed row shows the tag and Brief again.
  - agents off → the page still shows `t.agents_off` and no tabs.
- [ ] **Step 2:** Run `npx vitest run src/__tests__/agentsInbox.test.tsx src/__tests__/agentsPage.test.tsx` — FAIL. **Step 3:** Implement. **Step 4:** Rerun — PASS. Commit `feat(agents): tabs on the Agents page and the capture inbox`.

### Task 6: "Needs you" tab with its Briefs group

**Files:**
- Create: `src/components/agents/NeedsYouTab.tsx`
- Modify: `src/pages/AgentsPage.tsx`, `src/i18n/labels/agents.ts`
- Test: `src/__tests__/agentsNeedsYou.test.tsx`

**Interfaces:**
- Consumes: `useBriefEntries`, `useKeepAsTask`, `useMarkStarted`, `useSetBrief` (Task 4); `useStartAgentOn()` from `src/hooks/useStartAgentOn.ts` (the existing one-click start: folder, trust, Opus, "read it then ask me" prompt).

Only the Briefs group exists in part 1 (Decide and Check come with part 3). One group row as on the All agents list ("Briefs", plain count), then one entry per brief, as in mockup screen 2: "Filed under <project>", the capture time, the original words in quotes, the brief, and three buttons:

- **Start an agent:** `start({ kind, id })`; when it resolves without error, `markStarted(captureId)` so the entry leaves the list. A cancelled folder picker or trust question leaves it.
- **Keep as a task:** `keepAsTask(captureId)`; the entry leaves the list, the task stays.
- **Open the brief:** the entry expands into a `Textarea` with the brief, saved with `setBrief` on blur or Cmd+Enter (the design: "editable by Loris"). There is no open-task view yet (part 2), so the brief is read and edited here.

Empty: `EmptyState` "Nothing waits for you." / "Rien ne vous attend.". Labels: `briefs_group` "Briefs" / "Briefs", `brief_filed_under` "Filed under {project}" / "Classé dans {project}", `brief_start` "Start an agent" / "Lancer un agent", `brief_keep` "Keep as a task" / "Garder comme tâche", `brief_open` "Open the brief" / "Ouvrir le brief", `needs_you_empty`.

- [ ] **Step 1: Write failing tests:** one entry renders project, words and brief; Start calls `start` with `{ kind: "task", id }` (and `subtask` for a subtask entry) then `markStarted`; a start that returns without starting (picker cancelled) does not call `markStarted`; Keep calls `keepAsTask`; Open shows the textarea and blur saves; the tab label shows the count.
- [ ] **Step 2:** Run `npx vitest run src/__tests__/agentsNeedsYou.test.tsx` — FAIL. **Step 3:** Implement (`useStartAgentOn().start` returns `Promise<void>` today: make it resolve to `boolean`, started or not, and update `src/__tests__/useStartAgentOn.test.tsx`). **Step 4:** Rerun with `src/__tests__/useStartAgentOn.test.tsx` — PASS. Commit `feat(agents): Needs you tab with briefs waiting for a word`.

### Task 7: The capture field, in the menu bar panel's Agents tab

**Files:**
- Create: `src/components/agents/CaptureField.tsx` (new shared piece, flagged in the PR description)
- Modify: `src/menubar/AgentsTab.tsx` (field above the `LoginNotice`), `src-tauri/permissions/windows.toml` (`menubar-window`: `allow-capture-add`, `allow-capture-projects`), the panel count in `window_command_lists_match_the_handler` (16 → 18), `docs/menu-bar.md` ("What the panel can do": 14 → 16 commands)
- Modify: `src/i18n/labels/agents.ts`
- Test: `src/__tests__/captureField.test.tsx`, `src/__tests__/menuBarCommands.test.ts` (existing, must stay green), `src/__tests__/menuBarAgents.test.tsx`

**Interfaces:**
- `CaptureField({ source: "hotkey" | "menubar"; autoFocus?: boolean; onSaved?: () => void; onClose?: () => void })`
- Keys: **Enter** saves (`addCapture`) when the text is not blank, clears the field, calls `onSaved`; **Shift+Enter** adds a line; **Esc** calls `onClose` (the panel's own Escape handler in `MenuBarApp` still hides the panel when the field doesn't use the key); **Tab** opens the project picker (`captureProjects()`, a filterable `Dropdown` list; Enter picks, Esc closes the picker only), shown as a removable chip next to the field. Hints under the field as in mockup screen 1: "Enter save to inbox · Tab pick a project (optional) · Esc".
- On error the text stays and the error shows under the field (`CAPTURE_MODE`, a busy database, agents off).

Labels: `capture_placeholder` "Note a thought…" / "Noter une idée…", `capture_hint_enter` "save to inbox" / "dans la boîte", `capture_hint_tab` "pick a project (optional)" / "choisir un projet (facultatif)", `capture_saved` "Saved to the inbox" / "Enregistré dans la boîte".

- [ ] **Step 1: Write failing tests:** Enter calls `capture_add` with `{ text, source: "menubar", projectId: null }` and clears; blank Enter does nothing; Tab opens the picker, choosing sends `projectId`; Esc in the picker closes only the picker; a rejected invoke keeps the text and shows the message; the panel's Agents tab shows the field; `menuBarCommands.test.ts` passes with the two new commands in the set.
- [ ] **Step 2:** Run `npx vitest run src/__tests__/captureField.test.tsx src/__tests__/menuBarAgents.test.tsx src/__tests__/menuBarCommands.test.ts` and `(cd src-tauri && cargo test window_command_lists the_panel_window_is_refused)` — FAIL.
- [ ] **Step 3:** Implement; add `capture_add` and `capture_projects` to the "allowed" loop of `the_panel_window_is_refused_other_commands`.
- [ ] **Step 4:** Rerun — PASS. Commit `feat(menubar): capture field in the Agents tab`.

### Task 8: Global hotkey Control-Option-Space and the capture panel

**Files:**
- Modify: `src-tauri/Cargo.toml` (`tauri-plugin-global-shortcut = "2"`; exact version not verified, pick the newest 2.x that resolves with tauri 2.12.5 in `Cargo.lock`), `src-tauri/Cargo.lock`
- Create: `src-tauri/src/capture_window.rs` (or `src-tauri/src/menubar/capture.rs`, beside the panel code it reuses)
- Modify: `src-tauri/src/menubar/nspanel.rs` (a second `tauri_panel!` type, `CapturePanel`, same config as `MenuBarPanel`; that the macro accepts a second panel type in one file is not verified), `src-tauri/src/lib.rs` (plugin, setup, `capture_hide` and `capture_hotkey_status` in `generate_handler!`), `src-tauri/build.rs`, `src-tauri/permissions/windows.toml` (new set `capture-window`: `allow-capture-add`, `allow-capture-projects`, `allow-capture-hide`)
- Create: `src-tauri/capabilities/capture.json` (`"windows": ["capture"]`, permissions `capture-window` and `core:default` only)
- Modify: `src/App.tsx` (route `/capture` → `CaptureShell`, like `MenuBarShell`: no organisation gate, `useFollowAppSettings`)
- Create: `src/capture/CaptureApp.tsx`
- Modify: `src/components/settings/AgentsCard.tsx` (a line "Capture shortcut: Control-Option-Space", or the warning when it is taken)
- Test: Rust tests in `capture_window.rs`; `src-tauri/src/lib.rs` tests; `src/__tests__/captureApp.test.tsx`; a copy of `menuBarCommands.test.ts`'s import walk for `src/capture/CaptureApp.tsx` against `capture-window`

**What exists and what is new:** there is no global-shortcut plugin today (not in `Cargo.toml`, `Cargo.lock` or `package.json`). The plugin is used from Rust only (`GlobalShortcutExt::global_shortcut().on_shortcut(...)`), so no JavaScript package and no `global-shortcut:` capability are added (the plugin's permissions only gate its JavaScript API: not verified for 2.x, check before adding a capability). The window code reuses `menubar::monitor_under` (made `pub(crate)`) and the `nspanel` conversion, so the field opens over a full-screen app without activating StudioManager, like the menu bar panel.

**Interfaces:**
- `pub const CAPTURE_LABEL: &str = "capture"`, size 560 x 120, route `/capture`.
- `pub fn sync_hotkey(app: &AppHandle, on: bool)` — registers `Control+Alt+Space` when on (Agents switch on, not the demo build), unregisters when off; called from `setup` and from `agents_set_enabled` next to `menubar::sync_tray`. A registration error is kept in a `static` and logged, never fatal.
- `pub fn capture_origin(screen: Area, w: f64, scale: f64) -> (f64, f64)` — centred horizontally, a quarter of the way down the work area of the screen under the mouse (pure, tested).
- The hotkey toggles: pressed while the panel shows, it hides it. Focus lost → hide (as `ensure_panel`'s `Focused(false)`).
- `capture_hide()`; `capture_hotkey_status() -> Result<Option<String>, String>` (None when registered, else the error).
- `CaptureApp`: one `CaptureField source="hotkey" autoFocus`, `onSaved` and `onClose` call `capture_hide`; the field is cleared each time the panel shows (listen to a `capture:shown` event emitted by Rust).

Label: `capture_hotkey` "Capture shortcut: Control-Option-Space" / "Raccourci de capture : Contrôle-Option-Espace", `capture_hotkey_taken` "Control-Option-Space is used by another app or by macOS (Keyboard › Input Sources). Free it, then turn Agents off and on." / "Contrôle-Option-Espace est déjà pris par une autre app ou par macOS (Clavier › Méthodes de saisie). Libérez-le, puis désactivez et réactivez Agents.".

- [ ] **Step 1: Write failing tests:**
  - `capture_origin` on a 1440 x 900 work area at scale 2 and on a second screen with a negative x.
  - `window_command_lists_match_the_handler` extended: the `capture-window` set has exactly the three commands and never `execute_batch`, `agents_start`, `routines_run`.
  - `the_panel_window_is_refused_other_commands` extended to the `capture` label: `execute_batch` and `agents_list` refused, `capture_add` not.
  - `captureApp.test.tsx`: Enter saves with source `hotkey` and calls `capture_hide`; Esc calls `capture_hide`; the import walk finds only `capture_add`, `capture_projects`, `capture_hide`.
  - `every_host_command_is_gated_for_the_demo` still passes (the new commands check `switched_on` or `is_demo`).
- [ ] **Step 2:** Run `(cd src-tauri && cargo test)` and `npx vitest run src/__tests__/captureApp.test.tsx` — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun, `cargo clippy --locked --all-targets -- -D warnings`, `cargo audit` in `src-tauri` (new dependency) — PASS. Manual check (Loris, real app): the shortcut over Finder, over a full-screen app and with another Space active; the main window does not come forward; with "Select next source in Input menu" switched on in System Settings, Settings › Agents shows the taken warning.
- [ ] **Step 5:** Commit `feat(agents): Control-Option-Space opens the capture field anywhere`.

### Task 9: Settings › Agents: the brief session switch and its folder

**Files:**
- Modify: `src-tauri/src/agents/cli.rs` (`AgentsSettings`: `briefing: bool`, default false; `in_build` turns it off in the demo build; command `agents_set_briefing(on: bool)` behind `switched_on`)
- Create: `src-tauri/src/agents/briefing.rs` (this task: the folder only)
- Modify: `src-tauri/src/lib.rs`, `src-tauri/build.rs`, `src-tauri/permissions/windows.toml` (`agents_set_briefing`, `agents_briefing_folder`: main window only)
- Modify: `src/lib/agents.ts` (`AgentsInfo.briefing`, `setAgentsBriefing`, `briefingFolder`), `src/components/settings/AgentsCard.tsx`, `src/i18n/labels/agents.ts`
- Test: `src-tauri/src/agents/briefing.rs`, `src-tauri/src/agents/cli.rs` tests, `src/__tests__/agentsCard.test.tsx`

**The folder the session runs in:** `<app data folder>/briefing/`, made by the app, used only by brief sessions. Not a project folder, because one session files captures for several projects. The app (re)writes on each switch-on and before each session:

- `.mcp.json`: `{ "mcpServers": { "studiomanager": { "command": "<agent_access::mcp_path()>" } } }`. A Claude Code server added with the command shown in Settings (`claude mcp add studiomanager -- ...`, local scope by default) is not visible from this folder, so the folder brings its own.
- `.claude/settings.json`:

  ```json
  {
    "enabledMcpjsonServers": ["studiomanager"],
    "permissions": {
      "allow": [
        "mcp__studiomanager__list_captures",
        "mcp__studiomanager__file_capture",
        "mcp__studiomanager__set_brief",
        "mcp__studiomanager__list_projects",
        "mcp__studiomanager__get_project",
        "mcp__studiomanager__list_tasks",
        "mcp__studiomanager__list_wiki",
        "mcp__studiomanager__get_wiki_article"
      ],
      "deny": ["Bash", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch"]
    }
  }
  ```

  That `claude --bg` honours a project's `.mcp.json` pre-approval (`enabledMcpjsonServers`) and `permissions.allow` for MCP tools without any prompt is **not verified**: Step 1 below checks it by hand before any code relies on it. If it doesn't, the session would sit at a permission prompt; the fallback is passing `--allowedTools` and `--mcp-config` to `claude --bg` in `actions::start` (also not verified that `--bg` accepts them).

**Switching on** (`AgentsCard`, a new switch "Brief new captures with an agent", off by default): `briefingFolder()` creates the folder and returns its path; if `startFolders()` doesn't list it as trusted, the existing `confirmTrust(confirm, t, folder, false)` asks, and on yes `trustFolder(folder)`; only then `setAgentsBriefing(true)`. Declined → the switch stays off. The card also says the session needs Agent access on for the organisation (`t.agent_access`), and shows the last session's state from Task 10 (`briefing_status`).

Labels: `briefing_switch` "Brief new captures with an agent" / "Rédiger les briefs des captures avec un agent", `briefing_desc` "At most every 15 minutes, one Opus agent files new captures under projects and writes their briefs. Needs Agent access for the organisation. Paused while the 5-hour limit is at 80% or more." / "Au plus toutes les 15 minutes, un agent Opus classe les nouvelles captures dans les projets et rédige leurs briefs. Nécessite l'accès agents pour l'organisation. En pause dès 80 % de la limite de 5 heures."

- [ ] **Step 1: Spike (manual, before code):** in a scratch folder with the two files above and the real `studiomanager-mcp` path, run `claude --bg --model opus --name brief-spike -- "Call list_captures, then stop."` from a terminal; confirm with `claude agents --json` and the transcript that the tool ran with no permission or server-approval prompt. Record the result in the PR. If it prompts, switch to the fallback above and update this task before going on.
- [ ] **Step 2: Write failing tests:** `prepare_folder(app_dir, mcp_path)` writes both files with exactly that content and returns the canonical path; running it twice changes nothing; `AgentsSettings` without `briefing` in the JSON reads false; `in_build(.., demo = true)` turns it off; `agents_set_briefing` refused while Agents is off. `agentsCard.test.tsx`: switching on with an untrusted folder asks; decline → no `agents_trust_folder`, no `agents_set_briefing`; accept → trust then set.
- [ ] **Step 3:** Run `(cd src-tauri && cargo test agents::briefing agents::cli)` and `npx vitest run src/__tests__/agentsCard.test.tsx` — FAIL. **Step 4:** Implement. **Step 5:** Rerun — PASS. Commit `feat(agents): brief session switch and its folder`.

### Task 10: The brief session scheduler

**Files:**
- Modify: `src-tauri/src/agents/briefing.rs`, `src-tauri/src/agents/mod.rs` (`init` calls `briefing::start(handle)`)
- Modify: `src-tauri/src/lib.rs`, `src-tauri/build.rs`, `src-tauri/permissions/windows.toml` (`briefing_status`: main window)
- Modify: `src/lib/agents.ts` (`briefingStatus()`), `src/components/settings/AgentsCard.tsx`, `src/components/agents/InboxTab.tsx` (a muted line "Next brief session in 9 min" or the pause reason), `src/i18n/labels/agents.ts`
- Test: `src-tauri/src/agents/briefing.rs` tests

**How it reuses what exists:** a thread like `routines::schedule::start` (30 s ticks, wake detection with `woke`/`next_since_check` copied or shared), the start through `actions::start(cli, &read_trusted(&home_dir()), folder, &prompt, "opus", &name)` (the same function `agents_start` and agent routines use; `claude --bg` returns the short id), the agent's state from `AgentsState::cached()` (the poller's last list), stop and delete through `actions::stop` and `actions::delete`, the plan limits through `usage::limits::load(app_dir, now)`. State is kept in `briefing.json` in the app data folder (as `routine-runs.json` is for routines), written with `agent_access::write_atomic`.

**Interfaces:**
- `pub const SLOT_MS: i64 = 15 * 60_000; pub const MAX_TRIES: i64 = 3; pub const FIVE_HOUR_CAP: f64 = 80.0; pub const RUN_LIMIT_MS: i64 = 20 * 60_000; pub const WAITING_LIMIT_MS: i64 = 2 * 60_000;`
- `pub struct BriefRun { org_id: String, short_id: String, capture_ids: Vec<i64>, started_at: i64, waiting_since: Option<i64> }`
- `pub struct BriefState { last_start_at: Option<i64>, current: Option<BriefRun>, last: Option<LastRun> }` with `LastRun { finished_at, ok: bool, message: Option<String> }`
- `pub enum Paused { Demo, Off, AgentsOff, AccessOff, Budget(f64), TooSoon(i64), Running, Nothing }`
- `pub fn eligible(db: &Path) -> Result<Vec<(i64, String)>, String>` — `status = 'new' AND inbox_reason IS NULL AND brief_tries < 3`, oldest first, at most 20 (id, created_at).
- `pub fn pick_org(app_dir, access: &AccessSettings) -> Option<(Org, Vec<i64>)>` — among organisations in `orgs::Registry` that agent access allows (`access.enabled && access.orgs[id] == true`) and that are not in a mode (no `studiomanager_test.db` or `studiomanager_presentation.db` beside the database, the MCP server's `guard::MODE_FILES` rule), the one whose oldest eligible capture is oldest. One organisation per session, one session at a time.
- `pub fn five_hour_percent(meters: &[Meter]) -> Option<f64>` — the `five_hour` meter.
- `pub fn paused(s: &BriefState, settings: &AgentsSettings, demo: bool, five_hour: Option<f64>, has_work: bool, now: i64) -> Option<Paused>` — in that order: demo, briefing off, agents off, running, too soon (`now - last_start_at < SLOT_MS`), budget (`>= 80`), nothing to do.
- `pub fn prompt(org_id: &str, ids: &[i64]) -> String` — the text below, under 8000 characters and not starting with `-` (`validate::valid_task`).
- `pub fn session_name(now: DateTime<Local>) -> String` — `brief-YYYYMMDD-HHMM` (`validate::valid_name`).
- `pub fn verdict(agent: Option<&Agent>, run: &BriefRun, now: i64) -> Verdict` — `Verdict { Wait, Finished, Stuck, TimedOut }`: not listed → `Finished`; group `Working` → `Wait`; `Idle` or `Done` → `Finished`; `NeedsYou` → `Wait` until `waiting_since + WAITING_LIMIT_MS`, then `Stuck`; any state past `started_at + RUN_LIMIT_MS` → `TimedOut`.
- `pub fn count_try(db: &Path, ids: &[i64]) -> Result<usize, String>` — `brief_tries = brief_tries + 1` for the ids still eligible (status `new`, no `inbox_reason`); returns how many.
- Command `briefing_status() -> Result<BriefingStatus, String>`: `{ paused: Option<String>, nextAt: Option<i64>, running: bool, last: Option<LastRun> }`.

**One tick:**

1. If `current` is set: find its agent by short id in `cached()`; `verdict(...)`.
   - `Wait`: record `waiting_since` when it first shows NeedsYou; nothing else.
   - `Finished`: `actions::stop` (ignore "not running"), then `count_try` on the run's ids. None left → `actions::delete` (keeps the list short: the design's 165-agent day) and `last = ok`. Some left → keep the agent stopped, not deleted, so its conversation shows why; `last = failed`, "N captures were not filed".
   - `Stuck` or `TimedOut`: `actions::stop`, `count_try`, keep the agent, `last = failed` with the reason.
   - In every case clear `current`, emit `db-changed` with `["file_capture"]`.
2. Else compute `paused(...)`; if paused, keep the reason for `briefing_status` and stop here (a budget pause or a too-soon slot counts no try).
3. Else `prepare_folder` (Task 9), `pick_org`, build the prompt, `actions::start` on a blocking thread. On `Ok(short_id)`: save `current` and `last_start_at`. On `Err(e)` (claude not found, folder not trusted, start timed out): `count_try` on the ids, `last = failed` with `e`, `last_start_at = now` (so the next try waits a slot).

"Finished" is decided from the agent list, and success from the database (the captures left `new`), so a session that ends without filing counts as a failed try even when the agent says it is done. Captures stay `new` through every failure; the next slot sends them again; after 3 tries `eligible` leaves them out and the Inbox shows "Briefing failed" with **Brief again** (Task 5). At app start, a `current` left from before quitting is checked on the first tick like any other.

Never runs: in the demo build (`crate::host::is_demo(&app)` at the top of the tick, before any file is read), while Settings › Agents › Agents or "Brief new captures" is off, for an organisation in test or presentation mode, for an organisation agent access doesn't allow (the MCP server would refuse every write: no session is started for nothing), or at 80% and above of the five-hour window.

**The prompt, in full** (`{ORG}` is the organisation id, `{IDS}` the capture ids joined with ", "):

```text
You are StudioManager's brief session, started by the app. Your only job is to file new captures and write their briefs with the StudioManager tools, then stop.

Organisation: {ORG}. Pass org "{ORG}" to every StudioManager tool.
Captures to handle, by id: {IDS}. Handle these and no others. Captures that arrive while you work wait for the next session.

1. Read them with list_captures. Skip any listed id that is not in the result (it was filed or dismissed meanwhile).
2. For each capture:
   a. Find the one project it is about. Start from its project, if it has one. Otherwise use list_projects, then get_project on the likely ones. If no project clearly fits, call file_capture with no project and a one-line reason, and go to the next capture. Do not guess.
   b. If an open task of that project already covers it, file it as a subtask of that task (pass task with the task's id). Otherwise file it as a new task.
   c. Read the project's context: get_project, list_wiki, then get_wiki_article for the articles that matter (Overview and Decisions first), and its open tasks with list_tasks.
   d. Write the brief in the language of the capture, in plain text, at most 200 words, in three parts: "What to do:", "Done when:", "Unclear:" (write "Nothing." when nothing is unclear). Use only what the capture, the wiki, the decisions and the tasks say. Never invent facts, names, dates, amounts or file paths.
   e. Choose the outcome:
      - note: nothing for an agent to do (a call, a purchase, an idea to keep).
      - needs_word: an agent could do it, but the brief has an unclear point, or the work touches anything a client will see, money (invoices, quotes, expenses), a release or version bump, deleting files, branches or data, security or machine settings, new dependencies, or database migrations.
      - ready: an agent could do it from the brief alone, nothing is unclear, and none of the needs_word cases applies.
   f. Call file_capture once with capture_id, project, task (only for a subtask), title (an imperative phrase of at most 80 characters), brief and outcome.
3. Do not create projects or clients, do not change other tasks, do not edit the wiki, do not run commands, do not edit files, do not start agents. Do not ask questions: anything unclear goes in the brief's "Unclear:" part.
4. If the StudioManager tools are missing or refuse (agent access off, organisation not allowed, test or presentation mode, database not opened), stop at once and say why in one line.
5. When every listed capture is filed or left in the inbox, reply with one line per capture: its id and what you did. Then stop.
```

- [ ] **Step 1: Write failing tests** (pure functions; a temp app folder with a registry, two migrated organisations and `agent-access.json`; a fake `Cli` as in `actions.rs` tests):
  - `prompt("abc123", &[3, 7])` equals the text above with the values filled in; it is under 8000 characters and passes `valid_task`; `session_name` passes `valid_name`.
  - `paused`: each reason in order; 79.9% → none, 80.0% → `Budget`; no five-hour meter → none; `last_start_at` 14 min ago → `TooSoon`, 15 min → none.
  - `eligible` leaves out filed, dismissed, `inbox_reason` set and `brief_tries = 3`.
  - `pick_org`: the organisation with the older capture wins; one not allowed by agent access is skipped; one with `studiomanager_test.db` beside it is skipped.
  - `verdict`: Working → Wait; Idle → Finished; missing → Finished; NeedsYou for 1 min → Wait, 3 min → Stuck; 21 min → TimedOut.
  - a full tick with the fake CLI: start called once with model `opus`, the briefing folder and the prompt; a capture added during the run is not in `capture_ids` and is sent on the next slot; the agent turns idle with one capture still new → that capture has `brief_tries = 1`, the agent is stopped and not deleted; all filed → stopped and deleted; a start error counts a try; three failures → the capture is no longer eligible.
  - a tick in a demo app reads no file (the `is_demo` check comes first).
- [ ] **Step 2:** Run `(cd src-tauri && cargo test agents::briefing)` — FAIL.
- [ ] **Step 3:** Implement; show `briefing_status` in the card and the Inbox line (labels `briefing_next` "Next brief session in {min} min" / "Prochaine séance de brief dans {min} min", `briefing_paused_budget` "Briefs paused: the 5-hour limit is at {percent}%" / "Briefs en pause : la limite de 5 heures est à {percent} %", `briefing_last_failed` "Last brief session failed: {reason}" / "Dernière séance de brief échouée : {reason}", `briefing_access_off` "Briefs wait: Agent access is off for this organisation" / "Briefs en attente : l'accès agents est désactivé pour cette organisation").
- [ ] **Step 4:** Rerun, plus `cargo clippy --locked --all-targets -- -D warnings` — PASS. Manual check (Loris, real app, after Task 9's spike): capture two thoughts, wait for the slot, see them filed, one brief under Needs you, the agent gone from All agents.
- [ ] **Step 5:** Commit `feat(agents): brief session files new captures every 15 minutes`.

### Task 11: Docs and full check

- Modify: `docs/agents.md` — new sections "Capture" (hotkey, the panel field, Tab, Esc, active organisation, refused in test and presentation mode, the shortcut taken case) and "Inbox and briefs" (the three tabs, Inbox actions, the brief session: Settings switch off by default, the folder and its trust question, Opus, every 15 minutes, one organisation at a time, Agent access needed, the 80% five-hour pause, 3 tries then "Briefing failed", the session is stopped and removed when it filed everything). Link the [design](../specs/2026-11-12-agent-orchestrator-design.md) relative to that file (`superpowers/specs/2026-11-12-agent-orchestrator-design.md`) and this plan.
- Modify: `docs/menu-bar.md` — the capture field in "Agents"; the command count in "What the panel can do" (done in Task 7; check it).
- Modify: `docs/agent-access.md` — "Tools": a "Captures and briefs" line with the four tools; the total "40 tools, 5 of them money tools" becomes 44; under "Safety rules", that `file_capture` only creates tasks and subtasks and that `set_brief` writes only the brief.
- Modify: `IDEAS.md` — tick "Capture and briefing" once Task 12 is in, or leave it open with "(Reminders left)" if Task 12 ships later; link this plan next to the design link.
- Modify: the spec's header — "Implementation plan, part 1: [2026-11-12-agent-orchestrator-1-capture.md](../plans/2026-11-12-agent-orchestrator-1-capture.md)."
- Modify: `CHANGELOG.md` only at release time (RELEASING.md), not here.
- [ ] Run the checks of [RELEASING.md, step 1](../../../RELEASING.md#1-pre-release-validation-all-must-pass): `npx tsc --noEmit`, `npx vitest run`, `npm run lint`, then in `src-tauri/mcp` and `src-tauri` `cargo test --locked` and `cargo clippy --locked --all-targets -- -D warnings` (MCP with `CARGO_TARGET_DIR=~/cargo-target-studiomanager-mcp`), and `cargo audit` in `src-tauri` for the new plugin. All pass. Commit `docs(agents): capture, inbox and brief sessions`.

### Task 12: Capture from the phone through Apple Reminders

Last, so Tasks 1 to 11 ship without it.

**What exists and what is new.** The design and the request assume EventKit bindings through `objc2` for the calendar sync. **There are none.** The calendar sync (`src-tauri/src/apple.rs`) runs fixed AppleScript sources through `osascript` with every user value passed as `argv` (`CAL_LIST_WRITABLE`, `CAL_CREATE_TIMED`, `CAL_CREATE_ALLDAY`, `CAL_DELETE_EVENT`, `run_osascript`, `spawn_osascript`), and `src/lib/appleCalendar.ts` calls those commands. `objc2` 0.6.4 and `objc2-foundation` / `objc2-app-kit` 0.3.2 are in `Cargo.lock` only as dependencies of Tauri and tauri-nspanel; `objc2-event-kit` is not there. `src-tauri/Info.plist` has no Calendar or Reminders usage string (only `NSLocalNetworkUsageDescription`); the bundle is signed ad hoc (`"signingIdentity": "-"`) with no entitlements file, and Calendar automation works that way today.

So there are two ways, and the spike picks one:

- **A. AppleScript, as the calendar sync** (preferred: no new dependency, same safety pattern). Two fixed scripts in `apple.rs`: `REM_LIST_OPEN` (argv: list name; returns the open reminders of that list as `id`, `name`, `body`, separated by ASCII 31 between fields and 30 between reminders, so text with tabs or new lines survives) and `REM_COMPLETE` (argv: list name, reminder id; sets `completed` to true). New: macOS asks "StudioManager wants to control Reminders" (Automation) on first use; a refusal gives error -1743. `tell application "Reminders"` launches the Reminders app if it isn't running (not verified whether it shows a window).
- **B. EventKit through objc2.** New: the `objc2-event-kit` crate (version matching `objc2` 0.6, not verified), `NSRemindersFullAccessUsageDescription` in `src-tauri/Info.plist`, `EKEventStore requestFullAccessToRemindersWithCompletion:` (macOS 14+), `calendarsForEntityType:` to find the list by title, `predicateForIncompleteRemindersWithDueDateStarting:ending:calendars:` and `fetchRemindersMatchingPredicate:completion:` (async completion blocks: needs the `block2` crate), `setCompleted:` and `saveReminder:commit:error:`. Not verified: how the permission behaves for an ad hoc signed app across updates (TCC may ask again after each new build).

**Files:**
- Modify: `src-tauri/src/apple.rs` (way A: the two scripts, `pub(crate) fn reminders_open(list) -> Result<Vec<Reminder>, String>`, `pub(crate) fn reminders_complete(list, id) -> Result<(), String>`, `parse_reminders(raw: &str) -> Vec<Reminder>`; `REMINDERS_TIMEOUT` 15 s)
- Create: `src-tauri/src/agents/reminders.rs` (the import loop)
- Modify: `src-tauri/src/agents/cli.rs` (`AgentsSettings`: `reminders: bool` default false, `reminders_list: String` default `"Inbox"`; `in_build` turns `reminders` off in the demo; `agents_set_reminders(on, list)`), `src-tauri/src/agents/mod.rs` (`init`), `src-tauri/src/lib.rs`, `src-tauri/build.rs`, `src-tauri/permissions/windows.toml` (main window)
- Modify: `src-tauri/src/host.rs` tests (`every_host_command_is_gated_for_the_demo` also scans `apple.rs` commands named `reminders_…`; a test like `demo_calendar_commands_return_before_osascript` for them)
- Modify: `src-tauri/Info.plist` only if the spike shows the prompt needs it (`NSAppleEventsUsageDescription` for A, `NSRemindersFullAccessUsageDescription` for B)
- Modify: `src/lib/agents.ts`, `src/components/settings/AgentsCard.tsx`, `src/i18n/labels/agents.ts`, `docs/agents.md` (a "From the phone" part under "Capture"), `IDEAS.md` (tick "Capture and briefing")
- Test: `src-tauri/src/apple.rs` and `src-tauri/src/agents/reminders.rs` tests

**Interfaces:**
- `pub struct Reminder { id: String, title: String, body: String }`
- `pub fn capture_text(r: &Reminder) -> Option<String>` — title, then a blank line and the body when it has one; None when both are blank.
- `pub fn import(app_dir, db: &Path, list: &str, src: &dyn ReminderSource) -> Result<usize, String>` — for each open reminder: skip ids in `reminders-seen.json` (app data folder, the last 500 ids, across organisations); `capture::add(db, text, Source::Reminders, None, Some(&id))` (the `UNIQUE` `reminder_id` makes a second insert a no-op in the same organisation); record the id as seen; then `src.complete(list, id)`. A completion that fails is retried on the next pass; the seen list keeps it from becoming a second capture even after the active organisation changed.
- The loop: every 2 minutes and after a wake, while Agents and "Capture from Reminders" are on, not in the demo build (`crate::host::is_demo` first), and the active organisation is not in a mode (`active_org(&app).in_mode()`: skipped, the reminders wait). Emits `db-changed` with `["capture"]` when it added any.
- Settings: switch "Capture from Reminders" (off by default) and a text field "List" (default "Inbox"). Switching on runs one import at once so the permission question shows while Loris is looking; an error ("Reminders list "Inbox" not found", "Allow StudioManager to control Reminders in System Settings › Privacy & Security › Automation") shows under the switch.

Labels: `reminders_switch` "Capture from Reminders" / "Capturer depuis Rappels", `reminders_desc` "Reminders added to this list on your iPhone, Watch or Mac become captures, then are marked done. Works while StudioManager is open." / "Les rappels ajoutés à cette liste sur iPhone, Watch ou Mac deviennent des captures, puis sont cochés. Fonctionne quand StudioManager est ouvert.", `reminders_list` "List" / "Liste", `reminders_not_found` "Reminders list \"{list}\" not found" / "Liste de rappels « {list} » introuvable", `reminders_denied`.

- [ ] **Step 1: Spike (before anything else in this task):** with `osascript` in a terminal, against a throwaway list named "Spike": list the open reminders with id, name and body using the separators above; complete one by id; time both with 0, 1 and 50 reminders; note whether the Reminders app opens a window and which permission prompt appears when the call comes from the app (a debug build calling a temporary command). If A is too slow, opens a window, or can't complete by id, write way B's spike (a 30-line `objc2-event-kit` test binary) and choose B. Record the result in the PR and update this task's Files and Interfaces before Step 2.
- [ ] **Step 2: Write failing tests:**
  - `parse_reminders` with tabs, new lines, quotes and an empty body in the fields; an empty output → none.
  - `capture_text`: title only; title and body; both blank → None.
  - `import` with a fake `ReminderSource`: two reminders → two captures with source `reminders` and their ids, both completed; a completion that fails → the next pass completes it and adds nothing; the same id after the active organisation changed (second database) → no capture there (the seen list); a mode → no read at all.
  - the demo gate: `reminders_…` commands return before `osascript`.
  - `AgentsSettings` defaults: `reminders` false, `remindersList` "Inbox".
- [ ] **Step 3:** Run `(cd src-tauri && cargo test apple agents::reminders host)` — FAIL. **Step 4:** Implement. **Step 5:** Rerun, the full checks of RELEASING.md step 1 — PASS. Manual check (Loris): a reminder added on the iPhone to "Inbox" shows in the Inbox within about 2 minutes and is ticked in Reminders. Commit `feat(agents): capture from an Apple Reminders list`.

---

## Design gaps and decisions taken in this plan

Points where the design did not say enough for code, or where the code differs from what the design and the request assumed. Each is a call Loris can overturn.

1. **No EventKit or objc2 code exists** (Task 12): the calendar sync is AppleScript through `osascript`. The plan prefers the same for Reminders, after a spike.
2. **`captures` needs more columns** than the design lists: `project_id` (the Tab picker has to store its choice), `subtask_id` (filing as a subtask), `outcome` (the Briefs group is the `needs_word` captures), `inbox_reason` (the design's "leaves it in the inbox when no project fits" must not be retried forever), `brief_tries` (3 tries then failed), `reminder_id` (read once), `updated_at`.
3. **`file_capture` signature:** the design's `file_capture(capture_id, project, task?, brief, outcome)` has no title for the new task and no way to leave a capture in the inbox. The plan adds `title` and `reason` and makes `project` optional.
4. **A fourth tool, `list_captures`,** so the session reads the captures instead of carrying them in its prompt (`claude --bg` takes at most 8000 characters, `validate::valid_task`).
5. **`stage` CHECK lists all five values now**, part 1 writes only `briefed` and `ready` (Task 1 explains why).
6. **"Start an agent" on a brief** uses the existing "Start work with agent" flow (Opus, read then ask) and clears the stage; part 2 replaces that with `running` and `task_agents`.
7. **The session's folder** is the app's own `briefing/` folder with its own `.mcp.json` and permissions, because the Claude Code command shown in Settings adds the server at local scope, and a background session must not stop on a permission prompt. Whether `claude --bg` honours both without a prompt is not verified (Task 9, Step 1).
8. **Which organisation a session works in:** one per session, the one with the oldest waiting capture among those agent access allows. The design only says captures go to the active organisation.
9. **Default tab:** All agents until part 3, so existing links keep working; the tab order is already the design's.
10. **The hotkey is Agents-only**, like the menu bar, and so never in the demo build.
11. **Control-Option-Space is a macOS default** (next input source) on Macs with more than one keyboard layout; the plan reports the conflict instead of choosing another key.
