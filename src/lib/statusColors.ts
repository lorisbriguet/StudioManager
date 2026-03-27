import { variantClasses, type BadgeVariant } from "../components/ui/Badge";
import type { InvoiceStatus } from "../types/invoice";
import type { ProjectStatus } from "../types/project";
import type { QuoteStatus } from "../types/quote";
import type { TaskStatus } from "../types/task";

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

const PROJECT_VARIANT: Record<ProjectStatus, BadgeVariant> = {
  active: "accent",
  completed: "success",
  on_hold: "warning",
  cancelled: "neutral",
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

export function projectStatusVariant(s: ProjectStatus): BadgeVariant {
  return PROJECT_VARIANT[s];
}

/** Returns the raw CSS classes for a Badge variant — useful for <select> elements styled as badges. */
export function statusClasses(variant: BadgeVariant, status?: string): string {
  if (status === "cancelled") return variantClasses.neutral;
  return variantClasses[variant];
}
