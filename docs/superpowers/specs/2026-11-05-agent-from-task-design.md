# Start an agent from a task — design

Date: 2026-11-05 · Status: draft, for Loris's review. StudioManager subtask 297 (task 44, New Features).

Built on [DESIGN-SYSTEM.md](../../../DESIGN-SYSTEM.md). Extends the Agents page of the
[agents window design](2026-10-28-agents-window-design.md) (user guide: [Agents](../../agents.md)). The agent reads
StudioManager through [Agent access](../../agent-access.md) ([design](2026-10-27-agent-access-mcp-design.md)).

Decisions marked *[call]* were made by the designer from the conversation and the code; Loris can overturn any.
Everything else was said by Loris.

## Why

Starting an agent on a piece of work takes five steps today: copy the task, open Agents > New agent, pick the
folder, paste the task with a few lines on what to do, start. Loris does this often, and the extra lines are always
different ("what the agent should do for this task"), so a template wouldn't help.

The new flow is **one click**. The agent gets a short prompt that names the item, reads the item and its context
itself through the StudioManager tools, then **asks Loris in the Agents page** what to do. Typing the instructions
up front becomes answering the agent's questions.

## Goals

1. A **"Start work with agent"** item in the right-click menu of:
   - task rows, subtask rows and project group headers on the **Tasks page**;
   - project rows on the **Projects page**;
   - task and subtask rows in a project's **Tasks section** (project detail);
   - **task, subtask and project-deadline events on the Calendar page**. Left-click on an event keeps
     opening it as today. Invoice, quote, upkeep and renewal events don't get the item.
2. Hidden everywhere while agents are switched off (`agentsEnabled` in the app store).
3. One click starts the agent with no form: folder, prompt, model and name are all set by the app.
4. After starting, the app opens the Agents page on the new agent.

## Non-goals

- No form, extra prompt field or model picker at start. The model can still be switched on the agent afterwards
  (existing model menu).
- The app doesn't gather the task's notes, subtasks or wiki into the prompt: the agent reads what it needs.
- No link stored between an agent and the task it was started from (no badge on the task, no "agents on this
  task" list). *[call]* Can come later.
- Left-click behaviour doesn't change anywhere.

## Anti-goals

- An agent that starts changing things before Loris says what to do.
- A dialog or confirmation in the common case (linked, trusted folder): it must be one click.

## How it works

### Folder

- The **project's linked folder** (`projects.folder_path`). For a task or subtask, its project's folder.
- **No linked folder:** the system folder picker opens (same picker and title as the start form's "Choose
  folder"). The chosen folder is **saved as the project's linked folder** (the same update the project detail's
  folder button makes), then the start goes on. Cancelling the picker stops quietly.
- **Folder not trusted by Claude Code:** the same trust confirmation as the start form (title, message, the danger
  tone for the home folder), then `trustFolder`. Declining stops quietly. The trust check uses the same data as the
  start form *[call]*: the folder is trusted when it is inside a `startFolders()` entry marked trusted; otherwise it
  is untrusted and the confirmation shows. If `startFolders()` fails, the start stops with the start form's
  "couldn't list the folders" error toast.
- **Folder missing on disk:** the start fails with the start form's error toast *[call]*.

### Model

Opus (`"opus"`), always.

### Prompt

A fixed prompt, built by the app, in English *[call]* (agents are prompted in English; Loris answers in either
language). It names the item with its kind, title and ids, its parents, and the organisation, then tells the agent
to read it first and ask before acting. For a subtask, for example:

> Work on StudioManager subtask 297 "Start an agent from a task" (task 44 "New Features", project 4 "Studio Manager
> App", organisation 6kun0b). First read it and its context with the StudioManager tools: the task, its subtasks
> and notes, the project and its wiki. Then tell me briefly what you found and ask me what to do. Don't change
> anything before I answer. If the StudioManager tools aren't available, say so and ask me to describe the work.

For a task the subtask part is left out. For a project it reads "Work on StudioManager project 4 …" and the agent
is asked to read the project, its open tasks and its wiki. The titles are in the prompt so the agent still knows
what it is about when Agent access is off *[call]*.

The prompt must pass the start's existing check (not empty, doesn't start with `-`).

### Name

Built from the item: `subtask-297-start-an-agent-from-a-task`, `task-44-new-features`, `project-4-studio-manager-app`
*[call]*. Lowercase, non `[a-z0-9]` runs become `-`, accents dropped, trimmed to the 64 characters allowed by the
start form's name rule.

Starting again on an item that already has an agent (working or finished) **always starts a new agent**, with the
same name. The start's existing timeout recovery only looks at agents started since the click, so it never picks
the older one.

### After starting

`startAgent` resolves to the agent's short id. The app navigates to the Agents page, which selects the agent once it
shows in the list (the page's existing "pending short id" behaviour, reached through a URL parameter such as
`/agents?started=<shortId>` *[call]*). If the start fails, an error toast with the start form's message; nothing
else changes.

While a start is running, a second click on the same item does nothing *[call]* (no double start).

## Code shape *[call]*

- One shared helper (a hook, e.g. `useStartAgentOn()`) does lookup → folder → trust → prompt → name →
  `startAgent` → navigate. Every menu calls it with only `{ kind, id }`. The helper reads the item, its parents
  and the project's current `folder_path` fresh from the database (not from a page's cached list), so a folder
  linked or unlinked elsewhere is never stale. The organisation is the active one (tasks and projects belong to the
  open organisation's database). The flow lives in one place and is tested once.
- Saving a picked folder goes through the existing project update, so the project query caches are invalidated
  and Projects and the project detail show the new folder.
- The trust and folder-picking logic now inside `StartAgentForm` moves to shared functions that both use, rather
  than being copied.
- Menu items reuse the existing `ContextMenu` / `MenuItem` components and an existing lucide icon (e.g. the one
  the Agents nav item uses). The Calendar has no right-click menu yet: it gets the same `ContextMenu`, opened from
  the event element's `contextmenu` event (attached when the event mounts), with two items: "Open" (what left-click
  does) and "Start work with agent" *[call]*. Events inside the "+N more" popover get it too if FullCalendar mounts
  them the same way; nothing extra is required there. Drag and resize are unchanged.
- The item is hidden while `agentsEnabled` is false, which includes before the switch is loaded at startup.
- All new labels go through `src/i18n/ui.ts` in English and French.

## Constraints

- Reuse first (see the "Reuse First" section of [DESIGN-SYSTEM.md](../../../DESIGN-SYSTEM.md)): no new menu, toast
  or dialog component. The report lists what was reused, derived and new.
- No emojis, lucide icons only.
- Tests: the prompt and name builders (unit), the helper's branches (linked/trusted, no folder → saved, untrusted
  → confirm, cancel, failure), and one menu per surface showing/hiding the item with the agents switch.
- The user guide [Agents](../../agents.md) gets a short "Start from a task" section.

## Left to the builder

- Exact menu position (suggested: near the top, after "Open"), separators, and the icon.
- Where the shared helper and prompt builder files live.
- How the Agents page reads the "started" parameter, as long as the new agent ends up selected.
