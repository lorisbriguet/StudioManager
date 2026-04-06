import { create } from "zustand";
import type { LayoutItem } from "react-grid-layout";

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
  | "invoice-aging";

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
  { type: "busiest-day", labelKey: "busiest_day", category: "productivity", defaultW: 3, defaultH: 2, minW: 3, minH: 2 },
  // Phase 18 — Utility
  { type: "quick-create", labelKey: "quick_create", category: "utility", defaultW: 2, defaultH: 2, minW: 2, minH: 2 },
  { type: "pinned-notes", labelKey: "pinned_notes", category: "utility", defaultW: 3, defaultH: 3, minW: 3, minH: 3 },
  // Financial — Invoice aging
  { type: "invoice-aging", labelKey: "invoice_aging", category: "financial", defaultW: 4, defaultH: 4, minW: 3, minH: 3 },
  // Phase 13 — Time tracking
  { type: "time-this-week", labelKey: "time_this_week", category: "productivity", defaultW: 4, defaultH: 4, minW: 3, minH: 3 },
  { type: "planned-vs-actual", labelKey: "planned_vs_actual", category: "productivity", defaultW: 4, defaultH: 4, minW: 3, minH: 3 },
  { type: "top-time-consumers", labelKey: "top_time_consumers", category: "productivity", defaultW: 3, defaultH: 3, minW: 3, minH: 3 },
  { type: "billable-summary", labelKey: "billable_summary", category: "financial", defaultW: 2, defaultH: 2, minW: 2, minH: 2 },
  { type: "weekly-trend", labelKey: "weekly_trend", category: "productivity", defaultW: 4, defaultH: 4, minW: 3, minH: 3 },
  { type: "project-time-distribution", labelKey: "project_time_distribution", category: "productivity", defaultW: 3, defaultH: 3, minW: 3, minH: 3 },
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
];

const DEFAULT_LAYOUT: LayoutItem[] = [
  { i: "w-kpi-invoiced", x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: "w-kpi-balance", x: 3, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: "w-kpi-expenses", x: 6, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: "w-kpi-net", x: 9, y: 0, w: 3, h: 2, minW: 2, minH: 2 },
  { i: "w-chart-revenue", x: 0, y: 2, w: 8, h: 5, minW: 4, minH: 4 },
  { i: "w-recent-invoices", x: 8, y: 2, w: 4, h: 5, minW: 3, minH: 3 },
  { i: "w-today-tasks", x: 0, y: 7, w: 6, h: 4, minW: 3, minH: 3 },
  { i: "w-overdue-tasks", x: 6, y: 7, w: 6, h: 4, minW: 3, minH: 3 },
];

const STORAGE_KEY = "dashboard-layout";
const WIDGETS_KEY = "dashboard-widgets";

function loadLayout(): LayoutItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function loadWidgets(): DashboardWidget[] {
  try {
    const raw = localStorage.getItem(WIDGETS_KEY);
    return raw ? JSON.parse(raw) : DEFAULT_WIDGETS;
  } catch {
    return DEFAULT_WIDGETS;
  }
}

const NOTES_KEY = "dashboard-pinned-notes";
const PRESET_ID_KEY = "dashboard-preset-id";
const PRESET_NAME_KEY = "dashboard-preset-name";

function loadNotes(): string {
  return localStorage.getItem(NOTES_KEY) ?? "";
}

function loadPresetId(): number | null {
  const raw = localStorage.getItem(PRESET_ID_KEY);
  return raw ? Number(raw) : null;
}

function loadPresetName(): string {
  return localStorage.getItem(PRESET_NAME_KEY) ?? "Custom";
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
  resetDashboard: () => void;
  setPinnedNotes: (text: string) => void;
  setActivePreset: (id: number | null, name: string, widgets: DashboardWidget[], layout: LayoutItem[]) => void;
}

function clearPresetTracking() {
  localStorage.removeItem(PRESET_ID_KEY);
  localStorage.setItem(PRESET_NAME_KEY, "Custom");
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  widgets: loadWidgets(),
  layout: loadLayout(),
  pinnedNotes: loadNotes(),
  activePresetId: loadPresetId(),
  activePresetName: loadPresetName(),

  setLayout: (layout) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    set({ layout });
  },

  addWidget: (type) => {
    const catalog = WIDGET_CATALOG.find((c) => c.type === type);
    if (!catalog) return;
    const id = `w-${type}-${Date.now()}`;
    const widgets = [...get().widgets, { id, type }];
    // Place at bottom-left
    const maxY = get().layout.reduce((max, l) => Math.max(max, l.y + l.h), 0);
    const layout = [
      ...get().layout,
      { i: id, x: 0, y: maxY, w: catalog.defaultW, h: catalog.defaultH, minW: catalog.minW, minH: catalog.minH },
    ];
    localStorage.setItem(WIDGETS_KEY, JSON.stringify(widgets));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    clearPresetTracking();
    set({ widgets, layout, activePresetId: null, activePresetName: "Custom" });
  },

  removeWidget: (id) => {
    const widgets = get().widgets.filter((w) => w.id !== id);
    const layout = get().layout.filter((l) => l.i !== id);
    localStorage.setItem(WIDGETS_KEY, JSON.stringify(widgets));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    clearPresetTracking();
    set({ widgets, layout, activePresetId: null, activePresetName: "Custom" });
  },

  resetDashboard: () => {
    localStorage.setItem(WIDGETS_KEY, JSON.stringify(DEFAULT_WIDGETS));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_LAYOUT));
    clearPresetTracking();
    set({ widgets: DEFAULT_WIDGETS, layout: DEFAULT_LAYOUT, activePresetId: null, activePresetName: "Custom" });
  },

  setPinnedNotes: (text) => {
    localStorage.setItem(NOTES_KEY, text);
    set({ pinnedNotes: text });
  },

  setActivePreset: (id, name, widgets, layout) => {
    localStorage.setItem(WIDGETS_KEY, JSON.stringify(widgets));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    if (id !== null) {
      localStorage.setItem(PRESET_ID_KEY, String(id));
    } else {
      localStorage.removeItem(PRESET_ID_KEY);
    }
    localStorage.setItem(PRESET_NAME_KEY, name);
    set({ widgets, layout, activePresetId: id, activePresetName: name });
  },
}));
