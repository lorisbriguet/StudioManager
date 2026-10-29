import { useRef, useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { TabItem } from "../ui/TabItem";
import { useTabStore, predictNextActiveTab, type Tab } from "../../stores/tab-store";
import { confirmIfDirty } from "../../lib/dirty-guard";
import { useT } from "../../i18n/useT";
import { ICONS, IconButton } from "../ui";

export function TabBar() {
  const t = useT();
  const { tabs, activeTabId, openTab, closeTab, activateTab } = useTabStore();
  const navigate = useNavigate();
  const location = useLocation();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Track back/forward availability via react-router's history.state.idx
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  const updateNavState = useCallback(() => {
    // history.state?.idx is set by react-router and tracks position in the history stack
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    setCanGoBack(idx > 0);
    // We track max index seen to know if forward is possible
    const maxKey = "nav_max_idx";
    const storedMax = Number(sessionStorage.getItem(maxKey) || "0");
    const newMax = Math.max(storedMax, idx);
    sessionStorage.setItem(maxKey, String(newMax));
    setCanGoForward(idx < newMax);
  }, []);

  useEffect(() => {
    updateNavState();
  }, [location, updateNavState]);

  useEffect(() => {
    const handler = () => updateNavState();
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [updateNavState]);

  // Don't show tab bar when only 1 tab
  if (tabs.length <= 1) return null;

  const handleActivate = async (tab: Tab) => {
    // Clicking the active tab is a same-page no-op — confirmIfDirty skips
    // the prompt when the target path equals the current one
    if (!(await confirmIfDirty(tab.path))) return;
    activateTab(tab.id);
    navigate(tab.path);
  };

  const handleClose = async (tab: Tab) => {
    const store = useTabStore.getState();
    // closeTab refuses pinned / last tabs — skip early so we don't prompt for nothing
    if (store.tabs.length <= 1 || tab.pinned) return;
    if (tab.id === store.activeTabId) {
      // Closing the ACTIVE tab navigates to a neighbor — predict it (shared
      // rule with closeTab) and prompt if the current page holds a dirty form.
      // Closing a background tab never changes the route: no prompt.
      const next = predictNextActiveTab(store.tabs, tab.id);
      if (!(await confirmIfDirty(next?.path))) return;
    }
    const newActiveId = closeTab(tab.id);
    if (newActiveId) {
      const newActive = useTabStore.getState().tabs.find((t) => t.id === newActiveId);
      if (newActive) navigate(newActive.path);
    }
  };

  const handleNewTab = async () => {
    if (!(await confirmIfDirty("/"))) return;
    const id = openTab("/", "Dashboard");
    if (id) navigate("/");
  };

  return (
    <div className="flex items-center border-b border-[var(--color-border-divider)] bg-[var(--color-bg)] shrink-0" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
      {/* Back / Forward navigation */}
      <div className="flex items-center shrink-0 ml-1.5 gap-0.5">
        <IconButton icon={ICONS.prev} label={t.back} onClick={() => navigate(-1)} disabled={!canGoBack} />
        <IconButton icon={ICONS.next} label={t.forward} onClick={() => navigate(1)} disabled={!canGoForward} />
      </div>
      <div
        ref={scrollRef}
        className="flex items-center flex-1 overflow-x-auto scrollbar-hide"
      >
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            label={tab.label}
            pinned={tab.pinned}
            active={tab.id === activeTabId}
            onActivate={() => handleActivate(tab)}
            onClose={() => handleClose(tab)}
            closeLabel={t.close_tab}
          />
        ))}
      </div>
      <IconButton icon={ICONS.add} label={t.new_tab} onClick={handleNewTab} className="mx-1" />
    </div>
  );
}
