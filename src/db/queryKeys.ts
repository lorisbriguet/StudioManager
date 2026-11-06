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

/** Keys for a document kind (invoices or quotes). */
function documentKeys<P extends string>(prefix: P) {
  return {
    all: [prefix] as const,
    detail: (id: number) => [prefix, id] as const,
    byProject: (projectId: number) => [prefix, "project", projectId] as const,
  };
}

export const qk = {
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
  tasks: {
    all: ["tasks"] as const,
  },
  subtasks: {
    all: ["subtasks"] as const,
    withDueDate: ["subtasks", "with-due-date"] as const,
  },
  workload: {
    all: ["workload-rows"] as const,
    byProject: (projectId: number) => ["workload-rows", projectId] as const,
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
