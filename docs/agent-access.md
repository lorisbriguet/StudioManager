# Agent access

Agent access lets AI apps such as Claude read and edit your StudioManager data through a small local program, `studiomanager-mcp`, that ships inside the app. It speaks the Model Context Protocol (MCP) over standard input/output. Nothing leaves your Mac: the program reads and writes the same files the app uses.

It is off until you turn it on. To watch and answer Claude Code agents running on your Mac, see [Agents](agents.md).

## Turning it on

1. Open StudioManager, then Settings > Agents (Agent access card).
2. Switch on "Allow AI agents to use StudioManager".
3. Pick the organisations agents may use. The server refuses to read or write an organisation you leave unticked.
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

Clients: `list_clients`, `get_client`, `create_client`.

Studio: `list_machines` (machines and equipment with their next upkeep; no readings or connection details).

Wiki and tools: `list_wiki`, `get_wiki_article`, `put_wiki_article`, `add_decision`, `link_tool`.

Agents link wiki articles to each other by title: `[[Decisions]]`, `[[Panopus/Overview]]` or `[[Title|other text]]` in the Markdown they write become real links (this project's article first, then a title unique in the organisation). Titles that match nothing stay as text and are listed back to the agent in `unresolved_links`. Other links keep their target only when the wiki editor would accept it, a web address (`http`, `https`) or a `/wiki?` link; any other link (`javascript:`, `mailto:`, `file:`…) keeps only its text. The server's instructions ask agents to link every related article: Overview lists the others, and each article links back to it and to where a topic is covered.

A project's own Markdown files (README, design system, release notes, docs) show in the wiki read-only, straight from the project's folder. Agents link them the same way, `[[DESIGN-SYSTEM.md]]` or `[[Panopus/RELEASING.md]]`, instead of copying their content into an article.

Money (hidden unless allowed in Settings): `list_invoices`, `get_invoice`, `list_quotes`, `list_expenses`, `pnl_summary`.

That is 27 tools, 5 of them money tools. Names given to the tools (projects, clients, articles) match regardless of accents and case; if several match, the server returns the candidates instead of picking one. Agents are asked to check with you before creating projects or clients.

## Safety rules

- **No deletes.** No tool removes or drops anything. Task and subtask status can only be set to `todo` or `done`.
- **Backups.** Before the first write per organisation in a session, the server takes a full copy of the database to `<data folder>/backups/agent/`. The 20 most recent per organisation are kept.
- **Change log.** Every write adds a line to `<data folder>/agent-log.jsonl` (time, organisation, tool, summary); once it passes 1,000 lines it is cut back to the newest 500. Settings > Agents (Agent access card) shows the recent entries. The app watches this file: when an agent writes, open pages refresh within a couple of seconds.
- **Project folders.** `link_folder` and `update_project` accept only an existing folder inside Documents, Desktop, Downloads or `~/Library/CloudStorage` (not one of those places itself), and never an app or other bundle (`.app`, `.bundle`, `.framework`…).
- **Size.** A title, name, note, link or article over 1 MB is refused.
- **Test and presentation mode.** While either mode is active, writes are refused. Reads still work on the real data.
- **Apple Calendar.** If calendar sync is on, changes an agent makes to a task's or subtask's due date or status are not pushed to Apple Calendar. The event catches up the next time you edit that task in the app.
- **Fields agents never write:** calendar links, workload fields, layout configuration and tracked time.

## Known limit

If an agent edits a wiki article or a project at the same moment you are editing the same one in the app, your next change overwrites the agent's edit. The app does not merge the two.
