import { create } from "zustand";

export interface Tab {
  id: string;
  path: string;
  label: string;
  pinned: boolean;
}

const STORAGE_KEY = "open-tabs";

function generateId() {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function loadTabs(): { tabs: Tab[]; activeTabId: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.tabs?.length > 0) return parsed;
    }
  } catch { /* ignore */ }
  const id = generateId();
  return { tabs: [{ id, path: "/", label: "Dashboard", pinned: false }], activeTabId: id };
}

function persist(tabs: Tab[], activeTabId: string) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs, activeTabId }));
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
}

const initial = loadTabs();

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
      const idx = tabs.findIndex((t) => t.id === id);
      newActiveId = newTabs[Math.min(idx, newTabs.length - 1)]?.id ?? newTabs[0].id;
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
}));
