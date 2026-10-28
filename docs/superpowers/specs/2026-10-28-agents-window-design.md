# Agents window — design

Date: 2026-10-28 · Status: draft for Loris's review

Related: [Agent access (MCP server) design](2026-10-27-agent-access-mcp-design.md) · [Agent access guide](../../agent-access.md) · [IDEAS.md](../../../IDEAS.md)

Decisions marked *[call]* were made by the designer, not by Loris; he can overturn any.

## 1. Why

Loris runs several Claude Code agents at once across client and personal projects. For Art Basel he has a
"control room" (repo `claude-dashboard`, branch `feat/ab-control-room`, a local Node server on port 4747) that
lets him start agents, see what they are all doing, and attach to them in a terminal. Nothing like it exists
for the rest of his work, and StudioManager already knows what a terminal or the control room does not: which
folder belongs to which project and client.

This is the first of two steps. Step two, making the agent bar part of StudioManager, is a separate project
and gets its own brainstorm.

**Success:** with the window switched on, Loris can start an agent, see at a glance which agents are working
or waiting on him (labelled by client and project), read what one did, answer it, and drop into its terminal,
without opening iTerm or the control room.

## 2. Goals (v1)

- A Settings card, next to "Agent access", that switches the feature on. Off by default. When on, an
  "Agents" page appears in the sidebar.
- **List** of every Claude Code agent on the Mac, grouped *needs you / working / idle / done*, refreshed
  every couple of seconds. Each agent shows its name, model, status and, when its folder (or a parent folder)
  is a project's `folder_path` in any organisation, the organisation, client and project.
- **Start an agent** from the Agents page: folder, task, model, name. Linked project folders are listed first.
- **Per agent:** read the conversation, send a message, switch model, stop, delete, open a terminal attached
  to it.
- **Answer a waiting agent from its panel:** when an agent is in *needs you* (permission prompt, choice,
  question), the panel shows what it is asking and offers buttons for its options (allow / deny / each
  choice). This is new; the control room has no equivalent (§6). The message box only sends while an agent
  is busy or idle.
- **Terminal** attached to one running agent (`claude attach`). Claude's own `!` commands work inside it.
- **Mac notification** when an agent starts waiting on Loris.

## 3. Non-goals (v1)

- Starting an agent from a project, task or anywhere other than the Agents page. Entry points get added
  later as Loris finds uses for them.
- A free shell. The terminal only ever runs `claude attach <id>`.
- Context meter and per-agent task list (the control room has both; later).
- Phone alerts (ntfy, Pushover).
- Anything Art Basel: open questions, decisions, deadlines, hub records. The control room stays and keeps
  those.
- Git worktree options when starting an agent.
- The agent bar (step two).

## 4. Anti-goals

- Opening a network port or a local web server. The control room's audit
  (`ArtBasel/docs/hub-audit-2026-10-14/1-control-room-security.md`) shows how much of its risk comes from a
  key-protected HTTP/WebSocket server; inside Tauri everything goes through IPC instead.
- Letting the webview run arbitrary commands. Today the app's capability file states that the webview cannot
  execute shell commands; v1 keeps that true. Every process is started by a Rust command with a fixed
  program and validated arguments.
- Accepting Claude's folder-trust prompt on Loris's behalf.
- Writing to the Art Basel hub's files, or to `~/.claude` beyond what the `claude` CLI itself does.

## 5. Constraints

- Requires the `claude` CLI on the Mac. If it is missing, the Settings card says so and the switch stays
  off. *[call]*
- StudioManager is meant for other users too (see the [agent access design](2026-10-27-agent-access-mcp-design.md)),
  so nothing here is specific to Loris's folders.
- Agents are ordinary Claude background sessions: they keep running when StudioManager is closed. Alerts
  only arrive while the app is open. *[call]*
- Single Tauri window today; the Agents page is a route inside it, not a second window. *[call]*

## 6. How it works

### Borrowed from the control room

The control room's generic half is the reference for behaviour (not for code, which is Node):

