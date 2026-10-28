import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Agent, Group } from "../../lib/agents";
import { useT } from "../../i18n/useT";
import type { UIKey } from "../../i18n/ui";
import { Badge, type BadgeVariant } from "../ui/Badge";
import { GROUPS } from "./useAgents";

const GROUP_KEYS: Record<Group, UIKey> = {
  "needs-you": "agents_group_needs_you",
  working: "agents_group_working",
  idle: "agents_group_idle",
  done: "agents_group_done",
};

/** One colour per group, from the app's status tokens (light and dark aware). */
export const GROUP_STYLE: Record<Group, { dot: string; text: string; row: string }> = {
  "needs-you": {
    dot: "bg-warning",
    text: "text-[var(--color-warning-text)]",
    row: "bg-[var(--color-warning-bg)]",
  },
  working: {
    dot: "bg-[var(--color-info-text)] animate-pulse",
    text: "text-[var(--color-info-text)]",
    row: "",
  },
  idle: {
    dot: "bg-[var(--color-text-secondary)] opacity-40",
    text: "text-muted",
    row: "",
  },
  done: {
    dot: "bg-success",
    text: "text-[var(--color-success-text)]",
    row: "",
  },
};

/** Badge variant per group (count pill, detail status). */
export const GROUP_VARIANT: Record<Group, BadgeVariant> = {
  "needs-you": "warning",
  working: "info",
  idle: "neutral",
  done: "success",
};

export const GROUP_LABEL_KEYS = GROUP_KEYS;

function folderName(cwd: string): string {
  return cwd.split("/").filter(Boolean).pop() ?? cwd;
}

export function agentLabel(a: Agent): string {
  const p = a.project;
  return p ? `${p.orgName} › ${p.clientName} › ${p.projectName}` : folderName(a.cwd);
}

interface AgentListProps {
  byGroup: Record<Group, Agent[]>;
  selectedId: string | null;
  onSelect: (sessionId: string) => void;
}

const DONE_COLLAPSED_KEY = "agents.doneCollapsed";

function readDoneCollapsed(): boolean {
  try {
    return localStorage.getItem(DONE_COLLAPSED_KEY) !== "false";
  } catch {
    return true;
  }
}

export function AgentList({ byGroup, selectedId, onSelect }: AgentListProps) {
  const t = useT();
  // Done starts folded; the choice is remembered on this Mac.
  const [doneCollapsed, setDoneCollapsed] = useState(readDoneCollapsed);
  const toggleDone = () =>
    setDoneCollapsed((c) => {
      try {
        localStorage.setItem(DONE_COLLAPSED_KEY, String(!c));
      } catch {
        // Storage unavailable: the choice lasts for this session only.
      }
      return !c;
    });

  return (
    <div className="flex-1 overflow-y-auto">
      {GROUPS.filter((g) => byGroup[g].length > 0).map((g) => {
        const collapsible = g === "done";
        // A selected done agent stays visible even when the group is folded.
        const shown = collapsible && doneCollapsed ? byGroup[g].filter((a) => a.sessionId === selectedId) : byGroup[g];
        const heading = (
          <>
            <span className={`dot ${GROUP_STYLE[g].dot}`} aria-hidden />
            <h2 className={`text-[10px] font-medium uppercase tracking-widest ${GROUP_STYLE[g].text}`}>{t[GROUP_KEYS[g]]}</h2>
            <Badge variant={GROUP_VARIANT[g]} className="ml-auto">{byGroup[g].length}</Badge>
          </>
        );
        return (
        <section key={g} className="mb-4">
          {collapsible ? (
            <button
              type="button"
              aria-expanded={!doneCollapsed}
              onClick={toggleDone}
              className="w-full px-3 py-1.5 mb-0.5 flex items-center gap-2 rounded-md transition-colors hover:bg-[var(--color-hover-row)]"
            >
              <ChevronRight size={12} className={`-ml-1 text-muted transition-transform ${doneCollapsed ? "" : "rotate-90"}`} />
              {heading}
            </button>
          ) : (
            <div className="px-3 py-1.5 mb-0.5 flex items-center gap-2">{heading}</div>
          )}
          <ul className="space-y-px">
            {shown.map((a) => (
              <li key={a.sessionId}>
                <button
                  type="button"
                  onClick={() => onSelect(a.sessionId)}
                  aria-current={a.sessionId === selectedId || undefined}
                  className={`w-full text-left px-3 py-2.5 rounded-md transition-colors focus-accent ${
                    a.sessionId === selectedId
                      ? "bg-accent-light"
                      : `${GROUP_STYLE[g].row} hover:bg-[var(--color-hover-row)]`
                  }`}
                >
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className={`shrink-0 dot-sm ${GROUP_STYLE[g].dot}`} aria-hidden />
                    <span className="truncate">{a.name}</span>
                    {a.model && <span className="text-xs font-normal text-muted">{a.model}</span>}
                    {a.quiet && (
                      <Badge variant="neutral">{t.agents_quiet}</Badge>
                    )}
                  </div>
                  <div className="pl-3.5 text-xs text-muted truncate">{agentLabel(a)}</div>
                  {a.waitingFor && (
                    <div className={`pl-3.5 text-xs font-medium truncate ${GROUP_STYLE[g].text}`}>
                      {a.waitingFor}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
        );
      })}
    </div>
  );
}
