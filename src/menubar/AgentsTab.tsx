
import { EmptyState, ICONS } from "../components/ui";
import { AgentList } from "../components/agents/AgentList";
import { PromptAnswer } from "../components/agents/PromptAnswer";
import { useAgents } from "../components/agents/useAgents";
import { CaptureField } from "../components/agents/CaptureField";
import { LoginNotice } from "../components/agents/LoginNotice";
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

  // The sign-in warning sits above the list (nothing while more than 10 days are left).
  const notice = <LoginNotice className="m-2 mb-0" />;
  // The capture field sits above the notice and the list, empty state included.
  const field = <CaptureField source="menubar" />;

  if (agents.length === 0) {
    return (
      <>
        {field}
        {notice}
        <EmptyState icon={ICONS.agents} message={t.agents_empty} />
      </>
    );
  }

  const open = (sessionId: string) => void openMainWindow({ agent: sessionId });

  return (
    <>
      {field}
      {notice}
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
    </>
  );
}
