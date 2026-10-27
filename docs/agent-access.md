# Agent access

Agent access lets AI apps such as Claude read and edit your StudioManager data through a small local program, `studiomanager-mcp`, that ships inside the app. It speaks the Model Context Protocol (MCP) over standard input/output. Nothing leaves your Mac: the program reads and writes the same files the app uses.

It is off until you turn it on.

## Turning it on

1. Open StudioManager, then Settings > Agent access.
2. Switch on "Allow AI agents to use StudioManager".
3. Pick the organisations agents may use. An organisation you leave unticked is invisible to agents.
4. Optionally allow agents to read invoices, quotes and expenses (the "money" tools below). This is a separate switch and is off by default. The money tools appear in the AI app only after it restarts the StudioManager server (quit and reopen the AI app, or reconnect the server) after you switch this on.

Open StudioManager at least once with each organisation after installing or updating. The server refuses to touch a database the app has not prepared and says "Open StudioManager once with this organisation, then try again."

The settings are stored in `agent-access.json` in the app's data folder. If the file is missing, everything is off.

## Connecting a client

The program lives inside the app bundle at `StudioManager.app/Contents/MacOS/studiomanager-mcp`. Settings > Agent access shows the exact path and ready-made snippets.

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

Wiki and tools: `list_wiki`, `get_wiki_article`, `put_wiki_article`, `add_decision`, `link_tool`.

Money (hidden unless allowed in Settings): `list_invoices`, `get_invoice`, `list_quotes`, `list_expenses`, `pnl_summary`.

That is 26 tools, 5 of them money tools. Names given to the tools (projects, clients, articles) match regardless of accents and case; if several match, the server returns the candidates instead of picking one. Agents are asked to check with you before creating projects or clients.

## Safety rules

- **No deletes.** No tool removes or drops anything. Task and subtask status can only be set to `todo` or `done`.
- **Backups.** Before the first write per organisation in a session, the server takes a full copy of the database to `<data folder>/backups/agent/`. The 20 most recent per organisation are kept.
- **Change log.** Every write adds a line to `<data folder>/agent-log.jsonl` (time, organisation, tool, summary); the last 500 lines are kept. Settings > Agent access shows the recent entries.
- **Test and presentation mode.** While either mode is active, writes are refused. Reads still work on the real data.
- **Apple Calendar.** If calendar sync is on, changes an agent makes to a task's or subtask's due date or status are not pushed to Apple Calendar. The event catches up the next time you edit that task in the app.
- **Fields agents never write:** calendar links, workload fields, layout configuration and tracked time.

## Known limit

If an agent edits a wiki article or a project at the same moment you are editing the same one in the app, your next change overwrites the agent's edit. The app does not merge the two.
