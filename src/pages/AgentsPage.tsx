import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { useAppStore } from "../stores/app-store";
import { useT } from "../i18n/useT";
import { Button, EmptyState, PageHeader } from "../components/ui";
import { useAgents } from "../components/agents/useAgents";
import { AgentList } from "../components/agents/AgentList";
import { StartAgentForm } from "../components/agents/StartAgentForm";

export function AgentsPage() {
  const t = useT();
  const enabled = useAppStore((s) => s.agentsEnabled);
  const { agents, byGroup } = useAgents();
  const [params, setParams] = useSearchParams();
  const [starting, setStarting] = useState(false);
  // Task 10 reads this to fill the detail pane.
  const selectedId = params.get("agent");

  if (!enabled) {
    return (
      <div>
        <PageHeader title={t.agents} />
        <EmptyState message={t.agents_off} />
      </div>
    );
  }

  const select = (id: string) => {
    setStarting(false);
    setParams({ agent: id });
  };

  return (
    <div className="flex flex-col h-full">
      <PageHeader title={t.agents}>
        <Button icon={<Plus size={14} />} onClick={() => setStarting(true)}>
          {t.agents_new}
        </Button>
      </PageHeader>
      <div className="flex flex-1 min-h-0 gap-6">
        <div className="w-72 shrink-0 flex flex-col min-h-0">
          {agents.length === 0 ? (
            <EmptyState message={t.agents_empty} />
          ) : (
            <AgentList byGroup={byGroup} selectedId={selectedId} onSelect={select} />
          )}
        </div>
        <div className="flex-1 min-w-0 overflow-y-auto">
          {starting ? (
            <StartAgentForm onStarted={() => setStarting(false)} onCancel={() => setStarting(false)} />
          ) : (
            <EmptyState message={t.agents_select_hint} />
          )}
        </div>
      </div>
    </div>
  );
}
