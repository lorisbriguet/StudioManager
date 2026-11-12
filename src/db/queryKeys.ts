import type { QueryClient } from "@tanstack/react-query";

/**
 * Every React Query key, in one place. Hooks and widgets read keys from `qk`
 * instead of writing arrays inline, so a write can find every query it makes
 * stale. A key's value is its prefix: invalidating `qk.finance.all` also
 * refreshes `qk.finance.pl(2026)`.
 *
 * Writes that change money or tracked time call `invalidateMoney` or
 * `invalidateTimeTracking` below, which also refresh the dashboard widgets.
 */

type Id = string | number;
type MaybeId = Id | null | undefined;

/**
 * A key prefix by its name, for code that holds key names as strings
 * (agentChangeKeys maps each agent tool to the prefixes it changes).
 */
export const keyPrefix = (name: string) => [name] as const;

/** Keys for a document kind (invoices or quotes). */
function documentKeys<P extends string>(prefix: P) {
  return {
    all: [prefix] as const,
    detail: (id: number) => [prefix, id] as const,
    byProject: (projectId: number) => [prefix, "project", projectId] as const,
  };
}

export const qk = {
  captures: {
    all: ["captures"] as const,
  },
  invoices: {
    ...documentKeys("invoices"),
    byClient: (clientId: string) => ["invoices", "client", clientId] as const,
    lineItems: (id: number) => ["invoice-line-items", id] as const,
  },
  quotes: {
    ...documentKeys("quotes"),
    lineItems: (id: number) => ["quotes", id, "lineItems"] as const,
  },
  incomes: {
    all: ["incomes"] as const,
  },
  expenses: {
    all: ["expenses"] as const,
    distinctSuppliers: ["expenses", "distinct-suppliers"] as const,
    supplierCounts: ["expenses", "supplier-counts"] as const,
  },
  expenseCategories: {
    all: ["expense-categories"] as const,
  },
  finance: {
    all: ["finance"] as const,
    pl: (year: number) => ["finance", "pl", year] as const,
    monthly: (year: number) => ["finance", "monthly", year] as const,
    kpis: (year: number) => ["finance", "dashboard", year] as const,
    revenueByActivity: (year: number) => ["finance", "revenue-by-activity", year] as const,
    revenueByClient: (year: number) => ["finance", "revenue-by-client", year] as const,
  },
  timeEntries: {
    all: ["time-entries"] as const,
    details: (startDate?: string, endDate?: string, projectId?: number) =>
      ["time-entries", "details", startDate, endDate, projectId] as const,
  },
  invoiceTemplates: {
    all: ["invoice-templates"] as const,
    detail: (id: MaybeId) => ["invoice-templates", id] as const,
    default: ["invoice-templates", "default"] as const,
  },
  recurring: {
    all: ["recurring_templates"] as const,
  },
  businessProfile: {
    all: ["business-profile"] as const,
  },
  activities: {
    all: ["activities"] as const,
  },
  clients: {
    all: ["clients"] as const,
    detail: (id: MaybeId) => ["clients", id] as const,
    activity: (clientId: MaybeId) => ["client-activity", clientId] as const,
    /** Every client's activity (invoices, quotes and projects of each client). */
    activityAll: ["client-activity"] as const,
    addresses: (clientId: MaybeId) => ["client-addresses", clientId] as const,
    contacts: (clientId: MaybeId) => ["client-contacts", clientId] as const,
  },
  projects: {
    all: ["projects"] as const,
    detail: (id: MaybeId) => ["projects", id] as const,
    byClient: (clientId: MaybeId) => ["projects", "client", clientId] as const,
    materialCost: (projectId: MaybeId) => ["project-material-cost", projectId] as const,
  },
  projectTables: {
    byProject: (projectId: MaybeId) => ["project-tables", projectId] as const,
    allRows: ["project-table-rows"] as const,
    rows: (tableId: MaybeId) => ["project-table-rows", tableId] as const,
  },
  projectDocs: {
    list: (projectId: MaybeId, folder: MaybeId) => ["project-docs", projectId, folder] as const,
    doc: (folder: MaybeId, rel: MaybeId) => ["project-doc", folder, rel] as const,
  },
  tasks: {
    all: ["tasks"] as const,
    byProject: (projectId: MaybeId) => ["tasks", "project", projectId] as const,
    visible: ["tasks", "visible"] as const,
    withDueDate: ["tasks", "with-due-date"] as const,
  },
  subtasks: {
    all: ["subtasks"] as const,
    byProject: (projectId: MaybeId) => ["subtasks", "project", projectId] as const,
    withDueDate: ["subtasks", "with-due-date"] as const,
  },
  workload: {
    all: ["workload-rows"] as const,
    byProject: (projectId: MaybeId) => ["workload-rows", projectId] as const,
    allConfig: ["workload-config"] as const,
    config: (projectId: MaybeId) => ["workload-config", projectId] as const,
    configsAll: ["workload-configs-all"] as const,
    templates: ["workload-templates"] as const,
  },
  wiki: {
    folders: ["wiki-folders"] as const,
    allArticles: ["wiki-articles"] as const,
    articles: (folderId: MaybeId) => ["wiki-articles", folderId] as const,
    anyArticle: ["wiki-article"] as const,
    article: (id: MaybeId) => ["wiki-article", id] as const,
    allByProject: ["wiki-articles-by-project"] as const,
    byProject: (projectId: MaybeId) => ["wiki-articles-by-project", projectId] as const,
    tags: ["wiki-tags"] as const,
    allArticleTags: ["wiki-article-tags"] as const,
    articleTags: (articleId: MaybeId) => ["wiki-article-tags", articleId] as const,
  },
  resources: {
    all: ["resources"] as const,
    byProject: (projectId: MaybeId) => ["resources", "project", projectId] as const,
    tags: ["resource-tags"] as const,
  },
  customLists: {
    all: ["custom-lists"] as const,
    allItems: ["custom-list-items"] as const,
    items: (listId: MaybeId) => ["custom-list-items", listId] as const,
  },
  savedFilters: {
    byPage: (page: MaybeId) => ["saved-filters", page] as const,
  },
  dashboardPresets: {
    all: ["dashboard-presets"] as const,
  },
  notifications: {
    all: ["notifications"] as const,
    unreadCount: ["notifications", "unread-count"] as const,
  },
  machines: {
    all: ["machines"] as const,
    detail: (id: MaybeId) => ["machines", id] as const,
    files: (machineId: MaybeId) => ["machines", machineId, "files"] as const,
    projects: (machineId: MaybeId) => ["machines", machineId, "projects"] as const,
    allByProject: ["machines", "project"] as const,
    byProject: (projectId: MaybeId) => ["machines", "project", projectId] as const,
    links: ["machine-links"] as const,
    allDisks: ["machine-disks"] as const,
    disks: (machineId: MaybeId) => ["machine-disks", machineId] as const,
    allReadings: ["machine-readings"] as const,
    readings: (machineId: MaybeId, metric: MaybeId) => ["machine-readings", machineId, metric] as const,
    latestReading: (machineId: MaybeId, prefix: MaybeId) => ["machine-readings", machineId, "latest", prefix] as const,
    serviceLog: (machineId: MaybeId) => ["service-log", machineId] as const,
  },
  upkeep: {
    all: ["upkeep-items"] as const,
    active: ["upkeep-items", "active"] as const,
    /** Pass "all" for every machine. */
    byMachine: (machineId: MaybeId) => ["upkeep-items", machineId] as const,
  },
  consumables: {
    all: ["consumables"] as const,
  },
  subscriptions: {
    all: ["subscriptions"] as const,
    renewals: ["subscription-renewals"] as const,
  },
  connections: {
    all: ["connections"] as const,
    equipment: ["equipment-connections"] as const,
  },
  paperless: {
    thumb: (connectionId: MaybeId, docId: MaybeId) => ["paperless-thumb", connectionId, docId] as const,
  },
  system: {
    tailscale: ["tailscale"] as const,
    timeMachine: ["time-machine"] as const,
  },
  /** Dashboard widgets that read their own query (src/components/dashboard/widgets.tsx). */
  dashboard: {
    timeThisWeek: ["time-this-week"] as const,
    weeklyTrend: ["weekly-trend"] as const,
    topTimeConsumers: ["top-time-consumers"] as const,
    projectTimeDistribution: ["project-time-distribution"] as const,
    plannedVsActual: ["planned-vs-actual"] as const,
    billableSummary: ["billable-summary"] as const,
    invoiceAging: ["invoice-aging"] as const,
    expenseCategories: ["expense-categories-all"] as const,
  },
};

