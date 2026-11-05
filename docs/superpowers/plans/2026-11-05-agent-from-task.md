# Start an Agent from a Task Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Start work with agent" right-click item on tasks, subtasks, projects and calendar events that starts an Opus agent in the project's folder with a fixed "read it, then ask me" prompt, in one click.

**Architecture:** Pure builders (item lookup, prompt, name, trust check) in `src/lib/agentStart.ts`; one hook `useStartAgentOn()` runs the flow (lookup → folder → trust → start → navigate) and is called by every menu with `{ kind, id }`. The start form's trust confirmation moves to the same file so both share it. The Agents page selects the new agent from a `?started=<shortId>` parameter.

**Tech Stack:** React 19 + TypeScript, TanStack Query, Tauri invoke, Vitest + Testing Library, FullCalendar.

**Spec:** [2026-11-05-agent-from-task-design.md](../specs/2026-11-05-agent-from-task-design.md)

## Global Constraints

- Model is always `"opus"`.
- Hidden while `useAppStore((s) => s.agentsEnabled)` is false (also before it loads).
- Reuse `ContextMenu`, `useConfirm`, `notify`, `ICONS.agents` (lucide `Bot`); no new UI component.
- Labels in `src/i18n/ui.ts`, EN and FR. No emojis.
- Name: `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` (the start form's `NAME_RE`).
- Prompt must not start with `-` and must not be empty.
- Errors: the start form's existing labels `t.agents_start_failed`, `t.agents_folders_load_failed`, plus the existing trust-failure label used by the form.

## Review Focus

- A project with no folder whose picker is cancelled: nothing starts, nothing is saved, no toast. (Test in Task 2.)
- Titles with accents, quotes, emoji-free punctuation or 200 characters: the name stays valid and the prompt keeps the title verbatim. (Test in Task 1.)
- A double right-click start on the same item while the first is running: only one `agents_start`. (Test in Task 2.)
- A folder linked elsewhere since the page loaded: the hook reads it fresh (`getProject`), no picker. (Test in Task 2.)
- Calendar right-click on invoice/quote/upkeep/renewal events opens no menu and doesn't block the browser default. (Test in Task 4.)

---

### Task 1: Builders in `src/lib/agentStart.ts`

**Files:**
- Create: `src/lib/agentStart.ts`
- Test: `src/__tests__/agentStart.test.ts`

**Interfaces:**
- Produces:
  - `type AgentTarget = { kind: "task" | "subtask" | "project"; id: number }`
  - `interface AgentItem { kind: AgentTarget["kind"]; id: number; title: string; task?: { id: number; title: string }; project: { id: number; name: string; folder: string | null }; orgId: string }`
  - `agentPrompt(item: AgentItem): string`
  - `agentName(item: AgentItem): string`
  - `isTrustedFolder(folder: string, list: StartFolder[]): boolean` — true when inside an entry with `trusted: true`
  - `isHomeFolder(folder: string, list: StartFolder[]): boolean` — an entry with `home: true` and the same path
  - `loadAgentItem(target: AgentTarget, orgId: string): Promise<AgentItem | null>` — via `getSubtaskById`, `getTaskById`, `getProject` (fresh reads)
  - `confirmTrust(confirm: ConfirmFn, t: Labels, folder: string, home: boolean): Promise<boolean>` — the exact confirm call now in `StartAgentForm.submit` (title `t.agents_trust_title` with `{folder}`, home message + `tone: "danger"` for home)

- [ ] **Step 1: Write failing tests**
  - `agentPrompt` for a subtask equals exactly:
    `Work on StudioManager subtask 297 "Start an agent from a task" (task 44 "New Features", project 4 "Studio Manager App", organisation 6kun0b). First read it and its context with the StudioManager tools: the task, its subtasks and notes, the project and its wiki. Then tell me briefly what you found and ask me what to do. Don't change anything before I answer. If the StudioManager tools aren't available, say so and ask me to describe the work.`
  - For a task: `Work on StudioManager task 44 "New Features" (project 4 "Studio Manager App", organisation 6kun0b). First read it and its context …` (same tail as above).
  - For a project: `Work on StudioManager project 4 "Studio Manager App" (organisation 6kun0b). First read it and its context with the StudioManager tools: the project, its open tasks and its wiki. Then …` (same tail).
  - `agentName`: subtask 297 → `subtask-297-start-an-agent-from-a-task`; task 44 → `task-44-new-features`; project 4 → `project-4-studio-manager-app`; title `Révision « Café » d'été` → `task-1-revision-cafe-d-ete`; a 200-char title → length ≤ 64, matches `NAME_RE`, no trailing `-`; empty title → `task-1`.
  - `isTrustedFolder("/a/b/c", [{path:"/a/b",trusted:true,…}])` true; untrusted entry → false; empty list → false.
- [ ] **Step 2:** Run `npx vitest run src/__tests__/agentStart.test.ts` — FAIL (module missing).
- [ ] **Step 3:** Implement. Name: `normalize("NFD")`, strip combining marks, lowercase, `[^a-z0-9]+` → `-`, trim `-`, prefix `${kind}-${id}`, slice to 64, trim trailing `-`.
- [ ] **Step 4:** Rerun — PASS.
- [ ] **Step 5:** Switch `StartAgentForm.submit` to `confirmTrust(...)`; run `npx vitest run src/__tests__/agentsPage.test.tsx` — PASS. Commit `feat(agents): prompt, name and trust helpers for starting from a task`.

### Task 2: `useStartAgentOn()` hook + Agents page `?started=`

**Files:**
- Create: `src/hooks/useStartAgentOn.ts`
- Modify: `src/pages/AgentsPage.tsx` (read `started` like `new`, set `pendingShortId`, drop the param)
- Test: `src/__tests__/useStartAgentOn.test.tsx`

**Interfaces:**
- Consumes: Task 1; `startFolders`, `trustFolder`, `startAgent` from `src/lib/agents`; `useUpdateProject()`; `open` from `@tauri-apps/plugin-dialog`; `useOrgStore.getState().activeId`.
- Produces: `useStartAgentOn(): { enabled: boolean; start: (target: AgentTarget) => Promise<void> }`

Flow: in-flight guard (module-level `Set` of `${kind}-${id}`) → `loadAgentItem` (null → return) → folder = `project.folder` or picker (`title: t.agents_choose_folder`; cancel → return; else `updateProject.mutateAsync({ id, data: { folder_path: dir } })`) → `startFolders()` (fail → `notify.error(t.agents_folders_load_failed, e)`) → untrusted: `confirmTrust` (no → return) then `trustFolder` (fail → the form's trust error label) → `startAgent(folder, agentPrompt, "opus", agentName)` (fail → `notify.error(t.agents_start_failed, e)`) → `navigate("/agents?started=" + shortId)`.

- [ ] **Step 1: Write failing tests** (mock invoke with `setInvokeHandler`, wrap in MemoryRouter + QueryClientProvider + ConfirmHost):
  - linked + trusted: one `agents_start` with `{ folder: "/work/proj", model: "opus", name: "task-44-…", task: <prompt> }`, navigates to `/agents?started=abcd1234`.
  - no folder, picker returns `/new/dir`: project updated with `folder_path: "/new/dir"`, then started there.
  - no folder, picker cancelled: no update, no `agents_start`.
  - untrusted: confirm shown; decline → no `agents_trust_folder`, no start; accept → trust then start.
  - `agents_start` rejects → error toast with `agents_start_failed`, no navigation.
  - two `start()` calls without awaiting → one `agents_start`.
  - Agents page with `?started=abcd1234` selects the agent once it is listed.
- [ ] **Step 2:** Run `npx vitest run src/__tests__/useStartAgentOn.test.tsx` — FAIL.
- [ ] **Step 3:** Implement hook and the AgentsPage param.
- [ ] **Step 4:** Rerun — PASS. Commit `feat(agents): start an agent on a task, subtask or project`.

### Task 3: Menu items on Tasks, Projects and the project Tasks section

**Files:**
- Modify: `src/i18n/ui.ts` — `agents_start_work`: EN `"Start work with agent"`, FR `"Démarrer avec un agent"`
- Modify: `src/pages/TasksPage.tsx` (task, subtask, header menus), `src/pages/ProjectsPage.tsx`, `src/components/project/ProjectTasksSection.tsx`
- Test: `src/__tests__/startAgentMenus.test.tsx`

**Interfaces:** Consumes `useStartAgentOn()`.

- Existing menus: add `{ label: t.agents_start_work, icon: ICONS.agents, onClick: () => start({ kind, id }) }` after the "open" entries, only when `enabled` (spread conditionally).
- ProjectTasksSection has no row menu: add `ContextMenuState<AgentTarget>` + `onContextMenu` on the task row div (`group/task`) and on `SortableSubtaskRow`'s content, attached only when `enabled` (otherwise no handler, browser default stays). The menu holds the one item.

- [ ] **Step 1:** Failing tests: on TasksPage, right-click a task row → item present with agents on, absent with agents off; clicking it calls `start` with `{kind:"task",id}` (mock the hook). Same for ProjectTasksSection subtask row.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS. Commit `feat(agents): "Start work with agent" in task and project menus`.

### Task 4: Calendar menu

**Files:**
- Modify: `src/pages/CalendarPage.tsx`
- Test: `src/__tests__/calendarAgentMenu.test.tsx` (unit-test the extracted handler, FullCalendar is hard to drive)

- Extract `calendarAgentTarget(props: Record<string, unknown>): AgentTarget | null` (task → task, subtask → subtask, deadline → project; else null) in `src/lib/agentStart.ts`.
- `eventDidMount`: when `enabled` and the target is not null, `el.addEventListener("contextmenu", …)` with `preventDefault` and setting `ContextMenuState`; remove it in `eventWillUnmount` (keep the handler on the element, e.g. a WeakMap). Menu: "Open" (`t.view_details`, calls `handleEventClick({ event })`) and `t.agents_start_work`.

- [ ] **Step 1:** Failing test: `calendarAgentTarget` for all seven event types (task, subtask, deadline map; invoice, quote, upkeep, renewal → null).
- [ ] **Step 2–4:** Run FAIL, implement, run PASS. Commit `feat(agents): start an agent from a calendar event`.

### Task 5: Docs and full check

- Modify: `docs/agents.md` — section "Start from a task": where the item is, Opus, the folder rules (linked, picked and saved, trust), the agent reads and asks first, a second click starts a new agent. Link the [design](../specs/2026-11-05-agent-from-task-design.md) relative to that file (`superpowers/specs/2026-11-05-agent-from-task-design.md`).
- Add the plan link to the spec header.
- [ ] Run `npx tsc --noEmit`, `npx vitest run`, `npm run lint` (if present) — all pass. Commit `docs(agents): start from a task`.
