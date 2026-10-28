import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { useAppStore } from "../stores/app-store";
import { useT } from "../i18n/useT";
import { Button, EmptyState, PageHeader } from "../components/ui";
import { useAgents } from "../components/agents/useAgents";
import { AgentList } from "../components/agents/AgentList";
import { AgentDetail } from "../components/agents/AgentDetail";
import { StartAgentForm } from "../components/agents/StartAgentForm";

export function AgentsPage() {
  const t = useT();
  const enabled = useAppStore((s) => s.agentsEnabled);
  const { agents, byGroup } = useAgents();
  const [params, setParams] = useSearchParams();
  const [starting, setStarting] = useState(false);
  const selectedId = params.get("agent");
  // Short id of an agent just started: selected once it shows up in the list.
  const [pendingShortId, setPendingShortId] = useState<string | null>(null);
  // Task 11 renders the terminal panel for this short id into the slot below.
  const [terminalFor, setTerminalFor] = useState<string | null>(null);
  const selected = agents.find((a) => a.sessionId === selectedId) ?? null;

  useEffect(() => {
    if (!pendingShortId) return;
    const found = agents.find((a) => a.shortId === pendingShortId);
    if (found) {
      setPendingShortId(null);
      setParams({ agent: found.sessionId });
    }
  }, [agents, pendingShortId, setParams]);

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
    setTerminalFor(null);
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
            <StartAgentForm
              onStarted={(shortId) => {
                setStarting(false);
                setPendingShortId(shortId);
              }}
              onCancel={() => setStarting(false)} />
          ) : selected ? (
            <div className="flex flex-col h-full gap-4">
              <div className="flex-1 min-h-0">
                <AgentDetail
                  agent={selected}
                  onOpenTerminal={setTerminalFor}
                  onDeleted={() => setParams({})}
                  onSwitched={setPendingShortId}
                />
              </div>
              {terminalFor && selected.shortId === terminalFor && (
                <div data-testid="terminal-slot" data-short-id={terminalFor} />
              )}
            </div>
          ) : (
            <EmptyState message={t.agents_select_hint} />
          )}
        </div>
      </div>
    </div>
  );
}