| Job | Control room file | v1 behaviour |
|---|---|---|
| List | `server/sessions.ts` | `claude agents --json --all`, enriched from `~/.claude/sessions/<pid>.json`; status busy / idle / waiting, `waitingFor` |
| Grouping | `web/sessions/SessionList.tsx`, dismiss logic | needs you / working / idle / done; a needs-you agent goes quiet after 2 h with no transcript change, or when dismissed |
| Start | `server/launcher.ts`, `server/routes/launch.ts`, `server/trust.ts` | `claude --bg --model <m> --name <n> <task>` with cwd = folder; only trusted folders (`hasTrustDialogAccepted` in `~/.claude.json`) |
| Conversation | `server/transcripts.ts` | read `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl` |
| Send | `server/sendToSession.ts` | write into the agent; refused for interactive (non-background) sessions |
| Stop / delete | `server/routes/sessions.ts` | `claude stop <id>`; `claude rm <id>` |
| Switch model | `server/routes/sessions.ts` | stop, then `claude --resume <id> --bg --model <m>`; remember old → new id |
| Terminal | `server/terminal.ts`, `web/sessions/TerminalPanel.tsx` | pty running `claude attach <id>`, xterm.js in the page, max 8 open |

Validation copied as is: model in `haiku | sonnet | opus | fable`; name `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`;
task ≤ 8000 characters and not starting with `-`; agent ids `^[0-9a-f]{8}$`; terminal size clamped.

### In StudioManager

- **Rust (`src-tauri/src/agents.rs`, new):** commands for list, start, send, stop, delete, switch model,
  read conversation, and pty open / write / resize / close. A pty crate (e.g. `portable-pty`) streams output
  to the page through Tauri events. Processes start with argv only, never through a shell.
- **Capability:** only these new commands are added. `shell:allow-execute` stays off.
- **Project labels:** match an agent's cwd against projects' `folder_path` in every organisation; the
  longest matching prefix wins. No match shows the folder name.
- **Settings:** one app-wide switch (Loris's decision), not a per-organisation pref. A card in
  `src/components/settings/`, stored in the app data folder like `agent-access.json` (same file or a
  sibling; builder chooses). The Agents page appears in every organisation and lists all agents.
- **Organisations:** project lookup and the "linked folders first" list run in Rust across every
  organisation's database. Labels read *Organisation › Client › Project*. Organisations hidden from agent
  access are still matched here, since this is Loris's own view, not an agent's. *[call]*
- **Answer buttons:** read the open prompt (from the session status / `waitingFor`, the transcript, or the
  attached pty's screen, whichever proves reliable) and map each option to the keystrokes that select and
  confirm it. Before confirming, verify the selection landed on the chosen option; if the prompt can't be
  read with confidence, show no buttons and point to the terminal instead. Never send a bare Enter.
- **Finding `claude`:** a Tauri app launched from Finder doesn't inherit the shell's PATH. Resolve the
  binary from the login shell once (or known install paths) and show the path in the Settings card. *[call]*
- **Interactive sessions** (started in iTerm, not `--bg`): listed and readable; stop and terminal-attach
  where the CLI allows; no send, no model switch, no answer buttons. *[call]*
- **Untrusted folders:** not offered in the start form; the card explains that a folder is trusted by
  opening Claude in it once. *[call]*
- **Polling runs in Rust**, so alerts fire whatever page is open. *[call]*
- **Alerts:** when an agent moves into *needs you*, a Mac notification through the existing notification
  plugin, naming the agent and its project. One per transition.
- **Frontend:** new page under `src/pages/`, sidebar entry shown only when the switch is on, i18n keys in
  `src/i18n/`.

## 7. Left to the builder

- Layout of the Agents page (list plus detail pane is the obvious shape; match the app's design system,
  [DESIGN-SYSTEM.md](../../../DESIGN-SYSTEM.md)).
- How often to poll, as long as the list feels live (control room: 2 s).
- Where the old → new id links for model switches are stored.
- How the conversation is rendered (control room: grouped activity, markdown messages).
- Whether the same agent also showing in the control room needs any handling (expected: none).
