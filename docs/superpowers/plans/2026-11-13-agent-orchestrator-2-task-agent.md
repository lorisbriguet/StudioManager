# Agent Orchestrator, Part 2: A Task Carries Its Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A task or subtask shows where its agent work stands. "Start work with agent" records which agent works on it and sets its stage to Running. The agent writes a short result through a new `report_result` tool. The app notices when the agent is finished and sets the stage to To check. The task row shows a stage chip, and the open task shows the progress line, the brief, the agents that worked on it and the last result.

**Architecture:** One migration (017) adds the `task_agents` table and a `result` column on tasks and subtasks. The app writes a `task_agents` row when it starts an agent from a task (`useStartAgentOn`). A new Rust thread, the **link tracker** (`src-tauri/src/agents/links.rs`), reads the poller's agent list every 30 seconds, fills in what it learns (session id, model) and closes the links of agents that are finished, setting To check. It is plain code: it starts, stops and deletes nothing. The MCP server gets one tool, `report_result`. The UI gets a stage chip on task and subtask rows and a panel at the top of an expanded task.

**Tech Stack:** Rust (Tauri 2.12, rusqlite 0.32), the `studiomanager-mcp` crate (rmcp `#[tool]` router), React 19 + TypeScript, TanStack Query, Vitest + Testing Library.

**Spec:** [2026-11-12-agent-orchestrator-design.md](../specs/2026-11-12-agent-orchestrator-design.md), part 2 ("2. A task carries its agent", "Data and tools", "Decisions", "Build order" item 2). Mockups: [the four screens](../mockups/2026-11-12-agent-orchestrator.html), screen 3.

Builds on [part 1, capture and briefing](2026-11-12-agent-orchestrator-1-capture.md) (migration 016 already added `brief` and `stage`) and on [Start an agent from a task](2026-11-05-agent-from-task.md) ([its design](../specs/2026-11-05-agent-from-task-design.md)), whose `useStartAgentOn` hook every start from a task goes through.

