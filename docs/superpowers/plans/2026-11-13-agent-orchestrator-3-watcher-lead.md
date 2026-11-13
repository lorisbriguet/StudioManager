# Agent Orchestrator, Part 3: The Watcher, the Lead and "Needs you" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While Loris has switched it on, the app starts an Opus worker on the next Ready task in its own git worktree (at most 3 at once, only under the week's pace), notices when a worker asks, finishes, gets stuck or idles, runs the project's check command, and starts a short Opus lead session for one event at a time. Everything waiting on Loris is in one "Needs you" list (Decide, Check, Briefs) with a count on the sidebar and the menu bar. The lead may merge a small, checked change alone; a hub's project never.

**Architecture:** One migration (018) adds `needs_you`, the watcher's counters on `task_agents`, and `check_command`, `merge_alone`, `hub_project` on `projects`. A new Rust thread, the **watcher** (`src-tauri/src/agents/watcher/`), runs every 30 s beside the brief scheduler and the link tracker of part 2, reads the poller's agent list, and keeps all its state in the organisation databases and one `watcher.json`. Pure functions decide (budget, cap, events, merge rule); thin wrappers act through the existing start, stop, resume and message paths. The MCP server gets `ask`, `list_needs_you`, and three lead-only tools, plus a `--stop-hook` mode like `--statusline`. The app runs `git` and `gh` itself to make worktrees, measure a change and merge it. The UI gets the Decide and Check groups, a "Decided alone" group, project settings and the watcher switch.

**Tech Stack:** Rust (Tauri 2.12, rusqlite 0.32, `libc` for the lock file), the `studiomanager-mcp` crate (rmcp `#[tool]` router), `git` and `gh` run as programs (argv, never a shell, except the check command), React 19 + TypeScript, TanStack Query, Vitest + Testing Library.

**Spec:** [2026-11-12-agent-orchestrator-design.md](../specs/2026-11-12-agent-orchestrator-design.md), part 3 ("3. The watcher, the lead and "Needs you"", "Leeway", "Budget", "Hooks"), "Data and tools", "What it costs", "Decisions", "Non-goals", "Anti-goals", "Build order" item 3. Mockups: [the four screens](../mockups/2026-11-12-agent-orchestrator.html), screen 2.

Builds on [part 1, capture and briefing](2026-11-12-agent-orchestrator-1-capture.md) (the brief session, its folder and flags, the Needs you tab with Briefs) and [part 2, a task carries its agent](2026-11-13-agent-orchestrator-2-task-agent.md) (stages, `task_agents`, `report_result`, the link tracker, Accept).

Rules this plan follows: [CLAUDE.md](../../../CLAUDE.md), [DESIGN-SYSTEM.md](../../../DESIGN-SYSTEM.md), [Agent access](../../agent-access.md), [Agents](../../agents.md), [Menu bar](../../menu-bar.md), "Adding a Rust command" in [the README](../../../README.md#building-from-source), and [RELEASING.md, step 1](../../../RELEASING.md#1-pre-release-validation-all-must-pass).

## Calls made in this plan (the owner can overrule each)

The design leaves these open or the code forces them. Each is marked *my call* where it is used.

1. **Three PRs.** PR A (Tasks 1 to 7): data, tools, the Needs you list, the budget, and a watcher that notices and says what it would do, but starts nothing. PR B (Tasks 8 to 12): starting workers, the Stop hook, the check command, resume and wrap up, lead sessions. PR C (Task 13): merging alone. Each is hand-checked in the dev build before the next is built.
2. **Workers only in git projects, each in its own worktree made by the app.** The watcher starts a Ready item only when its project folder is a git work tree. The app runs `git worktree add -b sm/<kind>-<id> <folder>/.claude/worktrees/sm-<kind>-<id> <base>` and starts the worker there, so the app knows the worktree, the branch and the base. Other Ready items wait for Loris ("Not a git folder").
3. **Merging alone is switched on per project** (`projects.merge_alone`, off by default), and a project marked "Belongs to a hub" (`projects.hub_project`) can never have it on, in the UI or in the merge code. Part 4 has no hub link yet, so this flag is how part 3 knows a hub's project. Off by default means nothing is merged alone until Loris says so for one project.
4. **The budget also governs the brief session.** The design's budget covers "a worker or a lead session"; the brief session is the lead's "New captures" row. Part 1 paused it only at 80% of five hours and started when the data was missing. Part 3 moves it onto the same rule, failing closed.
5. **Over budget, questions and finished work go straight to Loris.** The design says they are "still handled"; the request says no lead session starts over budget. So the check command (no model) still runs, and the entries are listed for Loris without a lead recommendation. Nothing is left unseen.
6. **Usage data is stale after 30 minutes** (`limits.json` `savedAt`). Stale, missing, or a weekly window that reset: no start. Whether background sessions refresh `limits.json` is not known (Task 8 spike); if they do not, the watcher starts work only within 30 minutes of Loris's own use of Claude Code.
7. **In the dev build, the budget reads the installed app's `limits.json`** (read only, that file and `limits-history.jsonl`): the status line writes only there, so the dev build's own folder has no usage data and would never start anything. Release builds read their own folder as today.
8. **Lead sessions: one at a time, Opus, 20 minutes at most**, in their own folder `<app data>/lead/` with the brief session's kind of flags. Per link at most 3 question sessions and 2 check sessions; further questions go straight to Loris.
9. **The cap counts what is really running.** Running workers = the larger of the open watcher links in the databases and the listed agents named `sm-w-…` that are not done. An empty or broken agent list cannot open room for more.
10. **Two instances:** the watcher holds an exclusive `flock` on `<app data>/watcher.lock`; a second instance of the same build runs no watcher. The installed app and the dev build have separate folders, so the name-based count of call 9 is what keeps them together under one cap.
11. **Any organisation in test or presentation mode stops the whole watcher** (not only that organisation): no start, no check, no lead, no merge, no message.
12. **The check command is set in the app only.** No tool writes it (`update_project` keeps its fixed field list). It runs as `/bin/sh -c` in the worktree with the routines' environment, 10 minutes at most, the last 64 KB kept, the last 8 KB sent back. A worker already has a shell, so this is about not letting a tool call change what runs unattended later.
13. **Workers ask for permissions like any agent.** A worker at a permission prompt for more than 2 minutes becomes a Decide entry that opens the agent; the lead never answers a prompt. The Task 8 spike measures how often this happens with `--permission-mode acceptEdits`.
14. **The Stop hook is a mode of the MCP binary** (`studiomanager-mcp --stop-hook`), given to the worker with `--settings <file>` (spike in Task 8; fallback `<worktree>/.claude/settings.local.json`). It reads the transcript, as the hub's own Stop hook does, and blocks at most once per reason per session.
15. **"Stuck" is a connection error, read from the transcript.** The agent list has no such state (`group_of`, `model.rs`). Task 11 starts with a spike on what a failed request leaves in the list and the transcript.
16. **Resume = type "Continue where you stopped." into the agent**; when the process is gone, the existing `switch_model` path (stop, `--resume --bg`) to the same model, then the message.
17. **Accept does not merge.** Accept is part 2's (done, stage cleared). Loris merges on GitHub through "Open the pull request". Only the lead's merge-alone path merges, and the app runs it.
18. **The app merges with `gh pr merge <url> --squash --match-head-commit <sha>`**, never `--delete-branch`, and leaves the worktree in place (deleting is in "always asks").
19. **Lead tools are hidden unless named.** `get_needs_you`, `resolve` and `hand_over` are listed only when `STUDIOMANAGER_TOOLS` names them, so a worker or Loris's own sessions never see them.
20. **No end-of-day brief exists in this repo.** What the lead and the app decided alone shows in a "Decided alone" group of Needs you (today, then 7 days), with Reopen. A read-only `list_needs_you` tool lets Loris's own end-of-day routine list it.
21. **The menu bar shows the count as the tray title** next to the icon (amber as today when anything waits). The sidebar uses the existing `CountBadge`.
22. **The All agents tab's own "Needs you" group** leaves out agents with an open watcher link; they are listed in the new list instead.
23. **The mockup's Running tab is not built.** Running items show with their chip on the Tasks page.

## What protects Loris's work and usage

Part 3 is the first part where the app starts workers and lead sessions by itself and spends Loris's Claude plan by itself (part 1's brief session already started one session every 15 minutes at most). Each limit below is checked in code before the action it guards, and each has a test.

