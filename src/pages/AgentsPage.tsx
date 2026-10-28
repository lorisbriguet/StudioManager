import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bot, Plus } from "lucide-react";
import { useAppStore } from "../stores/app-store";
import { useT } from "../i18n/useT";
import { Button, EmptyState, PageHeader, PANEL_TOP_BAR } from "../components/ui";
import { useAgents } from "../components/agents/useAgents";
import { AgentList } from "../components/agents/AgentList";
import { AgentDetail } from "../components/agents/AgentDetail";
import { TerminalPanel } from "../components/agents/TerminalPanel";
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

  // `?new=1` (the menu bar panel's "New agent"): open the start form, then drop the flag.
  const wantsNew = params.get("new") === "1";
  useEffect(() => {
    if (!wantsNew) return;
    setStarting(true);
    setTerminalFor(null);
    setParams({}, { replace: true });
  }, [wantsNew, setParams]);

  if (!enabled) {
    return (
      <div>
        <PageHeader title={t.agents} />
        <EmptyState icon={<Bot size={32} />} message={t.agents_off} />
      </div>
    );
  }

  const select = (id: string) => {
    setStarting(false);
    setTerminalFor(null);
    setParams({ agent: id });
  };

  // Full-height columns like Settings: the page runs edge to edge (-m-8), and both
  // columns start with a PANEL_TOP_BAR so the line between them never steps.
  return (
    <div className="flex flex-1 min-h-0 -m-8">
      <aside className="w-72 shrink-0 flex flex-col min-h-0 border-r border-[var(--color-border-divider)]">
        <div className={`${PANEL_TOP_BAR} pl-5 pr-3 justify-between border-[var(--color-border-divider)]`}>
          <h1 className="text-sm font-semibold text-muted uppercase tracking-wider">{t.agents}</h1>
          <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setStarting(true)}>
            {t.agents_new}
          </Button>
        </div>
        {agents.length === 0 ? (
          <EmptyState icon={<Bot size={32} />} message={t.agents_empty} />
        ) : (
          <AgentList byGroup={byGroup} selectedId={selectedId} onSelect={select} />
        )}
      </aside>
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {starting ? (
          <div className="flex-1 min-h-0 overflow-y-auto px-8 py-6">
            <div className="max-w-xl">
              <StartAgentForm
                onStarted={(shortId) => {
                  setStarting(false);
                  setPendingShortId(shortId);
                }}
                onCancel={() => setStarting(false)}
              />
            </div>
          </div>
        ) : selected ? (
          <>
            <div className="flex-1 min-h-0">
              <AgentDetail
                agent={selected}
                onOpenTerminal={setTerminalFor}
                onDeleted={() => setParams({})}
                onSwitched={setPendingShortId}
              />
            </div>
            {terminalFor && selected.shortId === terminalFor && (
              <div className="shrink-0 px-5 pb-5">
                <TerminalPanel key={terminalFor} shortId={terminalFor} onClose={() => setTerminalFor(null)} />
              </div>
            )}
          </>
        ) : (
          <EmptyState icon={<Bot size={32} />} message={t.agents_select_hint} />
        )}
      </div>
    </div>
  );
}
