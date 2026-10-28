import { Bot } from "lucide-react";
import { EmptyState } from "../components/ui";
import { AgentList } from "../components/agents/AgentList";
import { PromptAnswer } from "../components/agents/PromptAnswer";
import { useAgents } from "../components/agents/useAgents";
import { useT } from "../i18n/useT";
import { openMainWindow } from "../lib/agents";

/**
 * The panel's Agents tab: the Agents page's list over the same state, no selection. A
 * Needs-you background agent shows its prompt inline (same PromptAnswer, same safety);
 * any other click, or a terminal-only prompt, opens the agent in the main window.
 */
export function AgentsTab() {
  const t = useT();
  const { agents, byGroup } = useAgents();

  if (agents.length === 0) {
    return <EmptyState icon={<Bot size={32} />} message={t.agents_empty} />;
  }

  const open = (sessionId: string) => void openMainWindow({ agent: sessionId });

  return (
    <AgentList
      compact
      byGroup={byGroup}
      selectedId={null}
      onSelect={open}
      renderExtra={(a) =>
        a.group === "needs-you" && a.kind === "background" && a.shortId ? (
          <div className="px-3 pb-2 pt-1">
            <PromptAnswer shortId={a.shortId} onOpenTerminal={() => open(a.sessionId)} />
          </div>
        ) : null
      }
    />
  );
}
