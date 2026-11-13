import { useT } from "../../i18n/useT";
import { useAppStore } from "../../stores/app-store";
import { Bot } from "lucide-react";
import { useOpenLinks, useItemAgents } from "../../db/hooks/useTaskAgents";
import { useAgents } from "../agents/useAgents";
import type { ItemKind } from "../../db/queries/taskAgents";
import type { TaskStage } from "../../types/task";
import { stageVariant, waitingOnYou } from "../../lib/stage";
import { Badge, IconButton } from "../ui";

type T = ReturnType<typeof useT>;

export function stageLabel(stage: TaskStage, t: T): string {
  return { briefed: t.stage_briefed, ready: t.stage_ready, running: t.stage_running, to_check: t.stage_to_check }[stage];
}

interface Props {
  kind: ItemKind;
  id: number;
  stage: TaskStage | null | undefined;
  status: string;
  /** On a subtask row the chip is a button (it opens the panel). */
  onClick?: () => void;
}

/**
 * The stage of a briefed task or subtask, as a Badge with a fixed variant per stage. Nothing
 * when there is no stage, the item is done, or Agents is off. New piece, built on Badge.
 */
export function StageChip({ stage, status, ...rest }: Props) {
  const on = useAppStore((s) => s.agentsEnabled);
  if (!on || !stage || status === "done") return null;
  return stage === "running" ? <RunningChip stage={stage} {...rest} /> : <Chip stage={stage} {...rest} />;
}

/** Only a running chip reads the agent list (a passive one: the poller keeps its pace). */
function RunningChip(props: Omit<Props, "status" | "stage"> & { stage: TaskStage }) {
  const { data: links = [] } = useOpenLinks();
  const { agents } = useAgents({ watch: false });
  return <Chip {...props} waiting={waitingOnYou({ kind: props.kind, id: props.id }, links, agents)} />;
}

function Chip({ stage, onClick, waiting = false }: Omit<Props, "status" | "stage"> & { stage: TaskStage; waiting?: boolean }) {
  const t = useT();
  const text = stageLabel(stage, t) + (waiting ? ` · ${t.stage_waiting}` : "");
  const badge = (
    <Badge variant={stageVariant(stage)} className="shrink-0">
      {text}
    </Badge>
  );
  if (!onClick) return badge;
  return (
    <button type="button" onClick={onClick} className="shrink-0 cursor-pointer">
      {badge}
    </button>
  );
}

/** The stage as a plain word before a calendar event's title. */
export function StageWord({ stage, status }: { stage: TaskStage | null | undefined; status: string }) {
  const t = useT();
  const on = useAppStore((s) => s.agentsEnabled);
  if (!on || !stage || status === "done") return null;
  return <span className="font-semibold mr-1">{stageLabel(stage, t)}</span>;
}

/**
 * A subtask row's way to its panel when the chip is not shown (no stage, or done) but a result
 * or an agent link is stored. Nothing while Agents is off or while the chip shows.
 */
export function AgentResultButton({ id, stage, status, result, onClick }: {
  id: number;
  stage: TaskStage | null | undefined;
  status: string;
  result: string | null | undefined;
  onClick: () => void;
}) {
  const t = useT();
  const on = useAppStore((s) => s.agentsEnabled);
  const { data: links = [] } = useItemAgents("subtask", id);
  if (!on || (stage && status !== "done")) return null;
  if (!result && links.length === 0) return null;
  return <IconButton size="xs" icon={Bot} label={t.task_agent_result_open} onClick={onClick} />;
}
