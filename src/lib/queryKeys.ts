/** Centralized query key factory for React Query cache management */
export const queryKeys = {
  clients: {
    all: ["clients"] as const,
    detail: (id: string) => ["clients", id] as const,
    contacts: (clientId: string) => ["client-contacts", clientId] as const,
  },
  projects: {
    all: ["projects"] as const,
    detail: (id: number) => ["projects", id] as const,
    byClient: (clientId: string) => ["projects", "client", clientId] as const,
  },
  tasks: {
    all: ["tasks"] as const,
    byProject: (projectId: number) => ["tasks", "project", projectId] as const,
    withDueDate: ["tasks", "with-due-date"] as const,
  },
  subtasks: {
    all: ["subtasks"] as const,
    byProject: (projectId: number) => ["subtasks", "project", projectId] as const,
    withDueDate: ["subtasks", "with-due-date"] as const,
  },
  invoices: {
    all: ["invoices"] as const,
    detail: (id: number) => ["invoices", id] as const,
    byClient: (clientId: string) => ["invoices", "client", clientId] as const,
    lineItems: (invoiceId: number) => ["invoice-line-items", invoiceId] as const,
  },
  quotes: {
    all: ["quotes"] as const,
    detail: (id: number) => ["quotes", id] as const,
    lineItems: (quoteId: number) => ["quotes", quoteId, "lineItems"] as const,
  },
  expenses: {
    all: ["expenses"] as const,
    distinctSuppliers: ["expenses", "distinct-suppliers"] as const,
    categories: ["expense-categories"] as const,
  },
  finance: {
    pl: (year: number) => ["finance", "pl", year] as const,
    monthly: (year: number) => ["finance", "monthly", year] as const,
    dashboard: (year: number) => ["finance", "dashboard", year] as const,
  },
  notifications: {
    all: ["notifications"] as const,
    unreadCount: ["notifications", "unread-count"] as const,
  },
  businessProfile: ["business-profile"] as const,
  workload: {
    templates: {
      all: ["workload-templates"] as const,
      detail: (id: number) => ["workload-templates", id] as const,
    },
    rows: (projectId: number) => ["workload-rows", projectId] as const,
    config: (projectId: number) => ["workload-config", projectId] as const,
  },
} as const;
