import { create } from "zustand";
import type { LayoutItem } from "react-grid-layout";
import { useOrgStore } from "./org-store";

export type WidgetType =
  | "kpi-invoiced"
  | "kpi-balance"
  | "kpi-expenses"
  | "kpi-net"
  | "chart-revenue"
  | "recent-invoices"
  | "today-tasks"
  | "overdue-tasks"
  | "project-progress"
  | "upcoming-deadlines"
  | "revenue-by-activity"
  | "revenue-by-client"
  | "this-week-events"
  // Phase 18 — Financial
  | "unpaid-invoices"
  | "expense-breakdown"
  | "monthly-comparison"
  | "profit-margin"
  | "top-client"
  | "average-invoice-value"
  // outstanding-total removed (duplicate of kpi-balance)
  | "quote-conversion-rate"
  // Phase 18 — Client insights
  | "client-activity"
  | "new-clients-year"
  // Phase 18 — Project health
  | "stale-tasks"
  | "projects-without-deadline"
  // Phase 18 — Calendar/Time
  // today-schedule removed (duplicate of today-tasks)
  | "free-days-week"
  | "upcoming-reminders"
  // Phase 18 — Productivity
  | "recently-completed"
  | "stale-projects"
  | "weekly-streak"
  | "busiest-day"
  // Phase 18 — Utility
  | "quick-create"
  | "pinned-notes"
  // Phase 13 — Time tracking
  | "time-this-week"
  | "planned-vs-actual"
  | "top-time-consumers"
  | "billable-summary"
  | "weekly-trend"
  | "project-time-distribution"
  | "invoice-aging"
  // Studio upkeep
  | "upkeep"
  // Wiki
  | "wiki-recent"
  | "wiki-overview";

export interface DashboardWidget {
  id: string;
  type: WidgetType;
}

export interface WidgetCatalogEntry {
  type: WidgetType;
  labelKey: string;
  category: "financial" | "workload" | "calendar" | "client" | "productivity" | "utility";
  defaultW: number;
  defaultH: number;
  minW?: number;
  minH?: number;
}

