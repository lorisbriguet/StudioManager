# Agent access (MCP server) — design

Date: 2026-10-27 · Status: draft for Loris's review

Loris asked for this to be written without the question round. Decisions marked *[call]* were made by the
designer from what the conversation and the code show; Loris can overturn any.

## 1. Why

StudioManager users who work with AI agents (Claude Code, Claude Desktop, Cursor and other MCP clients) want
their agents to know about, and keep up to date, the projects they are working on: "which project is this
folder?", "add a task for the bug we just found", "tick the subtask we finished", "write what we decided into
the project wiki", "what's due this week?".

Loris already does this for himself with the `sm` CLI in the agent-bar repo (Python, writes the SQLite files
directly, backups, no deletes). It works, but it is tied to his machine, his orgs and his rules. This turns
the idea into a feature of the app: any user flips a switch in Settings and their agents get a safe,
documented set of tools. It also fits the "sell the method, not the client code" direction: generic, no Art
Basel code.

**Success:** a new user goes from "Agent access: off" to an agent creating a task they can see in the app,
in under two minutes, without editing a config file by hand; and nothing an agent does can lose data.

## 2. Goals

- An MCP server shipped inside StudioManager.app, updated with the app.
- One Settings card to turn it on, choose what agents may touch, and connect it to Claude Desktop, Claude Code
  or any other MCP client.
- A stable v1 tool set covering what `sm` does today plus tasks, subtasks and clients.
- Changes made by agents appear in the open app within a couple of seconds.
- Loris's own setup (agent-bar hook and studio-manager skill) can move from `sm` to the MCP afterwards.

## 3. Non-goals (v1)

- Creating or editing invoices, quotes or expenses. Their numbering, line items and totals live in the
  frontend TypeScript (`referenceGenerator.ts`, `lib/lineItems.ts`); duplicating that in Rust is a later
  project. v1 can read them, behind a separate switch (§6).
- Deleting anything, ever.
- Remote access. The server only talks to an agent on the same Mac, over stdio.
- Windows/Linux (the app is macOS only).
- Moving projects between organisations (stays in `sm` for now).
- Art Basel or any other user-specific rule in the server. Per-user rules belong in the user's own agent
  instructions (for Loris: his skill).

## 4. Anti-goals

- An agent destroying or silently overwriting data: no deletes, a backup before the first write of every
  session, and every write in a transaction.
- Writing to the wrong database: test mode, presentation mode, the demo build and a not-yet-migrated database
  must all be refused, not guessed at.
- Money data reaching an agent the user did not explicitly allow.
- Editing another app's config file without the user seeing it happen.
- Tool names that change between versions and break users' agents.

## 5. How it works

### 5.1 Shape *[call]*

A second binary, `studiomanager-mcp`, built from the same Cargo workspace and shipped inside the bundle
(`StudioManager.app/Contents/MacOS/studiomanager-mcp`, Tauri `externalBin`). The agent's MCP client starts it
over **stdio**; it opens the organisation's SQLite file itself (WAL, `busy_timeout` 5000, `BEGIN IMMEDIATE`
for writes), exactly as `execute_batch` and `sm` already coexist with the app.

Why not a server hosted inside the running app: it would only work while the app is open, needs a network
listener plus CSP/capability changes, and the app has no Rust-side entity logic to call anyway. A stdio
binary works whether or not the app is open and adds no listening port.

It reuses the app's own Rust code for the risky parts: org registry (`orgs.rs`), database path resolution,
and `migrate.rs` for the schema version check. Written in Rust with the official MCP Rust SDK (`rmcp`).
`rusqlite` stays pinned at 0.32 (the sqlx link constraint).

### 5.2 Seeing agent changes in the app

The app does not notice external writes today (no polling, `refetchOnWindowFocus: false`). Add one small
mechanism *[call]*: the Rust side polls `PRAGMA data_version` on the active database every 2 seconds while the
window is visible, and on window focus. When it changes because of another connection, it emits a
`db-changed` event; the frontend invalidates all queries. This also fixes `sm` writes not showing up today.

### 5.3 Which database

- Every tool takes an optional `org` (id or name). Without it, the server uses the app's active organisation
  from `organisations.json`. Every result names the organisation it acted on.
- `list_organisations` shows the organisations and which ones agents may use.
- Refusals, each with a plain message the agent can repeat to the user:
  - Agent access is off, or off for that organisation.
  - The app is in test or presentation mode. The app writes a small mode marker into its data folder when it
    enters a mode and removes it on exit; the server refuses writes while it exists *[call]*.
  - The database's `schema_migrations` version is older or newer than this binary expects ("open
    StudioManager once to update it" / "update StudioManager").
- The demo build gets its own `studiomanager-mcp` pointing at the demo data folder (same compile-time switch
  as the app), so a demo user cannot touch real data.

### 5.4 Safety rules for writes (from `sm` and its skill)

