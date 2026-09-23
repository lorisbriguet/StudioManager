import { create } from "zustand";
import { useOrgStore } from "./org-store";

export interface Tab {
  id: string;
  path: string;
  label: string;
  pinned: boolean;
}

const storageKey = () => useOrgStore.getState().orgKey("open-tabs");

function generateId() {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function defaultTabs(): { tabs: Tab[]; activeTabId: string } {
  const id = generateId();
  return { tabs: [{ id, path: "/", label: "Dashboard", pinned: false }], activeTabId: id };
}

function loadTabs(): { tabs: Tab[]; activeTabId: string } {
  try {
    const raw = localStorage.getItem(storageKey());
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.tabs?.length > 0) return parsed;
    }
  } catch { /* ignore */ }
  return defaultTabs();
}

function persist(tabs: Tab[], activeTabId: string) {
  localStorage.setItem(storageKey(), JSON.stringify({ tabs, activeTabId }));
}

/**
 * The tab that becomes active when `closingId` is closed while active:
 * the same-index neighbor, or the last remaining tab. Single source of the
 * neighbor rule — used by closeTab AND by the pre-close dirty-guard checks
 * (useTabSync Cmd+W, TabBar close handler) so prediction and actual close
 * behavior cannot diverge.
 */
export function predictNextActiveTab(tabs: Tab[], closingId: string): Tab | null {
  const idx = tabs.findIndex((t) => t.id === closingId);
  if (idx === -1) return null;
  const remaining = tabs.filter((t) => t.id !== closingId);
  return remaining[Math.min(idx, remaining.length - 1)] ?? null;
}

interface TabState {
  tabs: Tab[];
  activeTabId: string;
  closedTabs: Tab[];
  openTab: (path: string, label: string) => string;
  closeTab: (id: string) => string | null;
  activateTab: (id: string) => void;
  updateActiveTab: (path: string, label: string) => void;
  reopenClosedTab: () => Tab | null;
  togglePin: (id: string) => void;
  reorderTabs: (fromIdx: number, toIdx: number) => void;
  closeAllTabs: () => void;
  reloadForOrg: () => void;
}

// Must not read the org-namespaced key at module evaluation time (org-store's
// activeId isn't settled yet, and tab-store must not participate in an
// import-time cycle with org-store). Start with plain defaults; the real
// per-organisation tabs are loaded via reloadForOrg() once the active
// organisation is known (see the useOrgStore subscription below).
const initial = defaultTabs();

export const useTabStore = create<TabState>((set, get) => ({
  tabs: initial.tabs,
  activeTabId: initial.activeTabId,
  closedTabs: [],

  openTab: (path, label) => {
    // Check if a tab with this exact path already exists
    const existing = get().tabs.find((t) => t.path === path);
    if (existing) {
      set({ activeTabId: existing.id });
      persist(get().tabs, existing.id);
      return existing.id;
    }
    const id = generateId();
    const tab: Tab = { id, path, label, pinned: false };
    const tabs = [...get().tabs, tab];
    persist(tabs, id);
    set({ tabs, activeTabId: id });
    return id;
  },

  closeTab: (id) => {
    const { tabs, activeTabId, closedTabs } = get();
    if (tabs.length <= 1) return null; // Don't close last tab
    const tab = tabs.find((t) => t.id === id);
    if (!tab || tab.pinned) return null;
    const newTabs = tabs.filter((t) => t.id !== id);
    const newClosed = [tab, ...closedTabs].slice(0, 10);
    let newActiveId = activeTabId;
    if (activeTabId === id) {
      newActiveId = predictNextActiveTab(tabs, id)?.id ?? newTabs[0].id;
    }
    persist(newTabs, newActiveId);
    set({ tabs: newTabs, activeTabId: newActiveId, closedTabs: newClosed });
    return newActiveId;
  },

  activateTab: (id) => {
    persist(get().tabs, id);
    set({ activeTabId: id });
  },

  updateActiveTab: (path, label) => {
    const { tabs, activeTabId } = get();
    const newTabs = tabs.map((t) => {
      if (t.id !== activeTabId) return t;
      // Keep custom label if path didn't change (e.g. opened via "Open in new tab" with a real name)
      const newLabel = t.path === path ? t.label : label;
      return { ...t, path, label: newLabel };
    });
    persist(newTabs, activeTabId);
    set({ tabs: newTabs });
  },

  reopenClosedTab: () => {
    const { closedTabs } = get();
    if (closedTabs.length === 0) return null;
    const [tab, ...rest] = closedTabs;
    const id = generateId();
    const newTab = { ...tab, id };
    const tabs = [...get().tabs, newTab];
    persist(tabs, id);
    set({ tabs, activeTabId: id, closedTabs: rest });
    return newTab;
  },

  togglePin: (id) => {
    const tabs = get().tabs.map((t) =>
      t.id === id ? { ...t, pinned: !t.pinned } : t
    );
    persist(tabs, get().activeTabId);
    set({ tabs });
  },

  reorderTabs: (fromIdx, toIdx) => {
    const tabs = [...get().tabs];
    const [moved] = tabs.splice(fromIdx, 1);
    tabs.splice(toIdx, 0, moved);
    persist(tabs, get().activeTabId);
    set({ tabs });
  },

  closeAllTabs: () => {
    const home = defaultTabs();
    set({ tabs: home.tabs, activeTabId: home.activeTabId });
    persist(home.tabs, home.activeTabId);
  },

  reloadForOrg: () => {
    const { tabs, activeTabId } = loadTabs();
    // Clear the reopen stack too: it holds tabs of the organisation we are
    // leaving, and reopenClosedTab() must not resurface them here. Never
    // persist from here — loadTabs() just read this organisation's own
    // saved tabs, and writing them straight back would only risk
    // overwriting them with the defaults when it found none.
    set({ tabs, activeTabId, closedTabs: [] });
  },
}));

// Reload the open tabs whenever the active organisation changes. org-store.ts
// must not import this module (that would create an import cycle), so the
// dependency runs the other way: tab-store subscribes to org-store here.
useOrgStore.subscribe((s, prev) => {
  if (s.activeId !== prev.activeId) useTabStore.getState().reloadForOrg();
});
