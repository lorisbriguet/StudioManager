import { useQuery } from "@tanstack/react-query";
import * as q from "../queries/invoices";
import { isDraftReference } from "../../types/invoice";
import type { Invoice, InvoiceLineItem } from "../../types/invoice";
import { getLabels, notify } from "../../lib/notify";
import { documentHooks } from "./documentHooks";
import { qk } from "../queryKeys";

const hooks = documentHooks<Invoice, InvoiceLineItem>({
  keys: qk.invoices,
  kind: "invoice",
  dateField: "invoice_date",
  lineItemForeignKey: "invoice_id",
  labels: {
    saveError: "error_save_invoice",
    deleteError: "error_delete_invoice",
    undoCreate: "undo_create_invoice",
    undoUpdate: "undo_update_invoice",
    undoDelete: "undo_delete_invoice",
  },
  queries: {
    list: q.getInvoices,
    get: q.getInvoice,
    listByProject: q.getInvoicesByProject,
    lineItems: q.getInvoiceLineItems,
    create: q.createInvoiceWithLineItems,
    updateWithLineItems: q.updateInvoiceWithLineItems,
    delete: q.deleteInvoice,
    nextReference: q.getNextInvoiceReference,
  },
  // Only drafts are deletable — an invoice that ever had a real
  // reference must be cancelled instead (no reference reuse)
  beforeDelete: (prev) => {
    if (!isDraftReference(prev.reference)) {
      throw new Error("Only draft invoices can be deleted");
    }
  },
  // The stored PDF is the document the client got, and the trustee export
  // copies it. So it is written when the invoice leaves draft, again when its
  // lines or total are edited (the corrected invoice goes out), and once more
  // on cancelling, as a separate _VOID file. Marking paid or overdue and
  // reminders leave it alone. A failed PDF doesn't fail the save: it is
  // reported on its own.
  afterUpdate: async (id, { status, prevStatus, numbered, contentChanged }, qc) => {
    if (!status || status === "draft") return;
    const leftDraft = prevStatus === "draft" || numbered;
    const cancelled = status === "cancelled" && prevStatus !== "cancelled";
    const edited = contentChanged && status !== "cancelled";
    if (!leftDraft && !cancelled && !edited) return;
    const t = getLabels();
    const generated = await notify.progress(
      t.generating_pdf,
      // Dynamic import keeps @react-pdf out of the main chunk.
      import("../../lib/invoicePdfStore")
        .then((m) => m.generateAndStoreInvoicePdf(id))
        .then(() => true),
      { success: null, error: t.failed_to_generate_pdf }
    );
    if (generated) qc.invalidateQueries({ queryKey: qk.invoices.all });
  },
});

export const useInvoices = hooks.useList;
export const useInvoice = hooks.useOne;
export const useInvoicesByProject = hooks.useByProject;
export const useInvoiceLineItems = hooks.useLineItems;
export const useCreateInvoice = hooks.useCreate;
export const useUpdateInvoice = hooks.useUpdate;
export const useDeleteInvoice = hooks.useDelete;

export function useInvoicesByClient(clientId: string) {
  return useQuery({
    queryKey: qk.invoices.byClient(clientId),
    queryFn: () => q.getInvoicesByClient(clientId),
    enabled: !!clientId,
  });
}
