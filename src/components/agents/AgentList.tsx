import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { Agent, Group } from "../../lib/agents";
import { agentGroupDotClass, agentGroupTextClass } from "../../lib/statusColors";
import { Badge, ICON_SIZE, SECTION_LABEL } from "../ui";
import { useT } from "../../i18n/useT";
import type { UIKey } from "../../i18n/ui";
import { GROUPS } from "./useAgents";
import { MODEL_LABELS } from "./ModelMenu";

const GROUP_KEYS: Record<Group, UIKey> = {
  "needs-you": "agents_group_needs_you",
  working: "agents_group_working",
  idle: "agents_group_idle",
  done: "agents_group_done",
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
  /** Smaller rows for the menu bar panel: no project line for idle and done agents. */
  compact?: boolean;
  /** Content under a row, outside its button (the panel's inline prompt answer). */
  renderExtra?: (agent: Agent) => ReactNode;
}

const FOLDED_KEY = "agents.foldedGroups";

/** Folded groups, remembered on this Mac. Done starts folded. */
function readFolded(): Set<Group> {
  try {
    const raw = localStorage.getItem(FOLDED_KEY);
    if (raw) return new Set(JSON.parse(raw) as Group[]);
  } catch {
    // Unreadable or unavailable storage: fall back to the default.
  }
  return new Set<Group>(["done"]);
}

export function AgentList({ byGroup, selectedId, onSelect, compact, renderExtra }: AgentListProps) {
  const t = useT();
  const [folded, setFolded] = useState<Set<Group>>(readFolded);
  const toggle = (g: Group) =>
    setFolded((cur) => {
      const next = new Set(cur);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      try {
        localStorage.setItem(FOLDED_KEY, JSON.stringify([...next]));
      } catch {
        // Storage unavailable: the choice lasts for this session only.
      }
      return next;
    });

  // Flat rows like a Table: each group opens with a group row (as Table.Group: chevron,
  // SectionLabel, muted count) over the header line, agents are rows with hairlines.
  return (
    <nav className={`flex-1 overflow-y-auto space-y-3 ${compact ? "px-2 py-2" : ""}`}>
      {GROUPS.filter((g) => byGroup[g].length > 0).map((g) => {
        const open = !folded.has(g);
        // The selected agent stays visible even when its group is folded.
        const shown = open ? byGroup[g] : byGroup[g].filter((a) => a.sessionId === selectedId);
        return (
          <section key={g}>
            <h2 className="h-8 flex items-center border-b border-[var(--color-border)] hover:bg-[var(--color-hover-row)]">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => toggle(g)}
                className="focus-accent w-full h-full flex items-center gap-2 px-2 rounded text-left cursor-pointer"
              >
                <ChevronRight size={ICON_SIZE.control} className={`shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`} />
                <span className={`dot ${agentGroupDotClass(g)}`} aria-hidden />
                <span className={`truncate ${SECTION_LABEL}`}>{t[GROUP_KEYS[g]]}</span>
                <span className="text-xs text-muted tabular-nums">{byGroup[g].length}</span>
              </button>
            </h2>
            {shown.length > 0 && (
              <ul>
                {shown.map((a) => {
                  const selected = a.sessionId === selectedId;
                  const model = a.modelLabel ?? (a.model && MODEL_LABELS[a.model]) ?? a.model;
                  return (
                    <li key={a.sessionId} className="border-b border-[var(--color-border-divider)]">
                      <button
                        type="button"
                        onClick={() => onSelect(a.sessionId)}
                        aria-current={selected || undefined}
                        className={`w-full text-left px-2 ${compact ? "py-1.5" : "py-2"} space-y-0.5 transition-colors focus-accent ${
                          selected ? "bg-accent-tint" : "hover:bg-[var(--color-hover-row)]"
                        }`}
                      >
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <span className="truncate">{a.name}</span>
                          {model && <span className="shrink-0 text-xs font-normal text-muted">{model}</span>}
                          {a.quiet && <Badge variant="neutral">{t.agents_quiet}</Badge>}
                        </div>
                        {/* One second line: what the agent waits for, in its status colour, else its project. */}
                        {a.waitingFor ? (
                          <div className={`text-xs truncate ${agentGroupTextClass(g)}`}>{a.waitingFor}</div>
                        ) : (
                          !(compact && (g === "idle" || g === "done")) && (
                            <div className="text-xs text-muted truncate">{agentLabel(a)}</div>
                          )
                        )}
                      </button>
                      {renderExtra?.(a)}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </nav>
  );
}
