import { useState } from "react";
import { BottomBar, Button, PANEL_TOP_BAR, TabItem } from "../components/ui";
import { AgentsTab } from "./AgentsTab";
import { useT } from "../i18n/useT";
import { openMainWindow } from "../lib/agents";

/** The menu bar panel's last tab, kept across openings (per webview origin). */
export const MENUBAR_TAB_KEY = "menubarTab";

const TABS = ["agents", "usage", "day"] as const;
type Tab = (typeof TABS)[number];

function readTab(): Tab {
  try {
    const saved = localStorage.getItem(MENUBAR_TAB_KEY);
    return TABS.find((t) => t === saved) ?? "agents";
  } catch {
    return "agents";
  }
}

function writeTab(tab: Tab) {
  try {
    localStorage.setItem(MENUBAR_TAB_KEY, tab);
  } catch {
    // Storage unavailable: the tab is just not remembered.
  }
}

/**
 * The menu bar panel (route `/menubar`, its own borderless window): Agents, Usage and Day
 * tabs over the same Rust state as the Agents page. Tab bodies come with later tasks.
 */
export function MenuBarApp() {
  const t = useT();
  const [tab, setTab] = useState<Tab>(readTab);
  const labels: Record<Tab, string> = { agents: t.agents, usage: t.menubar_usage, day: t.menubar_day };

  const choose = (next: Tab) => {
    setTab(next);
    writeTab(next);
  };

  return (
    <div className="h-screen flex flex-col bg-[var(--color-bg)] text-[var(--color-text)] overflow-hidden">
      <div role="tablist" aria-label="StudioManager" className={`${PANEL_TOP_BAR} px-1.5 border-[var(--color-border-header)]`}>
        {TABS.map((id) => (
          <TabItem key={id} role="tab" label={labels[id]} active={tab === id} onActivate={() => choose(id)} />
        ))}
      </div>
      <div role="tabpanel" aria-label={labels[tab]} className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        {tab === "agents" && <AgentsTab />}
      </div>
      <BottomBar className={tab === "agents" ? "justify-between" : "justify-end"}>
        {tab === "agents" && (
          <Button size="sm" variant="ghost" onClick={() => void openMainWindow({ newAgent: true })}>
            {t.agents_new}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => void openMainWindow()}>
          {t.menubar_open_app}
        </Button>
      </BottomBar>
    </div>
  );
}
