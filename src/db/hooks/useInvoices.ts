import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as q from "../queries/invoices";
import { getNextInvoiceReference } from "../queries/invoices";
import type { Invoice, InvoiceLineItem } from "../../types/invoice";
import { useUndoStore } from "../../stores/undo-store";
import { generateAndStoreInvoicePdf } from "../../lib/invoicePdfStore";
import { logError } from "../../lib/log";

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

export function useInvoicesByProject(projectId: number) {
  return useQuery({
    queryKey: ["invoices", "project", projectId],
    queryFn: () => q.getInvoicesByProject(projectId),
    enabled: !!projectId,
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
      const id = await q.createInvoiceWithLineItems(data, lineItems);
      useUndoStore.getState().push({
        label: `Create invoice "${data.reference}"`,
        execute: async () => {
          await q.deleteInvoice(id);
          qc.invalidateQueries({ queryKey: ["invoices"] });
        },
        redo: async () => {
          await q.createInvoiceWithLineItems(data, lineItems);
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
      const prevLineItems = lineItems ? await q.getInvoiceLineItems(id) : undefined;

      // Auto-assign reference when status changes to "sent" and ref is still DRAFT
      if (data.status === "sent" && prev?.reference.startsWith("DRAFT")) {
        const year = prev.invoice_date
          ? parseInt(prev.invoice_date.substring(0, 4))
          : new Date().getFullYear();
        data.reference = await getNextInvoiceReference(year);
      }

      // Prevent changing back to draft once it's been set to another status
      if (data.status === "draft" && prev && prev.status !== "draft") {
        throw new Error("Cannot revert to draft status");
      }

      await q.updateInvoiceWithLineItems(id, data, lineItems);

      // Auto-generate PDF when invoice is not a draft
      const finalStatus = data.status ?? prev?.status;
      if (finalStatus && finalStatus !== "draft") {
        const toastId = toast.loading("Generating PDF...");
        try {
          await generateAndStoreInvoicePdf(id);
          toast.dismiss(toastId);
          qc.invalidateQueries({ queryKey: ["invoices"] });
        } catch (e) {
          toast.dismiss(toastId);
          logError("PDF generation failed:", e);
          toast.error("PDF generation failed");
        }
      }

      if (prev) {
        const prevData: Record<string, unknown> = {};
        for (const key of Object.keys(data)) {
          prevData[key] = (prev as unknown as Record<string, unknown>)[key];
        }
        const prevItems = prevLineItems?.map(({ id: _iid, invoice_id, ...rest }) => rest);
        useUndoStore.getState().push({
          label: `Update invoice "${prev.reference}"`,
          execute: async () => {
            await q.updateInvoiceWithLineItems(
              id,
              prevData as Partial<Omit<Invoice, "id" | "created_at" | "updated_at">>,
              prevItems
            );
            qc.invalidateQueries({ queryKey: ["invoices"] });
          },
          redo: async () => {
            await q.updateInvoiceWithLineItems(id, data, lineItems);
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
    mutationFn: async (id: number) => {
      const prev = await q.getInvoice(id);
      const prevItems = await q.getInvoiceLineItems(id);
      await q.deleteInvoice(id);
      if (prev) {
        const { id: _id, created_at, updated_at, ...data } = prev;
        const items = prevItems.map(({ id: _iid, invoice_id, ...rest }) => rest);
        useUndoStore.getState().push({
          label: `Delete invoice "${prev.reference}"`,
          execute: async () => {
            await q.createInvoiceWithLineItems(
              data as Omit<Invoice, "id" | "created_at" | "updated_at">,
              items
            );
            qc.invalidateQueries({ queryKey: ["invoices"] });
          },
          redo: async () => {
            // Re-fetch by reference since ID may differ after restore
            const invoices = await q.getInvoices();
            const restored = invoices.find((i) => i.reference === prev.reference);
            if (restored) {
              await q.deleteInvoice(restored.id);
              qc.invalidateQueries({ queryKey: ["invoices"] });
            }
          },
        });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices"] }),
  });
}
