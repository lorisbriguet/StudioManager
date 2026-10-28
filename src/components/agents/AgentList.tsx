import type { Agent, Group } from "../../lib/agents";
import { useT } from "../../i18n/useT";
import type { UIKey } from "../../i18n/ui";
import { GROUPS } from "./useAgents";

const GROUP_KEYS: Record<Group, UIKey> = {
  "needs-you": "agents_group_needs_you",
  working: "agents_group_working",
  idle: "agents_group_idle",
  done: "agents_group_done",
};

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

export function AgentList({ byGroup, selectedId, onSelect }: AgentListProps) {
  const t = useT();
  return (
    <div className="flex-1 overflow-y-auto">
      {GROUPS.filter((g) => byGroup[g].length > 0).map((g) => (
        <section key={g} className="mb-4">
          <h2 className="px-3 mb-1 text-xs font-medium uppercase tracking-wide text-muted">
            {t[GROUP_KEYS[g]]}
          </h2>
          <ul>
            {byGroup[g].map((a) => (
              <li key={a.sessionId}>
                <button
                  type="button"
                  onClick={() => onSelect(a.sessionId)}
                  aria-current={a.sessionId === selectedId || undefined}
                  className={`w-full text-left px-3 py-2 rounded-md transition-colors focus-accent ${
                    a.sessionId === selectedId
                      ? "bg-accent-light"
                      : "hover:bg-[var(--color-hover-row)]"
                  }`}
                >
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className="truncate">{a.name}</span>
                    {a.model && <span className="text-xs font-normal text-muted">{a.model}</span>}
                    {a.quiet && (
                      <span className="text-xs font-normal text-muted rounded-full bg-[var(--color-input-bg)] px-1.5">
                        {t.agents_quiet}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted truncate">{agentLabel(a)}</div>
                  {a.waitingFor && (
                    <div className="text-xs text-[var(--color-text-secondary)] truncate">
                      {a.waitingFor}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
