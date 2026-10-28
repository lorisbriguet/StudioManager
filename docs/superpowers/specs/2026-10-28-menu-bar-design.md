# Menu bar — design

Date: 2026-10-28 · Status: draft for Loris's review

Follows: [Agents window design](2026-10-28-agents-window-design.md) · User guide of the Agents page: [agents.md](../../agents.md) · Design rules: [DESIGN-SYSTEM.md](../../../DESIGN-SYSTEM.md) · Ideas list: [IDEAS.md](../../../IDEAS.md)

Decisions marked *[call]* were made by the designer, not by Loris; he can overturn any.

## 1. Why

Loris runs AgentBar, a separate SwiftUI menu bar app (repo `~/Documents/GitHub/agent-bar`), to keep an eye on his
Claude Code agents without opening a terminal: a live agent list, answering prompts from the menu bar, notifications,
and plan-usage numbers. StudioManager now has an Agents page with the same agent engine (step 1). This is step 2:
the menu bar becomes part of StudioManager, shipped with the app, so there is one app to install and keep up to date,
and AgentBar can be retired.

StudioManager is meant for other users too. Everything generic ships in the app; what is personal to Loris (Art
Basel, his briefs) stays his, as configuration and his own scripts, never as app code — so StudioManager updates never
touch it and there is no private fork.

**Success:** with "Show in menu bar" on, Loris uninstalls AgentBar and does not miss it day to day: he sees and
answers his agents, reads his plan usage, and runs his day (start and end of day, personal and Art Basel) from
StudioManager's menu bar icon.

## 2. The whole picture, and what this document covers

AgentBar's generic features move into StudioManager in separate projects, in this order:

1. **Menu bar, version 1** — this document: Agents, Usage and **Day** tabs. The Day tab brings forward the core of
   "saved tasks and custom actions" as **routines** (Loris: the Day tab "is really important").
2. Saved tasks beyond the day: a routines library per project, a full editor window, more schedules.
3. Launcher (global hotkey, including starting an agent for a project with no folder yet).
4. Results inbox (finished/failed background jobs, unread badge).
5. Wrap up (handoff note, then stop).
6. Retiring the rest of AgentBar (the `sm` CLI and SessionStart hook replaced by MCP tools or app features).

Each later project gets its own brainstorm. Agent time stays a guide; turning it into time entries is not planned
(Loris: "guide only for now").

## 3. Goals (version 1)

- **Switch:** "Show in menu bar" in Settings › Agents, next to the Agents page switch. Off by default; needs the Agents
  switch on. *[call]*
- **Always available:** when it is on, StudioManager starts at login and keeps running when its window is closed.
  Quitting (⌘Q) quits the app and removes the icon. Standard Mac behaviour (Loris confirmed).
- **Icon:** StudioManager's mark in the menu bar, as a template image (adapts to light/dark menu bar), tinted amber
  while any agent needs you. Clicking it opens the panel; clicking outside closes it. *[call: amber tint as AgentBar]*
