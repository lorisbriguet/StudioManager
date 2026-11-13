/**
 * Starting an agent on a task, subtask or project ("Start work with agent"):
 * the item lookup, the prompt, the name and the trust check. The flow itself
 * is `useStartAgentOn` (src/hooks). Design: docs/superpowers/specs/2026-11-05-agent-from-task-design.md
 */
import { getProject } from "../db/queries/projects";
import { getSubtaskById, getTaskById } from "../db/queries/tasks";
import { confirm } from "./confirm";
import { getLabels } from "./notify";
import { isInside, type StartFolder } from "./agents";
import { ICONS } from "../components/ui/icons";
import type { ContextMenuItem } from "../components/ui/ContextMenu";

export type AgentKind = "task" | "subtask" | "project";

export interface AgentTarget {
  kind: AgentKind;
  id: number;
}

export interface AgentItem {
  kind: AgentKind;
  id: number;
  title: string;
  /** A subtask's task. */
  task?: { id: number; title: string };
  project: { id: number; name: string; folder: string | null };
  orgId: string;
}

const ASK = "Then tell me briefly what you found and ask me what to do. Don't change anything before I answer. ";
const FALLBACK = "If the StudioManager tools aren't available, say so and ask me to describe the work.";
const TAIL = ASK + FALLBACK;
/** For a task or subtask: its agent is linked to it, and the result shows on the item. */
const REPORT =
  "When the work is done, or you stop with work left, call report_result once with what was done, " +
  "what is left open and how to check it, and the branch and pull request link if there are any. ";

/** The agent's first message: what to work on, read it first, ask before acting. */
export function agentPrompt(item: AgentItem): string {
  const p = item.project;
  const org = `organisation ${item.orgId}`;
  if (item.kind === "project") {
    return (
      `Work on StudioManager project ${p.id} "${p.name}" (${org}). ` +
      "First read it and its context with the StudioManager tools: the project, its open tasks and its wiki. " +
      TAIL
    );
  }
  const parents = [
    item.task ? `task ${item.task.id} "${item.task.title}"` : null,
    `project ${p.id} "${p.name}"`,
    org,
  ].filter(Boolean);
  return (
    `Work on StudioManager ${item.kind} ${item.id} "${item.title}" (${parents.join(", ")}). ` +
    "First read it and its context with the StudioManager tools: the task, its brief, its subtasks and notes, the project and its wiki. " +
    ASK +
    REPORT +
    FALLBACK
  );
}

/** `task-44-new-features`: kind, id, then the title as lowercase ASCII words; at most 64 characters. */
export function agentName(item: AgentItem): string {
  const words = item.title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const name = words ? `${item.kind}-${item.id}-${words}` : `${item.kind}-${item.id}`;
  return name.slice(0, 64).replace(/-+$/, "");
}

/** Claude Code trusts `folder`: it is inside a start folder marked trusted. */
export function isTrustedFolder(folder: string, list: StartFolder[]): boolean {
  return list.some((f) => f.trusted && isInside(folder, f.path));
}

/** `folder` is the home folder (trusting it trusts every folder in it). */
export function isHomeFolder(folder: string, list: StartFolder[]): boolean {
  return list.some((f) => f.home && isInside(f.path, folder) && isInside(folder, f.path));
}

/** Ask before trusting a folder for Claude Code; shared with the start form. */
export async function confirmTrust(folder: string, home: boolean): Promise<boolean> {
  const t = getLabels();
  return (
    (await confirm({
      title: t.agents_trust_title.replace("{folder}", folder),
      message: home ? t.agents_trust_home_message : t.agents_trust_message,
      confirmLabel: t.agents_trust_confirm,
      tone: home ? "danger" : "default",
    })) === true
  );
}

/** The item with its parents and its project's current folder, read fresh. Null when gone. */
export async function loadAgentItem(target: AgentTarget, orgId: string): Promise<AgentItem | null> {
  let title: string;
  let task: AgentItem["task"];
  let projectId: number;
  if (target.kind === "subtask") {
    const s = await getSubtaskById(target.id);
    if (!s) return null;
    const tk = await getTaskById(s.task_id);
    if (!tk) return null;
    title = s.title;
    task = { id: tk.id, title: tk.title };
    projectId = tk.project_id;
  } else if (target.kind === "task") {
    const tk = await getTaskById(target.id);
    if (!tk) return null;
    title = tk.title;
    projectId = tk.project_id;
  } else {
    projectId = target.id;
    title = "";
  }
  const p = await getProject(projectId);
  if (!p) return null;
  return {
    kind: target.kind,
    id: target.id,
    title: target.kind === "project" ? p.name : title,
    task,
    project: { id: p.id, name: p.name, folder: p.folder_path || null },
    orgId,
  };
}

/** The "Start work with agent" menu entry, or none while agents are off. Spread into a menu's items. */
export function agentMenuItems(
  enabled: boolean,
  start: (target: AgentTarget) => unknown,
  target: AgentTarget,
): ContextMenuItem[] {
  if (!enabled) return [];
  return [{ label: getLabels().agents_start_work, icon: ICONS.agents, onClick: () => void start(target) }];
}

/** What a calendar event's agent item works on: task, subtask, or a deadline's project. Null for the rest. */
export function calendarAgentTarget(props: Record<string, unknown>): AgentTarget | null {
  const id = props.itemId;
  if (typeof id !== "number") return null;
  if (props.type === "task") return { kind: "task", id };
  if (props.type === "subtask") return { kind: "subtask", id };
  if (props.type === "deadline") return { kind: "project", id };
  return null;
}