Rules this plan follows: [CLAUDE.md](../../../CLAUDE.md), [DESIGN-SYSTEM.md](../../../DESIGN-SYSTEM.md), [Agent access](../../agent-access.md), [Agents](../../agents.md), "Adding a Rust command" in [the README](../../../README.md#building-from-source), and [RELEASING.md, step 1](../../../RELEASING.md#1-pre-release-validation-all-must-pass).

## Calls made in this plan (the owner can overrule each)

The design leaves these open. Each is the simplest option that fits the code; each is marked *my call* where it is used.

1. **Where "the open task" lives.** The app has no task page or task panel today: a task is a row that expands to show its subtasks (`TasksPage.tsx`, `ProjectTasksSection.tsx`). The open task is a new panel, `TaskAgentPanel`, at the top of the expanded area. For a subtask, clicking its stage chip opens the same panel under the subtask row. No new page, no new route.
2. **When an agent counts as finished.** An agent started from a task first reads it, then asks Loris what to do, then waits. In the agent list, an agent waiting for his reply in its conversation looks the same as one that finished (both "idle"). So: the link closes, and the stage becomes To check, when (a) the agent reported a result and is no longer working, or (b) the agent shows as done, or (c) a fresh agent list no longer has it (stopped and removed, or never started). An idle agent with no result stays Running.
3. **Which link `report_result` writes to.** The tool cannot know which session calls it. It writes to the item's newest open link. With no open link (an agent started by hand in a terminal), it writes only the result.
4. **Branch and pull request** come only from `report_result`. The agent list carries no branch.
5. **Session id.** `claude --bg` prints only the short id, so a link starts with the short id and the tracker fills in the session id from the list. Once known, the link is matched by session id, because switching an agent's model keeps the session id but gives a new short id.
6. **No CHECK on `task_agents.outcome`.** Part 2 writes `result` or `no_result`; part 3 will add its own values (sent back, merged, stuck). SQLite cannot widen a CHECK without rebuilding the table (see part 1's Task 1). The values live in one Rust constant and one TypeScript type.
7. **Links go with their task.** `ON DELETE CASCADE` on both foreign keys. Undoing a task delete recreates the task with a new id (`useDeleteTask`), so its links do not come back.
8. **Chips and the panel show only while Agents is on** (`useAppStore((s) => s.agentsEnabled)`), like "Start work with agent". So never in the demo build. A done item shows no chip.
9. **Who sets which stage by hand.** In the panel, Loris can set none, Briefed or Ready. Running and To check are set only by the app. From To check: **Accept** (status done, stage cleared, as the design says) or **Clear stage**. Ready does nothing yet: the watcher that starts Ready tasks is part 3.
10. **Test and presentation mode.** A start from a task still starts the agent (as today) but writes no link and no stage: the copy it would go to is thrown away when the mode ends, and the tracker skips organisations in a mode.
11. **Dev build only: task agents use the dev build's own StudioManager server.** An agent started from a task uses the server Loris added to Claude Code, which reads the installed app's data. In the dev build (`npm run dev:test`, identifier `ch.studiomanager.dev`) that is the wrong data and an older server without `report_result`. So in the dev build only, the start adds `--mcp-config` with the dev build's server and data folder. A spike decides whether `--strict-mcp-config` is also needed (Task 5). Release builds start agents exactly as today.
12. **Result size.** At most 4000 characters (a short note, not a report); `pr_url` must start with `https://`; `branch` at most 200 characters, no spaces. The result is shown read-only.
13. **The prompt.** The task and subtask prompts gain one sentence asking for `report_result` when the work is done. The "read it, then ask me" start stays. The project prompt does not change (a project start has no link).
14. **The tracker is its own thread**, every 30 seconds, like the brief scheduler, not inside the 2-second poller. It looks at every organisation not in a mode, whether or not Agent access allows it: these are the app's own writes, not an agent's.
15. **"Waiting on you" on a row** reads the agent list without speeding up the poller (a passive list, refreshed by `agents:changed`, every 30 seconds while no Agents view is open).
16. **The progress line** is Idea, Briefed, Running, To check, Done, as in the mockup. Ready shows as "Ready" in the Briefed step. Idea is marked when a capture was filed as the item.

## Global Constraints

- **Schema:** only through migration `017_task_agents.sql`, listed in `MIGRATIONS` in `src-tauri/src/migrate.rs` (`LATEST_VERSION` becomes 17). `ensureSchema` in `src/db/index.ts` is not touched. The MCP server's `check_schema` (`src-tauri/mcp/src/guard.rs`) refuses a database not at exactly the latest version ("Open StudioManager once with this organisation, then try again."): expected, say it in the release notes, as for 016.
- **Feature gate:** everything here is part of the Agents feature: hidden or skipped while `AgentsSettings.enabled` is false (`switched_on` in `src-tauri/src/agents/actions.rs`), and so always off in the demo build (`cli::in_build`). The tracker checks `crate::host::is_demo` first, before it reads any file, as `briefing::check` does. Nothing is written for an organisation in test or presentation mode (Rust: the `MODE_FILES` rule of `briefing::in_mode`; app: `useAppStore` `testMode` / `presentationMode`).
- **No new Rust command** is planned: the panel and the start read and write through the app's own SQL (`src/db/queries`), and `agents_start` only gains an optional argument. If one is added after all, it goes in the three lists (`generate_handler!` in `src-tauri/src/lib.rs`, `COMMANDS` in `src-tauri/build.rs`, `src-tauri/permissions/windows.toml`), `main-window` only.
- **No deletes** through the MCP server. The app deletes a link only through the cascade of a task the user deletes.
- **Labels** in `src/i18n/labels/work.ts` (stage, panel) and `src/i18n/labels/agents.ts` (agent states), EN and FR, added in the task that shows them. No emojis. Icons from `ICONS`.
- **New UI pieces are flagged** (DESIGN-SYSTEM.md "Reuse First"): `TaskAgentPanel` and `StageChip` (a `Badge` with a fixed variant per stage). Everything else reuses `Badge`, `Button`, `Select`, `Textarea`, `ExternalLink`, `notify`.
- **Public repo:** fixtures and tests use made-up names ("Studio A", "Poster tool", "Contact sheet export"), never a client name or a personal path.
- **Cargo:** from inside `src-tauri` with `CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager`, and from inside `src-tauri/mcp` with `CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager-mcp` and `--locked`. Never the repo root. Never `cargo fmt` in `src-tauri/mcp`.
- **Hand checks** are done by Loris in the dev build (`npm run dev:test`, its own data folder, fictional data), not in the installed app: no release goes out for a few weeks.

## Risk for the owner's real work

Part 2 starts no session by itself, spends no plan usage by itself, writes to no repo and merges nothing. Sessions still start only when Loris clicks "Start work with agent".

| Task | What could touch real work | What limits it |
|---|---|---|
| 1. Migration 017 | Runs on every real organisation database at the first launch of the release that has it | Adds one table and two columns only; nothing is changed or removed; tested on a fresh file and run twice |
| 2. `report_result` | Any agent connected to StudioManager can write a task's result and a link's branch and pull request link | Text only, never status or stage; backup before the first write and a log line (the server's `write`); refused in test and presentation mode; 4000-character cap |
| 4. Link tracker | Writes by itself, every 30 s, to real organisation databases | Only rows the app created (open links); stage changes only from Running to To check, and only on items not done; Agents switch on, not demo, not in a mode; `org_shared()` held and a 5-second busy wait; never starts, stops or deletes an agent |
| 5. Dev-build server | Changes how agents start | Only when the app's identifier is `ch.studiomanager.dev`; a test proves release and demo identifiers add nothing |
| 6. Start writes the link | One more write after each start; the prompt now asks agents to call `report_result` | The start itself is unchanged and still needs Loris's click; no link in a mode or when the organisation changed during the start |

## Review Focus

- **An idle agent right after it starts** (a review note left open from part 1): an idle agent with no result keeps its link open; only a reported result, a done state or a fresh list without it closes the link. (Test in Task 4.)
- **The list has not seen the new agent yet:** "not listed" counts only after the poller's last successful list (`AgentsState::listed_at`) is newer than both the link's start plus 60 seconds and the tracker's own start, as `briefing::list_is_fresh` does. (Test in Task 4.)
- **A clock jumping backwards** (open from part 1): link times are SQLite `datetime('now')`, `listed_at` is the app's clock. A jump back only makes the tracker wait longer before trusting "not listed"; it never closes a link early. (Test in Task 4.)
- **Two app instances** (open from part 1): two trackers on the same database write the same thing; every update has a `WHERE ended_at IS NULL` or `WHERE stage = 'running'` guard, so a second write changes nothing. The installed app and the dev build have separate data folders, so each only sees its own links, even though both list the same agents. (Test in Task 4.)
- **Model switch:** the copy has a new short id and the same session id; the link follows it and does not close. (Test in Task 4.)
- **Organisation switched during a start** (picker, trust question): the link is not written, a toast says the agent was started but not linked. (Test in Task 6.)
- **`report_result` and the stage:** the tool never writes `stage` or `status` ("Data and tools" in the design). (Test in Task 2.)
- **A link whose task was finished meanwhile:** the tracker closes the link but leaves the stage alone (no To check on a done item). (Test in Task 4.)

---

### Task 1: Migration 017: `task_agents`, `result`

**Files:**
- Create: `src-tauri/migrations/017_task_agents.sql`
- Modify: `src-tauri/src/migrate.rs` (`MIGRATIONS` entry with `columns_if_missing: true`, as 014 to 016; `LATEST_VERSION = 17`)
- Modify: `src/lib/backup.ts` (`TABLES`: `task_agents` after `captures`, with "children of tasks"), `src/__tests__/backupCsv.test.ts` (`EXPECTED_ORDER`, FK edges `task_agents -> tasks`, `task_agents -> subtasks`)
- Modify: `src/types/task.ts` (`result?: string | null` on `Task` and `Subtask`; update the comment on `TaskStage`: part 2 writes `running` and `to_check`)
- Create: `src/types/taskAgent.ts`
- Test: `src-tauri/src/migrate.rs` (tests module), `src/__tests__/taskAgentsSchema.test.ts`, `src/__tests__/backupSchema.test.ts` (existing, must stay green)

**Interfaces:**
- `type LinkOutcome = "result" | "no_result"`
- `interface TaskAgent { id: number; task_id: number | null; subtask_id: number | null; session_id: string | null; short_id: string; name: string; model: string | null; branch: string | null; pr_url: string | null; started_at: string; reported_at: string | null; ended_at: string | null; outcome: LinkOutcome | null }`

```sql
-- Agent orchestrator, part 2: the agents that worked on a task, and its result.
-- See docs/superpowers/specs/2026-11-12-agent-orchestrator-design.md.
CREATE TABLE IF NOT EXISTS task_agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- Exactly one of the two.
    task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    subtask_id INTEGER REFERENCES subtasks(id) ON DELETE CASCADE,
    -- Filled in by the app once the agent list shows it (claude --bg prints only the short id).
    session_id TEXT,
    short_id TEXT NOT NULL,
    name TEXT NOT NULL,
    model TEXT,
    -- Written by report_result.
    branch TEXT,
    pr_url TEXT,
    reported_at TEXT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT,
    -- 'result' or 'no_result' in part 2; no CHECK so part 3 can add values.
    outcome TEXT,
    CHECK ((task_id IS NULL) <> (subtask_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_task_agents_task ON task_agents(task_id);
CREATE INDEX IF NOT EXISTS idx_task_agents_subtask ON task_agents(subtask_id);
CREATE INDEX IF NOT EXISTS idx_task_agents_open ON task_agents(ended_at);
ALTER TABLE tasks ADD COLUMN result TEXT DEFAULT NULL;
ALTER TABLE subtasks ADD COLUMN result TEXT DEFAULT NULL;
```

**Not in the design's column list, added here:** `reported_at` (the tracker needs to know a result came in for this agent, call 2). `session_id` may be null (call 5). Outcome has no CHECK (call 6).

- [ ] **Step 1: Write failing tests**
  - `migrate.rs`: a fresh file migrated to 17 has `task_agents` with the columns above, `tasks.result`, `subtasks.result`; a row with both `task_id` and `subtask_id`, or neither, fails the CHECK; deleting a task removes its links and its subtasks' links (`foreign_keys` on); running 017 twice succeeds (`columns_if_missing`).
  - `taskAgentsSchema.test.ts` (with `freshRealDb()` from `src/__tests__/fixtures/realSqlite.ts`): a link on a subtask is removed with the subtask; `SELECT *` on tasks returns `result`.
- [ ] **Step 2:** Run `(cd src-tauri && CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager cargo test migrate)` and `npx vitest run src/__tests__/taskAgentsSchema.test.ts src/__tests__/backupSchema.test.ts src/__tests__/backupCsv.test.ts` — FAIL.
- [ ] **Step 3:** Add the file, the `MIGRATIONS` entry, `LATEST_VERSION`, `TABLES`, the backupCsv order and edges, the types.
- [ ] **Step 4:** Rerun, plus `(cd src-tauri/mcp && CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager-mcp cargo test --locked)` (its `db_behind_the_latest_migration_refused` follows `MIGRATIONS`) — PASS.
- [ ] **Step 5:** Commit `feat(db): task_agents table and result on tasks and subtasks (migration 017)`.

### Task 2: Agent access tool `report_result`

**Files:**
- Create: `src-tauri/mcp/src/write/results.rs` (declared in `write/mod.rs`)
- Modify: `src-tauri/mcp/src/server.rs` (one `#[tool]` method and `ReportResultInput`; the count in the `tool_router.list_all().len()` test 44 → 45)
- Modify: `src-tauri/mcp/src/read/mod.rs` (`Task` and `Subtask` get `result: Option<String>`, skipped when none), `src-tauri/mcp/src/read/projects.rs` (select it in `get_project`; `list_tasks` stays as it is, to keep it short)
- Modify: `src-tauri/mcp/tests/protocol.rs` (`stdio_round_trip`: 44 → 45 with `report_result` listed; `money_tools_hidden_when_off_at_startup`: 39 → 40)
- Test: unit tests in `write/results.rs`

**Interfaces:**
- `report_result(task_id? | subtask_id?, result, branch?, pr_url?, org?)`, in one `write(dir, org, "report_result", ...)` transaction (`write/mod.rs`: backup before the first write, change log):
  - exactly one id, else the existing `ONE_ID` error of `write/captures.rs`; the item must exist.
  - `result`: required, trimmed, not empty, at most 4000 characters ("Result too long: keep it under 4000 characters (what was done, what is left open, how to check it)."). *My call* (call 12).
  - `branch`: at most 200 characters, no whitespace. `pr_url`: starts with `https://`, at most 500 characters.
  - Writes `result` on the task or subtask. Then the newest link of that item with `ended_at IS NULL`: `reported_at = datetime('now')`, and `branch` and `pr_url` when given. No open link: only the result (*my call*, call 3).
  - Never writes `stage`, `status` or `ended_at`.
  - Returns `{ org, kind: "task" | "subtask", id, title, linked: bool }`. Log line: `Reported the result of task "<title>" (id N)`.
- Description: "Write the result of your work on a task or subtask before you stop: what was done, what is left open, how to check it. Add the branch and the pull request link if there are any."
- The server's `INSTRUCTIONS` stay as they are. The brief session's `STUDIOMANAGER_TOOLS` list does not get the tool.

- [ ] **Step 1: Write failing tests** (the crate's `write/test_util.rs` fixtures):
  - on a task with one open link: `result` set, the link has `reported_at`, `branch`, `pr_url`; `stage` and `status` unchanged; one log line.
  - two links, the older one closed: only the open one is written. No open link: result written, `linked: false`.
  - on a subtask: the subtask's result and its link.
  - both ids, no id, an unknown id → error, nothing written. Empty result, 4001 characters, `pr_url` "http://…", a branch with a space → error, nothing written.
  - refused in test mode with `MODE_ACTIVE` (`write_refused_in_test_mode` pattern); the first write takes the backup.
  - `get_project` shows `result` when set and leaves it out when null.
  - protocol: 45 tools with `report_result`; 40 with money off; with `STUDIOMANAGER_TOOLS` set to the brief session's seven, `report_result` is not listed.
- [ ] **Step 2:** Run `(cd src-tauri/mcp && CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager-mcp cargo test --locked)` — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun, plus `cargo clippy --locked --all-targets -- -D warnings` there — PASS.
- [ ] **Step 5:** Commit `feat(agent-access): report_result tool`.

### Task 3: Links and stages in the app's data layer

**Files:**
- Create: `src/db/queries/taskAgents.ts`, `src/db/hooks/useTaskAgents.ts`
- Modify: `src/db/queryKeys.ts` (`taskAgents: { all, byItem(kind, id), open }`), `src/lib/agentChangeKeys.ts` (`report_result` → `[...TASKS, "taskAgents"]`; `task_links` (the tracker's event, Task 4) → the same)
- Modify: `src/db/queries/captures.ts` (`markStarted` sets only the capture's `outcome = 'ready'`; it no longer clears the stage, since the start now sets Running)
- Test: `src/__tests__/taskAgentQueries.test.ts` (real SQLite fixture), `src/__tests__/captureQueries.test.ts` (existing: update the `markStarted` case), `src/__tests__/agentChangeKeys.test.ts`

**Interfaces:**
- `type ItemKind = "task" | "subtask"`
- `linkAgent({ kind, id, shortId, name, model }): Promise<number>` — one `TransactionBatch`: insert the link, then `stage = 'running'` on the item `WHERE status <> 'done'`.
- `getItemAgents(kind, id): Promise<TaskAgent[]>` — newest first.
- `getOpenLinks(): Promise<{ kind: ItemKind; item_id: number; short_id: string; session_id: string | null }[]>` — for the "waiting on you" chip.
- `wasCaptured(kind, id): Promise<boolean>` — a capture is filed as this item (the Idea step).
- `setStage(kind, id, stage: null | "briefed" | "ready")` — refused (no write, throws "The app sets this stage") when the current stage is `running`; allowed from none, briefed, ready, to_check. *My call* (call 9).
- `acceptResult(kind, id)` — `status = 'done'`, `stage = NULL`, in one statement.
- Hooks: `useItemAgents(kind, id)`, `useOpenLinks()`, `useWasCaptured(kind, id)`, `useSetStage()`, `useAcceptResult()`; mutations invalidate `taskAgents` and call `invalidateTasks` (`src/db/queryKeys.ts`).

- [ ] **Step 1: Write failing tests:** `linkAgent` on a task and a subtask writes the row and Running; on a done task it writes the row and leaves the stage; `setStage` from running throws and writes nothing; from to_check to null works; `acceptResult` sets done and clears the stage; `getOpenLinks` leaves out closed links; `markStarted` keeps the stage; the two change keys map as above.
- [ ] **Step 2:** Run `npx vitest run src/__tests__/taskAgentQueries.test.ts src/__tests__/captureQueries.test.ts src/__tests__/agentChangeKeys.test.ts` — FAIL. **Step 3:** Implement. **Step 4:** Rerun — PASS. Commit `feat(tasks): agent links and stages in queries and hooks`.

### Task 4: The link tracker

**Files:**
- Create: `src-tauri/src/agents/links.rs` (declared in `src-tauri/src/agents/mod.rs`; `init` calls `links::start(handle)`)
- Modify: `src-tauri/src/agents/briefing.rs` (make `in_mode` and `MODE_FILES` `pub(crate)` so the tracker shares them; nothing else changes)
- Test: `src-tauri/src/agents/links.rs` tests

**How it reuses what exists:** the thread loop of `briefing::start` (`routines::schedule::{next_since_check, wall_ms, CHECK_EVERY, SLICE}`: every 30 s and right after a wake, the first check after 30 s so the poller has listed); the list from `AgentsState::cached()` and `listed_at()`; `briefing::list_is_fresh` and `LISTED_GRACE_MS`; organisations from `orgs::Registry::load` and `org_dir(app_dir, id).join(DB_FILE)`, as `briefing::with_work`; the database opened as `capture::open` does (`foreign_keys` on, `busy_timeout(5000)`); `crate::org_shared()` held while writing one organisation. *My call* (call 14): its own thread, not inside the poller.

**Interfaces:**
- `pub const OUTCOMES: [&str; 2] = ["result", "no_result"];`
- `pub struct OpenLink { id: i64, kind: ItemKind, item_id: i64, short_id: String, session_id: Option<String>, model: Option<String>, started_at: i64 /* ms, parsed from the TEXT as UTC */, reported: bool }`
- `pub fn open_links(db: &Path) -> Result<Vec<OpenLink>, String>` — `ended_at IS NULL`; an organisation whose database has no `task_agents` table (not migrated yet) gives none.
- `pub enum Judgement { Keep { fill: Option<Fill> }, End(&'static str) }` with `Fill { session_id, short_id, model }` (only what differs from the row).
- `pub fn judge(link: &OpenLink, agents: &[Agent], listed_at: Option<i64>, tracker_started: i64) -> Judgement`:
  - the agent: by `session_id` when the link has one, else by `short_id`.
  - found, group `Done` → `End(result | no_result)` by `reported`.
  - found, `reported` and group not `Working` → `End("result")`.
  - found otherwise → `Keep`, with `fill` when the session id, short id (model switch) or model differ.
  - not found and `list_is_fresh(listed_at, link.started_at + LISTED_GRACE_MS, tracker_started)` → `End(result | no_result)`; not found otherwise → `Keep { fill: None }`.
- `pub fn apply(db: &Path, link: &OpenLink, j: &Judgement) -> Result<bool, String>` — one immediate transaction. `Keep` with `fill`: update those columns. `End`: `UPDATE task_agents SET ended_at = datetime('now'), outcome = ? WHERE id = ? AND ended_at IS NULL`; when that changed a row and the item has no other open link, `UPDATE <tasks|subtasks> SET stage = 'to_check', updated_at = datetime('now') WHERE id = ? AND stage = 'running' AND status <> 'done'`. Returns whether anything changed.
- `pub fn pass(app_dir: &Path, agents: &[Agent], listed_at: Option<i64>, tracker_started: i64) -> bool` — every organisation with a database, not in a mode; errors logged per organisation, never fatal.
- After a pass that changed something: emit `crate::agent_access::CHANGED_EVENT` with `["task_links"]`.

Never runs: in the demo build (`crate::host::is_demo(&app)` first, before any file is read), while Agents is off (`read_settings(..).enabled`), for an organisation in a mode. It never calls `claude`.

- [ ] **Step 1: Write failing tests** (a temp app folder with a registry and two migrated organisations; `Agent` values built in the test):
  - `judge`: Working, no result → Keep; Idle, no result → Keep (the "idle right after start" case); Idle with a result → End("result"); NeedsYou with a result → End("result"); Done without a result → End("no_result").
  - not listed: with `listed_at` before `started_at + 60 s` → Keep; after it but before `tracker_started` → Keep; after both → End. `listed_at` None → Keep.
  - a clock jumped back (`listed_at` earlier than `started_at`) → Keep.
  - model switch: link with session id S and short id A; list has S with short id B → Keep with fill `short_id = B`. Link with no session id, list has its short id → fill the session id.
  - `apply` End: link closed, stage Running → To check; a second `apply` of the same End changes nothing (two instances); a done task keeps its stage; an item with a second open link keeps Running; a stage Loris changed to Briefed meanwhile is left alone.
  - `pass` skips an organisation with `studiomanager_test.db` beside its database, and one whose database has no `task_agents` table.
  - a database held in `BEGIN IMMEDIATE` for 6 s → that organisation's pass fails after about 5 s with an error, the other organisation is still handled.
  - the demo check comes before any file read (a tick in a demo app reads nothing), as `briefing`'s test.
- [ ] **Step 2:** Run `(cd src-tauri && CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager cargo test agents::links)` — FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun, plus `cargo test every_host_command_is_gated_for_the_demo` and `cargo clippy --locked --all-targets -- -D warnings` in `src-tauri` — PASS.
- [ ] **Step 5:** Commit `feat(agents): the app follows the agents linked to tasks and sets To check`.

### Task 5: Dev build: task agents reach the dev build's own server

Needed for every hand check of this plan (*my call*, call 11). Without it, an agent started from a task in the dev build talks to the server Loris added to Claude Code, which reads the installed app's data (the dev organisation ids are unknown there, so it refuses) and has no `report_result`.

**Files:**
- Modify: `src-tauri/src/host.rs` (`pub fn is_dev_identifier(id: &str) -> bool`, true only for `ch.studiomanager.dev`; `is_dev(app)`)
- Modify: `src-tauri/src/agents/actions.rs` (`agents_start` gains `own_server: Option<bool>`; when true and `is_dev(app)`, it calls `start_with` with `task_agent_args(..)` instead of `start`)
- Create: in `actions.rs` or a small `src-tauri/src/agents/task_server.rs`: `prepare_config(app_dir, mcp_path) -> Result<PathBuf, String>` writing `<app data folder>/task-agent-mcp.json` = `{ "mcpServers": { "studiomanager": { "command": <agent_access::mcp_path()>, "env": { "STUDIOMANAGER_DATA_DIR": <app data folder> } } } }` (no `STUDIOMANAGER_TOOLS`: a worker keeps every tool), and `task_agent_args(file) -> Vec<String>` = `--mcp-config <file>`, plus `--strict-mcp-config` if Step 1 says so
- Modify: `src/lib/agents.ts` (`startAgent(folder, task, model, name, ownServer = false)`)
- Test: `src-tauri/src/host.rs` and `actions.rs` tests, `src/__tests__/useStartAgentOn.test.tsx` (Task 6 passes `ownServer: true`)

- [ ] **Step 1: Spike, by hand in a terminal (Loris, or the implementer with his OK: it starts two short Opus sessions).** In an empty test folder that is trusted, with the `studiomanager` server added to Claude Code as Settings shows it: start `claude --bg --model opus --name spike-a --mcp-config <file> -- "Call list_organisations and say which data folder answered"` with a file that points `STUDIOMANAGER_DATA_DIR` at the dev build's data folder. Answer: which server answers when both have the same name. If the file's server wins, no more flags. If the user's own server wins or the session sees both, repeat with `--strict-mcp-config` (then the dev session has no other servers, such as the browser; acceptable in the dev build only). Also check that the dev build has the `studiomanager-mcp` binary next to its executable (`mcp_path()` says "usually absent" in dev builds; the brief session in the dev build needs it too). Write the answers into this task before Step 2.
  **Spike result (2026-11-13, one Opus session on the dev build's fictional data):** started with `--mcp-config` naming a `studiomanager` server while the user's own `studiomanager` server was also added to Claude Code. The session saw one `list_organisations` tool and the file's server answered (the dev build's organisations). So the file's server wins: no `--strict-mcp-config`, the session keeps its other servers. The `studiomanager-mcp` binary is next to the dev build's executable (the brief session already uses it there).
- [ ] **Step 2: Write failing tests:** `is_dev_identifier` true for `ch.studiomanager.dev`, false for `ch.studiomanager.app` and the demo identifier; `prepare_config` writes exactly that JSON and is safe to run twice; `task_agent_args` puts nothing equal to `--` alone; `agents_start` with `own_server` in a non-dev app calls `start` with no extra argument (the argv of the fake `Cli` is unchanged from today).
- [ ] **Step 3:** Run `(cd src-tauri && CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager cargo test host agents::actions)` — FAIL. **Step 4:** Implement. **Step 5:** Rerun, plus clippy — PASS. Commit `feat(agents): in the dev build, task agents use the dev build's own server`.

### Task 6: "Start work with agent" records the link

**Files:**
- Modify: `src/hooks/useStartAgentOn.ts` (after `startAgent` resolves, for a task or subtask: `linkAgent`)
- Modify: `src/lib/agentStart.ts` (`agentPrompt` for task and subtask; the project prompt is unchanged)
- Modify: `src/components/agents/NeedsYouTab.tsx` only if its test shows a change is needed (it already calls `markStarted` after a start that resolved true; Task 3 made `markStarted` keep the stage)
- Modify: `src/i18n/labels/agents.ts` (`agents_started_not_linked`)
- Test: `src/__tests__/useStartAgentOn.test.tsx`, `src/__tests__/agentStart.test.ts`, `src/__tests__/agentsNeedsYou.test.tsx`

**Flow** after `startAgent(folder, prompt, "opus", name, true)` returns the short id, for a task or subtask only:
1. If `useAppStore.getState().testMode || presentationMode`: no link (*my call*, call 10).
2. If `useOrgStore.getState().activeId` is no longer the organisation the item was read from: no link, `notify.error(t.agents_started_not_linked)`.
3. Else `linkAgent({ kind, id, shortId, name, model: "opus" })`. A failure: `notify.error(t.agents_started_not_linked, e)`; the start still counts as done (it returns true and navigates).

**The prompt** (*my call*, call 13). For a task, exactly:

```text
Work on StudioManager task 44 "New Features" (project 4 "Studio Manager App", organisation 6kun0b). First read it and its context with the StudioManager tools: the task, its brief, its subtasks and notes, the project and its wiki. Then tell me briefly what you found and ask me what to do. Don't change anything before I answer. When the work is done, or you stop with work left, call report_result once with what was done, what is left open and how to check it, and the branch and pull request link if there are any. If the StudioManager tools aren't available, say so and ask me to describe the work.
```

The subtask prompt changes the same way. The project prompt stays exactly as it is.

Label: `agents_started_not_linked` "The agent started, but the task does not show it: {error}" / "L'agent a démarré, mais la tâche ne l'affiche pas : {error}".

- [ ] **Step 1: Write failing tests:** a task start calls `agents_start` with `ownServer: true` then writes one link and Running; a project start writes no link; test mode → started, no link; the active organisation changed during the trust question → started, no link, the toast; `linkAgent` rejecting → toast, still navigates; the prompt texts (task, subtask: the new sentence; project: unchanged, under 8000 characters); NeedsYou's Start leaves the item Running.
- [ ] **Step 2:** Run `npx vitest run src/__tests__/useStartAgentOn.test.tsx src/__tests__/agentStart.test.ts src/__tests__/agentsNeedsYou.test.tsx` — FAIL. **Step 3:** Implement. **Step 4:** Rerun — PASS. Commit `feat(agents): an agent started from a task is linked to it`.

### Task 7: The stage chip on rows and calendar events

**Files:**
- Create: `src/components/project/StageChip.tsx` (new piece, flagged), `src/lib/stage.ts` (`stageVariant(stage): BadgeVariant`: briefed `neutral`, ready `info`, running `accent`, to_check `warning`; `waitingOnYou(item, openLinks, agents): boolean`)
- Modify: `src/components/agents/useAgents.ts` (`useAgents({ watch = true } = {})`: with `watch: false` it never calls `watchAgents`, so the poller keeps its 30-second pace; *my call*, call 15)
- Modify: `src/pages/TasksPage.tsx` (chip after the title on task rows and subtask rows), `src/components/project/ProjectTasksSection.tsx` (task rows and the subtask rows inside `SortableSubtaskRow`), `src/pages/CalendarPage.tsx` (`stage` in `extendedProps` of task and subtask events; `renderEventContent` shows the stage word before the title)
- Modify: `src/i18n/labels/work.ts` (`stage_briefed` "Briefed" / "Avec brief", `stage_ready` "Ready" / "Prêt", `stage_running` "Running" / "En cours", `stage_to_check` "To check" / "À vérifier", `stage_waiting` "waiting on you" / "attend votre réponse")
- Test: `src/__tests__/stageChip.test.tsx`, `src/__tests__/startAgentMenus.test.tsx` and `src/__tests__/calendarDatesAndStatus.test.tsx` (existing, must stay green)

Rules: no chip when the stage is null, when the item is done, or while Agents is off (*my call*, call 8). Running with a linked agent in group `needs-you` reads "Running · waiting on you", as on mockup screen 3. On a subtask row the chip is a button that opens the panel of Task 8 (until then it does nothing).

- [ ] **Step 1: Write failing tests:** each stage gives its label and variant; done → no chip; Agents off → no chip; an open link whose agent is in `needs-you` → the waiting text; `useAgents({ watch: false })` never invokes `agents_watch`; a calendar task event with `stage: "to_check"` renders "To check".
- [ ] **Step 2:** Run `npx vitest run src/__tests__/stageChip.test.tsx src/__tests__/startAgentMenus.test.tsx src/__tests__/calendarDatesAndStatus.test.tsx` — FAIL. **Step 3:** Implement. **Step 4:** Rerun — PASS. Hand check (Loris, dev build): set a stage with the dev database open in a SQLite tool, or after Task 8 from the panel; see the chip on the Tasks page, the project page and the calendar. Commit `feat(tasks): stage chip on task and subtask rows and calendar events`.

### Task 8: The open task: `TaskAgentPanel`

**Files:**
- Create: `src/components/project/TaskAgentPanel.tsx` (new piece, flagged)
- Modify: `src/pages/TasksPage.tsx` and `src/components/project/ProjectTasksSection.tsx` (the panel at the top of a task's expanded area; under a subtask row when its chip is clicked; *my call*, call 1), `src/i18n/labels/work.ts`
- Test: `src/__tests__/taskAgentPanel.test.tsx`

Shown when Agents is on and the item has a stage, a brief, a result or a link. Content, as on mockup screen 3:

- **Progress line:** Idea (when `wasCaptured`), Briefed (reads "Ready" when ready), Running, To check, Done; the current step stands out (*my call*, call 16).
- **Stage:** a `Select` with none, Briefed, Ready while the stage is none, briefed or ready (`setStage`); while Running, the stage as text only; while To check, **Accept** (`acceptResult`) and **Clear stage** (`setStage(null)`).
- **Brief:** `Textarea`, saved on blur or Cmd+Enter with `setBrief` from `src/db/queries/captures.ts` (as the Needs you tab does).
- **Agents:** one line per link, newest first: name, state ("working", "waiting on you", "finished 20 min ago", "ended without a result"), model, branch, the pull request through `ExternalLink` (opens through `openExternal`, so nothing opens in the demo build), and **Open** to `/agents?agent=<session id>`, or `/agents?started=<short id>` while the session id is unknown.
- **Result:** the last result, read-only, line breaks kept. None: "No result yet".

Labels (EN / FR): `task_agent_brief` "Brief" / "Brief", `task_agent_agents` "Agents" / "Agents", `task_agent_result` "Result" / "Résultat", `task_agent_no_result` "No result yet" / "Pas encore de résultat", `task_agent_accept` "Accept" / "Accepter", `task_agent_clear_stage` "Clear stage" / "Retirer l'étape", `task_agent_ended_no_result` "ended without a result" / "terminé sans résultat", `task_agent_finished` "finished {ago}" / "terminé {ago}", `task_agent_open` "Open" / "Ouvrir", `stage_idea` "Idea" / "Idée", `stage_done` "Done" / "Terminé", `stage_none` "No stage" / "Aucune étape".

- [ ] **Step 1: Write failing tests** (mock the hooks of Task 3 and `useAgents`): the progress line marks the right step for each stage; Ready shows in the Briefed step; Idea only when captured; the select offers three options and calls `setStage`; Running shows no select; To check shows Accept and Clear stage and calls the hooks; the brief saves on blur; a link with a PR shows the link; a link with no session id opens `?started=`; Agents off → nothing renders.
- [ ] **Step 2:** Run `npx vitest run src/__tests__/taskAgentPanel.test.tsx` — FAIL. **Step 3:** Implement. **Step 4:** Rerun with `src/__tests__/stageChip.test.tsx` — PASS. Commit `feat(tasks): the open task shows its brief, agents and result`.

### Task 9: Docs, full check and the owner's hand check

- Modify: `docs/agents.md` — a section "A task carries its agent" after "Start from a task": the stages and who sets them; the link written when an agent starts from a task (not from a project, the New agent form or a review report); `report_result`; when To check is set (call 2, in plain words); the panel; Accept; nothing in test or presentation mode; not in the demo build. Link the [design](../specs/2026-11-12-agent-orchestrator-design.md) (from that file: `superpowers/specs/2026-11-12-agent-orchestrator-design.md`) and this plan (`superpowers/plans/2026-11-13-agent-orchestrator-2-task-agent.md`).
- Modify: `docs/agent-access.md` — "Tools": `report_result` beside the capture tools; "44 tools, 5 of them money tools" becomes 45; under "Safety rules", that `report_result` writes only the result and the link's branch and pull request.
- Modify: `IDEAS.md` — "A task carries its agent": built, awaiting a hand check, with a link to this plan.
- Modify: `CHANGELOG.md` only at release time ([RELEASING.md](../../../RELEASING.md)), not here.
- [ ] Run the checks of [RELEASING.md, step 1](../../../RELEASING.md#1-pre-release-validation-all-must-pass): `npx tsc --noEmit`, `npx vitest run`, `npm run lint`; in `src-tauri/mcp`: `CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager-mcp cargo test --locked` and `cargo clippy --locked --all-targets -- -D warnings`; in `src-tauri`: `CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager cargo test --locked` and the same clippy. All pass. Commit `docs(agents): a task carries its agent`.
- [ ] **Hand check (Loris, dev build `npm run dev:test`, fictional data; starts three or four short Opus sessions):** Agents and Agent access on for the dev organisation; a test project linked to an empty test folder; a task with a brief.
  1. Start work with agent on the task: the row says Running; the panel lists the agent with Opus.
  2. The agent asks what to do: the row stays Running (not To check). If it asks for a permission, the row says "waiting on you".
  3. Tell it to write one line in a file and report: the panel shows the result; within about a minute of the agent going idle, the row says To check.
  4. Accept: the task is done, no chip.
  5. On a subtask: start, then stop and remove the agent from the Agents page without a result: the subtask says To check, the panel says "ended without a result".
  6. Switch the model of a running linked agent: the link stays open and shows the new model.
  7. Test mode on: a start from a task writes no link.

---

## What is deliberately left out (parts 3 and 4)

- The watcher that starts Ready tasks, the cap of 3 workers, the budget rule (85% of the week's pace, 80% of five hours), the check command, `projects.check_command`.
- The `needs_you` table, the `ask` and `resolve` tools, the Decide and Check groups, Send back, merging, the lead sessions, the leeway rules, the end-of-day list, the Stop hook that asks once for a result.
- The rule that a hub's project is never merged by the lead alone (part 3, where merging is built; part 2 merges nothing).
- The Running tab of the mockup, the count on the sidebar and menu bar, moving watcher agents out of the All agents list.
- Links for agents started from a project, from the New agent form, from a review report, or in a terminal.
- A guard against two app instances (both write the same thing here, see Review Focus).
- Hubs (part 4).

## Design gaps and decisions taken in this plan

Points where the design did not say enough for code, or where the code differs from what the design assumed. Each is a call the owner can overturn.

1. **There is no "open task" view.** The design says "The open task shows the progress line, the brief, the agents … and the last result", and the mockup draws a task detail. The app has no task page or detail panel: a task row only expands to its subtasks. The plan adds a panel in the expanded area (call 1).
2. **"The agent finished" has no signal for the agents part 2 links.** The design sets To check "when the agent finishes". A "Start work with agent" session reads the task and then waits for Loris's answer; the agent list shows that wait as idle, exactly like a finished session. The plan defines finished as: result reported and not working, done, or gone from a fresh list (call 2). Part 3's Stop hook will make this sharper for the watcher's own workers.
3. **`claude --bg` gives no session id.** The design's `task_agents` row has a session id from the start; `actions::start` returns only the short id. The session id is filled in later (call 5), and the column may be null.
4. **A model switch changes the short id.** `actions::switch_model` resumes the same session as a new background agent with a new short id. Matching on the short id alone would close the link; the plan matches on the session id once known.
5. **`report_result` cannot tell which agent calls it.** The design gives it `branch` and `pr_url`, which belong to the link, but no link id. The plan writes to the item's newest open link (call 3), and adds `reported_at` to `task_agents` so the tracker knows a result came in.
6. **Branch has no other source.** The design lists `branch` on `task_agents`; nothing in the agent list carries it. Only `report_result` writes it (call 4).
7. **`stage` and `brief` are already in the database.** The design's "Data and tools" puts `stage`, `brief` and `result` in part 2's columns; part 1's migration 016 already added `stage` (with all five values) and `brief`. Migration 017 adds only `result` and `task_agents`.
8. **Outcome values were not given.** The design says "how it ended" without values. Part 2 uses `result` and `no_result`, with no CHECK so part 3 can add its own (call 6).
9. **Agents started from a task use the server Loris added to Claude Code**, not the server of the app that started them. In the dev build that is the installed app's data and an older server. The plan passes the dev build's own server in the dev build only, after a spike (call 11, Task 5).
10. **Undo of a task delete does not restore links.** `useDeleteTask` recreates the task with a new id and its subtasks; the links are deleted with the task (call 7).
11. **Ready has no effect yet.** The design's Ready means "may be started by the watcher", which is part 3. Part 2 lets Loris and the brief session set it, and shows it.
12. **"Agents started by hand from a task are linked the same way"** covers only "Start work with agent" on a task or subtask. A project start, the New agent form and review reports have no task to link to.