- Never DELETE or ALTER. No tool can remove a row.
- Before the first write of each server process and organisation: copy the database (SQLite backup API) to
  `<app data>/backups/agent/<org>-<timestamp>.db`; keep the 20 most recent *[call]*.
- Every UPDATE sets `updated_at = datetime('now')`. New rows get `sort_order = MAX + 1`.
- Never write `calendar_event_id`, `calendar_deadline_id`, `workload_*`, `layout_config`, `tracked_minutes`.
- Task and subtask status written by agents: `todo` or `done` only.
- Name matching is accent- and case-insensitive. When a name matches more than one row, the tool returns the
  candidates instead of picking one.
- Creating a client or a project is allowed but the tool descriptions tell the agent to ask the user first
  *[call]* (MCP clients already show the call for approval).

### 5.5 Tools (v1)

Names are stable from v1 on; new versions only add tools or optional fields.

- **Organisations:** `list_organisations`
- **Folders:** `find_project_for_folder` (a folder path to its linked project, walking up parent folders),
  `link_folder` (sets `projects.folder_path`)
- **Projects:** `list_projects` (filter by status, client, text), `get_project` (with tasks, subtasks, wiki
  index and linked tools), `create_project`, `update_project` (status, deadline, notes, folder)
- **Tasks:** `list_tasks` (filter by project, status, due before), `create_task`, `update_task`,
  `create_subtask`, `update_subtask`
- **Clients:** `list_clients`, `get_client`, `create_client` (next client reference the same way the app makes
  it)
- **Wiki:** `list_wiki` (folders and article titles), `get_wiki_article`, `put_wiki_article` (create or
  replace by title in the project's folder; Markdown in, the app's article format stored), `add_decision`
  (appends a dated line to the project's "Decisions" article)
- **Tools and resources:** `link_tool` (find or create a resource by name or URL and link it to a project)
- **Due list:** `whats_due` (tasks, subtasks and deadlines late or due within N days, every allowed org)
- **Money (only when allowed, read-only):** `list_invoices`, `get_invoice`, `list_quotes`, `list_expenses`,
  `pnl_summary` (year or month)

The server's MCP instructions summarise §5.4 for the agent in a few lines.

### 5.6 Settings → "Agent access" card

A new `AgentAccessCard.tsx` next to Calendar sync, EN/FR strings in `i18n/ui.ts`:

- **Allow agents to use StudioManager:** off by default.
- **Per organisation:** a checkbox for each organisation, all on once the main switch is on. Stored with the
  organisation prefs in `organisations.json`, which the server reads on every call.
- **Let agents read invoices, quotes and expenses:** off by default.
- **Connect:**
  - **Claude Desktop — Add:** shows the exact JSON it will add to `claude_desktop_config.json` and adds it only
    on confirmation, keeping a backup of the file. If Claude Desktop is not installed, the button is hidden.
  - **Claude Code — Copy command:** copies
    `claude mcp add studiomanager -- /Applications/StudioManager.app/Contents/MacOS/studiomanager-mcp`
    (with the real bundle path).
  - **Other apps — Copy config:** copies the generic `mcpServers` JSON snippet.
- **Recent agent changes:** the last 20 writes (time, organisation, tool, what changed), read from a small log
  the server appends to in the app data folder *[call]*.
- A link to a short help page (`docs/agent-access.md`) listing the tools and the rules.

### 5.7 Loris's own setup (after v1 ships)

The agent-bar session-start hook and studio-manager skill switch from `scripts/sm` to the MCP tools; `sm`
keeps only `move` and anything the MCP does not cover. Separate small change in the agent-bar repo, not part
of this build.

## 6. Constraints

- Tauri 2, Rust; frontend React 19 + TanStack Query. No new network listener; CSP unchanged.
- Repo is public: no personal data, org ids or Art Basel references in code, tests or docs.
- Release: the binary is part of the existing release (`.dmg`, `.app.tar.gz`, updater). Ad-hoc signing
  ("-"), like the app. Version numbers stay in sync in the four places `RELEASING.md` lists.
- EN/FR key parity is a release gate for the new strings.
- Tests: Rust integration tests against temporary databases created with `migrate.rs` (never the real data
  folder); a protocol test that starts the binary and calls tools over stdio; vitest for the card.
- The schema is split between migrations and the frontend `ensureSchema()`. Tables the server writes
  (`resources`, `wiki_*`) must exist even if the app never ran `ensureSchema` on that database: move their
  creation into a numbered migration as part of this work *[call]*.

## 7. Left to the builder

- Exact JSON shapes of tool inputs and outputs (keep them small; ids plus names; dates as `YYYY-MM-DD`).
- How Markdown maps to the wiki's stored article format (follow `src/lib/wikiLinks.ts` and how `sm` writes
  articles).
- How the client reference for `create_client` is generated (match the app's existing logic).
- Polling details for `data_version` (interval, pausing when hidden).
- Layout of the Settings card within `SettingsPrimitives`.
