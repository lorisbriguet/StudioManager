/**
 * What an agent write can change on screen. The MCP server logs each write
 * with its tool name (`agent-log.jsonl`), and the `db-changed` event carries
 * the tools seen since the last one. Each tool maps to the query keys the
 * app's own mutation of the same data invalidates, plus the views built on
 * top of it. A tool missing here refreshes every query, so a new server tool
 * never leaves stale data on screen.
 */

const PROJECTS = ["projects", "workload-rows", "workload-config", "client-activity"];
const TASKS = ["tasks", "subtasks", "workload-rows", "projects"];
const WIKI = [
  "wiki-folders", "wiki-articles", "wiki-article", "wiki-articles-by-project",
  "wiki-tags", "wiki-article-tags",
];
const RESOURCES = ["resources", "resource-tags"];
const MACHINES = ["machines", "upkeep-items", "service-log", "machine-links", "consumables"];
const UPKEEP = ["upkeep-items", "machines", "service-log"];
const CONSUMABLES = ["consumables", "project-material-cost"];
const SUBSCRIPTIONS = ["subscriptions", "subscription-renewals"];

const TOOL_KEYS: Record<string, readonly string[]> = {
  link_folder: PROJECTS,
  create_project: [...PROJECTS, "clients"],
  update_project: [...PROJECTS, ...TASKS],
  create_task: TASKS,
  update_task: TASKS,
  create_subtask: TASKS,
  update_subtask: TASKS,
  create_client: ["clients"],
  put_wiki_article: WIKI,
  add_decision: WIKI,
  link_tool: RESOURCES,
  create_machine: MACHINES,
  update_machine: MACHINES,
  add_service_log: UPKEEP,
  add_machine_link: ["machine-links", "machines"],
  add_upkeep_item: UPKEEP,
  mark_upkeep_done: UPKEEP,
  create_consumable: CONSUMABLES,
  update_consumable: CONSUMABLES,
  create_subscription: SUBSCRIPTIONS,
  update_subscription: SUBSCRIPTIONS,
};

/** Tools whose writes can add or move an Apple Calendar event. */
const CALENDAR_TOOLS = new Set([
  "create_machine", "update_machine", "add_upkeep_item", "mark_upkeep_done",
  "create_subscription", "update_subscription",
]);

/**
 * The query key roots to invalidate for these tools, or `null` for "refresh
 * everything" (no tool list, or a tool this map does not know).
 */
export function keysForTools(tools: readonly string[] | null): string[] | null {
  if (tools === null) return null;
  const keys = new Set<string>();
  for (const tool of tools) {
    const k = TOOL_KEYS[tool];
    if (!k) return null;
    for (const key of k) keys.add(key);
  }
  return [...keys];
}

/** Whether the upkeep calendar sync has anything to do after these tools. */
export function touchesCalendar(tools: readonly string[] | null): boolean {
  return tools === null || tools.some((t) => CALENDAR_TOOLS.has(t) || !(t in TOOL_KEYS));
}
