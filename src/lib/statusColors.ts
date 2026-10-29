import { variantClasses, type BadgeVariant } from "../components/ui/Badge";
import type { InvoiceStatus } from "../types/invoice";
import type { QuoteStatus } from "../types/quote";
import type { TaskStatus } from "../types/task";
import type { Group as AgentGroup } from "./agents";
import type { DiskHealth, MachineStatus } from "../types/upkeep";

const MACHINE_VARIANT: Record<MachineStatus, BadgeVariant> = {
  working: "success",
  attention: "warning",
  broken: "danger",
  lent: "info",
  retired: "neutral",
};

export function machineStatusVariant(s: MachineStatus): BadgeVariant {
  return MACHINE_VARIANT[s];
}

/** Upkeep due state: only overdue and soon rows are listed, the rest stay quiet. */
export function dueStateVariant(s: "overdue" | "soon" | "later" | "none"): BadgeVariant {
  if (s === "overdue") return "danger";
  if (s === "soon") return "warning";
  return "neutral";
}

const DISK_VARIANT: Record<DiskHealth, BadgeVariant> = {
  healthy: "success",
  warning: "warning",
  failing: "danger",
};

export function diskHealthVariant(h: DiskHealth): BadgeVariant {
  return DISK_VARIANT[h] ?? "warning";
}

/** Connection state: failing since a date, or working. */
export function connectionVariant(failing: boolean): BadgeVariant {
  return failing ? "danger" : "success";
}

/**
 * Maps any entity status to a Badge variant.
 * Single source of truth — replaces per-page statusColors objects.
 */

const INVOICE_VARIANT: Record<InvoiceStatus, BadgeVariant> = {
  draft: "indigo",
  sent: "warning",
  paid: "success",
  overdue: "danger",
  cancelled: "neutral",
};

const QUOTE_VARIANT: Record<QuoteStatus, BadgeVariant> = {
  draft: "indigo",
  sent: "warning",
  accepted: "success",
  rejected: "danger",
  expired: "neutral",
};

const TASK_VARIANT: Record<TaskStatus, BadgeVariant> = {
  todo: "indigo",
  done: "success",
};


export function invoiceStatusVariant(s: InvoiceStatus): BadgeVariant {
  return INVOICE_VARIANT[s];
}

export function quoteStatusVariant(s: QuoteStatus): BadgeVariant {
  return QUOTE_VARIANT[s];
}

export function taskStatusVariant(s: TaskStatus): BadgeVariant {
  return TASK_VARIANT[s];
}

const AGENT_GROUP_VARIANT: Record<AgentGroup, BadgeVariant> = {
  "needs-you": "warning",
  working: "info",
  idle: "neutral",
  done: "success",
};

/** Agents page: the colour of an agent's group (needs you, working, idle, done). */
export function agentGroupVariant(g: AgentGroup): BadgeVariant {
  return AGENT_GROUP_VARIANT[g];
}

/**
 * Client status is derived at render time ("active" when the client has an
 * active project, "inactive" otherwise) — it is not stored on the Client type,
 * so this accepts a plain string.
 */
export function projectStatusVariant(s: string): BadgeVariant {
  if (s === "active") return "accent";
  if (s === "completed") return "success";
  if (s === "on_hold") return "warning";
  return "neutral";
}

export function clientStatusVariant(s: string): BadgeVariant {
  return s === "active" ? "success" : "neutral";
}

/**
 * Background class for the small status dot next to an invoice (`dot-sm`).
 * Same colours as `invoiceStatusVariant`; unknown statuses get a neutral dot.
 */
export function invoiceStatusDotClass(s: string): string {
  switch (s) {
    case "paid":
      return "bg-success";
    case "overdue":
      return "bg-danger";
    case "sent":
      return "bg-warning";
    case "draft":
      return "bg-[var(--color-indigo-text)]";
    default:
      return "bg-[var(--color-input-bg)]";
  }
}

/** Background class for a task priority dot (`dot-sm`): high red, medium amber, else green. */
export function priorityDotClass(priority: string): string {
  return priority === "high" ? "bg-danger" : priority === "medium" ? "bg-warning" : "bg-success";
}

/** Returns the raw CSS classes for a Badge variant — useful for <select> elements styled as badges. */
export function statusClasses(variant: BadgeVariant, status?: string): string {
  if (status === "cancelled") return variantClasses.neutral;
  return variantClasses[variant];
}
