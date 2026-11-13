import type { BadgeVariant } from "../components/ui/Badge";
import type { Agent } from "./agents";
import type { OpenLink } from "../db/queries/taskAgents";
import type { TaskStage } from "../types/task";

/** One fixed Badge variant per stage. */
export function stageVariant(stage: TaskStage): BadgeVariant {
  switch (stage) {
    case "briefed":
      return "neutral";
    case "ready":
      return "info";
    case "running":
      return "accent";
    case "to_check":
      return "warning";
  }
}

/** The item has an open link whose agent is waiting for an answer (group needs-you). */
export function waitingOnYou(
  item: { kind: OpenLink["kind"]; id: number },
  openLinks: OpenLink[],
  agents: Agent[],
): boolean {
  return openLinks.some(
    (l) =>
      l.kind === item.kind &&
      l.item_id === item.id &&
      agents.some(
        (a) => a.group === "needs-you" && (l.session_id ? a.sessionId === l.session_id : a.shortId === l.short_id),
      ),
  );
}
