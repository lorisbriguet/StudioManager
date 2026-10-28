# Agent access (MCP server) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a stdio MCP server inside StudioManager.app that lets a user's agents safely read and update projects, tasks, clients and the wiki, with a Settings card to switch it on and connect it.

**Architecture:** A separate Cargo package `src-tauri/mcp` builds `studiomanager-mcp`. It shares the app's pure Rust modules (`orgs.rs`, `migrate.rs`, `dbfiles.rs`) through `#[path]` module includes, and opens each organisation's SQLite file directly (WAL, busy timeout, `BEGIN IMMEDIATE`). Tool logic is plain functions over `rusqlite::Connection` (unit-tested on temp databases). A thin `rmcp` layer exposes them over stdio. The app gains a `data_version` poller that emits `db-changed`, Tauri commands for the settings file and the Claude Desktop config, and an "Agent access" Settings card.

**Tech Stack:** Rust 2021 (rusqlite 0.32 bundled, serde, chrono, rmcp + tokio, pulldown-cmark), Tauri 2, React 19 + TanStack Query, vitest.

**Spec:** [docs/superpowers/specs/2026-10-27-agent-access-mcp-design.md](../specs/2026-10-27-agent-access-mcp-design.md)

## Global Constraints

- Never DELETE or ALTER from the MCP server; no tool removes a row.
- Every UPDATE sets `updated_at = datetime('now')`; new tasks/subtasks/wiki articles/folders get `sort_order = MAX + 1` (wiki articles: per project).
- Never write `calendar_event_id`, `calendar_deadline_id`, `workload_*`, `layout_config`, `tracked_minutes`.
- Agent-written task and subtask status: `todo` or `done` only.
- Name matching is accent- and case-insensitive; more than one match returns the candidates, never a pick.
- Backups: before the first write per server process and organisation, SQLite backup API to `<data dir>/backups/agent/<org>-<yyyyMMdd-HHmmss>.db`; keep the 20 most recent per organisation.
- Settings file: `<data dir>/agent-access.json` = `{"enabled": bool, "allowMoney": bool, "orgs": {"<id>": bool}}`; missing file = everything off; an org missing from `orgs` = allowed when `enabled`.
- Change log: `<data dir>/agent-log.jsonl`, one JSON object per write `{"at","org","tool","summary"}`; keep the last 500 lines.
- Data dir: `$STUDIOMANAGER_DATA_DIR` if set (tests), else `~/Library/Application Support/<identifier>`, identifier read from the enclosing bundle's `Contents/Info.plist` `CFBundleIdentifier` when the binary runs inside a `.app`, else `ch.studiomanager.app`. The demo bundle therefore resolves `ch.studiomanager.demo` on its own.
- The server always opens `orgs/<id>/studiomanager.db` (never `_test`/`_presentation`).
- Repo is public: no personal paths, org ids, client names or keys in code, tests, fixtures or docs.
- UI strings through `useT()`; EN/FR parity; FR strings without accents. No emojis.
- Rust gates per task: `cargo test` and `cargo clippy --all-targets -- -D warnings` in the touched package. Frontend gates: `npx tsc --noEmit`, `npm run lint`, `npx vitest run`. Use `CARGO_TARGET_DIR=~/cargo-target-studiomanager` (and `~/cargo-target-studiomanager-mcp` for the MCP package).
- Never chain `git commit` after a test command in one shell line; never `git checkout` to undo.

## Rulings against the spec (made while planning)

1. **No mode marker file.** Test and presentation mode already leave `studiomanager_test.db` / `studiomanager_presentation.db` in the org folder while active (and remove them on exit), so the server refuses writes when either exists. Same effect, no app change.
2. **No new migration for the frontend-created tables.** `ensureSchema()` creates ~17 tables and many columns outside the numbered migrations; moving them is a large, risky refactor. Instead the server checks before any use that the database has been opened by the app: `schema_migrations` max version equals `migrate::MIGRATIONS.last().version`, and the tables/columns it touches exist (`resources`, `resource_projects`, `wiki_folders`, `wiki_articles`, `wiki_article_tags`, `projects.folder_path`). Otherwise: "Open StudioManager once with this organisation, then try again." (newer version: "Update StudioManager.").
3. **Agent settings live in `agent-access.json`**, not in `OrgPrefs`, so the server reads one small file and the org prefs type stays untouched.
4. **Shared code by `#[path]` includes**, not a crate split: `orgs.rs`, `migrate.rs` (its `include_str!` paths resolve relative to the file) and `dbfiles.rs` are pure and are compiled into both binaries unchanged.
5. **Wiki conventions follow the app, not Loris's six fixed titles**: any title is allowed; the project's folder is the `wiki_folders` row whose trimmed name equals the project name (created if missing); articles link by `wiki_articles.project_id`; tags = project name + lowercased title; `add_decision` targets the article titled "Decisions" with the existing `<li><p><strong>YYYY-MM-DD</strong> text</p></li>` format.

