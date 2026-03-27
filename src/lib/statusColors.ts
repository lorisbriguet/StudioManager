import { variantClasses, type BadgeVariant } from "../components/ui/Badge";
import type { InvoiceStatus } from "../types/invoice";
import type { QuoteStatus } from "../types/quote";
import type { TaskStatus } from "../types/task";

/**
 * Maps any entity status to a Badge variant.
 * Single source of truth — replaces per-page statusColors objects.
 */

const INVOICE_VARIANT: Record<InvoiceStatus, BadgeVariant> = {
  draft: "neutral",
  sent: "accent",
  paid: "success",
  overdue: "danger",
  cancelled: "neutral",
};

/** Cancelled invoices use a more muted treatment than draft (both are "neutral" variant). */
const CANCELLED_CLASSES = "bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500";

const QUOTE_VARIANT: Record<QuoteStatus, BadgeVariant> = {
  draft: "neutral",
  sent: "accent",
  accepted: "success",
  rejected: "danger",
  expired: "warning",
};

const TASK_VARIANT: Record<TaskStatus, BadgeVariant> = {
  todo: "warning",
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

/** Returns the raw CSS classes for a Badge variant — useful for <select> elements styled as badges. */
export function statusClasses(variant: BadgeVariant, status?: string): string {
  if (status === "cancelled") return CANCELLED_CLASSES;
  return variantClasses[variant];
}
