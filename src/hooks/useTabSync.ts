import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTabStore, predictNextActiveTab } from "../stores/tab-store";
import { confirmIfDirty } from "../lib/dirty-guard";

// Map route paths to tab labels
function labelFromPath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return "Dashboard";
  const base = segments[0];
  const labels: Record<string, string> = {
    clients: "Clients",
    projects: "Projects",
    tasks: "Tasks",
    calendar: "Calendar",
    invoices: "Invoices",
    quotes: "Quotes",
    expenses: "Expenses",
    income: "Income",
    finances: "Finances",
    resources: "Resources",
    notifications: "Notifications",
    settings: "Settings",
    profile: "Profile",
  };
  let label = labels[base] ?? base;
  // Add detail indicators
  if (segments.length >= 2) {
    if (segments[1] === "new") label += " (new)";
    else if (segments[2] === "edit") label += ` #${segments[1]}`;
    else if (segments[2] === "preview") label += ` #${segments[1]}`;
    else label += ` #${segments[1]}`;
  }
  return label;
}

export function useTabSync() {
  const location = useLocation();
  const navigate = useNavigate();
  const { updateActiveTab, openTab, closeTab, reopenClosedTab } = useTabStore();
  const isTabNavRef = useRef(false);

  // When route changes (e.g. via Link click), update the active tab
  useEffect(() => {
    if (isTabNavRef.current) {
      isTabNavRef.current = false;
      return;
    }
    const label = labelFromPath(location.pathname);
    updateActiveTab(location.pathname, label);
  }, [location.pathname, updateActiveTab]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMeta = e.metaKey || e.ctrlKey;

      // Cmd+T: new tab (no Shift). e.key is lowercase "t" when Shift is not held.
      if (isMeta && (e.key === "t" || e.key === "T") && !e.shiftKey) {
        e.preventDefault();
        void confirmIfDirty("/").then((ok) => {
          if (!ok) return;
          openTab("/", "Dashboard");
          navigate("/");
        });
        return;
      }

      // Cmd+W: close tab (always the ACTIVE tab, so this leaves the current
      // page — prompt if it holds a dirty form)
      if (isMeta && e.key === "w") {
        e.preventDefault();
        const store = useTabStore.getState();
        if (store.tabs.length <= 1) return;
        const active = store.tabs.find((t) => t.id === store.activeTabId);
        // closeTab refuses pinned tabs — skip early so we don't prompt for nothing
        if (!active || active.pinned) return;
        // Predict the neighbor we would land on (shared rule with closeTab) so
        // confirmIfDirty can skip the prompt when its path equals the current one
        const next = predictNextActiveTab(store.tabs, store.activeTabId);
        void confirmIfDirty(next?.path).then((ok) => {
          if (!ok) return;
          const newActiveId = closeTab(store.activeTabId);
          if (newActiveId) {
            const newActive = useTabStore.getState().tabs.find((t) => t.id === newActiveId);
            if (newActive) {
              isTabNavRef.current = true;
              navigate(newActive.path);
            }
          }
        });
        return;
      }

      // Cmd+Shift+Y: reopen closed tab. e.key is uppercase "Y" when Shift is held.
      // (Cmd+Shift+T belongs to the Quick Timer modal — see App.tsx.)
      if (isMeta && (e.key === "Y" || e.key === "y") && e.shiftKey) {
        e.preventDefault();
        // Peek before mutating the store: on cancel the tab must stay closed
        const peek = useTabStore.getState().closedTabs[0];
        if (!peek) return;
        void confirmIfDirty(peek.path).then((ok) => {
          if (!ok) return;
          const tab = reopenClosedTab();
          if (tab) {
            isTabNavRef.current = true;
            navigate(tab.path);
          }
        });
        return;
      }

      // Ctrl+Tab / Ctrl+Shift+Tab: next/prev tab
      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        const store = useTabStore.getState();
        const idx = store.tabs.findIndex((t) => t.id === store.activeTabId);
        const len = store.tabs.length;
        const nextIdx = e.shiftKey ? (idx - 1 + len) % len : (idx + 1) % len;
        const nextTab = store.tabs[nextIdx];
        // Single tab: cycling is a no-op — don't prompt, don't navigate
        if (nextTab && nextTab.id !== store.activeTabId) {
          void confirmIfDirty(nextTab.path).then((ok) => {
            if (!ok) return;
            store.activateTab(nextTab.id);
            isTabNavRef.current = true;
            navigate(nextTab.path);
          });
        }
        return;
      }

      // Cmd+1-9: jump to tab N
      if (isMeta && e.key >= "1" && e.key <= "9") {
        const store = useTabStore.getState();
        const idx = parseInt(e.key) - 1;
        if (idx < store.tabs.length) {
          e.preventDefault();
          const tab = store.tabs[idx];
          // Jumping to the tab we're already on is a no-op — don't prompt
          if (tab.id === store.activeTabId) return;
          void confirmIfDirty(tab.path).then((ok) => {
            if (!ok) return;
            store.activateTab(tab.id);
            isTabNavRef.current = true;
            navigate(tab.path);
          });
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate, openTab, closeTab, reopenClosedTab]);
}