## Review Focus

1. The user flips Agent access off (or off for one org) while an agent session is running: the next call is refused — the server re-reads `agent-access.json` on every call (test in Task 1).
2. The app is in test/presentation mode mid-session: writes are refused, reads still work on the production file (test in Task 1).
3. Two writers at once (app + agent): a write waiting on the lock succeeds within the busy timeout instead of failing with "database is locked" (test in Task 3 using two connections).
4. Unicode and quotes in names/Markdown (accents, `"`, `<script>`): name matching folds accents; wiki HTML is escaped/sanitised (no raw HTML passthrough from Markdown) (tests in Tasks 2 and 3).
5. The Claude Desktop config already has other servers, comments-free but with unknown keys: adding ours keeps every other key and server untouched and writes a backup first (test in Task 6).

---

### Task 1: MCP package, data dir, access and database guards

**Files:**
- Create: `src-tauri/mcp/Cargo.toml` (package `studiomanager-mcp`, bin `studiomanager-mcp`, deps: rusqlite 0.32 `bundled`,`backup`; serde/serde_json; chrono `clock`; no tauri)
- Create: `src-tauri/mcp/src/main.rs` (placeholder `fn main()` printing nothing; real server in Task 5)
- Create: `src-tauri/mcp/src/lib.rs` with `#[path = "../../src/orgs.rs"] pub mod orgs;`, same for `migrate` and `dbfiles`, plus `pub mod env; pub mod guard; pub mod backup; pub mod log;`
- Create: `src-tauri/mcp/src/{env.rs,guard.rs,backup.rs,log.rs}`
- Test: inline `#[cfg(test)]` modules, helper `tests_support::temp_data_dir()` + `seed_app_db(dir, org_id)` in `src-tauri/mcp/src/test_support.rs` (cfg(test)) that runs `migrate::migrate_db` then creates the app-only tables/columns listed in Ruling 2 with the column lists from `src/db/index.ts`.

**Interfaces (Produces):**
- `env::data_dir() -> PathBuf` (per Global Constraints); `env::identifier_from_bundle(exe: &Path) -> Option<String>`.
- `guard::AccessConfig { enabled: bool, allow_money: bool, orgs: HashMap<String, bool> }` + `AccessConfig::load(dir: &Path) -> AccessConfig` (missing/invalid file → all off).
- `guard::Org { id: String, name: String, db: PathBuf }`.
- `guard::resolve_org(dir: &Path, org: Option<&str>) -> Result<Org, String>` — by id or accent/case-folded name; `None` → registry active org; refuses when access is off overall or for that org.
- `guard::open_read(org: &Org) -> Result<Connection, String>` and `guard::open_write(dir: &Path, org: &Org) -> Result<Connection, String>` — both run the schema check (Ruling 2); `open_write` also refuses in a mode (Ruling 1) and triggers `backup::ensure(dir, org)` once per process per org. Connections set `busy_timeout(5000)` and `foreign_keys=ON`.
- `backup::ensure(dir: &Path, org: &Org) -> Result<(), String>` (keeps 20).
- `log::append(dir: &Path, org: &str, tool: &str, summary: &str)` (trims to 500 lines).
- `text::fold(s: &str) -> String` (lowercase, accents removed; put it in `guard.rs` or a `text.rs`).
- Exact refusal strings (tools return them verbatim):
  - `"Agent access is off in StudioManager (Settings > Agent access)."`
  - `"Agent access is off for the organisation \"<name>\"."`
  - `"StudioManager is in test or presentation mode; changes are paused until it leaves that mode."`
  - `"Open StudioManager once with this organisation, then try again."`
  - `"This database is newer than the agent tools. Update StudioManager."`