| Limit | Where it is enforced | Test |
|---|---|---|
| **Off until switched on.** `AgentsSettings.watcher` is false by default and reads false in the demo build; switching Agents off turns it off. | `watcher::gate` is the first call of `watcher::tick`, before any file is read or any `claude` call | `gate_order_demo_off_mode_lock` (Task 7), `watcher_off_by_default_and_in_the_demo` (Task 5) |
| **Budget.** No worker, lead or brief session starts when the weekly percentage is above `85 * elapsed / 7 days` (elapsed from the window's start, `resets_at - 7 days`), or the five-hour percentage is at or above 80. Missing data, a window that already reset, `savedAt` older than 30 minutes or in the future: no start. Checks and Needs you entries go on (call 5). Starting by hand never reads the budget. | `budget::budget` called in `start::may_start` before `start_worker`, in `lead::may_start` before `start_lead`, and in `briefing::paused` | `budget_*` tests (Task 6), `no_start_when_budget_fails` (Task 8), `over_budget_question_goes_to_loris` (Task 12), `useStartAgentOn` test unchanged (start by hand) |
| **Cap of 3 workers** (setting, 1 to 5). Agents Loris started are never counted and never acted on: every action takes a `WatcherLink` read with `started_by = 'watcher'`. | `start::running_workers` before each start; `store::open_watcher_links` is the only source of agents the watcher stops, resumes or types into | `cap_counts_db_links_when_the_list_is_empty`, `hand_started_agents_are_never_touched` (Task 8) |
| **Retry caps**, stored in `task_agents` so a restart keeps them: `resumes` (at most 3), `check_fails` (1 send back), `sent_back` (lead, 1), `question_sessions` (3), `check_sessions` (2). Stop hook: `<app data>/watcher/stop-hook/<session id>.json`, once per reason per session. | `store::bump` runs in the same transaction as the decision, before the message or the start | `resume_at_most_three_times_then_needs_you` (Task 11), `second_check_failure_goes_to_loris` (Task 10), `lead_sends_back_once` (Task 12), `hook_blocks_once_per_reason` (Task 9) |
| **Merging alone** only when: the project has `merge_alone` on and `hub_project` off; a check command is set and passed on the same head; additions plus deletions under 100 (binary changes refuse); no path in the always-asks list (migrations, dependency manifests and lock files, version and release files, workflows, security and machine settings, any deleted file); the pull request is open, not a draft, its head is the worktree's clean HEAD; the lead said accept. The app computes all of it and runs the merge; the lead's word is only the last condition. | `merge::may_merge` then `merge::merge` in `watcher::act_on_resolution` | `merge_rule_*` (Task 13) |
| **Builds and modes.** Never in the demo build; in the dev build only when switched on there (its own `agents.json`, off by default, and a warning line); nothing while any organisation is in test or presentation mode; only while the app runs; one watcher per data folder (`watcher.lock`). | `watcher::gate` | `gate_order_demo_off_mode_lock`, `second_lock_is_refused` (Task 7) |
| **Check command** is set by Loris in the project's settings only; `/bin/sh -c` in the worktree, 10 minutes, 64 KB kept, 8 KB sent, control characters removed. | `check::run_check` | `check_*` (Task 10), `update_project_cannot_set_check_command` (Task 2) |
| **Lead sessions** get seven StudioManager tools and nothing else: `get_needs_you`, `resolve`, `hand_over`, `get_project`, `list_tasks`, `list_wiki`, `get_wiki_article` (allowed with `--allowedTools`, the server limited by `STUDIOMANAGER_TOOLS`, the 13 tools of `briefing::DENIED_TOOLS` denied). No tool deletes, no money tool is listed, there is no shell, so a lead cannot delete, release or touch money; the merge is the app's. | `lead::lead_args`, `lead::prepare_folder` | `lead_args_hold_exactly_the_seven_tools` (Task 12) |
| **Recorded with a reason.** Every decision taken without Loris is a `needs_you` row with `decided_by` `lead` or `app`, a `reason`, and the Decided alone group lists it with Reopen. | `store::record_alone` | `everything_done_alone_is_listed` (Task 4), each acting test checks the row |

**Worst case for one task:** 1 worker session, 3 restarts, 5 lead sessions (3 questions, 2 checks): 9 sessions. Typed into the worker: 1 check failure, 1 lead send back, at most 3 answers, 1 wrap-up request, 2 Stop hook continuations. Plus its share of one brief session.

## Global Constraints

- **Schema:** only through migration `018_watcher.sql`, listed in `MIGRATIONS` in `src-tauri/src/migrate.rs` (`LATEST_VERSION` becomes 18). `ensureSchema` is not touched. The MCP server's `check_schema` refuses an organisation the app has not opened since: say it in the release notes, as for 016 and 017.
- **Feature gate:** everything here is part of Agents (`switched_on` in `src-tauri/src/agents/actions.rs`), and the watcher also needs its own switch. Every thread checks `crate::host::is_demo` first, before it reads any file. Test and presentation mode: `briefing::in_mode` and `MODE_FILES` in Rust, `useAppStore` `testMode` / `presentationMode` in the app.
- **New Rust commands** (`agents_set_watcher`, `watcher_status`, `agents_lead_folder`) go in the three lists (`generate_handler!` in `src-tauri/src/lib.rs`, `COMMANDS` in `src-tauri/build.rs`, `src-tauri/permissions/windows.toml`), `main-window` only; `window_command_lists_match_the_handler` and `every_host_command_is_gated_for_the_demo` must pass.
- **No deletes** through the MCP server. The watcher never deletes an agent, a branch, a worktree or a file; it stops agents it started.
- **Labels** in `src/i18n/labels/agents.ts` and `src/i18n/labels/work.ts`, EN and FR, added in the task that shows them. No emojis. Icons from `ICONS`. New UI pieces flagged: `DecideEntry`, `CheckEntry`, `ProjectAgentSettings`; the rest reuses `Badge`, `Button`, `Switch`, `TextInput`, `Textarea`, `EmptyState`, `CountBadge`, `ExternalLink`, `notify`.
- **Public repo:** made-up names in tests ("Studio A", "Poster tool", "Contact sheet export"); no client name, personal path or real repository.
- **Cargo:** from inside `src-tauri` with `CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager`, and from inside `src-tauri/mcp` with `CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager-mcp` and `--locked`. Never the repo root. Never `cargo fmt` in `src-tauri/mcp`. `apple::tests::vision_ocr_reads_fixture_text` times out in background sessions: run it in a terminal or skip it with `--skip`.
- **Hand checks** are Loris's, in the dev build (`npm run dev:test`, identifier `ch.studiomanager.dev`, its own data folder, fictional data), on a throwaway test repository (a private one on GitHub for Task 13). They start real Opus sessions on his plan: each says how many.

## Risk for the owner's real work

| Task | What could touch real work | What limits it |
|---|---|---|
| 1. Migration 018 | Runs on every real organisation database at the first launch of the release that has it | Adds one table and columns only; tested fresh and twice |
| 2. Tools | Any agent can add a Decide entry with `ask` | Text only, capped; refused in a mode; backup before the first write; lead tools hidden unless named |
| 6. Budget on the brief session | The brief session may pause more often than today | Fails closed: it can only start less |
| 8. Starting workers | Spends plan usage; makes branches and worktrees in Loris's repositories | Off by default; budget; cap; git projects only; branch and worktree names fixed and refused when they exist; never on `main`; never in the demo; whole watcher off in a mode |
| 9. Stop hook | Changes how a worker's session ends | Only workers the watcher started get it; once per reason |
| 10. Check command | Runs a shell command unattended | Set by Loris in the app only; in the worktree; 10 minutes; killed with its process group on quit |
| 11. Resume and wrap up | Types into and stops agents | Only watcher links; 3 resumes; one wrap-up request; stop, never delete |
| 12. Lead sessions | Spends plan usage; answers a worker in Loris's place | Seven tools, no shell; budget; one at a time; 20 minutes; answers only from what is written, naming the source, recorded and listed |
| 13. Merging alone | Merges into a main branch without Loris | Separate PR; off per project by default; never a hub's project; every condition computed by the app; head pinned with `--match-head-commit`; no branch deleted |

## Review Focus

- **Usage data missing, stale or with its clock off:** no `limits.json`; `savedAt` 31 minutes old; `savedAt` 10 minutes in the future (clock jumped back); weekly `resets_at` already past (the meter is dropped by `limits::meters`); weekly `resets_at` more than 7 days ahead (negative elapsed). Each gives no start. (Tests in Task 6.)
- **The agent list empty or reshaped:** `claude agents --json --all` returns `[]`, or items without `sessionId` (dropped by `parse_agents`), while 3 watcher links are open: no start; nothing is judged "gone" from one list (`list_is_fresh` and part 2's two-miss rule). (Test in Task 8.)
- **Two instances:** a second watcher in the same data folder gets no lock and does nothing; the dev build and the installed app together stay under one cap through the name count. (Tests in Task 7 and Task 8.)
- **App quit in the middle of a check, or the worktree gone:** a `check_state = 'running'` found at start is run again and counts no failure; a missing worktree gives a Check entry "The worktree is gone", no send back, never a merge. (Tests in Task 10.)
- **The pull request changed by hand:** merged, closed, made a draft, or a new commit pushed after the check: `may_merge` refuses and the entry stays for Loris. (Tests in Task 13.)

---

### Task 1: Migration 018: `needs_you`, watcher columns, project settings

**Files:**
- Create: `src-tauri/migrations/018_watcher.sql`
- Modify: `src-tauri/src/migrate.rs` (`MIGRATIONS` entry with `columns_if_missing: true`, as 014 to 017; `LATEST_VERSION = 18`)
- Modify: `src/lib/backup.ts` (`TABLES`: `needs_you` after `task_agents`), `src/__tests__/backupCsv.test.ts` (order, FK edges `needs_you -> tasks`, `-> subtasks`, `-> task_agents`)
- Modify: `src/types/project.ts` (`check_command`, `merge_alone`, `hub_project`), `src/types/taskAgent.ts` (`LinkOutcome` gains `merged`, `to_check`, `stuck`, `wrapped_up`; the watcher fields)
- Create: `src/types/needsYou.ts`
- Test: `src-tauri/src/migrate.rs` tests, `src/__tests__/needsYouSchema.test.ts`

```sql
-- Agent orchestrator, part 3: what waits on Loris, the watcher's counters, project settings.
-- See docs/superpowers/specs/2026-11-12-agent-orchestrator-design.md.
CREATE TABLE IF NOT EXISTS needs_you (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- decide: a question; check: finished work; alone: done by the app or the lead without Loris.
    kind TEXT NOT NULL CHECK (kind IN ('decide', 'check', 'alone')),
    task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    subtask_id INTEGER REFERENCES subtasks(id) ON DELETE CASCADE,
    link_id INTEGER REFERENCES task_agents(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    recommendation TEXT,
    options TEXT,                 -- JSON array of strings
    is_decision INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'dismissed')),
    answer TEXT,
    decided_by TEXT CHECK (decided_by IN ('user', 'lead', 'app')),
    reason TEXT,
    lead_state TEXT,              -- waiting, running, done, skipped; no CHECK (part 4 may add)
    check_passed INTEGER,         -- null: no check command, or not run
    check_output TEXT,
    change_lines INTEGER,
    touches TEXT,                 -- JSON array of always-asks rules the change touches
    delivered_at TEXT,            -- the answer was typed into the worker
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    answered_at TEXT,
    CHECK ((task_id IS NULL) <> (subtask_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_needs_you_status ON needs_you(status, kind);
CREATE INDEX IF NOT EXISTS idx_needs_you_link ON needs_you(link_id);
ALTER TABLE task_agents ADD COLUMN started_by TEXT DEFAULT NULL;   -- 'watcher'; null: by hand
ALTER TABLE task_agents ADD COLUMN worktree TEXT DEFAULT NULL;
ALTER TABLE task_agents ADD COLUMN base_ref TEXT DEFAULT NULL;
ALTER TABLE task_agents ADD COLUMN check_state TEXT DEFAULT NULL;  -- running, passed, failed, none, error
ALTER TABLE task_agents ADD COLUMN resumes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE task_agents ADD COLUMN check_fails INTEGER NOT NULL DEFAULT 0;
ALTER TABLE task_agents ADD COLUMN sent_back INTEGER NOT NULL DEFAULT 0;
ALTER TABLE task_agents ADD COLUMN question_sessions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE task_agents ADD COLUMN check_sessions INTEGER NOT NULL DEFAULT 0;
ALTER TABLE task_agents ADD COLUMN wrap_asked_at TEXT DEFAULT NULL;
ALTER TABLE projects ADD COLUMN check_command TEXT DEFAULT NULL;
ALTER TABLE projects ADD COLUMN merge_alone INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN hub_project INTEGER NOT NULL DEFAULT 0;
```

**Not in the design's column list, added here** (design gaps 5 and 6): `subtask_id`, `link_id`, `is_decision`, `lead_state`, the check columns, `delivered_at`, kind `alone`, `decided_by` `app`; the counters; `merge_alone`, `hub_project`. The design's `session_id` is reached through `link_id`. Kind `brief` is not used: Briefs stay part 1's captures.

- [ ] **Step 1: Write failing tests:** `migrate.rs`: a fresh file at 18 has the table and every column above; a row with both or neither item id fails; kind `brief` and status `closed` fail; deleting a task removes its entries; deleting a link sets `link_id` null; 018 twice succeeds. `needsYouSchema.test.ts` (`freshRealDb()`): `SELECT *` on projects returns `merge_alone = 0`, `hub_project = 0`.
- [ ] **Step 2:** Run `(cd src-tauri && CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager cargo test migrate)` and `npx vitest run src/__tests__/needsYouSchema.test.ts src/__tests__/backupSchema.test.ts src/__tests__/backupCsv.test.ts` — FAIL.
- [ ] **Step 3:** Add the file, the entry, the types, `TABLES`, the order and edges.
- [ ] **Step 4:** Rerun, plus `(cd src-tauri/mcp && CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager-mcp cargo test --locked)` — PASS. Commit `feat(db): needs_you, watcher counters and project agent settings (migration 018)`.

### Task 2: Agent access tools `ask`, `list_needs_you`, and the lead's `get_needs_you`, `resolve`, `hand_over`

**Files:**
- Create: `src-tauri/mcp/src/write/needs_you.rs`, `src-tauri/mcp/src/read/needs_you.rs`
- Modify: `src-tauri/mcp/src/server.rs` (five `#[tool]` methods; `LEAD_ONLY: [&str; 3]` removed in `with_tools` unless `session_tools` names them, *my call*, call 19; tool counts), `src-tauri/mcp/tests/protocol.rs` (counts and names)
- Test: unit tests in both files, `src-tauri/mcp/src/write/projects.rs` tests

**Interfaces** (each write in one `write(dir, org, "<tool>", ...)` transaction: backup before the first write, one log line; refused in a mode with `MODE_ACTIVE`):
- `ask(task_id? | subtask_id?, question, recommendation, options?, org?)` → `{ org, id }`. Exactly one id (`ONE_ID`); question 1 to 2000 characters; recommendation required, at most 2000; options at most 6, each at most 80. Writes a `decide` row with `link_id` = the item's newest open link, `lead_state = 'waiting'` when that link has `started_by = 'watcher'`, else null. Description: "Ask a question you cannot answer from the brief, the wiki or the decisions, with your recommendation. Then stop and wait: the answer is typed into this conversation."
- `list_needs_you(status?, decided_by?, since?, org?)` → at most 100 rows, newest first, read only (for an end-of-day routine, call 20).
- Lead only: `get_needs_you(id, org?)` → the row, the item's title, brief and result, the project id and name, and for a check the stored diff from `<data dir>/lead/checks/<org>-<id>.diff` (ids numeric, nothing else read, at most 200 KB).
- Lead only: `resolve(needs_you_id, answer, reason, org?)` — only on `status = 'open'` and `lead_state = 'running'` rows; `answer` at most 4000; for a check, `answer` is `accept` or `send_back: <notes>`. Sets `status = 'answered'`, `decided_by = 'lead'`, `reason`, `answered_at`, `lead_state = 'done'`. Never writes stage, status of a task, or `delivered_at`.
- Lead only: `hand_over(needs_you_id, recommendation, reason, options?, is_decision?, org?)` — same guards; sets the recommendation and `lead_state = 'done'`, keeps `status = 'open'` for Loris.

- [ ] **Step 1: Write failing tests:** `ask` on a task with an open watcher link → `lead_state = 'waiting'`; with a hand link → null; no link → `link_id` null; both ids, unknown id, 2001 characters, 7 options → error, nothing written; refused in test mode; `resolve` on an answered row or one not `running` → error; `resolve` writes nothing on the task; `hand_over` keeps it open; `get_needs_you` reads only its own diff file (an id of `1/../x` cannot be passed: the type is i64); lead tools absent from `list_all()` with no `STUDIOMANAGER_TOOLS`, present when named; `update_project_cannot_set_check_command` (an input with `check_command` is refused by `deny_unknown_fields`, the column unchanged); protocol: the counts in `tool_count_follows_allow_money` and `protocol.rs` move by +2 without the lead list and +5 with it.
- [ ] **Step 2:** Run `(cd src-tauri/mcp && CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager-mcp cargo test --locked)` — FAIL. **Step 3:** Implement. **Step 4:** Rerun, plus `cargo clippy --locked --all-targets -- -D warnings` there — PASS. Commit `feat(agent-access): ask, list_needs_you and the lead's tools`.

### Task 3: Needs you, project settings and decisions in the app's data layer

**Files:**
- Create: `src/db/queries/needsYou.ts`, `src/db/hooks/useNeedsYou.ts`
- Modify: `src/db/queries/projects.ts` (`setProjectAgentSettings(id, { check_command?, merge_alone?, hub_project? })`), `src/db/queries/wiki.ts` (`addDecision(projectId, date, text)`), `src/db/queryKeys.ts` (`needsYou: { all, open, alone }`), `src/lib/agentChangeKeys.ts` (`ask`, `resolve`, `hand_over`, `watcher` → `needsYou` and tasks)
- Test: `src/__tests__/needsYouQueries.test.ts`, `src/__tests__/addDecision.test.ts`, `src/__tests__/agentChangeKeys.test.ts`

**Interfaces:**
- `getOpenEntries(): Promise<NeedsYouRow[]>` (decide and check, open, with item title, project, link short id and session id); `getAloneEntries(sinceDays: 7)`; `countOpen(): Promise<number>`.
- `answerEntry(id, answer)`, `dismissEntry(id)`, `reopenEntry(id)` (an `alone` or answered row back to open, `decided_by` null; a merged item goes back to todo with stage `to_check`).
- `setProjectAgentSettings`: refuses `merge_alone = 1` while `hub_project = 1`, and setting `hub_project = 1` turns `merge_alone` off, in one statement. `check_command` trimmed, at most 500 characters, empty → null.
- `addDecision`: writes the project's "Decisions" article exactly as the MCP's `add_decision` (`src-tauri/mcp/src/write/wiki.rs`): `<strong>YYYY-MM-DD</strong> text` in a list item, the article created when missing, the same decision twice added once.

- [ ] **Step 1: Write failing tests:** each query on `freshRealDb()`; `merge_alone` on a hub project throws and writes nothing; `addDecision` output equals the HTML the MCP test fixture expects for the same input (copy its expected string); `reopenEntry` on a merged entry sets the task todo, `to_check`; change keys map.
- [ ] **Step 2:** Run `npx vitest run src/__tests__/needsYouQueries.test.ts src/__tests__/addDecision.test.ts src/__tests__/agentChangeKeys.test.ts` — FAIL. **Step 3:** Implement. **Step 4:** Rerun — PASS. Commit `feat(agents): needs you entries, project agent settings and decisions in queries`.

### Task 4: The Needs you tab: Decide, Check, Briefs, Decided alone, and the counts

**Files:**
- Create: `src/components/agents/DecideEntry.tsx`, `src/components/agents/CheckEntry.tsx` (new pieces, flagged)
- Modify: `src/components/agents/NeedsYouTab.tsx` (groups Decide, Check, Briefs, then "Decided alone"), `src/pages/AgentsPage.tsx` (no `tab` → Needs you; `?agent=`, `?new=1`, `?started=` still open All agents; the count is open entries plus briefs), `src/components/agents/AgentList.tsx` (call 22), `src/components/layout/Sidebar.tsx` (`CountBadge` on Agents, as for upkeep), `src-tauri/src/menubar/mod.rs` (`set_needs_count(app, n)`: tray title, call 21), `src/i18n/labels/agents.ts`
- Test: `src/__tests__/agentsNeedsYou.test.tsx`, `src/__tests__/agentsPage.test.tsx`, `src/__tests__/Sidebar.test.tsx`

**Decide entry** (mockup screen 2): the question, the recommendation and its reason ("From the lead" when the lead wrote it), one button per option, **Answer in words** (`Textarea`). An answer calls `sendMessage(sessionId, "Answer to your question: <answer>")` (`src/lib/agents.ts`, the `agents_send` path), then `answerEntry`, then `addDecision` when `is_decision`. A refused send (agent at a prompt, gone) keeps the entry open with the error. A permission-prompt entry (call 13) has only **Open the agent**.
**Check entry:** the result, the change size ("42 changed lines"), the check ("Check passed", "Check failed", "No check command"), what it touches, and **Accept** (`useAcceptResult`, then the entry answered), **Open the pull request** (`ExternalLink`), **Send back** (a `Textarea`, typed into the worker, stage back to Running).
**Decided alone:** each row says what was done and why ("Merged: check passed, 37 lines", "Answered from the wiki article Decisions", "Restarted after a connection error") with **Reopen**.

- [ ] **Step 1: Write failing tests:** no `tab` → Needs you; `?agent=x` → All agents; an option button sends the text and answers; a failed send keeps the entry and shows the error; `is_decision` calls `addDecision`; Check shows the size and Accept marks done; Send back types the note; `everything_done_alone_is_listed` (an `alone` row and a lead-answered row show with Reopen); the sidebar badge shows the open count; an agent with an open watcher link is not in All agents' Needs you group.
- [ ] **Step 2:** Run `npx vitest run src/__tests__/agentsNeedsYou.test.tsx src/__tests__/agentsPage.test.tsx src/__tests__/Sidebar.test.tsx` — FAIL. **Step 3:** Implement. **Step 4:** Rerun — PASS. Hand check (dev build, no session): add a Decide entry with `ask` from a terminal session pointed at the dev build's server, answer it, see the count fall on the sidebar and the menu bar. Commit `feat(agents): Needs you lists questions, finished work and what was decided alone`.

### Task 5: Settings › Agents: the watcher switch; the project's agent settings

**Files:**
- Modify: `src-tauri/src/agents/cli.rs` (`AgentsSettings.watcher: bool` false, `worker_cap: u32` 3, clamped 1 to 5; `in_build` and `switch_off` turn `watcher` off; `set_watcher(dir, on, cap)` refuses on while Agents is off; command `agents_set_watcher`), the three command lists
- Create: `src/components/project/ProjectAgentSettings.tsx` (new piece, flagged): check command (`TextInput`), "The lead may merge small changes alone" (`Switch`, disabled with a reason on a hub's project), "Belongs to a hub" (`Switch`); shown in `src/components/ProjectDetailContent.tsx` under the folder line, only while Agents is on
- Modify: `src/components/settings/AgentsCard.tsx` (switch "Start work on Ready tasks by itself", the cap, the trust question for `<app data>/lead/` as for the brief folder, and in the dev build the line "Dev build: workers use your real Claude plan and the repositories of the projects here"), `src/lib/agents.ts`, labels
- Test: `src-tauri/src/agents/cli.rs` tests, `src/__tests__/agentsCard.test.tsx`, `src/__tests__/projectAgentSettings.test.tsx`

- [ ] **Step 1: Write failing tests:** `watcher_off_by_default_and_in_the_demo`; Agents off turns it off; cap 0 → 1, 9 → 5; the card's switch asks trust for the lead folder, a decline writes nothing; the project's merge switch is disabled on a hub's project; the check command saves on blur.
- [ ] **Step 2:** Run `(cd src-tauri && CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager cargo test agents::cli)` and `npx vitest run src/__tests__/agentsCard.test.tsx src/__tests__/projectAgentSettings.test.tsx` — FAIL. **Step 3:** Implement. **Step 4:** Rerun, plus `cargo test window_command_lists_match_the_handler every_host_command_is_gated_for_the_demo` — PASS. Commit `feat(agents): watcher switch and project agent settings`.

### Task 6: The budget rule

**Files:**
- Create: `src-tauri/src/agents/watcher/budget.rs` (with `watcher/mod.rs` declared in `agents/mod.rs`)
- Modify: `src-tauri/src/agents/briefing.rs` (`evaluate` and `paused` use `budget::budget`; `Paused::Budget(f64)` becomes `Paused::Budget(budget::Budget)`; `briefing_status` keeps its keys), `src/components/settings/AgentsCard.tsx`, `src/components/agents/InboxTab.tsx` (the reason in words), labels
- Test: `budget.rs` tests, `briefing.rs` tests (the 80% ones updated)

**Interfaces:**
- `pub const WEEK_LINE: f64 = 85.0; pub const FIVE_HOUR_CAP: f64 = 80.0; pub const WEEK_MS: i64 = 7 * 86_400_000; pub const STALE_MS: i64 = 30 * 60_000; pub const FUTURE_SLACK_MS: i64 = 5 * 60_000;`
- `pub enum Budget { Ok, AheadOfWeek { percent: f64, line: f64 }, FiveHour(f64), NoData, Stale { saved_at: i64 } }`
- `pub fn week_line(resets_at: i64, now: i64) -> Option<f64>` — `85 * (now - (resets_at - WEEK_MS)) / WEEK_MS`; None when the elapsed time is negative or over a week.
- `pub fn budget(limits: Option<(Vec<Meter>, i64)>, now: i64) -> Budget` — in order: no file → `NoData`; `saved_at` older than `STALE_MS` or more than `FUTURE_SLACK_MS` ahead → `Stale`; no `seven_day` meter or no `five_hour` meter (dropped when reset, `limits::meters`) → `NoData`; `five_hour >= 80` → `FiveHour`; `week_line` None or `seven_day > line` → `AheadOfWeek`; else `Ok`.
- `pub fn limits_dir(app_dir: &Path, dev: bool, home: &Path) -> PathBuf` — the installed app's folder (`<home>/Library/Application Support/ch.studiomanager.app`) when `dev`, else `app_dir` (*my call*, call 7).
- Reason labels: "Paused: ahead of the week's pace ({percent}% used, line at {line}%)", "Paused: the 5-hour window is at {percent}%", "Paused: no usage reading yet", "Paused: the last usage reading is {min} minutes old".

- [ ] **Step 1: Write failing tests** (the `limits(...)` fixture of `limits.rs` tests): `budget_ok_on_the_line` (3.5 days into the week, 42.5% → Ok; 42.6% → AheadOfWeek); `budget_five_hour_80_stops` (79.9 → Ok, 80.0 → FiveHour); `budget_no_file`, `budget_stale_31_min`, `budget_saved_in_the_future`, `budget_week_reset_already` (`resets_at` past → NoData), `budget_week_more_than_7_days_ahead` → AheadOfWeek; `limits_dir` gives the installed folder only in dev; the brief scheduler with no `limits.json` now pauses (`NoData`) and with a stale one pauses.
- [ ] **Step 2:** Run `(cd src-tauri && CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager cargo test agents::watcher::budget agents::briefing)` — FAIL. **Step 3:** Implement. **Step 4:** Rerun, plus clippy — PASS. Commit `feat(agents): the week's pace and the 5-hour cap pause automatic sessions`.

### Task 7: The watcher thread: gates, lock, and noticing only

**Files:**
- Create: `src-tauri/src/agents/watcher/mod.rs` (thread, `gate`, `tick`, `WatcherState` in `<app data>/watcher.json`), `watcher/store.rs`, `watcher/events.rs`
- Modify: `src-tauri/src/agents/mod.rs` (`init` calls `watcher::start(handle)`), `src-tauri/src/agents/links.rs` (`read_open` leaves out `started_by = 'watcher'`: the watcher owns those links), the three command lists (`watcher_status`), `src/lib/agents.ts`, `src/components/agents/NeedsYouTab.tsx` (one muted line: the pause reason or "Would start: <item>")
- Test: tests in the three files, `links.rs` tests

**How it reuses what exists:** the 30-second loop with wake detection of `briefing::start` (`routines::schedule::{next_since_check, wall_ms, CHECK_EVERY, SLICE}`); the list from `AgentsState::cached()` and `listed_at()`; `briefing::list_is_fresh` and `LISTED_GRACE_MS`; organisations from `Registry::load`; databases opened as `capture::open`; `crate::org_shared()` held while writing one organisation; `agent_access::write_atomic`.

**Interfaces:**
- `pub enum Paused { Demo, Off, AgentsOff, Mode, Locked, Budget(Budget), Cap(usize), Nothing }`
- `pub fn gate(demo: bool, s: &AgentsSettings, any_mode: bool, locked: bool) -> Option<Paused>` — that order; `any_mode` is any organisation with a `MODE_FILES` file (call 11).
- `pub fn acquire_lock(app_dir: &Path) -> Option<std::fs::File>` — `flock(LOCK_EX | LOCK_NB)` on `watcher.lock`, kept for the life of the thread (call 10).
- `pub struct WatcherLink { org: String, id: i64, kind: ItemKind, item_id: i64, short_id: String, session_id: Option<String>, worktree: Option<String>, base_ref: Option<String>, check_state: Option<String>, reported: bool, started_at: i64, wrap_asked_at: Option<i64>, resumes: i64, check_fails: i64, sent_back: i64, question_sessions: i64, check_sessions: i64 }`
- `pub fn open_watcher_links(db: &Path, org: &str) -> Result<Vec<WatcherLink>, String>`
- `pub struct ReadyItem { kind: ItemKind, id: i64, title: String, project_id: i64, folder: Option<String>, priority: String, due: Option<String> }`; `pub fn ready_items(db: &Path) -> Result<Vec<ReadyItem>, String>` — stage `ready`, status not done; subtasks take their task's priority; order by effective priority (the rule of `effectivePriority` in `src/types/task.ts`: due today or past is high, due tomorrow at least medium), then due date (none last), then id. A Rust test copies the TS test's cases.
- `pub enum Event { Asked { entry: i64 }, AtPrompt { since: i64 }, Finished { reported: bool }, Stuck, IdleNoResult { since: i64 }, Old, Gone }`
- `pub fn notice(link: &WatcherLink, agent: Option<&Agent>, stuck: bool, open_ask: Option<i64>, now: i64, listed_at: Option<i64>) -> Option<Event>` — `Old` when idle and `now - started_at >= 86_400_000`; `IdleNoResult` after 30 minutes idle without a result or an open ask; `AtPrompt` after 2 minutes in `needs-you` with status `waiting`.
- Command `watcher_status() -> WatcherStatus { paused: Option<String>, budget: Option<String>, running: usize, cap: u32, would_start: Option<String>, lead: Option<String> }`.

In this task `tick` computes everything and records the result for `watcher_status`; it starts, stops and types nothing (PR A).

- [ ] **Step 1: Write failing tests:** `gate_order_demo_off_mode_lock` (each reason in order; demo returns before any file read, as `briefing`'s demo test); `second_lock_is_refused` (two `acquire_lock` on one folder: the second is None; after drop, Some); `ready_items` order (effective priority first, then due date, then id) and done items left out; `notice` for each event at its threshold and one millisecond before it; a hand link (`started_by` null) is not in `open_watcher_links`; part 2's tracker leaves a watcher link open in a state it would have closed.
- [ ] **Step 2:** Run `(cd src-tauri && CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager cargo test agents::watcher agents::links)` — FAIL. **Step 3:** Implement. **Step 4:** Rerun, plus `cargo test every_host_command_is_gated_for_the_demo window_command_lists_match_the_handler` and clippy — PASS.
- [ ] **Step 5:** Full checks of [RELEASING.md, step 1](../../../RELEASING.md#1-pre-release-validation-all-must-pass). Hand check (Loris, dev build, no session started): switch the watcher on; mark two test tasks Ready with different priorities; see "Would start" name the right one; see the budget line move with his use of Claude Code; put the organisation in test mode and see "Paused". Commit `feat(agents): the watcher notices and says what it would start`. **End of PR A.**

### Task 8: Starting workers

**Files:**
- Create: `src-tauri/src/agents/watcher/git.rs`, `watcher/start.rs`
- Modify: `watcher/mod.rs` (`tick` calls `start::step`)
- Test: tests in both files (a fake `Git` and the fake `Cli` of `actions.rs` tests)

- [ ] **Step 1: Spike, by hand in a terminal (Loris, or the implementer with his OK: two or three short Opus sessions on a throwaway repository).** Record the answers here before Step 2:
  1. Does `claude --bg --settings <file>` load a `Stop` hook from that file? If not, does `<worktree>/.claude/settings.local.json` (call 14)?
  2. With `--permission-mode acceptEdits`, does a worker that edits files and runs `npm test` stop at prompts, and which?
  3. While only background sessions run, does `limits.json` `savedAt` move (call 6)?
  4. Does `gh pr create` work from a worker started by the app, and `gh pr view --json` from the app's environment (login-shell `PATH`)?

**Interfaces:**
- `pub trait Git { fn run(&self, program: &str, args: &[String], cwd: &str) -> CommandOutcome; }` with `RealGit` over `routines::run::run_command` (60-second timeout, login-shell `PATH`).
- `pub fn is_repo(g, folder) -> bool`; `pub fn base_ref(g, folder) -> Result<String, String>` — `git fetch origin --quiet` then `origin/HEAD` resolved; no `origin` → local `main` or `master`; else `Err("No base branch")`.
- `pub fn add_worktree(g, folder, kind, id, base) -> Result<Worktree { path, branch }, String>` — branch `sm/<task|subtask>-<id>`, path `<folder>/.claude/worktrees/sm-<task|subtask>-<id>`; refused when the branch or the path exists.
- `pub fn running_workers(links: usize, agents: &[Agent]) -> usize` — `max(links, listed agents named "sm-w-…" not in group done)` (call 9).
- `pub fn worker_name(kind, id) -> String` — `sm-w-<kind>-<id>`, passes `validate::valid_name`.
- `pub fn worker_prompt(org: &str, item: &ReadyItem, worktree: &Worktree) -> String` — under 8000 characters, not starting with `-`. It says: work on the item from its brief in this worktree only, on its branch; do not ask Loris in the conversation: use `ask` and stop; commit, push and open a pull request (`gh pr create`, not a draft) when done; then `report_result` once with the branch and the pull request link; never touch money, releases, versions, migrations or dependencies without asking with `ask`.
- `pub fn worker_args(dev: bool, app_dir, mcp_path, hook_settings: &Path) -> Result<Vec<String>, String>` — `task_agent_args(dev, true, ...)` (part 2), `--settings <hook file>`, `--permission-mode acceptEdits` (per the spike).
- `pub fn may_start(gate: Option<Paused>, budget: &Budget, running: usize, cap: u32) -> bool`.
- `pub fn start_worker(...) -> Result<i64, String>` — worktree, then `actions::start_with(cli, trusted, worktree, prompt, "opus", name, args)`, then in one transaction: the link (`started_by = 'watcher'`, `worktree`, `base_ref`) and stage `running` with `WHERE stage = 'ready' AND status <> 'done'`. A failed start leaves the worktree in place (never removed: call 18's rule). Because `add_worktree` refuses an existing branch or path, the watcher does not try that item again: it adds one Decide entry "Could not start: <reason>" and skips the item while that entry is open (*my call*: no retry loop, Loris removes the worktree or starts the item by hand).

At most one start per pass. Organisations: those agent access allows (`pick_org` rule of part 1), oldest Ready first across them.

- [ ] **Step 2: Write failing tests:** `no_start_when_budget_fails` (each `Budget` variant but Ok); `cap_counts_db_links_when_the_list_is_empty` (3 open watcher links, list `[]` → no start); a listed `sm-w-…` agent of the other build counts; `hand_started_agents_are_never_touched` (a hand link and an unlinked agent named like the item: no stop, send or start against them, the fake Cli records no call with their ids); not a git folder → no start, reason; an existing branch → refused; `a_failed_start_is_listed_once_and_not_retried` (the start fails after the worktree was made: one Decide entry, the next ten passes start nothing for that item and add no second entry); the start argv has `--settings` and, in a non-dev app, no `--mcp-config`; the link and Running are written; the item turned done during the start → link written, stage untouched; a `START_TIMED_OUT` is adopted by name as `briefing::resolve_pending` does.
- [ ] **Step 3:** Run `(cd src-tauri && CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager cargo test agents::watcher)` — FAIL. **Step 4:** Implement. **Step 5:** Rerun, plus clippy — PASS. Commit `feat(agents): the watcher starts workers on Ready tasks in their own worktree`.

### Task 9: The Stop hook

**Files:**
- Create: `src-tauri/mcp/src/stophook.rs`
- Modify: `src-tauri/mcp/src/main.rs` (`--stop-hook` like `--statusline`: never prints anything but the decision, always exits 0), `src-tauri/src/agents/watcher/start.rs` (`hook_settings(app_dir, mcp_path) -> Result<PathBuf, String>` writes `<app data>/watcher/hook-settings.json`: one `Stop` hook running `'<mcp path>' --stop-hook`, quoted as `statusline::status_line_command`, with `STUDIOMANAGER_DATA_DIR` in `env` in the dev build)
- Test: `stophook.rs` tests

**Interfaces:**
- `pub fn decide(input: &str, transcript: &str, state: &mut HookState) -> Option<String>` — reads `session_id`, `stop_hook_active`. Blocks (returns the reason) once per session when the transcript has no `tool_use` named `mcp__studiomanager__report_result` ("Before you stop: call report_result with what was done, what is left open, how to check it, and the branch and pull request link."); once per session when the last assistant message contains a question line (a line ending in `?`) and no `mcp__studiomanager__ask` after the last user message ("If you are asking Loris something, send it with the ask tool, then stop."). Never blocks when `stop_hook_active` is true. An unreadable transcript blocks nothing.
- `HookState { result_asked: bool, question_asked: bool }` in `<data dir>/watcher/stop-hook/<session id>.json` (session id checked with the same rule as `valid_session_id`).

- [ ] **Step 1: Write failing tests:** `hook_blocks_once_per_reason` (no result → block, again → none; question → block once); a result in the transcript → no block; a question sent with `ask` → no block; `stop_hook_active` → none; a session id with `/` → nothing written; output is the JSON `{"decision":"block","reason":...}`.
- [ ] **Step 2:** Run `(cd src-tauri/mcp && CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager-mcp cargo test --locked stophook)` — FAIL. **Step 3:** Implement. **Step 4:** Rerun the crate, clippy — PASS. Commit `feat(agent-access): Stop hook for workers the watcher started`.

### Task 10: A finished worker: the check command, one send back, the Check entry

**Files:**
- Create: `src-tauri/src/agents/watcher/check.rs`
- Modify: `watcher/mod.rs`, `watcher/store.rs` (`bump(db, link_id, Counter) -> Result<i64, String>`, `add_entry`, `set_check_state`, `record_alone`)
- Test: `check.rs` tests

**Interfaces:**
- `pub const CHECK_TIMEOUT: Duration = Duration::from_secs(600); pub const SENT_TAIL: usize = 8 * 1024;` (kept: `routines::run::TAIL_BYTES`, 64 KB).
- `pub struct CheckRun { passed: bool, timed_out: bool, tail: String, error: Option<String> }`
- `pub fn run_check(command: &str, worktree: &str, path_env: &str) -> CheckRun` — `run_command("/bin/sh", ["-c", command], worktree, path_env, CHECK_TIMEOUT)`; passed only on exit 0.
- `pub fn for_agent(tail: &str) -> String` — the last 8 KB, control characters but new line and tab removed (so `normalise_message` accepts it).
- `pub fn diff_facts(g, worktree, base) -> Result<DiffFacts { lines: Option<i64>, paths: Vec<String>, deleted: Vec<String>, head: String, clean: bool }, String>` — `git diff --numstat` and `--name-status --no-renames` against `git merge-base <base> HEAD`; a binary file makes `lines` None. The diff text is written to `<app data>/lead/checks/<org>-<entry id>.diff`, at most 200 KB.

**Flow** on `Finished { reported: true }`: `check_state = 'running'`; no check command → `none`; else `run_check`. Failed and `check_fails == 0` → bump, type "The check command failed. Fix it, then call report_result again. Output:\n<for_agent>" into the worker, `check_state` null, the link stays (*the design's "goes back to the same agent once"*). Failed again → Check entry with the output. Passed or none → Check entry with `check_passed`, `change_lines`, `touches`, stage `to_check`, `lead_state = 'waiting'`. `Finished { reported: false }` → Check entry "Ended without a result", link `outcome = 'no_result'`, no check.

- [ ] **Step 1: Write failing tests:** pass and fail by exit code; timeout after 300 ms with a test timeout; `for_agent` removes `\x1b`; `second_check_failure_goes_to_loris`; `check_fails` survives reopening the database (the counter is in the row); `a_running_check_found_at_start_runs_again_and_counts_no_failure`; `worktree_gone_gives_a_check_entry_and_no_send_back`; no check command → `check_passed` null and never merge-ready.
- [ ] **Step 2:** Run `(cd src-tauri && CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager cargo test agents::watcher::check)` — FAIL. **Step 3:** Implement. **Step 4:** Rerun, clippy — PASS. Commit `feat(agents): run the project's check when a worker finishes`.

### Task 11: Stuck, at a prompt, idle, old: resume, Decide entries, wrap up

**Files:**
- Modify: `watcher/events.rs` (`stuck_in(transcript_tail: &str) -> bool`), `watcher/mod.rs`
- Test: `events.rs` and `mod.rs` tests

- [ ] **Step 1: Spike (by hand, no session needed if a past transcript shows it):** in `~/.claude/projects/*/*.jsonl` of a session that hit a connection error, what is the last entry (for example an assistant entry flagged as an API error), and what does `claude agents --json --all` show for it (`status`, `state`)? Write the answer here; `stuck_in` matches exactly that, on the last 64 KB.

**Flow:**
- `Stuck` (and idle at least 2 minutes): `resumes < 3` → bump, then `pty::send_message` "Continue where you stopped." when the process is listed, else `actions::switch_model(cli, home, agent, "opus", app_dir)` then the message (call 16); `record_alone` "Restarted after a connection error (n of 3)". `resumes == 3` → Decide entry "Stuck after three restarts", link `outcome = 'stuck'` kept open for Loris.
- `AtPrompt` → one Decide entry per wait (`waiting_for` as the title), button Open the agent.
- `IdleNoResult` → one Decide entry "Stopped without a result or a question".
- `Old` → no `wrap_asked_at`: type "Write your result with report_result now, then stop." and set it. 30 minutes later still idle: `actions::stop` (never delete), Check entry, `outcome = 'wrapped_up'`, `record_alone`.

- [ ] **Step 2: Write failing tests:** `resume_at_most_three_times_then_needs_you`; a resume counted before the message is sent (a failed send still counts); a process not listed → `switch_model` argv `--resume <session> --bg --model opus`; one prompt entry per wait, a second wait a second entry; wrap up asks once, stops after 30 minutes, never calls `rm`; none of these on a hand link.
- [ ] **Step 3:** Run `(cd src-tauri && CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager cargo test agents::watcher)` — FAIL. **Step 4:** Implement. **Step 5:** Rerun, clippy — PASS. Commit `feat(agents): the watcher restarts stuck workers and wraps up idle ones`.

### Task 12: Lead sessions for a question and for finished work

**Files:**
- Create: `src-tauri/src/agents/watcher/lead.rs`
- Modify: `watcher/mod.rs` (`WatcherState.lead: Option<LeadRun { org, entry_id, short_id, started_at, waiting_since }>`), the three command lists (`agents_lead_folder`)
- Test: `lead.rs` tests

**Interfaces:**
- `pub const LEAD_TOOLS: [&str; 7]` (the seven of "What protects", with the `mcp__studiomanager__` prefix); `pub fn prepare_folder(app_dir, mcp_path) -> Result<PathBuf, String>` and `pub fn lead_args(folder) -> Vec<String>` as `briefing::prepare_folder` and `briefing_args`, with `STUDIOMANAGER_TOOLS` set to the seven and `STUDIOMANAGER_DATA_DIR` to the app data folder.
- `pub fn next_event(entries: &[EntryRow], links: &[WatcherLink]) -> Option<i64>` — oldest `lead_state = 'waiting'`; a question when `question_sessions < 3`, a check when `check_sessions < 2`; else `lead_state = 'skipped'` (Loris decides).
- `pub fn question_prompt(org: &str, entry: i64) -> String` and `pub fn check_prompt(org: &str, entry: i64) -> String`, under 8000 characters. The question prompt: read the entry with `get_needs_you`, then the project with `get_project`, `list_wiki`, `get_wiki_article` (Decisions first) and `list_tasks`; if the answer is written there, `resolve` with the answer and a reason naming the article or task; otherwise `hand_over` with a recommendation, its reason, the options, and `is_decision` when the answer would be a project decision; never guess; then stop. The check prompt: read the entry (result, check output, size, diff); `resolve` with `accept` when the work does what the brief asks and nothing in "always asks" is touched, `send_back: <notes>` when something specific is missing and `sent_back` is 0, otherwise `hand_over` with a summary; then stop.
- `pub fn verdict(...)` — the brief session's rules (`briefing::verdict`): 20 minutes, 2 minutes waiting.
- `pub fn act_on_resolution(...)` (in `mod.rs`): a question resolved by the lead → type "Answer: <answer> (<reason>)" into the worker, `delivered_at`; a refused send → entry back to open for Loris. A check `send_back` → bump `sent_back`, type the notes, stage Running. A check `accept` → Task 13 (until then: the entry stays open for Loris, marked "The lead would accept").

Start rule: one lead at a time; `budget` Ok and the gate open; else entries stay `waiting` and show for Loris without a recommendation (call 5). Each start bumps `question_sessions` or `check_sessions` first. A session that ends without `resolve` or `hand_over`: `lead_state = 'skipped'`, the agent stopped and kept; resolved: stopped and removed, as the brief session.

- [ ] **Step 1: Write failing tests:** `lead_args_hold_exactly_the_seven_tools` (and the 13 denied, `--strict-mcp-config`); prompts equal their text with values filled in and pass `valid_task`; `over_budget_question_goes_to_loris` (no start, entry open, `lead_state` stays `waiting` and the UI shows it); `lead_sends_back_once` (a second `send_back` is handed to Loris); a fourth question → `skipped`, no start; a resolution typed into the worker; a refused send reopens the entry; one lead at a time.
- [ ] **Step 2:** Run `(cd src-tauri && CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager cargo test agents::watcher::lead)` — FAIL. **Step 3:** Implement. **Step 4:** Rerun, the full checks of RELEASING.md step 1 — PASS. Commit `feat(agents): short lead sessions answer questions and read finished work`.
- [ ] **Step 5: Hand check (Loris, dev build, test repository with a check command such as `test -f done.txt`; about six Opus sessions):** watcher on, cap 1. (1) A Ready task "Add done.txt": the watcher starts it within a minute, the row says Running, `sm-w-task-<id>` in All agents, a worktree and branch in the test repository. (2) It finishes: the check runs, a Check entry shows the size and "Check passed"; the lead's summary appears. (3) A second Ready task whose brief leaves a question open: a Decide entry with the lead's recommendation; answer it, the worker continues. (4) Make the check fail once: the worker is told, fixes it. (5) Cap 1 with two Ready tasks: the second waits. (6) Test mode on: "Paused". **End of PR B.**

### Task 13: Merging alone (PR C)

**Files:**
- Create: `src-tauri/src/agents/watcher/merge.rs`
- Modify: `watcher/mod.rs` (`act_on_resolution` for `accept`)
- Test: `merge.rs` tests

**Interfaces:**
- `pub const MERGE_LINES: i64 = 100;`
- `pub const ALWAYS_ASKS: &[(&str, &[&str])]` — rule name and path patterns: `migrations` (`**/migrations/**`, `*.sql`); `dependencies` (`package.json`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `Cargo.toml`, `Cargo.lock`, `pyproject.toml`, `requirements*.txt`, `Gemfile`, `Gemfile.lock`, `go.mod`, `go.sum`, `Podfile`, `Podfile.lock`, at any depth); `version` (`tauri.conf.json`, `CHANGELOG.md`, `VERSION`, `latest.json`, `RELEASING.md`); `release` (`.github/**`, `scripts/release*`); `security` (`.claude/**`, `**/capabilities/**`, `**/permissions/**`, `*.entitlements`, `Info.plist`, `.env*`). Any deleted path is the rule `deleting`.
- `pub fn touches(paths: &[String], deleted: &[String]) -> Vec<&'static str>`
- `pub struct PrFacts { state: String, draft: bool, head: String, base: String }`; `pub fn pr_facts(g, worktree, url) -> Result<PrFacts, String>` — `gh pr view <url> --json state,isDraft,headRefOid,baseRefName`.
- `pub struct MergeRules { merge_alone: bool, hub_project: bool, check_passed: Option<bool>, lead_accepts: bool }`
- `pub fn may_merge(r: &MergeRules, d: &DiffFacts, pr: &PrFacts, base_branch: &str) -> Result<(), Refusal>` — refuses, in this order: hub's project; `merge_alone` off; no check or not passed; `lead_accepts` false; `lines` None or `>= 100`; `touches` not empty; worktree not clean; PR not `OPEN`, a draft, base not the link's base branch, or `head` not the worktree's HEAD.
- `pub fn merge(g, worktree, url, head) -> Result<(), String>` — `gh pr merge <url> --squash --match-head-commit <head>`; nothing else.

On `Ok`: merge; on success `record_alone` ("Merged: check passed, N lines"), the item done and its stage cleared, link `outcome = 'merged'`, the entry answered `decided_by = 'lead'`. On any refusal or a failed merge: the entry stays open for Loris with "The lead would accept; not merged: <refusal>".

- [ ] **Step 1: Write failing tests:** `merge_rule_*`: each refusal alone (hub with everything else fine; 99 lines → Ok, 100 → refused; a binary file; each always-asks rule by one path; a deleted file; dirty worktree; state `MERGED`, `CLOSED`; draft; head moved after the check; no check command); the merge argv is exactly `pr merge <url> --squash --match-head-commit <sha>` and never has `--delete-branch`; a failed merge leaves the entry open and the item not done.
- [ ] **Step 2:** Run `(cd src-tauri && CARGO_TARGET_DIR=$HOME/cargo-target-studiomanager cargo test agents::watcher::merge)` — FAIL. **Step 3:** Implement. **Step 4:** Rerun, the full checks — PASS. Commit `feat(agents): the lead may merge a small checked change alone`.
- [ ] **Step 5: Hand check (Loris, dev build, a private throwaway GitHub repository; two or three Opus sessions):** with `merge_alone` on: a one-line change is merged, listed under Decided alone with its reason, the branch still there; with "Belongs to a hub" on: the same change is not merged and waits under Check; a change to `package.json` waits under Check with "dependencies". **End of PR C.**

### Task 14: Docs and the spec's list of plans

- Modify: `docs/agents.md` — a section "The watcher and the lead": the switch, the budget in plain words, the cap, workers in worktrees, the check command, the Stop hook, lead sessions and their tools, Needs you's groups, merging alone and its conditions, what is never done; links to the [design](../specs/2026-11-12-agent-orchestrator-design.md) and this plan (from that file: `superpowers/...`).
- Modify: `docs/agent-access.md` — the five tools, the lead-only rule, the new count; under "Safety rules", that `resolve` and `hand_over` write only `needs_you`.
- Modify: `docs/menu-bar.md` (the count), `IDEAS.md` ("The watcher, the lead and Needs you": built, awaiting a hand check, with a link to this plan).
- [ ] Run the checks of [RELEASING.md, step 1](../../../RELEASING.md#1-pre-release-validation-all-must-pass) in both crates and the app. All pass. Commit `docs(agents): the watcher, the lead and Needs you`.

---

## What is deliberately left out (part 4 and later)

- Hubs: the connector, the hub line in Needs you, the calendar layer. Part 3 only knows a hub's project through the `hub_project` flag.
- The Running tab of the mockup (call 23); agents on a second machine; notifications per event (an anti-goal).
- A change to Loris's end-of-day routine, which lives outside this repo: it can call `list_needs_you`.
- Removing worktrees or branches after a merge (deleting asks).

## Design gaps and decisions taken in this plan

Points where the design did not say enough for code, or where the code differs from what it assumed. Each is a call the owner can overturn. Verified in the code on main at a2950c6 unless marked *not verified*.

1. **The polling is a Rust thread, not the Agents page.** `claude agents --json --all` is run by `actions::fetch_agents` from the `agents-poller` thread (`poller.rs`, `run`), every 2 s while a view watches and 30 s otherwise, cached in `AgentsState::cached()`. The watcher is its own 30-second thread reading that cache, like part 2's tracker.
2. **There is no "stuck" state.** The list's groups are needs-you, working, idle, done (`model.rs`, `group_of`); nothing reads connection errors. Task 11 starts with a spike (call 15). *Not verified:* what a failed request leaves in the transcript.
3. **The budget data is enough, with two limits.** `limits.json` holds `savedAt` and, per window, `used_percentage` and `resets_at` (written by `studiomanager-mcp --statusline`, `mcp/src/statusline.rs`; read by `usage::limits::load`). The weekly line needs the window's start, taken as `resets_at - 7 days` (the window is named `seven_day`). But the file is written only when Claude Code runs the status line, a window that reset is dropped (`limits::meters`), and part 1's brief scheduler treated missing data as under 80%. Part 3 fails closed (calls 4 and 6). *Not verified:* whether background sessions run the status line.
4. **The dev build has no usage data.** The status line writes into the installed app's folder; the dev build (identifier `ch.studiomanager.dev`, `host::running_dev`) reads its own. Call 7 reads the installed app's file in the dev build.
5. **Briefs are not `needs_you` rows.** Part 1 built the Briefs group on `captures` (`outcome = 'needs_word'`). `needs_you` holds Decide, Check and Decided alone only.
6. **`needs_you` needs more than the design's columns** (Task 1): the subtask, the link, `is_decision`, the lead's state, the check facts, delivery, and `decided_by = 'app'` for what plain code does alone (restarts, wrap-ups).
7. **The design's tools are not enough for a lead.** `resolve` alone cannot say "here is a recommendation for Loris", and the lead must read the event. Added: `hand_over`, `get_needs_you`, and `list_needs_you` for the end-of-day routine; the three lead tools are hidden from other sessions (call 19). `ask` does not exist yet; Task 2 adds it.
8. **Decisions are saved only by the MCP tool.** `add_decision` (`mcp/src/write/wiki.rs`) writes the project's "Decisions" wiki article; the app has no query for it. Task 3 adds `addDecision` with the same output.
9. **No project is linked to a hub.** Projects have no hub column (`src/types/project.ts`); part 4 is not built. Part 3 adds `hub_project` and opt-in `merge_alone` (call 3).
10. **The app has no git or GitHub code**, and part 2's workers run in the project folder (`useStartAgentOn`, `item.project.folder`), not a worktree. The design's "the agent's worktree" and "merge a pull request" need the app to make the worktree and run `git` and `gh` (calls 2 and 18). *Not verified:* `gh` authentication from the app's environment (Task 8 spike).
11. **Part 2's tracker would close a watcher worker's link** as soon as it reports a result and goes idle (`links::judge`), before the check and a send back. Task 7 makes it skip watcher links.
12. **No Stop hook exists in this repo.** The hub's own Stop hook (a script in its repository, run from Loris's global Claude Code settings) is the model: it reads the transcript and blocks once. Task 9 builds one into the MCP binary. *Not verified:* `--settings` with hooks on `claude --bg` (spike).
13. **Messages to a waiting agent** go through `pty::send_message` (`agents_send`), which refuses an agent at a permission prompt (`status == "waiting"`) and accepts at most 20,000 characters without control characters (`validate::normalise_message`). The lead never answers a prompt (call 13); check output is cleaned first (Task 10).
14. **Two instances are not prevented** anywhere (no single-instance plugin in `src-tauri/src/lib.rs`). Calls 9 and 10.
15. **"Test mode" and "presentation mode"** are the org's database swapped for `studiomanager_test.db` or `studiomanager_presentation.db` (`ActiveOrg::in_mode`, `src-tauri/src/lib.rs`; `briefing::in_mode` and `MODE_FILES` for background threads; `useAppStore` `testMode`, `presentationMode`). Call 11 stops the whole watcher while any is on.
16. **The end-of-day brief is not in this repo.** The morning brief's page is rendered by a script in another repository, with its comment server in `agents/brief.rs`; start and end of day are Loris's own agent routines ([the AgentBar retirement](../../retire-agentbar.md)). Call 20.
17. **The menu bar icon has no count today**: `menubar::set_attention` only switches the icon to amber. Call 21. *Not verified:* the tray title call on this Tauri version.
18. **The design's "the watcher checks `crate::host::is_demo`"** holds, and the Agents switch already reads off in the demo (`cli::in_build`); the new switch joins it.
19. **Workers' permissions are not in the design.** An unattended worker meets Claude Code's permission prompts; call 13 lists them for Loris. *Not verified:* how often (spike).
20. **"Questions and checks are still handled" over budget** is read as: listed for Loris, not answered by a lead (call 5).

## Changed while building PR A (Tasks 1 to 7)

- **`ask` refuses an item with no open agent link**, and a second open question on the same link (Task 2 said a missing link gives `link_id` null). An answer that cannot be typed into an agent must not be promised. The hand check of Task 4 therefore needs a task with an agent started from the app.
- **Task 5 leaves out the trust question for the lead folder**; Task 12 adds it with the folder.
- **All agents' "Needs you" group** leaves out an agent only when the watcher started it and an open entry exists for it (call 22 said: any agent with an open watcher link). A Decide entry has "Open the agent" and, after a failed send, "Dismiss".
- **The count reaches the menu bar through a new command**, `menubar_set_needs_count`: the front end had no path to `set_attention`.
- **The budget reads `limits::load_dated`**: a usage file with no save time is `NoData`.
- **Entries decided alone** are stored with status `answered` and `decided_by` `lead` or `app`; `store::record_alone` (Task 10) must write them so.
- **Left for PR B:** the permission-prompt entry ("Open the agent" only); `Gone` needs part 2's two-miss rule before anything acts on it; the at-prompt and idle timers are in memory; "Would start" ignores a project with no folder and can show up to 30 seconds before the lock is taken; matching an `ask` caller to its own link; one listing per pass instead of several reads.

## Changed while building PR B (Tasks 8 to 12)

What the spikes of Task 8 and Task 11 answered (two short Opus sessions in a throwaway folder, no project, no app data):

- **`claude --bg --settings <file>` loads a Stop hook from that file.** The hook reads JSON with `session_id`, `transcript_path`, `cwd`, `permission_mode`, `stop_hook_active` and `last_assistant_message`. `{"decision":"block","reason":…}` makes a background session go on; the next stop has `stop_hook_active` true, so the hook never blocks twice in one chain.
- **`--permission-mode acceptEdits`** let a worker write files and run `npm test` and `gh auth status` with no lasting prompt. The agent list showed "permission prompt" for a moment and went on by itself, so a prompt is listed only after 2 minutes, and an entry whose wait ended by itself is closed by the app.
- **Trust:** `claude --bg` refuses an untrusted folder at once, before anything is spent. A separate git repository inside a trusted folder is not trusted; a plain folder inside one is. A linked worktree of a trusted repository was not tried: it is a hand check. A refused start ends as one "Could not start" entry.
- **The usage file** moved within seconds of a session's activity, but other sessions were open: not proven for a worker alone.
- **`gh`** is signed in inside a worker; `gh pr create` was not run.
- **A stuck worker** is one whose last transcript entry is an assistant entry with `isApiErrorMessage` true and `error` `server_error`. `rate_limit` and `authentication_failed` are never resumed: they end as an idle entry for Loris.

What differs from the task text:

- **Task 9 is in the MCP crate only**; Task 8 writes the hook settings file (`start.rs`).
- **No new migration.** A permission-prompt entry is a Decide row with `lead_state` `prompt` ("Open the agent" and "Dismiss"); an entry with no agent link ("Could not start") has "Dismiss" only.
- **One list of Ready tasks across the allowed organisations**, in the order of `store::order`, then organisation order; the first that can start is started. A task with no folder or a folder that is not a git repository is skipped with a reason.
- **A worker that started but could not be linked** still counts toward the cap, and is adopted only when its name, kind and folder match.
- **A change too large to measure** (git output over 64 KB) is never given a size: it goes to Loris.
- **A stuck worker is resumed only while the budget is Ok**: a resume spends usage like a start.
- **A worker that handed in a result and stays idle for 2 minutes is checked**, with or without a wrap-up request. Only a worker's own question (`ask`) counts as an open question; the app's own idle, prompt and stuck entries are closed by the app when the worker is wrapped up or finishes.
- **A wrap-up request that could not be typed** is listed, not followed by a stop.
- **Accept does nothing yet.** When the lead accepts, the entry comes back open as "The lead would accept: …"; merging is Task 13.
- **A lead session is stopped and kept, never removed.** Task 12 said "stopped and removed, as the brief session"; the Global Constraints say the watcher never deletes an agent, and they win. Finished `sm-lead-…` sessions stay in the agent list (at most 5 per task) until Loris removes them. Loris can overrule this.
- **The lead acts only on its own session**: a listed background agent with the lead's name, in the lead folder. Anything else with the same id is left alone and the entry is marked skipped.
- **Over budget when the lead's answer arrives**, the answer is not typed into the worker: the entry is reopened as "From the lead: …".
- **The trust question for the lead folder** is asked on the Agents card when the watcher is switched on (`agents_lead_folder`).
- **The app's own "Send back"** on a Check entry also resets the link's check state, so the next result is checked again.

To know before switching it on:

- Workers get a worktree under `<project>/.claude/worktrees/`; a project that does not ignore that folder sees it as untracked.
- A project folder that is a subfolder of a larger repository gets a worktree of the whole repository.
- **Left for later:** the at-prompt, idle and awaiting timers are in memory (a restart delays an entry by its threshold); a dismissed idle entry can come back after a restart; a crash between the lead's decision and its message leaves the worker waiting until the idle rule lists it.
