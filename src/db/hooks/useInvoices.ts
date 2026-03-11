import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as q from "../queries/invoices";
import type { Invoice, InvoiceLineItem } from "../../types/invoice";
import { useUndoStore } from "../../stores/undo-store";
import { generateAndStoreInvoicePdf } from "../../lib/invoicePdfStore";

export function useInvoices() {
  return useQuery({ queryKey: ["invoices"], queryFn: q.getInvoices });
}

export function useInvoice(id: number) {
  return useQuery({
    queryKey: ["invoices", id],
    queryFn: () => q.getInvoice(id),
    enabled: !!id,
  });
}

export function useInvoicesByClient(clientId: string) {
  return useQuery({
    queryKey: ["invoices", "client", clientId],
    queryFn: () => q.getInvoicesByClient(clientId),
    enabled: !!clientId,
  });
}

export function useInvoiceLineItems(invoiceId: number) {
  return useQuery({
    queryKey: ["invoice-line-items", invoiceId],
    queryFn: () => q.getInvoiceLineItems(invoiceId),
    enabled: !!invoiceId,
  });
}

export function useCreateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ data, lineItems }: {
      data: Omit<Invoice, "id" | "created_at" | "updated_at">;
      lineItems: Omit<InvoiceLineItem, "id" | "invoice_id">[];
    }) => {
      const id = await q.createInvoice(data);
      await q.setInvoiceLineItems(id, lineItems);
      useUndoStore.getState().push({
        label: `Create invoice "${data.reference}"`,
        execute: async () => {
          await q.deleteInvoice(id);
          qc.invalidateQueries({ queryKey: ["invoices"] });
        },
      });
      return id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices"] }),
  });
}

export function useUpdateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
      lineItems,
    }: {
      id: number;
      data: Partial<Omit<Invoice, "id" | "created_at" | "updated_at">>;
      lineItems?: Omit<InvoiceLineItem, "id" | "invoice_id">[];
    }) => {
      const prev = await q.getInvoice(id);
      await q.updateInvoice(id, data);
      if (lineItems) {
        await q.setInvoiceLineItems(id, lineItems);
      }

      // Auto-generate PDF when status changes to "sent"
      if (data.status === "sent" && prev?.status !== "sent") {
        generateAndStoreInvoicePdf(id).then(() => {
          qc.invalidateQueries({ queryKey: ["invoices"] });
        }).catch((e) => {
          console.error("PDF generation failed:", e);
          toast.error("PDF generation failed");
        });
      }

      if (prev) {
        const prevData: Record<string, unknown> = {};
        for (const key of Object.keys(data)) {
          prevData[key] = (prev as unknown as Record<string, unknown>)[key];
        }
        useUndoStore.getState().push({
          label: `Update invoice "${prev.reference}"`,
          execute: async () => {
            await q.updateInvoice(id, prevData as Partial<Omit<Invoice, "id" | "created_at" | "updated_at">>);
            qc.invalidateQueries({ queryKey: ["invoices"] });
          },
        });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices"] }),
  });
}

export function useDeleteInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: q.deleteInvoice,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices"] }),
  });
}
