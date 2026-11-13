import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useT } from "../../i18n/useT";
import { useAppStore } from "../../stores/app-store";
import { useItemAgents, useWasCaptured, useSetStage, useAcceptResult } from "../../db/hooks/useTaskAgents";
import { useSetBrief } from "../../db/hooks/useCaptures";
import type { ItemKind } from "../../db/queries/taskAgents";
import type { TaskAgent } from "../../types/taskAgent";
import type { TaskStage } from "../../types/task";
import { useAgents } from "../agents/useAgents";
import { ExternalLink } from "../agents/ExternalLink";
import { formatAgo } from "../../lib/network/format";
import { Button, SECTION_LABEL, Select, Textarea } from "../ui";

type T = ReturnType<typeof useT>;

interface Item {
  id: number;
  status: string;
  stage?: TaskStage | null;
  brief?: string | null;
  result?: string | null;
}

type StepKey = "idea" | "briefed" | "running" | "to_check" | "done";

/** The step the item stands on, or null (no stage, not done, not captured). */
function currentStep(item: Item, captured: boolean): StepKey | null {
  if (item.status === "done") return "done";
  if (item.stage === "briefed" || item.stage === "ready") return "briefed";
  if (item.stage === "running" || item.stage === "to_check") return item.stage;
  return captured ? "idea" : null;
}

/**
 * The open task: progress line, stage, brief, agents and last result (mockup screen 3). Shown
 * while Agents is on and the item has a stage, a brief, a result or a link. New piece.
 */
export function TaskAgentPanel({ kind, item }: { kind: ItemKind; item: Item }) {
  const t = useT();
  const on = useAppStore((s) => s.agentsEnabled);
  const { data: links = [] } = useItemAgents(kind, item.id);
  const { data: captured = false } = useWasCaptured(kind, item.id);
  const { agents } = useAgents({ watch: false });
  const setStage = useSetStage();
  const accept = useAcceptResult();
  const setBrief = useSetBrief();
  const navigate = useNavigate();

  const stored = item.brief ?? "";
  const [draft, setDraft] = useState(stored);
  // The last text saved or loaded: only a change is written.
  const [saved, setSaved] = useState(stored);
  // The brief changed elsewhere (an agent rewrote it): start from it again.
  const [seen, setSeen] = useState(stored);
  if (seen !== stored) {
    setSeen(stored);
    setDraft(stored);
    setSaved(stored);
  }

  if (!on) return null;
  if (!item.stage && !item.brief && !item.result && links.length === 0) return null;

  const save = () => {
    if (draft === saved) return;
    setSaved(draft);
    setBrief.mutate({ kind, id: item.id, brief: draft });
  };

  const steps: { key: StepKey; label: string }[] = [
    ...(captured ? [{ key: "idea" as const, label: t.stage_idea }] : []),
    { key: "briefed", label: item.stage === "ready" ? t.stage_ready : t.stage_briefed },
    { key: "running", label: t.stage_running },
    { key: "to_check", label: t.stage_to_check },
    { key: "done", label: t.stage_done },
  ];
  const current = currentStep(item, captured);
  const handSettable = !item.stage || item.stage === "briefed" || item.stage === "ready";

  return (
    <section className="my-2 rounded-lg border border-[var(--color-border)] p-3 space-y-3" aria-label={t.task_agent_panel}>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {steps.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2">
            {i > 0 && <span aria-hidden className="text-muted">·</span>}
            <span aria-current={s.key === current ? "step" : undefined} className={s.key === current ? "font-semibold text-accent-text" : "text-muted"}>{s.label}</span>
          </li>
        ))}
      </ol>

      {item.status !== "done" && (
        <div className="flex flex-wrap items-center gap-2">
          {handSettable ? (
            <Select
              aria-label={t.stage_label}
              value={item.stage ?? ""}
              fullWidth={false}
              onChange={(e) => setStage.mutate({ kind, id: item.id, stage: (e.target.value || null) as null | "briefed" | "ready" })}
            >
              <option value="">{t.stage_none}</option>
              <option value="briefed">{t.stage_briefed}</option>
              <option value="ready">{t.stage_ready}</option>
            </Select>
          ) : item.stage === "to_check" ? (
            <>
              <Button onClick={() => accept.mutate({ kind, id: item.id })}>{t.task_agent_accept}</Button>
              <Button variant="secondary" onClick={() => setStage.mutate({ kind, id: item.id, stage: null })}>
                {t.task_agent_clear_stage}
              </Button>
            </>
          ) : (
            <span className="text-sm">{t.stage_running}</span>
          )}
        </div>
      )}

      <div>
        <h3 className={SECTION_LABEL}>{t.task_agent_brief}</h3>
        <Textarea
          className="mt-1"
          aria-label={t.task_agent_brief}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              save();
            }
          }}
        />
      </div>

      {links.length > 0 && (
        <div>
          <h3 className={SECTION_LABEL}>{t.task_agent_agents}</h3>
          <ul className="mt-1 space-y-1">
            {links.map((l) => {
              const live = agents.find((a) => (l.session_id ? a.sessionId === l.session_id : a.shortId === l.short_id));
              return (
                <li key={l.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="font-medium">{l.name}</span>
                  <span className="text-xs text-muted">{linkState(l, live?.group, t)}</span>
                  {l.model && <span className="text-xs text-muted">{l.model}</span>}
                  {l.branch && <span className="text-xs text-muted">{l.branch}</span>}
                  {l.pr_url && (
                    <ExternalLink href={l.pr_url} className="text-xs text-accent-text hover:underline">
                      {l.pr_url}
                    </ExternalLink>
                  )}
                  <Button
                    variant="secondary"
                    className="ml-auto"
                    onClick={() => navigate(l.session_id ? `/agents?agent=${l.session_id}` : `/agents?started=${l.short_id}`)}
                  >
                    {t.task_agent_open}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div>
        <h3 className={SECTION_LABEL}>{t.task_agent_result}</h3>
        {item.result ? (
          <p className="mt-1 text-sm whitespace-pre-wrap">{item.result}</p>
        ) : (
          <p className="mt-1 text-sm text-muted">{t.task_agent_no_result}</p>
        )}
      </div>
    </section>
  );
}

function linkState(l: TaskAgent, group: string | undefined, t: T): string {
  if (l.ended_at) {
    if (l.outcome === "no_result") return t.task_agent_ended_no_result;
    // SQLite writes UTC as "YYYY-MM-DD HH:MM:SS".
    const ago = formatAgo(l.ended_at.replace(" ", "T") + "Z", Date.now(), t);
    return t.task_agent_finished.replace("{ago}", ago);
  }
  return group === "needs-you" ? t.stage_waiting : t.task_agent_working;
}
