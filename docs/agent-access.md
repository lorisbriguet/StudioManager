# Agent access

Agent access lets AI apps such as Claude read and edit your StudioManager data through a small local program, `studiomanager-mcp`, that ships inside the app. It speaks the Model Context Protocol (MCP) over standard input/output. Nothing leaves your Mac: the program reads and writes the same files the app uses.

It is off until you turn it on. To watch and answer Claude Code agents running on your Mac, see [Agents](agents.md).

## Turning it on

1. Open StudioManager, then Settings > Agents (Agent access card).
2. Switch on "Allow AI agents to use StudioManager".
3. Pick the organisations agents may use. The server refuses to read or write an organisation you leave unticked. An organisation starts unticked (a new one, or one the settings file doesn't list, such as one restored from a backup): tick it here when agents should use it. The first time you switch access on, the active organisation is ticked for you; the others stay unticked. Organisations from versions up to 3.4.0, where an unlisted one was allowed, keep that access: on the first launch of a later version, if agent access is on, the app ticks every one without an entry, once.
4. Optionally allow agents to read invoices, quotes and expenses (the "money" tools below). This is a separate switch and is off by default. The money tools appear in the AI app only after it restarts the StudioManager server (quit and reopen the AI app, or reconnect the server) after you switch this on.

Open StudioManager at least once with each organisation after installing or updating. The server refuses to touch a database the app has not prepared and says "Open StudioManager once with this organisation, then try again."

The settings are stored in `agent-access.json` in the app's data folder. If the file is missing, everything is off.

### A consent switch, not a lock

These switches tell the server what you agree to; they are not a security boundary. `agent-access.json` and the databases are ordinary files of your user account, and the server re-reads the settings on every call. An AI app that may run commands or edit files on your Mac (Claude Code, or Claude Desktop with a terminal or file-system tool) could rewrite the settings, or open a database with `sqlite3` and bypass the server altogether. Unticked organisations and the money switch keep agents that go through the server out; they hide nothing from a program that ignores them. The boundary that holds is the AI app's own permission system: which commands it may run and which folders it may touch.

## Connecting a client

The program lives inside the app bundle at `StudioManager.app/Contents/MacOS/studiomanager-mcp`. Settings > Agents (Agent access card) shows the exact path and ready-made snippets.

- **Claude Desktop:** press "Add…". The app shows the change to Claude Desktop's configuration file, backs the file up next to itself, and writes it only after you confirm. Restart Claude Desktop afterwards.
- **Claude Code:** copy the command shown in Settings and run it in a terminal, for example `claude mcp add studiomanager -- '/Applications/StudioManager.app/Contents/MacOS/studiomanager-mcp'`.
- **Other apps:** add a stdio server whose command is the path above, for example `{ "mcpServers": { "studiomanager": { "command": "/Applications/StudioManager.app/Contents/MacOS/studiomanager-mcp" } } }`.

The Demo build registers itself under the name `studiomanager-demo` so both can be connected side by side. Each bundle uses its own data folder.

To check which data folder a bundle will use, run `studiomanager-mcp --print-data-dir`.

## Tools

Organisation and folders: `list_organisations`, `find_project_for_folder`, `link_folder`.

Projects: `list_projects`, `get_project`, `create_project`, `update_project`.

Tasks: `list_tasks`, `create_task`, `update_task`, `create_subtask`, `update_subtask`, `whats_due`.

Clients: `list_clients`, `get_client`, `create_client`. Like the app's pickers, agents do not see archived clients by default: `list_clients` leaves them out unless `include_archived` is true, and a client name given to `create_project` or any other tool matches active clients only. An id still reaches an archived client, and `get_client` reports its `archived_at`. Projects and other records of an archived client still show it.

Upkeep, reading: `list_machines` (machines and equipment with their next upkeep), `get_machine` (one machine with its upkeep items, service log, consumables and links), `list_consumables`, `list_subscriptions`. No serial numbers, readings or connection details; prices and costs only when money reading is allowed.

Upkeep, writing: `add_service_log` (a dated repair, upgrade or part on a machine, such as new RAM in a NAS), `add_machine_link` (a web page or remote-access link on a machine, which the Network page shows), `create_machine`, `update_machine`, `add_upkeep_item` (a repeating task such as "clean the filter every 6 months"), `mark_upkeep_done`, `create_consumable`, `update_consumable` (set the stock or add a restock), `create_subscription`, `update_subscription` (plan, vendor, link, cost, notes, or cancel; a subscription's name, renewal date and period change in the app). Each of these tells the agent to ask you first and say what it will save. An organisation that uses another organisation's machines and consumables (Settings > Studio upkeep) reads and writes them in that organisation, which agent access must allow too; subscriptions always stay with the organisation itself.

Captures and briefs: `capture` (save a thought in the inbox, with an optional project hint), `list_captures` (the latest 50 new ones, a given status, or exactly the `ids` you pass, at most 50), `file_capture` (file a capture under a project as a task or subtask with a brief, or leave it in the inbox with a reason), `set_brief` (write the brief of a task or subtask), `report_result` (write the result of a task or subtask, with an optional branch and pull request link, when the work is done), `ask` (put a question with a recommendation to the user, on a task or subtask that an agent started from StudioManager is working on; refused when no agent is linked to the item, or when a question is already waiting on it, and other sessions ask the user directly), `list_needs_you` (what waits on the user or was decided, at most 100, newest first). See [Capture and briefs](agents.md#inbox-and-briefs).

Wiki and tools: `list_wiki`, `get_wiki_article`, `put_wiki_article`, `add_decision`, `link_tool`.

Agents link wiki articles to each other by title: `[[Decisions]]`, `[[Panopus/Overview]]` or `[[Title|other text]]` in the Markdown they write become real links (this project's article first, then a title unique in the organisation). Titles that match nothing stay as text and are listed back to the agent in `unresolved_links`. Other links keep their target only when the wiki editor would accept it, a web address (`http`, `https`) or a `/wiki?` link; any other link (`javascript:`, `mailto:`, `file:`…) keeps only its text. The server's instructions ask agents to link every related article: Overview lists the others, and each article links back to it and to where a topic is covered.

A project's own Markdown files (README, design system, release notes, docs) show in the wiki read-only, straight from the project's folder. Agents link them the same way, `[[DESIGN-SYSTEM.md]]` or `[[Panopus/RELEASING.md]]`, instead of copying their content into an article.

Money (hidden unless allowed in Settings): `list_invoices`, `get_invoice`, `list_quotes`, `list_expenses`, `pnl_summary`.

That is 47 tools, 5 of them money tools, not counting the three lead-only tools below. Names given to the tools (projects, clients, articles) match regardless of accents and case; if several match, the server returns the candidates instead of picking one. Agents are asked to check with you before creating projects or clients and before every upkeep write.

### Limiting a session to some tools

If the environment variable `STUDIOMANAGER_TOOLS` is set and not empty, the server lists and allows only the tools it names (comma-separated, without the `mcp__studiomanager__` prefix, for example `list_captures,file_capture`). Any other call is refused with "This tool is not available in this session". Names that are no tool are ignored; unset, nothing changes. The brief session's config sets it to its seven tools (see [Brief session](agents.md#brief-session)).

Three tools are for the lead session only: `get_needs_you` (one entry with its task, project and, for a check, the stored diff, at most 200 KB), `resolve` (answer an entry the lead is working on, with the reason) and `hand_over` (pass it to the user with a recommendation; it stays open). They are neither listed nor allowed unless `STUDIOMANAGER_TOOLS` names them. They only act on an open entry whose `lead_state` is `running`, and never write a stage, a task status or `delivered_at`.

## Safety rules

- **No deletes.** No tool removes or drops anything. Task and subtask status can only be set to `todo` or `done`.
- **Backups.** Before the first write per organisation in a session, the server takes a full copy of the database to `<data folder>/backups/agent/`. The 20 most recent per organisation are kept.
- **Change log.** Every write adds a line to `<data folder>/agent-log.jsonl` (time, organisation, tool, summary); once it passes 1,000 lines it is cut back to the newest 500. Settings > Agents (Agent access card) shows the recent entries. The app watches this file: when an agent writes, open pages refresh within a couple of seconds.
- **Captures.** `file_capture` only creates a task or a subtask (or leaves the capture in the inbox) and never changes an existing one. `set_brief` writes only the brief of the task or subtask it names (the brief session does not use it: `file_capture` carries the brief). `report_result` writes only the result of the task or subtask it names (text, at most 4,000 characters) and, the branch and pull request link on that item's open agent link when it has exactly one; it never writes a stage or a status.
- **Project folders.** `link_folder` and `update_project` accept only an existing folder inside Documents, Desktop, Downloads or `~/Library/CloudStorage` (not one of those places itself), and never an app or other bundle (`.app`, `.bundle`, `.framework`…).
- **Size.** A title, name, note, link or article over 1 MB is refused.
- **Test and presentation mode.** While either mode is active, writes are refused. Reads still work on the real data.
- **Apple Calendar.** If calendar sync is on, changes an agent makes to a task's or subtask's due date or status are not pushed to Apple Calendar. The event catches up the next time you edit that task in the app. Upkeep items and subscriptions an agent adds, or upkeep it marks done, get their calendar event from the app as soon as it sees the change (the app must be open).
- **Fields agents never write:** calendar links, workload fields, layout configuration, tracked time, and a machine's serial number, device connection and readings. Agents never create expenses: a cost on a service log entry stays on that entry.

## Known limit

If an agent edits a wiki article or a project at the same moment you are editing the same one in the app, your next change overwrites the agent's edit. The app does not merge the two.
