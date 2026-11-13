import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import type { Agent, Group } from "../../lib/agents";
import { agentGroupDotClass, agentGroupTextClass } from "../../lib/statusColors";
import { Badge, ContextMenu, ICONS, ICON_SIZE, SECTION_LABEL, type ContextMenuState } from "../ui";
import { setFlagged, useFlaggedAgents } from "../../lib/agentFlags";
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
  /** Short ids of agents left out of the Needs you group: the Needs you tab lists them instead. */
  leaveOut?: ReadonlySet<string>;
}

const FOLDED_KEY = "agents.foldedGroups";

/** A list section: an agent group, or the flagged conversations above them. */
type Section = Group | "flagged";

/** Flagged agents leave Idle and Done for the Flagged section on top; one that works or
 *  needs you stays in its group, where it is visible anyway, with its flag. */
const FLAG_MOVES: ReadonlySet<Group> = new Set<Group>(["idle", "done"]);

/** Folded sections, remembered on this Mac. Done starts folded. */
function readFolded(): Set<Section> {
  try {
    const raw = localStorage.getItem(FOLDED_KEY);
    if (raw) return new Set(JSON.parse(raw) as Section[]);
  } catch {
    // Unreadable or unavailable storage: fall back to the default.
  }
  return new Set<Section>(["done"]);
}

export function AgentList({ byGroup, selectedId, onSelect, compact, renderExtra, leaveOut }: AgentListProps) {
  const t = useT();
  const [folded, setFolded] = useState<Set<Section>>(readFolded);
  const flags = useFlaggedAgents();
  const [menu, setMenu] = useState<ContextMenuState<Agent> | null>(null);
  const toggle = (g: Section) =>
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

  const isFlagged = (a: Agent) => flags.has(a.sessionId);
  const moved = (a: Agent) => isFlagged(a) && FLAG_MOVES.has(a.group);
  const sections: { key: Section; label: string; dot: string | null; agents: Agent[] }[] = [
    {
      key: "flagged",
      label: t.agents_group_flagged,
      dot: null,
      agents: GROUPS.flatMap((g) => byGroup[g]).filter(moved),
    },
    ...GROUPS.map((g) => ({
      key: g as Section,
      label: t[GROUP_KEYS[g]],
      dot: agentGroupDotClass(g),
      agents: byGroup[g].filter((a) => !moved(a) && !(g === "needs-you" && a.shortId != null && leaveOut?.has(a.shortId))),
    })),
  ];

  // Flat rows like a Table: each group opens with a group row (as Table.Group: chevron,
  // SectionLabel, muted count) over the header line, agents are rows with hairlines.
  return (
    <nav className={`flex-1 overflow-y-auto space-y-3 ${compact ? "px-2 py-2" : ""}`}>
      {sections.filter((sec) => sec.agents.length > 0).map((sec) => {
        const open = !folded.has(sec.key);
        // The selected agent stays visible even when its group is folded.
        const shown = open ? sec.agents : sec.agents.filter((a) => a.sessionId === selectedId);
        return (
          <section key={sec.key}>
            <h2 className="h-8 flex items-center border-b border-[var(--color-border)] hover:bg-[var(--color-hover-row)]">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => toggle(sec.key)}
                className="focus-accent w-full h-full flex items-center gap-2 px-2 rounded text-left cursor-pointer"
              >
                <ChevronRight size={ICON_SIZE.control} className={`shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`} />
                {sec.dot ? (
                  <span className={`dot ${sec.dot}`} aria-hidden />
                ) : (
                  <ICONS.flag size={ICON_SIZE.control} className="shrink-0 text-muted" aria-hidden />
                )}
                <span className={`truncate ${SECTION_LABEL}`}>{sec.label}</span>
                <span className="text-xs text-muted tabular-nums">{sec.agents.length}</span>
              </button>
            </h2>
            {shown.length > 0 && (
              <ul>
                {shown.map((a) => {
                  const g = a.group;
                  const selected = a.sessionId === selectedId;
                  const model = a.modelLabel ?? (a.model && MODEL_LABELS[a.model]) ?? a.model;
                  return (
                    <li key={a.sessionId} className="border-b border-[var(--color-border-divider)]">
                      <button
                        type="button"
                        onClick={() => onSelect(a.sessionId)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setMenu({ x: e.clientX, y: e.clientY, item: a });
                        }}
                        aria-current={selected || undefined}
                        className={`w-full text-left px-2 ${compact ? "py-1.5" : "py-2"} space-y-0.5 transition-colors focus-accent ${
                          selected ? "bg-accent-tint" : "hover:bg-[var(--color-hover-row)]"
                        }`}
                      >
                        <div className="flex items-center gap-2 text-sm font-medium">
                          {/* In Flagged, the row keeps its status as a dot. */}
                          {sec.key === "flagged" && <span className={`dot ${agentGroupDotClass(g)}`} aria-hidden />}
                          <span className="truncate">{a.name}</span>
                          {model && <span className="shrink-0 text-xs font-normal text-muted">{model}</span>}
                          {a.quiet && <Badge variant="neutral">{t.agents_quiet}</Badge>}
                          {isFlagged(a) && (
                            <ICONS.flag size={ICON_SIZE.control} className="shrink-0 ml-auto text-accent-text" aria-label={t.agents_flagged} role="img" />
                          )}
                        </div>
                        {/* The project, then what the agent waits for in its status colour. */}
                        {!(compact && (g === "idle" || g === "done")) && (
                          <div className="text-xs text-muted truncate">{agentLabel(a)}</div>
                        )}
                        {a.waitingFor && <div className={`text-xs truncate ${agentGroupTextClass(g)}`}>{a.waitingFor}</div>}
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
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          aria-label={menu.item.name}
          onClose={() => setMenu(null)}
          items={[
            isFlagged(menu.item)
              ? { label: t.agents_unflag, icon: ICONS.flag, onClick: () => setFlagged(menu.item.sessionId, false) }
              : { label: t.agents_flag, icon: ICONS.flag, onClick: () => setFlagged(menu.item.sessionId, true) },
          ]}
        />
      )}
    </nav>
  );
}
