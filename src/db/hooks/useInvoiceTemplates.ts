import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as q from "../queries/invoiceTemplates";
import { snapshotRows, snapshotLinks, pushRestore } from "../undoRestore";
import { getLabels } from "../../lib/notify";
import type { InvoiceTemplate } from "../../types/invoice-template";

export function useInvoiceTemplates() {
  return useQuery({
    queryKey: ["invoice-templates"],
    queryFn: q.getInvoiceTemplates,
  });
}

export function useInvoiceTemplate(id: number | null | undefined) {
  return useQuery({
    queryKey: ["invoice-templates", id],
    queryFn: () => q.getInvoiceTemplate(id!),
    enabled: !!id,
  });
}

export function useDefaultTemplate() {
  return useQuery({
    queryKey: ["invoice-templates", "default"],
    queryFn: q.getDefaultTemplate,
  });
}

export function useCreateInvoiceTemplate() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_save_template" },
    mutationFn: (data: Omit<InvoiceTemplate, "id" | "created_at" | "updated_at">) =>
      q.createInvoiceTemplate(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoice-templates"] }),
  });
}

export function useUpdateInvoiceTemplate() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_save_template" },
    mutationFn: ({
      id,
      data,
    }: {
      id: number;
      data: Partial<Omit<InvoiceTemplate, "id" | "created_at" | "updated_at">>;
    }) => q.updateInvoiceTemplate(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoice-templates"] }),
  });
}

export function useDeleteInvoiceTemplate() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["invoice-templates"] });
    qc.invalidateQueries({ queryKey: ["invoices"] });
    qc.invalidateQueries({ queryKey: ["quotes"] });
  };
  return useMutation({
    meta: { errorLabel: "error_delete_template" },
    mutationFn: async (id: number) => {
      const snap = await snapshotRows([{ table: "invoice_templates", where: "id = $1", params: [id] }]);
      // The delete sets their template_id to NULL (back to the default
      // template); the restore puts them on this one again.
      const links = await snapshotLinks([
        { table: "invoices", column: "template_id", id },
        { table: "quotes", column: "template_id", id },
      ]);
      await q.deleteInvoiceTemplate(id);
      const name = String(snap[0].rows[0]?.name ?? "");
      pushRestore(`${getLabels().undo_delete_invoice_template} "${name}"`, snap, {
        redo: () => q.deleteInvoiceTemplate(id),
        invalidate,
        extra: links,
      });
    },
    onSuccess: invalidate,
  });
}

export function useSetDefaultTemplate() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_save_template" },
    mutationFn: (id: number) => q.setDefaultTemplate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoice-templates"] }),
  });
}
