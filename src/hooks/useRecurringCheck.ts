import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { getDueTemplates, updateRecurringTemplate } from "../db/queries/recurring";
import { getInvoice, getInvoiceLineItems, createInvoiceWithLineItems } from "../db/queries/invoices";
import { createNotification } from "../db/queries/notifications";
import { sendNativeNotification } from "../lib/nativeNotification";
import { notifyError, getLabels } from "../lib/notifyError";
import { logWarn } from "../lib/log";
import { todayLocalISO, parseLocalDate } from "../utils/localDate";
import { advanceDate } from "../utils/recurringDates";
import { addDays, format } from "date-fns";

// Safety cap on catch-up generations per template (5 years of monthly periods)
// so a corrupt next_due can never spin the loop unbounded. Hitting the cap
// stops silently for this launch; since next_due is persisted per step, the
// remaining periods self-heal on the next launch.
const MAX_CATCHUP_PER_TEMPLATE = 60;

export function useRecurringCheck() {
  const qc = useQueryClient();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      try {
        const templates = await getDueTemplates();
        if (templates.length === 0) return;

        const today = todayLocalISO();
        let generated = 0;
        for (const tmpl of templates) {
          // Fail soft per-template: one broken template must not block the others.
          try {
            const baseInvoice = await getInvoice(tmpl.base_invoice_id);
            if (!baseInvoice) continue;

            const baseLineItems = await getInvoiceLineItems(tmpl.base_invoice_id);
            // Immutable anchor day: the base invoice's day-of-month. next_due
            // cannot serve as anchor — it mutates on every advance and would
            // decay permanently after one short-month clamp (Jan 31 → Feb 28
            // → Mar 28 forever instead of Mar 31).
            const anchorDay = parseLocalDate(baseInvoice.invoice_date).getDate();

            // Catch up ALL overdue periods, not just one per app launch.
            let nextDue = tmpl.next_due;
            let steps = 0;
            while (nextDue <= today && steps < MAX_CATCHUP_PER_TEMPLATE) {
              // Each draft is dated on its own period (nextDue), not today:
              // a template 3 months behind yields 3 distinct period drafts.
              const dueDate = format(
                addDays(parseLocalDate(nextDue), baseInvoice.payment_terms_days ?? 30),
                "yyyy-MM-dd"
              );

              await createInvoiceWithLineItems(
                {
                  reference: `DRAFT-${crypto.randomUUID()}`,
                  client_id: tmpl.client_id,
                  project_id: baseInvoice.project_id,
                  status: "draft",
                  language: baseInvoice.language,
                  activity: baseInvoice.activity,
                  activity_id: baseInvoice.activity_id ?? null,
                  assignment: baseInvoice.assignment,
                  invoice_date: nextDue,
                  due_date: dueDate,
                  payment_terms_days: baseInvoice.payment_terms_days,
                  subtotal: baseInvoice.subtotal,
                  discount_applied: baseInvoice.discount_applied,
                  discount_rate: baseInvoice.discount_rate,
                  discount_label: baseInvoice.discount_label,
                  total: baseInvoice.total,
                  paid_date: null,
                  contact_id: baseInvoice.contact_id,
                  billing_address_id: baseInvoice.billing_address_id,
                  currency: baseInvoice.currency,
                  exchange_rate: baseInvoice.exchange_rate,
                  chf_equivalent: baseInvoice.chf_equivalent,
                  po_number: null,
                  pdf_path: null,
                  from_quote_id: null,
                  notes: baseInvoice.notes,
                  reminder_count: 0,
                  last_reminder_date: null,
                  template_id: baseInvoice.template_id ?? null,
                },
                baseLineItems.map((li) => ({
                  designation: li.designation,
                  rate: li.rate,
                  unit: li.unit,
                  quantity: li.quantity,
                  amount: li.amount,
                  sort_order: li.sort_order,
                }))
              );

              // Persist the advance immediately: a crash between create and
              // persist regenerates exactly one period on the next launch (a
              // duplicate, deletable draft) — the accepted failure mode,
              // chosen over skipping a period.
              nextDue = advanceDate(nextDue, tmpl.frequency, anchorDay);
              await updateRecurringTemplate(tmpl.id, { next_due: nextDue });

              generated++;
              steps++;
            }
            if (steps >= MAX_CATCHUP_PER_TEMPLATE && nextDue <= today) {
              logWarn(
                `Recurring catch-up cap (${MAX_CATCHUP_PER_TEMPLATE}) hit for template ${tmpl.id}; remaining periods will generate on next launch`
              );
            }
          } catch (e) {
            notifyError(getLabels().recurring_generation_failed, e);
          }
        }

        if (generated > 0) {
          qc.invalidateQueries({ queryKey: ["invoices"] });
          qc.invalidateQueries({ queryKey: ["finance"] });
          qc.invalidateQueries({ queryKey: ["recurring_templates"] });

          const labels = getLabels();
          const msg = labels.recurring_drafts_generated.replace("{count}", String(generated));
          toast.info(msg, { duration: 6000 });

          await createNotification({
            type: "info",
            title: labels.recurring_invoices,
            message: msg,
            read: 0,
            link: "/invoices",
          });
          qc.invalidateQueries({ queryKey: ["notifications"] });

          sendNativeNotification(labels.recurring_invoices, msg);
        }
      } catch (e) {
        // notifyError logs AND toasts; no separate logError needed
        notifyError(getLabels().recurring_generation_failed, e);
      }
    })();
  }, [qc]);
}
