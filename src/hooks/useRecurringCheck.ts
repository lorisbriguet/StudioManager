import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { getDueTemplates, updateRecurringTemplate } from "../db/queries/recurring";
import { getInvoice, getInvoiceLineItems, createInvoiceWithLineItems } from "../db/queries/invoices";
import { createNotification } from "../db/queries/notifications";
import { sendNativeNotification } from "../lib/nativeNotification";
import { logError } from "../lib/log";
import { addMonths, addDays, format } from "date-fns";
import type { RecurringFrequency } from "../types/recurring";

function advanceDate(date: string, frequency: RecurringFrequency): string {
  const d = new Date(date + "T00:00:00");
  switch (frequency) {
    case "monthly": return format(addMonths(d, 1), "yyyy-MM-dd");
    case "quarterly": return format(addMonths(d, 3), "yyyy-MM-dd");
    case "biannual": return format(addMonths(d, 6), "yyyy-MM-dd");
    case "annual": return format(addMonths(d, 12), "yyyy-MM-dd");
  }
}

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

        let generated = 0;
        for (const tmpl of templates) {
          const baseInvoice = await getInvoice(tmpl.base_invoice_id);
          if (!baseInvoice) continue;

          const baseLineItems = await getInvoiceLineItems(tmpl.base_invoice_id);
          const today = new Date().toISOString().split("T")[0];
          const dueDate = format(
            addDays(new Date(today + "T00:00:00"), baseInvoice.payment_terms_days || 30),
            "yyyy-MM-dd"
          );

          await createInvoiceWithLineItems(
            {
              reference: `DRAFT-${Date.now()}`,
              client_id: tmpl.client_id,
              project_id: baseInvoice.project_id,
              status: "draft",
              language: baseInvoice.language,
              activity: baseInvoice.activity,
              assignment: baseInvoice.assignment,
              invoice_date: today,
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

          // Advance next_due
          await updateRecurringTemplate(tmpl.id, {
            next_due: advanceDate(tmpl.next_due, tmpl.frequency),
          });

          generated++;
        }

        if (generated > 0) {
          qc.invalidateQueries({ queryKey: ["invoices"] });
          qc.invalidateQueries({ queryKey: ["recurring_templates"] });

          const msg = `${generated} recurring invoice draft${generated > 1 ? "s" : ""} generated`;
          toast.info(msg, { duration: 6000 });

          await createNotification({
            type: "info",
            title: "Recurring invoices",
            message: msg,
            read: 0,
            link: "/invoices",
          });
          qc.invalidateQueries({ queryKey: ["notifications"] });

          sendNativeNotification("Recurring invoices", msg);
        }
      } catch (e) {
        logError("Recurring check failed:", e);
      }
    })();
  }, [qc]);
}
