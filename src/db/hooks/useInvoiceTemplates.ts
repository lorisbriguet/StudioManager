import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as q from "../queries/invoiceTemplates";
import { snapshotRows, pushRestore } from "../undoRestore";
import { getLabels } from "../../lib/notifyError";
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
    mutationFn: (data: Omit<InvoiceTemplate, "id" | "created_at" | "updated_at">) =>
      q.createInvoiceTemplate(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoice-templates"] }),
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useUpdateInvoiceTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: number;
      data: Partial<Omit<InvoiceTemplate, "id" | "created_at" | "updated_at">>;
    }) => q.updateInvoiceTemplate(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoice-templates"] }),
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useDeleteInvoiceTemplate() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["invoice-templates"] });
  return useMutation({
    mutationFn: async (id: number) => {
      const snap = await snapshotRows([{ table: "invoice_templates", where: "id = $1", params: [id] }]);
      await q.deleteInvoiceTemplate(id);
      const name = String(snap[0].rows[0]?.name ?? "");
      pushRestore(`${getLabels().undo_delete_invoice_template} "${name}"`, snap, { redo: () => q.deleteInvoiceTemplate(id), invalidate });
    },
    onSuccess: invalidate,
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useSetDefaultTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => q.setDefaultTemplate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoice-templates"] }),
    onError: (e) => { toast.error(String(e)); },
  });
}