- [ ] **Step 1: Write failing tests:** `data_dir_prefers_env`, `identifier_read_from_bundle_info_plist` (temp `X.app/Contents/{Info.plist,MacOS/bin}`), `access_missing_file_is_off`, `access_reread_each_time` (flip file between two `resolve_org` calls → second refused), `org_off_refused`, `resolve_by_folded_name` ("Etude" finds "Étude"), `write_refused_in_test_mode` (create `studiomanager_test.db` beside the prod file), `read_allowed_in_test_mode`, `unmigrated_db_refused` (only `migrate_db`, no app tables → exact message), `newer_db_refused`, `backup_once_and_keeps_20` (25 pre-existing backups → 20 after), `log_trims_to_500`.
- [ ] **Step 2:** `cd src-tauri/mcp && cargo test` → fails to compile.
- [ ] **Step 3:** Implement. Plist parsing: read the XML text and take the `<string>` after `<key>CFBundleIdentifier</key>` (no plist crate).
- [ ] **Step 4:** `cargo test` and `cargo clippy --all-targets -- -D warnings` pass; also `cd src-tauri && cargo test` still passes (shared files unchanged).
- [ ] **Step 5:** Commit "Agent access: MCP package, data dir, access and database guards".

### Task 2: Read tools

**Files:** Create `src-tauri/mcp/src/read.rs` (+ tests).

**Interfaces (Produces)** — all `fn(conn: &Connection, ...) -> Result<T, String>` with `T: Serialize`, dates `YYYY-MM-DD`:
- `find_project_for_folder(conn, path: &str) -> Option<ProjectRef>` — exact `folder_path` match on the path or its nearest ancestor.
- `list_projects(conn, status: Option<&str>, client: Option<&str>, text: Option<&str>) -> Vec<ProjectRef>`; `ProjectRef { id, name, client_id, client_name, status, deadline, folder_path }`.
- `get_project(conn, project: &str /* id or name */) -> ProjectDetail { project: ProjectRef, notes, tasks: Vec<Task{ id,title,status,priority,due_date, subtasks: Vec<Subtask{id,title,status,due_date}> }>, wiki: Vec<ArticleRef{id,title,updated_at}>, tools: Vec<Tool{id,name,url}> }`.
- `list_tasks(conn, project: Option<&str>, status: Option<&str>, due_before: Option<&str>) -> Vec<TaskRow>`.
- `list_clients(conn, text: Option<&str>) -> Vec<ClientRef{id,name,email}>`; `get_client(conn, client: &str) -> ClientDetail` (contact fields + its projects).
- `list_wiki(conn, project: &str) -> Vec<ArticleRef>`; `get_wiki_article(conn, project: &str, title: &str) -> Article{title, html, markdown}` (markdown = a plain-text rendering: strip tags, keep list bullets and headings).
- `whats_due(conn, days: i64, today: NaiveDate) -> Vec<DueItem{kind: "task"|"subtask"|"deadline", date, days_left, title, project, client}>` — same rules as the agent-bar due list: not done, project active/on_hold (deadlines: active), late or due within `days`.
- Ambiguity: a name matching several rows returns `Err("Several projects match \"x\": <a> (id 3), <b> (id 9). Use the id.")` (same shape for clients/tasks).

- [ ] **Step 1: Failing tests** per function on a seeded temp db (Task 1 helpers): including `folder_lookup_walks_up_to_parent`, `ambiguous_name_lists_candidates`, `accent_insensitive_match`, `whats_due_excludes_done_and_cancelled`, `wiki_markdown_rendering_of_list`.
- [ ] **Step 2–4:** red, implement, green + clippy.
- [ ] **Step 5:** Commit "Agent access: read tools".

### Task 3: Write tools

**Files:** Create `src-tauri/mcp/src/write.rs`, `src-tauri/mcp/src/markdown.rs` (+ tests). Add `pulldown-cmark` dependency.

**Interfaces (Produces)** — each takes `(dir: &Path, org: &Org, ...)`, opens via `guard::open_write`, runs one `BEGIN IMMEDIATE` transaction, appends to the log, returns a small serializable result naming the org:
- `link_folder(project, folder_path)`; `create_project(client, name, status="active", deadline?, notes?)`; `update_project(project, status?, deadline?, notes?, folder_path?)` (status ∈ active|completed|on_hold|cancelled).
- `create_task(project, title, due_date?, priority?, notes?)`; `update_task(task_id, title?, status?, due_date?, priority?, notes?)`; `create_subtask(task_id, title, due_date?)`; `update_subtask(subtask_id, title?, status?, due_date?)`.
- `create_client(name, email?, language="FR")` — id = `C-` + zero-padded (3) `MAX(CAST(SUBSTR(id,3) AS INTEGER)) + 1`, as `getNextClientId` does.
- `put_wiki_article(project, title, markdown)` (Ruling 5; Markdown → HTML via `markdown::to_html` with raw HTML disabled/escaped); `add_decision(project, date, text)` (idempotent, HTML-escaped).
- `link_tool(project, name, url?)` — find resource by folded name or exact URL, else insert; then `INSERT OR IGNORE` into `resource_projects`.