export const WIDGET_CATALOG: WidgetCatalogEntry[] = [
  { type: "kpi-invoiced", labelKey: "total_invoiced", category: "financial", defaultW: 2, defaultH: 2, minW: 2, minH: 2 },
  { type: "kpi-balance", labelKey: "open_balance", category: "financial", defaultW: 2, defaultH: 2, minW: 2, minH: 2 },
  { type: "kpi-expenses", labelKey: "total_expenses", category: "financial", defaultW: 2, defaultH: 2, minW: 2, minH: 2 },
  { type: "kpi-net", labelKey: "net_result", category: "financial", defaultW: 2, defaultH: 2, minW: 2, minH: 2 },
  { type: "chart-revenue", labelKey: "revenue_vs_expenses", category: "financial", defaultW: 4, defaultH: 4, minW: 4, minH: 4 },
  { type: "recent-invoices", labelKey: "recent_invoices", category: "financial", defaultW: 3, defaultH: 3, minW: 3, minH: 3 },
  { type: "today-tasks", labelKey: "today", category: "workload", defaultW: 3, defaultH: 3, minW: 3, minH: 3 },
  { type: "overdue-tasks", labelKey: "overdue", category: "workload", defaultW: 3, defaultH: 3, minW: 3, minH: 3 },
  { type: "project-progress", labelKey: "progress", category: "workload", defaultW: 3, defaultH: 3, minW: 3, minH: 3 },
  { type: "upcoming-deadlines", labelKey: "deadline", category: "calendar", defaultW: 3, defaultH: 3, minW: 3, minH: 3 },
  { type: "revenue-by-activity", labelKey: "revenue_by_activity", category: "financial", defaultW: 3, defaultH: 3, minW: 3, minH: 3 },
  { type: "revenue-by-client", labelKey: "revenue_by_client", category: "financial", defaultW: 3, defaultH: 3, minW: 3, minH: 3 },
  { type: "this-week-events", labelKey: "this_week", category: "calendar", defaultW: 3, defaultH: 3, minW: 3, minH: 3 },
  // Phase 18 — Financial
  { type: "unpaid-invoices", labelKey: "unpaid_invoices", category: "financial", defaultW: 3, defaultH: 3, minW: 3, minH: 3 },
  { type: "expense-breakdown", labelKey: "expense_breakdown", category: "financial", defaultW: 3, defaultH: 3, minW: 2, minH: 3 },
  { type: "monthly-comparison", labelKey: "monthly_comparison", category: "financial", defaultW: 3, defaultH: 2, minW: 3, minH: 2 },
  { type: "profit-margin", labelKey: "profit_margin", category: "financial", defaultW: 2, defaultH: 2, minW: 2, minH: 2 },
  { type: "top-client", labelKey: "top_client", category: "financial", defaultW: 2, defaultH: 2, minW: 2, minH: 2 },
  { type: "average-invoice-value", labelKey: "avg_invoice_value", category: "financial", defaultW: 2, defaultH: 2, minW: 2, minH: 2 },
  { type: "quote-conversion-rate", labelKey: "quote_conversion_rate", category: "financial", defaultW: 2, defaultH: 2, minW: 2, minH: 2 },
  // Phase 18 — Client insights
  { type: "client-activity", labelKey: "client_activity", category: "client", defaultW: 3, defaultH: 3, minW: 3, minH: 3 },
  { type: "new-clients-year", labelKey: "new_clients_year", category: "client", defaultW: 2, defaultH: 2, minW: 2, minH: 2 },
  // Phase 18 — Project health
  { type: "stale-tasks", labelKey: "stale_tasks", category: "workload", defaultW: 3, defaultH: 3, minW: 3, minH: 3 },
  { type: "projects-without-deadline", labelKey: "projects_no_deadline", category: "workload", defaultW: 3, defaultH: 3, minW: 3, minH: 3 },
  // Phase 18 — Calendar/Time
  { type: "free-days-week", labelKey: "free_days_week", category: "calendar", defaultW: 2, defaultH: 2, minW: 2, minH: 2 },
  { type: "upcoming-reminders", labelKey: "upcoming_reminders", category: "calendar", defaultW: 3, defaultH: 3, minW: 3, minH: 3 },
  // Phase 18 — Productivity
  { type: "recently-completed", labelKey: "recently_completed", category: "productivity", defaultW: 3, defaultH: 3, minW: 3, minH: 3 },
  { type: "stale-projects", labelKey: "stale_projects", category: "productivity", defaultW: 3, defaultH: 3, minW: 3, minH: 3 },
  { type: "weekly-streak", labelKey: "weekly_streak", category: "productivity", defaultW: 2, defaultH: 2, minW: 2, minH: 2 },
  { type: "busiest-day", labelKey: "busiest_day", category: "productivity", defaultW: 3, defaultH: 3, minW: 3, minH: 3 },
  // Phase 18 — Utility
  { type: "quick-create", labelKey: "quick_create", category: "utility", defaultW: 3, defaultH: 3, minW: 3, minH: 3 },
  { type: "pinned-notes", labelKey: "pinned_notes", category: "utility", defaultW: 3, defaultH: 3, minW: 3, minH: 3 },
  { type: "upkeep", labelKey: "upkeep_widget", category: "utility", defaultW: 3, defaultH: 4, minW: 3, minH: 3 },
  { type: "wiki-recent", labelKey: "wiki_recent_widget", category: "utility", defaultW: 3, defaultH: 3, minW: 3, minH: 3 },
  { type: "wiki-overview", labelKey: "wiki_articles", category: "utility", defaultW: 2, defaultH: 2, minW: 2, minH: 2 },
  // Financial — Invoice aging
  { type: "invoice-aging", labelKey: "invoice_aging", category: "financial", defaultW: 4, defaultH: 4, minW: 3, minH: 3 },
  // Phase 13 — Time tracking
  { type: "time-this-week", labelKey: "time_this_week", category: "productivity", defaultW: 4, defaultH: 4, minW: 3, minH: 3 },
  { type: "planned-vs-actual", labelKey: "planned_vs_actual", category: "productivity", defaultW: 4, defaultH: 4, minW: 3, minH: 3 },
  { type: "top-time-consumers", labelKey: "top_time_consumers", category: "productivity", defaultW: 3, defaultH: 3, minW: 3, minH: 3 },
  { type: "billable-summary", labelKey: "billable_summary", category: "financial", defaultW: 2, defaultH: 2, minW: 2, minH: 2 },
  { type: "weekly-trend", labelKey: "weekly_trend", category: "productivity", defaultW: 4, defaultH: 4, minW: 3, minH: 3 },
  { type: "project-time-distribution", labelKey: "project_time_distribution", category: "productivity", defaultW: 4, defaultH: 4, minW: 3, minH: 3 },
];

