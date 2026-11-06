import { useQuery } from "@tanstack/react-query";
import * as q from "../queries/invoices";
import { isDraftReference } from "../../types/invoice";
import type { Invoice, InvoiceLineItem } from "../../types/invoice";
import { generateAndStoreInvoicePdf } from "../../lib/invoicePdfStore";
import { getLabels, notify } from "../../lib/notify";
import { documentHooks } from "./documentHooks";

const hooks = documentHooks<Invoice, InvoiceLineItem>({
  key: "invoices",
  lineItemsKey: (id) => ["invoice-line-items", id],
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
  // Store the PDF once the invoice is no longer a draft. A failed PDF
  // doesn't fail the save: it is reported on its own.
  afterUpdate: async (id, status, qc) => {
    if (!status || status === "draft") return;
    const t = getLabels();
    const generated = await notify.progress(
      t.generating_pdf,
      generateAndStoreInvoicePdf(id).then(() => true),
      { success: null, error: t.failed_to_generate_pdf }
    );
    if (generated) qc.invalidateQueries({ queryKey: ["invoices"] });
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
    queryKey: ["invoices", "client", clientId],
    queryFn: () => q.getInvoicesByClient(clientId),
    enabled: !!clientId,
  });
}