- **Panel, tabs** (layout A, chosen from mockups): **Agents**, **Usage** and **Day**.
  - **Agents tab:** the Agents page's list — groups Needs you / Working / Idle / Done with colours and folding (Done
    folded by default, latest first), the model version, the project label — and answering prompts in place with the
    same safety rules as the Agents page (shows the command, buttons only when the prompt is read with confidence,
    fingerprint check). Footer: "Open StudioManager" (brings the window forward, on that agent) and "New agent"
    (opens the window on the start form). Clicking an agent opens it in the window. *[call]*
  - **Usage tab**, everything AgentBar's Usage tab shows:
    - **Plan limits:** 5-hour window, weekly (all models), weekly per model (e.g. Opus), each with percent used,
      reset time and a pacing line ("On pace to hit 100% Thu 15:40" / "On pace for 70% at reset").
    - **Alerts**, as AgentBar's: one Mac notification when a window passes **80%**, and one **pace alert** when the
      projected 100% comes more than an hour before the window resets; each fires once per window (keyed by its reset
      time); a setting to turn them off. *[call: match AgentBar exactly; the meters turn amber at 75% and red at 90%]*
    - **Tokens:** last 7 days, stacked by client (via linked folders), and this week's model mix
      ("Mostly Opus 5.5 (92%), Sonnet 5.5 (8%)").
    - **Agent time:** per client and project, Today / Week, labelled "A guide from agent activity, not a timesheet",
      with "Copy as text".
  - **Day tab:** sections the user names (Loris: "Personal", "Art Basel"), each a list of **routines**. A routine row
    shows its title, a status line (idle hint / "Running" / "Done at 08:12" / "Failed: …"), a main button ("Run" /
    "Open result") and a "…" menu (Run now, Edit, Open folder or link). Two kinds of routine:
    - **Agent prompt:** folder, model, name, and the prompt (text, or a prompt file whose content is read at run time).
      Runs as a background agent through the Agents engine; its result is the agent itself (open it in the window)
      plus an optional result link (a file path or URL the routine names, e.g. today's brief). Comments on a brief
      become messages to that agent from the Agents page, so no brief server is needed. *[call]*
    - **Command:** a program and its arguments that the user sets up, run in a chosen folder, never through a shell.
      The status line is the last non-empty line of its output; the exit code decides done or failed. Loris's Art
      Basel day buttons become a small script of his own (in his Art Basel tooling, not in StudioManager) that calls the
      control room with its key and prints what to show (hours, a missing end time). *[call: a command routine,
      not a "call this URL" routine, keeps control-room details out of the app]*
    - **Schedule:** optional, per routine: a time, on weekdays or every day. A missed run (Mac asleep) catches up on wake
      if less than 2 h late, as AgentBar's saved tasks do. Loris's start of day at 08:00 moves here. *[call: same
      catch-up rule as AgentBar]*
    - **Links per section:** optional named links shown in the section header (Loris: "Topics", "Briefs", the control
      room).
    - Routines are set up in Settings › Agents › Day (add, edit, reorder, delete, choose the section), stored in the
      app data folder, never in the code. *[call]*
- **Plan-limit capture:** StudioManager provides its own status line command and sets it in Claude's settings
  (`~/.claude/settings.json`, key `statusLine`) **with a preview of the change and a backup first**, the way Agent
  access connects Claude Desktop. The command reads Claude Code's status-line JSON from stdin, keeps `rate_limits`,
  appends history, and prints nothing (as AgentBar's does).
- **Notifications:** the existing needs-you notifications keep working with the window closed. A scheduled routine that
  fails posts one notification.
- **Status line setup** lives in Settings › Agents as its own action ("Set up plan limits"), with the preview and backup;
  the Usage tab points there until it is done. "Remove" restores the backed-up status line, and turning the menu bar off
  offers to. If another status line is already set (another user's own), the preview says it will stop showing and
  nothing changes unless they confirm; combining the two is a later feature. *[call]*
- **At login** StudioManager starts in the menu bar only, without opening its window; the Dock icon behaves as usual.
  *[call]*

## 4. Non-goals (version 1)

- The launcher, the results inbox, wrap up, routines outside the Day tab (later projects, §2).
- The Art Basel hub push check (dropped; Loris's own script may print it if he wants).
- A "call this URL" routine kind.
- Anything Art Basel or brief-specific in the app.
- Writing time entries from agent time.
- A separate helper process or daemon: the menu bar lives inside the StudioManager process.

## 5. Anti-goals

- **Two engines.** The menu bar must not poll or parse agents separately: it reads the same Rust state, events and
  commands as the Agents page (`src-tauri/src/agents/`).
- **Hand-rolled UI.** Follow DESIGN-SYSTEM.md "Reuse First": PANEL_TOP_BAR + TabItem for the tabs, the Agents page's
  `AgentList` and `PromptAnswer`, `Badge`, `Button`, `dot`, `BottomBar`, recharts for the token chart, TabItem for
  Today/Week. The usage meter derives from the project progress bar (`ProjectDetailContent.tsx`, `ProjectsPage.tsx`),
  extracted into a shared `src/components/ui` component and used in both places. Anything new is named to Loris.
- **Silent edits to Claude's config.** The status line is only written after Loris sees the change; a backup is kept;
  an existing status line that isn't StudioManager's is never overwritten without saying so.
- **A network port.** As for the Agents page: Tauri IPC only.
- **Personal content in shipped code.**

- **Running commands the user didn't set up.** Only command routines the user created in Settings run, with the
  program and arguments they entered; the webview never passes a program or arguments of its own.

## 6. Constraints

- Tauri 2 desktop app; current Agents engine and UI from step 1 (merged as `51c2128`).
- Only one status line command can be set in Claude Code. Today it is AgentBar's binary.
- StudioManager is used by others: every user-visible piece is generic and translated (EN/FR).

## 7. Retiring AgentBar at version 1 (Loris's decision)

Loris retires AgentBar as soon as version 1 works. With the Day tab in version 1, nothing temporary is needed:

- His **start and end of day** (personal) become Agent prompt routines pointing at his prompt files in
  `~/Documents/Briefs`, with start of day scheduled at 08:00.
- His **Art Basel day buttons** become Command routines running his own script that talks to the control room.
- Retirement steps on his machine, as a short checklist in `docs/` *[call]*:
  - remove AgentBar's login item and its 08:00 launchd job (`ch.lorisbriguet.agentbar.sod`), then the app;
  - switch the status line to StudioManager's (its setup step does this with a preview and backup);
  - remove the safety-events settings (`OTEL_*` keys pointing at AgentBar's brief server, port 47480) from
    `~/.claude/settings.json`, with a backup, since nothing listens there any more *[call]*;
  - write the Art Basel day script and set up the routines.
- Brief comments are replaced by messaging the start-of-day agent from StudioManager.
- Lost until later projects: the launcher, the results inbox, wrap up, the saved-tasks window (Loris accepted this).

## 8. Left to the builder

- How the panel is shown (a Tauri tray icon plus a borderless panel window positioned under it, or the tray menu API)
  and how it closes on blur — as long as it behaves as a Mac menu bar panel.
- Start at login mechanism (e.g. the Tauri autostart plugin) and how "keep running when the window closes" is wired.
- Where plan-limit samples live (app data folder), history trimming, and the pacing maths — AgentBar's
  `UsageStore.swift`, `Pacing.swift` and `StatusLineCapture.swift` are the reference behaviour.
- The status line command's form: a mode of the existing `studiomanager-mcp` sidecar or a small separate binary inside
  the app bundle.
- Panel width and height (AgentBar's panel is the reference; mockups used 340 px).
- The routine editor's layout in Settings, within DESIGN-SYSTEM.md.
- How scheduled routines run while the window is closed (they run in the app process, which keeps running in the
  menu bar).