const DEFAULT_WIDGETS: DashboardWidget[] = [
  { id: "w-kpi-invoiced", type: "kpi-invoiced" },
  { id: "w-kpi-balance", type: "kpi-balance" },
  { id: "w-kpi-expenses", type: "kpi-expenses" },
  { id: "w-kpi-net", type: "kpi-net" },
  { id: "w-chart-revenue", type: "chart-revenue" },
  { id: "w-recent-invoices", type: "recent-invoices" },
  { id: "w-today-tasks", type: "today-tasks" },
  { id: "w-overdue-tasks", type: "overdue-tasks" },
  { id: "w-upkeep", type: "upkeep" },
];

export const DEFAULT_LAYOUT: LayoutItem[] = [
  { i: "w-kpi-invoiced", x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: "w-kpi-balance", x: 3, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: "w-kpi-expenses", x: 6, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: "w-kpi-net", x: 9, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: "w-chart-revenue", x: 0, y: 2, w: 8, h: 5, minW: 4, minH: 4 },
  { i: "w-recent-invoices", x: 8, y: 2, w: 4, h: 5, minW: 3, minH: 3 },
  { i: "w-today-tasks", x: 0, y: 7, w: 6, h: 4, minW: 3, minH: 3 },
  { i: "w-overdue-tasks", x: 6, y: 7, w: 6, h: 4, minW: 3, minH: 3 },
  { i: "w-upkeep", x: 0, y: 11, w: 4, h: 4, minW: 3, minH: 3 },
];

// Widths of the dashboard itself, not the window: with the sidebar open and the
// page padding, the 12-column layout starts at a window of about 1170px, so the
// default 1280px window can be arranged.
export const DASHBOARD_BREAKPOINTS = { lg: 880, md: 700, sm: 520, xs: 0 };
export const DASHBOARD_COLS = { lg: 12, md: 10, sm: 6, xs: 4 };

/** The saved layout is the 12-column one. Narrower windows show a copy the
 *  grid squeezes to fewer columns, which must never be saved over it.
 *  Same rule as react-grid-layout: `lg` once the width is above its breakpoint. */
export function isFullWidthLayout(width: number): boolean {
  return width > DASHBOARD_BREAKPOINTS.lg;
}

// Each organisation keeps its own dashboard: these keys are written as
// `<key>:<organisation id>` (listed in org-store's NAMESPACED_KEYS).
const orgKey = (base: string) => useOrgStore.getState().orgKey(base);
const STORAGE_KEY = () => orgKey("dashboard-layout");
const WIDGETS_KEY = () => orgKey("dashboard-widgets");
const NOTES_KEY = () => orgKey("dashboard-pinned-notes");
const PRESET_ID_KEY = () => orgKey("dashboard-preset-id");
const PRESET_NAME_KEY = () => orgKey("dashboard-preset-name");
// Set once the saved layout has been checked for a squeezed 3.4.0 copy (no legacy
// un-namespaced value exists, so it isn't in NAMESPACED_KEYS). "-2": the first
// check stretched only whole layouts, so it runs again with the per-row rule.
const SPREAD_KEY = () => orgKey("dashboard-layout-spread-2");
const OLD_SPREAD_KEY = () => orgKey("dashboard-layout-spread");

/** Columns of the saved layout, written into presets so old ones can be told apart. */
const FULL_COLS = DASHBOARD_COLS.lg;

/** Groups of widgets whose rows overlap, top to bottom. */
function rowBands(layout: LayoutItem[]): LayoutItem[][] {
  const sorted = [...layout].sort((a, b) => a.y - b.y);
  const bands: LayoutItem[][] = [];
  let bottom = -Infinity;
  for (const item of sorted) {
    if (item.y >= bottom) bands.push([]);
    bands[bands.length - 1].push(item);
    bottom = Math.max(bottom, item.y + item.h);
  }
  return bands;
}

const rightEdge = (items: LayoutItem[]) => Math.max(0, ...items.map((l) => l.x + l.w));

/**
 * v3.4.0 saved the copy the grid squeezed into a narrower window (10, 6 or 4
 * columns) as the 12-column layout, which then filled only the left part of the
 * dashboard. Stretches the squeezed rows over the 12 columns, keeping each widget's
 * order and proportion. The squeezed copy is the top of the layout (3.4.0 added new
 * widgets at the bottom), so only the narrow rows above the first row reaching
 * column 11 or 12 are stretched: widgets added at full width since, and a narrow
 * row below them (left that way on purpose), are kept as they are. The layout is
 * returned as is when nothing is stretched.
 */
