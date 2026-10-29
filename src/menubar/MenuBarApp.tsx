import { useId, useState } from "react";
import { BottomBar, Button, PANEL_TOP_BAR, TabItem } from "../components/ui";
import { TabList, tabIds } from "../components/ui/TabItem";
import { AgentsTab } from "./AgentsTab";
import { UsageTab } from "./UsageTab";
import { DayTab } from "./DayTab";
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
 * tabs over the same Rust state as the Agents page.
 */
export function MenuBarApp() {
  const t = useT();
  const [tab, setTab] = useState<Tab>(readTab);
  const labels: Record<Tab, string> = { agents: t.agents, usage: t.menubar_usage, day: t.menubar_day };
  const idBase = useId();
  const panel = tabIds(idBase, tab);

  const openApp = (
    <Button variant="outline" onClick={() => void openMainWindow()}>
      {t.menubar_open_app}
    </Button>
  );

  const choose = (next: Tab) => {
    setTab(next);
    writeTab(next);
  };

  return (
    <div className="h-screen flex flex-col bg-[var(--color-bg)] text-[var(--color-text)] overflow-hidden rounded-xl border border-[var(--color-border)]">
      <TabList label="StudioManager" className={`${PANEL_TOP_BAR} px-1.5 border-[var(--color-border)]`}>
        {TABS.map((id) => {
          const ids = tabIds(idBase, id);
          return (
            <TabItem
              key={id}
              role="tab"
              id={ids.tab}
              controls={ids.panel}
              label={labels[id]}
              active={tab === id}
              onActivate={() => choose(id)}
            />
          );
        })}
      </TabList>
      {tab === "usage" ? (
        // The Usage tab owns the bottom bar: "Copy as text" sits next to the shell's action.
        <div role="tabpanel" id={panel.panel} aria-labelledby={panel.tab} className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <UsageTab trailing={openApp} />
        </div>
      ) : (
        <>
          <div role="tabpanel" id={panel.panel} aria-labelledby={panel.tab} tabIndex={0} className="flex-1 min-h-0 overflow-y-auto flex flex-col focus-accent">
            {tab === "agents" && <AgentsTab />}
            {tab === "day" && <DayTab />}
          </div>
          <BottomBar className={tab === "agents" ? "justify-between" : "justify-end"}>
            {tab === "agents" && (
              <Button variant="outline" onClick={() => void openMainWindow({ newAgent: true })}>
                {t.agents_new}
              </Button>
            )}
            {openApp}
          </BottomBar>
        </>
      )}
    </div>
  );
}
