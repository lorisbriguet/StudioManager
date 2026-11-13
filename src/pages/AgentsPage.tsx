import { useEffect, useId, useState } from "react";
import { useChangedOrMount } from "../hooks/useChanged";
import { useSearchParams } from "react-router-dom";
import { useAppStore } from "../stores/app-store";
import { useT } from "../i18n/useT";
import { Button, EmptyState, ICONS, PageHeader, TabItem } from "../components/ui";
import { TabList, tabIds } from "../components/ui/TabItem";
import { useCaptures } from "../db/hooks/useCaptures";
import { useNeedsYouCount } from "../db/hooks/useNeedsYou";
import { useOpenLinks } from "../db/hooks/useTaskAgents";
import { useAgents } from "../components/agents/useAgents";
import { AgentList } from "../components/agents/AgentList";
import { AgentDetail } from "../components/agents/AgentDetail";
import { TerminalPanel } from "../components/agents/TerminalPanel";
import { StartAgentForm } from "../components/agents/StartAgentForm";
import { LoginNotice } from "../components/agents/LoginNotice";
import { InboxTab } from "../components/agents/InboxTab";
import { NeedsYouTab } from "../components/agents/NeedsYouTab";

const TABS = ["needs-you", "inbox", "all"] as const;
type Tab = (typeof TABS)[number];

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

  // `?tab=needs-you|inbox|all`; no `tab` is Needs you. Anything that points at an agent opens All
  // agents instead: `?agent=`, `?new=1` and `?started=` win over `tab`.
  const rawTab = params.get("tab");
  const picksAgent = params.has("agent") || params.has("new") || params.has("started");
  const tab: Tab = picksAgent ? "all" : rawTab === "inbox" || rawTab === "all" ? rawTab : "needs-you";
  const idBase = useId();
  const panel = tabIds(idBase, tab);
  const { data: newCaptures = [] } = useCaptures("new");
  const needsYouCount = useNeedsYouCount();
  // An agent a watcher worker runs for an item is listed in Needs you, not in its group here.
  const { data: openLinks = [] } = useOpenLinks();
  const watcherAgents = new Set(openLinks.filter((l) => l.started_by === "watcher").map((l) => l.short_id));
  const counts: Record<Tab, number> = { "needs-you": needsYouCount, inbox: newCaptures.length, all: 0 };
  const tabLabels: Record<Tab, string> = {
    "needs-you": t.agents_tab_needs_you,
    inbox: t.agents_tab_inbox,
    all: t.agents_tab_all,
  };

  // Select it once it shows up; the wait ends when the address shows it selected.
  const found = pendingShortId ? agents.find((a) => a.shortId === pendingShortId) : undefined;
  if (found && found.sessionId === selectedId) setPendingShortId(null);
  const foundId = found?.sessionId ?? null;
  // Wait for the `?started=` flag below to be dropped, or dropping it would undo this.
  const startedParam = params.get("started");
  useEffect(() => {
    if (foundId && !startedParam) setParams({ agent: foundId });
  }, [foundId, startedParam, setParams]);

  // `?new=1` (the menu bar panel's "New agent"): open the start form, then drop the flag.
  const wantsNew = params.get("new") === "1";
  if (useChangedOrMount(wantsNew) && wantsNew) {
    setStarting(true);
    setTerminalFor(null);
  }
  useEffect(() => {
    if (wantsNew) setParams({ tab: "all" }, { replace: true });
  }, [wantsNew, setParams]);

  // `?started=<shortId>` ("Start work with agent" on a task): select it once listed.
  if (useChangedOrMount(startedParam) && startedParam) {
    setStarting(false);
    setTerminalFor(null);
    setPendingShortId(startedParam);
  }
  useEffect(() => {
    if (startedParam) setParams({ tab: "all" }, { replace: true });
  }, [startedParam, setParams]);

  const select = (id: string) => {
    setStarting(false);
    setTerminalFor(null);
    setParams({ agent: id });
  };

  // The New agent button works from any tab: the form lives in All agents.
  const startNew = () => {
    if (tab !== "all") setParams(selectedId ? { agent: selectedId } : { tab: "all" }, { replace: true });
    setStarting(true);
    setTerminalFor(null);
  };

  // A flat page like Invoices: the PageHeader on the canvas (the same whether the feature
  // is on or off), then the list and the selected agent side by side, split by a hairline.
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title={t.agents}>
        <Button icon={ICONS.add} disabled={!enabled} onClick={startNew}>
          {t.agents_new}
        </Button>
      </PageHeader>
      {enabled && <LoginNotice quiet className="mb-4" />}
      {!enabled ? (
        <EmptyState icon={ICONS.agents} message={t.agents_off} />
      ) : (
        <>
          <TabList label={t.agents} className="flex items-center gap-1 mb-4 border-b border-[var(--color-border)] shrink-0">
            {TABS.map((k) => {
              const ids = tabIds(idBase, k);
              return (
                <TabItem
                  key={k}
                  role="tab"
                  id={ids.tab}
                  controls={ids.panel}
                  label={counts[k] > 0 ? `${tabLabels[k]} ${counts[k]}` : tabLabels[k]}
                  active={tab === k}
                  onActivate={() => setParams({ tab: k }, { replace: true })}
                />
              );
            })}
          </TabList>
          {tab === "needs-you" && (
            <div role="tabpanel" id={panel.panel} aria-labelledby={panel.tab} className="flex flex-1 min-h-0">
              <NeedsYouTab />
            </div>
          )}
          {tab === "inbox" && (
            <div role="tabpanel" id={panel.panel} aria-labelledby={panel.tab} className="flex flex-1 min-h-0">
              <InboxTab />
            </div>
          )}
          {tab === "all" && (
            <div role="tabpanel" id={panel.panel} aria-labelledby={panel.tab} className="flex flex-1 min-h-0 gap-8">
              <section aria-label={t.agents} className="w-70 shrink-0 flex flex-col min-h-0">
                {agents.length === 0 ? (
                  <EmptyState icon={ICONS.agents} message={t.agents_empty} />
                ) : (
                  <AgentList byGroup={byGroup} selectedId={selectedId} onSelect={select} leaveOut={watcherAgents} />
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
                        onDeleted={() => setParams({ tab: "all" })}
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
        </>
      )}
    </div>
  );
}