export function spreadSqueezedLayout(layout: LayoutItem[]): LayoutItem[] {
  const bands = rowBands(layout);
  const firstFull = bands.findIndex((band) => rightEdge(band) > DASHBOARD_COLS.md);
  const squeezed = (firstFull === -1 ? bands : bands.slice(0, firstFull)).flat();
  // All squeezed rows come from the same narrow copy: one scale for all of them.
  const edge = rightEdge(squeezed);
  if (edge === 0) return layout;
  const stretch = new Set(squeezed);
  const scale = (n: number) => Math.round((n * FULL_COLS) / edge);
  return layout.map((item) => {
    if (!stretch.has(item)) return item;
    const x = scale(item.x);
    const w = Math.min(FULL_COLS - x, Math.max(scale(item.x + item.w) - x, item.minW ?? 1));
    return { ...item, x, w };
  });
}

/** A preset's layout: presets saved before `cols` was written may be squeezed. */
export function presetLayout(saved: { layout: LayoutItem[]; cols?: number }): LayoutItem[] {
  return saved.cols === FULL_COLS ? saved.layout : spreadSqueezedLayout(saved.layout);
}

/** What a preset stores: widgets, layout and the layout's columns. */
export function presetJson(widgets: DashboardWidget[], layout: LayoutItem[]): string {
  return JSON.stringify({ widgets, layout, cols: FULL_COLS });
}

function loadLayout(): LayoutItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY());
    // Once per organisation: later layouts are saved at full width only, and one left
    // narrow on purpose must not be stretched.
    const checked = localStorage.getItem(SPREAD_KEY()) !== null;
    const markChecked = () => {
      localStorage.setItem(SPREAD_KEY(), "1");
      localStorage.removeItem(OLD_SPREAD_KEY());
    };
    if (!raw) {
      if (!checked) markChecked();
      return DEFAULT_LAYOUT;
    }
    const saved = JSON.parse(raw) as LayoutItem[];
    if (checked) return saved;
    const spread = spreadSqueezedLayout(saved);
    if (spread !== saved) localStorage.setItem(STORAGE_KEY(), JSON.stringify(spread));
    markChecked();
    return spread;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function loadWidgets(): DashboardWidget[] {
  try {
    const raw = localStorage.getItem(WIDGETS_KEY());
    return raw ? JSON.parse(raw) : DEFAULT_WIDGETS;
  } catch {
    return DEFAULT_WIDGETS;
  }
}

function loadNotes(): string {
  return localStorage.getItem(NOTES_KEY()) ?? "";
}

function loadPresetId(): number | null {
  const raw = localStorage.getItem(PRESET_ID_KEY());
  return raw ? Number(raw) : null;
}

/** Empty when no preset is active: the page then shows the translated "Custom". */
function loadPresetName(): string {
  return localStorage.getItem(PRESET_NAME_KEY()) ?? "";
}

/**
 * The first spot, reading top to bottom then left to right, where a w x h
 * widget fits without covering another one, in the saved 12-column layout.
 * Below everything when no gap is big enough.
 */
export function findFreeSpot(layout: LayoutItem[], w: number, h: number, cols = DASHBOARD_COLS.lg): { x: number; y: number } {
  const width = Math.min(w, cols);
  const bottom = layout.reduce((max, l) => Math.max(max, l.y + l.h), 0);
  const overlaps = (x: number, y: number) =>
    layout.some((l) => x < l.x + l.w && x + width > l.x && y < l.y + l.h && y + h > l.y);
  for (let y = 0; y < bottom; y++) {
    for (let x = 0; x + width <= cols; x++) {
      if (!overlaps(x, y)) return { x, y };
    }
  }
  return { x: 0, y: bottom };
}

/**
 * Brings each widget up to its catalog's minimum size. A saved layout keeps
 * the minimum the widget had when it was added, so a widget whose minimum
 * grew (it was too small to show its content) is fixed on load.
 */
export function fitLayoutToCatalog(widgets: DashboardWidget[], layout: LayoutItem[]): LayoutItem[] {
  const typeOf = new Map(widgets.map((w) => [w.id, w.type]));
  return layout.map((item) => {
    const entry = WIDGET_CATALOG.find((c) => c.type === typeOf.get(item.i));
    const minW = entry?.minW ?? 0;
    const minH = entry?.minH ?? 0;
    const tooSmall =
      item.w < minW || item.h < minH ||
      (item.minW !== undefined && item.minW < minW) ||
      (item.minH !== undefined && item.minH < minH);
    if (!tooSmall) return item;
    return {
      ...item,
      minW: Math.max(item.minW ?? 0, minW),
      minH: Math.max(item.minH ?? 0, minH),
      w: Math.max(item.w, minW),
      h: Math.max(item.h, minH),
    };
  });
}