- [ ] **Step 1: Failing tests:** each tool's happy path; `status_in_progress_rejected`; `never_touches_calendar_or_workload_columns` (set them beforehand, assert unchanged); `updated_at_bumped`; `sort_order_max_plus_one`; `client_id_next` (`C-009` exists → `C-010`); `decision_idempotent`; `markdown_script_tag_escaped`; `concurrent_writer_waits` (hold `BEGIN IMMEDIATE` on a second connection for 300 ms in a thread; the tool succeeds); `write_logged`; `no_delete_statements` (grep the source in a test: `!include_str!("write.rs").to_uppercase().contains("DELETE ")`).
- [ ] **Step 2–4:** red, implement, green + clippy.
- [ ] **Step 5:** Commit "Agent access: write tools".

### Task 4: Money tools (read-only, behind the switch)

**Files:** Create `src-tauri/mcp/src/money.rs` (+ tests).

**Interfaces (Produces):** `list_invoices(conn, status?, year?)`, `get_invoice(conn, reference_or_id)` (with line items), `list_quotes(conn, status?, year?)`, `list_expenses(conn, year?, month?)`, `pnl_summary(conn, year, month?) -> {income, expenses, result, currency: "CHF"}` (CHF using `chf_equivalent` when present). Each first checks `AccessConfig.allow_money`, else `Err("Reading invoices, quotes and expenses is off (Settings > Agent access).")`. Read the column names from migrations 001–006 plus the ensureSchema additions; include only fields a person would read (no IBAN/QR fields).

- [ ] Steps: failing tests (`money_off_refused`, one happy path each, `pnl_uses_chf_equivalent`), implement, green + clippy, commit "Agent access: read-only money tools".

### Task 5: MCP server over stdio

**Files:** Modify `src-tauri/mcp/src/main.rs`; create `src-tauri/mcp/src/server.rs`; test `src-tauri/mcp/tests/protocol.rs`. Add `rmcp` (server, transport-io, macros) and `tokio` (rt, macros, io-std).

**Interfaces:** Tools (names final, stable): `list_organisations`, `find_project_for_folder`, `link_folder`, `list_projects`, `get_project`, `create_project`, `update_project`, `list_tasks`, `create_task`, `update_task`, `create_subtask`, `update_subtask`, `list_clients`, `get_client`, `create_client`, `list_wiki`, `get_wiki_article`, `put_wiki_article`, `add_decision`, `link_tool`, `whats_due`, `list_invoices`, `get_invoice`, `list_quotes`, `list_expenses`, `pnl_summary`. Every tool takes optional `org`; `whats_due` without `org` merges every allowed organisation (each item names its org), and `list_organisations` shows each org's `allowed` flag. Results are JSON text content; errors are tool errors with the exact strings above. Money tools are listed only when `allowMoney` is true at startup (and still checked per call). `create_client`/`create_project` descriptions say "Ask the user before calling." Server instructions (≤ 8 lines) summarise the safety rules and "name the organisation in what you tell the user".

- [ ] **Step 1: Failing protocol test** `stdio_round_trip`: build the binary path via `env!("CARGO_BIN_EXE_studiomanager-mcp")`, spawn with `STUDIOMANAGER_DATA_DIR=<temp seeded dir>` and access enabled, send `initialize`, `tools/list` (26 tools with money on; 21 with it off), `tools/call create_task` then `get_project` → the task is there.
- [ ] **Step 2–4:** red, implement, green + clippy.
- [ ] **Step 5:** Commit "Agent access: MCP server over stdio".

### Task 6: App side — settings commands, Claude Desktop config, change poller

**Files:** Create `src-tauri/src/agent_access.rs`; modify `src-tauri/src/lib.rs` (mod + `invoke_handler` registration + poller start in `setup`), `src-tauri/capabilities/default.json` (ensure `core:event:default`).