/**
 * After a write to invoices, quotes, income, expenses or expense categories:
 * refreshes the finance figures and the dashboard money widgets. The caller
 * still invalidates its own list (e.g. `qk.invoices.all`).
 */
export function invalidateMoney(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: qk.finance.all });
  qc.invalidateQueries({ queryKey: qk.dashboard.invoiceAging });
  qc.invalidateQueries({ queryKey: qk.dashboard.expenseCategories });
}

/**
 * After a task is created, edited or deleted: refreshes tasks, workload and
 * the planned-vs-actual widget (it sums each task's planned minutes).
 */
export function invalidateTasks(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: qk.tasks.all });
  qc.invalidateQueries({ queryKey: qk.workload.all });
  qc.invalidateQueries({ queryKey: qk.dashboard.plannedVsActual });
}

/**
 * After a write to time entries or to a task's planned or tracked minutes:
 * refreshes time entries, tasks, workload and every dashboard time widget.
 */
export function invalidateTimeTracking(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: qk.timeEntries.all });
  qc.invalidateQueries({ queryKey: qk.tasks.all });
  qc.invalidateQueries({ queryKey: qk.workload.all });
  qc.invalidateQueries({ queryKey: qk.dashboard.timeThisWeek });
  qc.invalidateQueries({ queryKey: qk.dashboard.weeklyTrend });
  qc.invalidateQueries({ queryKey: qk.dashboard.topTimeConsumers });
  qc.invalidateQueries({ queryKey: qk.dashboard.projectTimeDistribution });
  qc.invalidateQueries({ queryKey: qk.dashboard.plannedVsActual });
  qc.invalidateQueries({ queryKey: qk.dashboard.billableSummary });
}

/**
 * After a connection sync or edit: refreshes connections and everything they
 * feed (machines, upkeep, readings, disks, equipment links).
 */
export function invalidateEquipment(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: qk.connections.all });
  qc.invalidateQueries({ queryKey: qk.machines.all });
  qc.invalidateQueries({ queryKey: qk.upkeep.all });
  qc.invalidateQueries({ queryKey: qk.machines.allReadings });
  qc.invalidateQueries({ queryKey: qk.machines.allDisks });
  qc.invalidateQueries({ queryKey: qk.connections.equipment });
}