function loadAll() {
  const widgets = loadWidgets();
  return {
    widgets,
    layout: fitLayoutToCatalog(widgets, loadLayout()),
    pinnedNotes: loadNotes(),
    activePresetId: loadPresetId(),
    activePresetName: loadPresetName(),
  };
}

interface DashboardState {
  widgets: DashboardWidget[];
  layout: LayoutItem[];
  pinnedNotes: string;
  activePresetId: number | null;
  activePresetName: string;
  setLayout: (layout: LayoutItem[]) => void;
  addWidget: (type: WidgetType) => void;
  removeWidget: (id: string) => void;
  /** Puts a removed widget back where it was (the undo of removeWidget). */
  restoreWidget: (widget: DashboardWidget, item: LayoutItem | undefined) => void;
  resetDashboard: () => void;
  setPinnedNotes: (text: string) => void;
  setActivePreset: (id: number | null, name: string, widgets: DashboardWidget[], layout: LayoutItem[]) => void;
  /** Re-read the active organisation's dashboard (after an organisation switch). */
  reloadForOrg: () => void;
}

function clearPresetTracking() {
  localStorage.removeItem(PRESET_ID_KEY());
  localStorage.removeItem(PRESET_NAME_KEY());
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  ...loadAll(),

  setLayout: (layout) => {
    localStorage.setItem(STORAGE_KEY(), JSON.stringify(layout));
    set({ layout });
  },

  addWidget: (type) => {
    const catalog = WIDGET_CATALOG.find((c) => c.type === type);
    if (!catalog) return;
    const id = `w-${type}-${Date.now()}`;
    const widgets = [...get().widgets, { id, type }];
    const { x, y } = findFreeSpot(get().layout, catalog.defaultW, catalog.defaultH);
    const layout = [
      ...get().layout,
      { i: id, x, y, w: catalog.defaultW, h: catalog.defaultH, minW: catalog.minW, minH: catalog.minH },
    ];
    localStorage.setItem(WIDGETS_KEY(), JSON.stringify(widgets));
    localStorage.setItem(STORAGE_KEY(), JSON.stringify(layout));
    clearPresetTracking();
    set({ widgets, layout, activePresetId: null, activePresetName: "" });
  },

  removeWidget: (id) => {
    const widgets = get().widgets.filter((w) => w.id !== id);
    const layout = get().layout.filter((l) => l.i !== id);
    localStorage.setItem(WIDGETS_KEY(), JSON.stringify(widgets));
    localStorage.setItem(STORAGE_KEY(), JSON.stringify(layout));
    clearPresetTracking();
    set({ widgets, layout, activePresetId: null, activePresetName: "" });
  },

  restoreWidget: (widget, item) => {
    if (get().widgets.some((w) => w.id === widget.id)) return;
    const widgets = [...get().widgets, widget];
    const layout = item ? [...get().layout, item] : get().layout;
    localStorage.setItem(WIDGETS_KEY(), JSON.stringify(widgets));
    localStorage.setItem(STORAGE_KEY(), JSON.stringify(layout));
    set({ widgets, layout });
  },

  resetDashboard: () => {
    localStorage.setItem(WIDGETS_KEY(), JSON.stringify(DEFAULT_WIDGETS));
    localStorage.setItem(STORAGE_KEY(), JSON.stringify(DEFAULT_LAYOUT));
    clearPresetTracking();
    set({ widgets: DEFAULT_WIDGETS, layout: DEFAULT_LAYOUT, activePresetId: null, activePresetName: "" });
  },

  setPinnedNotes: (text) => {
    localStorage.setItem(NOTES_KEY(), text);
    set({ pinnedNotes: text });
  },

  setActivePreset: (id, name, widgets, presetLayout) => {
    const layout = fitLayoutToCatalog(widgets, presetLayout);
    localStorage.setItem(WIDGETS_KEY(), JSON.stringify(widgets));
    localStorage.setItem(STORAGE_KEY(), JSON.stringify(layout));
    if (id !== null) {
      localStorage.setItem(PRESET_ID_KEY(), String(id));
      localStorage.setItem(PRESET_NAME_KEY(), name);
    } else {
      clearPresetTracking();
    }
    set({ widgets, layout, activePresetId: id, activePresetName: id !== null ? name : "" });
  },

  reloadForOrg: () => set(loadAll()),
}));

// org-store must not import this store (import cycle), so the reload on an
// organisation switch is wired here, as tab-store does.
useOrgStore.subscribe((s, prev) => {
  if (s.activeId !== prev.activeId) useDashboardStore.getState().reloadForOrg();
});
