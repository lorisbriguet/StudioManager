import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAppStore } from "../stores/app-store";
import { useT } from "../i18n/useT";
import { Button, EmptyState, ICONS, PageHeader } from "../components/ui";
import { useAgents } from "../components/agents/useAgents";
import { AgentList } from "../components/agents/AgentList";
import { AgentDetail } from "../components/agents/AgentDetail";
import { TerminalPanel } from "../components/agents/TerminalPanel";
import { StartAgentForm } from "../components/agents/StartAgentForm";
import { LoginNotice } from "../components/agents/LoginNotice";

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

  const select = (id: string) => {
    setStarting(false);
    setTerminalFor(null);
    setParams({ agent: id });
  };

  // A flat page like Invoices: the PageHeader on the canvas (the same whether the feature
  // is on or off), then the list and the selected agent side by side, split by a hairline.
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title={t.agents}>
        <Button icon={ICONS.add} disabled={!enabled} onClick={() => setStarting(true)}>
          {t.agents_new}
        </Button>
      </PageHeader>
      {enabled && <LoginNotice quiet className="mb-4" />}
      {!enabled ? (
        <EmptyState icon={ICONS.agents} message={t.agents_off} />
      ) : (
        <div className="flex flex-1 min-h-0 gap-8">
          <section aria-label={t.agents} className="w-70 shrink-0 flex flex-col min-h-0">
            {agents.length === 0 ? (
              <EmptyState icon={ICONS.agents} message={t.agents_empty} />
            ) : (
              <AgentList byGroup={byGroup} selectedId={selectedId} onSelect={select} />
            )}
          </section>
          <div className="flex-1 min-w-0 min-h-0 flex flex-col border-l border-[var(--color-border-divider)] pl-8">
            {starting ? (
              <div className="flex-1 min-h-0 overflow-y-auto">
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
                  <div className="shrink-0 pt-4">
                    <TerminalPanel key={terminalFor} shortId={terminalFor} onClose={() => setTerminalFor(null)} />
                  </div>
                )}
              </>
            ) : (
              <EmptyState icon={ICONS.agents} message={t.agents_select_hint} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