**Interfaces (Produces, Tauri commands):**
- `get_agent_access() -> AgentAccess { enabled, allow_money, orgs: HashMap<String,bool>, mcp_path: String, claude_desktop_installed: bool, claude_code_command: String, generic_config: String }` — `mcp_path` = sibling of the app executable `studiomanager-mcp`.
- `set_agent_access(enabled: bool, allow_money: bool, orgs: HashMap<String,bool>) -> Result<(), String>` (atomic write).
- `preview_claude_desktop() -> Result<String, String>` — the full JSON that would be written.
- `install_claude_desktop() -> Result<String, String>` — backup to `claude_desktop_config.json.studiomanager-backup-<stamp>`, merge `mcpServers.studiomanager = {"command": mcp_path}` keeping every other key, atomic write; returns the backup path.
- `recent_agent_changes(limit: u32) -> Vec<LogEntry>` from `agent-log.jsonl`, newest first.
- Poller: a std thread every 2 s reads `PRAGMA data_version` on the active org's prod db with its own connection; when the window is visible and the value changed since the last read, emit `db-changed`. Also check on window focus. Pure helper `fn changed(prev: Option<i64>, now: i64) -> bool` tested.

- [ ] **Step 1: Failing tests** (inline, temp dirs; the Claude config path is a parameter of the pure merge function `merge_claude_config(existing: Option<&str>, mcp_path: &str) -> Result<String, String>`): `merge_keeps_other_servers_and_keys`, `merge_creates_file_when_missing`, `merge_rejects_invalid_json_without_writing`, `access_roundtrip`, `changed_detects_only_differences`, `recent_changes_newest_first`.
- [ ] **Step 2–4:** red, implement, `cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings` green.
- [ ] **Step 5:** Commit "Agent access: app commands and change poller".

### Task 7: Frontend — refresh on change and the Settings card

**Files:** Create `src/hooks/useDbChangedListener.ts`, `src/components/settings/AgentAccessCard.tsx`, `src/__tests__/agentAccessCard.test.tsx`; modify `src/App.tsx` (`StartupChecks` calls the hook), `src/pages/SettingsPage.tsx` (category `agent_access` in the preferences group, after calendar sync), `src/i18n/ui.ts` (EN/FR keys).

**Behaviour:**
- Hook: `listen("db-changed", () => queryClient.invalidateQueries())`, unlisten on unmount.
- Card (copy EN; FR equivalents without accents): title "Agent access"; switch "Allow AI agents to use StudioManager" (off); per-organisation checkboxes (shown when on); switch "Let agents read invoices, quotes and expenses" (off); "Connect" rows: Claude Desktop "Add…" (shows the preview JSON in a confirm strip, then installs; hidden when not installed), Claude Code "Copy command", Other apps "Copy config"; "Recent agent changes" list (time, organisation, summary; "No changes yet."); help link to [docs/agent-access.md](../../agent-access.md) on GitHub.
- Copy feedback "Copied", install feedback "Added to Claude Desktop. Restart it to load StudioManager." Errors shown inline.

- [ ] **Step 1: Failing vitest** with the Tauri `invoke` mocked: renders off by default; turning on calls `set_agent_access`; Claude Desktop add shows preview then calls `install_claude_desktop` only after confirm; copy buttons put the exact strings on the clipboard; parity test still passes.
- [ ] **Step 2–4:** red, implement, `npx tsc --noEmit && npm run lint && npx vitest run` green (run separately, read results).
- [ ] **Step 5:** Commit "Agent access: settings card and live refresh".

### Task 8: Bundling, release steps and docs

**Files:** Create `scripts/build-mcp.sh` (builds `src-tauri/mcp` in release for the host triple, copies to `src-tauri/binaries/studiomanager-mcp-<triple>`), modify `src-tauri/tauri.conf.json` (`bundle.externalBin: ["binaries/studiomanager-mcp"]`, `build.beforeBuildCommand` runs the script before the frontend build), `.gitignore` (`src-tauri/binaries/`), [RELEASING.md](../../../RELEASING.md) (gates: MCP `cargo test`/clippy; build note), create [docs/agent-access.md](../../agent-access.md) (what it is, how to connect each client, tool list, safety rules, where backups and the log live).

- [ ] **Step 1:** `scripts/build-mcp.sh` produces the binary; `CARGO_TARGET_DIR=~/cargo-target-studiomanager npm run tauri build -- --bundles app` produces `StudioManager.app/Contents/MacOS/studiomanager-mcp`; check `identifier_from_bundle` resolves `ch.studiomanager.app` by running the bundled binary with `--print-data-dir` (add this flag in this task; it prints `env::data_dir()` and exits).
- [ ] **Step 2:** Demo: `npm run build:demo -- --bundles app` (or the closest variant) and `--print-data-dir` prints the `ch.studiomanager.demo` folder.
- [ ] **Step 3:** All gates green; commit "Agent access: bundle the MCP server, release steps, docs".
