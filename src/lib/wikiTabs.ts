/** The wiki's tabs: each article tab keeps its own back/forward history. */
/** What a tab shows: an article id, or a project file's `file:…` key. */
export type WikiRef = number | string;

export type WikiTab =
  | { key: string; kind: "article"; history: WikiRef[]; pos: number }
  | { key: "graph"; kind: "graph" };

export interface TabsState {
  tabs: WikiTab[];
  active: string | null;
}

export const EMPTY_TABS: TabsState = { tabs: [], active: null };

export function tabRef(tab: WikiTab | undefined): WikiRef | null {
  return tab?.kind === "article" ? tab.history[tab.pos] ?? null : null;
}

export function tabArticleId(tab: WikiTab | undefined): number | null {
  const ref = tabRef(tab);
  return typeof ref === "number" ? ref : null;
}

function newTabKey(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Open `id`: in the current article tab (adding to its history), or in a
 *  new tab — reusing a tab that already shows it. */
export function openInTabs(state: TabsState, id: WikiRef, newTab: boolean): TabsState {
  const activeIdx = state.tabs.findIndex((t) => t.key === state.active);
  const active = state.tabs[activeIdx];
  if (!newTab && active?.kind === "article") {
    if (tabRef(active) === id) return state;
    const history = [...active.history.slice(0, active.pos + 1), id];
    const tabs = [...state.tabs];
    tabs[activeIdx] = { ...active, history, pos: history.length - 1 };
    return { ...state, tabs };
  }
  const existing = state.tabs.find((t) => tabRef(t) === id);
  if (existing) return { ...state, active: existing.key };
  const tab: WikiTab = { key: newTabKey(), kind: "article", history: [id], pos: 0 };
  const tabs = [...state.tabs];
  tabs.splice(activeIdx + 1, 0, tab);
  return { tabs, active: tab.key };
}

export function closeTab(state: TabsState, key: string): TabsState {
  const idx = state.tabs.findIndex((t) => t.key === key);
  if (idx < 0) return state;
  const tabs = state.tabs.filter((t) => t.key !== key);
  const active =
    state.active === key ? tabs[Math.min(idx, tabs.length - 1)]?.key ?? null : state.active;
  return { tabs, active };
}

/** Drops deleted articles from every tab's history, and empty tabs.
 *  Files stay: they come and go with the project folder. */
export function pruneTabs(state: TabsState, exists: Set<number>): TabsState {
  let changed = false;
  const tabs: WikiTab[] = [];
  for (const tab of state.tabs) {
    if (tab.kind !== "article") {
      tabs.push(tab);
      continue;
    }
    const current = tab.history[tab.pos];
    const history = tab.history.filter((id) => typeof id === "string" || exists.has(id));
    if (history.length === tab.history.length) {
      tabs.push(tab);
      continue;
    }
    changed = true;
    if (history.length === 0) continue;
    const kept = history.indexOf(current);
    tabs.push({ ...tab, history, pos: kept >= 0 ? kept : history.length - 1 });
  }
  if (!changed) return state;
  const active = tabs.some((t) => t.key === state.active) ? state.active : tabs[0]?.key ?? null;
  return { tabs, active };
}
