import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { Agent, Group } from "../../lib/agents";
import { agentGroupDotClass, agentGroupTextClass, agentGroupVariant } from "../../lib/statusColors";
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

/** The needs-you row is tinted; the others stay plain. */
const NEEDS_YOU_ROW = "bg-[var(--color-warning-bg)]";

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

  return (
    <nav className={`flex-1 overflow-y-auto px-2 space-y-3 ${compact ? "py-2" : "py-3"}`}>
      {GROUPS.filter((g) => byGroup[g].length > 0).map((g) => {
        const open = !folded.has(g);
        // The selected agent stays visible even when its group is folded.
        const shown = open ? byGroup[g] : byGroup[g].filter((a) => a.sessionId === selectedId);
        return (
          <section key={g}>
            <div className="flex items-center gap-2 pr-3 rounded-md hover:bg-[var(--color-hover-row)]">
              <h2 className="flex-1 min-w-0">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => toggle(g)}
                  className={`w-full flex items-center gap-2 pl-3 py-1.5 text-left ${SECTION_LABEL}`}
                >
                  <ChevronRight size={ICON_SIZE.menu} className={`shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`} />
                  <span className={`dot ${agentGroupDotClass(g)}`} aria-hidden />
                  <span className="truncate">{t[GROUP_KEYS[g]]}</span>
                </button>
              </h2>
              <Badge variant={agentGroupVariant(g)}>{byGroup[g].length}</Badge>
            </div>
            {shown.length > 0 && (
              <ul className="mt-px space-y-px">
                {shown.map((a) => (
                  <li key={a.sessionId}>
                    <button
                      type="button"
                      onClick={() => onSelect(a.sessionId)}
                      aria-current={a.sessionId === selectedId || undefined}
                      className={`w-full text-left px-3 ${compact ? "py-1.5" : "py-2"} rounded-md transition-colors focus-accent ${
                        a.sessionId === selectedId
                          ? "bg-accent-light"
                          : `${g === "needs-you" ? NEEDS_YOU_ROW : ""} hover:bg-[var(--color-hover-row)]`
                      }`}
                    >
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span className={`dot ${agentGroupDotClass(g)}`} aria-hidden />
                        <span className="truncate">{a.name}</span>
                        {(a.modelLabel ?? a.model) && (
                          <span className="shrink-0 text-xs font-normal text-muted">{a.modelLabel ?? (a.model && MODEL_LABELS[a.model]) ?? a.model}</span>
                        )}
                        {a.quiet && <Badge variant="neutral">{t.agents_quiet}</Badge>}
                      </div>
                      {/* Indented past the dot (8px) and its gap (8px). */}
                      {!(compact && (g === "idle" || g === "done")) && (
                        <div className="pl-4 text-xs text-muted truncate">{agentLabel(a)}</div>
                      )}
                      {a.waitingFor && (
                        <div className={`pl-4 text-xs font-medium truncate ${agentGroupTextClass(g)}`}>{a.waitingFor}</div>
                      )}
                    </button>
                    {renderExtra?.(a)}
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </nav>
  );
}
