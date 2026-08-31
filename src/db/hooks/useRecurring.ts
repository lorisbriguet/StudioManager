import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useUndoStore } from "../../stores/undo-store";
import * as q from "../queries/recurring";
import type { RecurringInvoiceTemplate } from "../../types/recurring";
import { getLabels } from "../../lib/notifyError";

export function useRecurringTemplates() {
  return useQuery({
    queryKey: ["recurring_templates"],
    queryFn: q.getRecurringTemplates,
  });
}

export function useCreateRecurringTemplate() {
  const qc = useQueryClient();
  const push = useUndoStore((s) => s.push);
  return useMutation({
    mutationFn: (data: Omit<RecurringInvoiceTemplate, "id" | "created_at" | "updated_at">) =>
      q.createRecurringTemplate(data),
    onSuccess: (id, data) => {
      qc.invalidateQueries({ queryKey: ["recurring_templates"] });
      // Redo recreates with a fresh id; keep the current id so a later undo
      // of the redo deletes the right row.
      let currentId = id;
      push({
        label: getLabels().undo_create_recurring,
        execute: () => q.deleteRecurringTemplate(currentId).then(() => {
          qc.invalidateQueries({ queryKey: ["recurring_templates"] });
        }),
        redo: async () => {
          currentId = await q.createRecurringTemplate(data);
          qc.invalidateQueries({ queryKey: ["recurring_templates"] });
        },
      });
    },
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useUpdateRecurringTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: number;
      data: Partial<Omit<RecurringInvoiceTemplate, "id" | "created_at" | "updated_at">>;
    }) => {
      const prev = await q.getRecurringTemplate(id);
      await q.updateRecurringTemplate(id, data);
      if (prev) {
        const prevData: Record<string, unknown> = {};
        for (const key of Object.keys(data)) {
          prevData[key] = (prev as unknown as Record<string, unknown>)[key];
        }
        useUndoStore.getState().push({
          label: getLabels().undo_update_recurring,
          execute: async () => {
            await q.updateRecurringTemplate(id, prevData as Partial<Omit<RecurringInvoiceTemplate, "id" | "created_at" | "updated_at">>);
            qc.invalidateQueries({ queryKey: ["recurring_templates"] });
          },
          redo: async () => {
            await q.updateRecurringTemplate(id, data);
            qc.invalidateQueries({ queryKey: ["recurring_templates"] });
          },
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring_templates"] });
    },
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useDeleteRecurringTemplate() {
  const qc = useQueryClient();
  const push = useUndoStore((s) => s.push);
  return useMutation({
    mutationFn: async (id: number) => {
      const prev = await q.getRecurringTemplate(id);
      await q.deleteRecurringTemplate(id);
      return prev;
    },
    onSuccess: (prev) => {
      qc.invalidateQueries({ queryKey: ["recurring_templates"] });
      if (prev) {
        const { id: _id, created_at, updated_at, ...data } = prev;
        // Redo targets exactly the id the restore produced.
        let restoredId: number | null = null;
        push({
          label: getLabels().undo_delete_recurring,
          execute: async () => {
            restoredId = await q.createRecurringTemplate(
              data as Omit<RecurringInvoiceTemplate, "id" | "created_at" | "updated_at">
            );
            qc.invalidateQueries({ queryKey: ["recurring_templates"] });
          },
          redo: async () => {
            if (restoredId !== null) {
              await q.deleteRecurringTemplate(restoredId);
              qc.invalidateQueries({ queryKey: ["recurring_templates"] });
            }
          },
        });
      }
    },
    onError: (e) => { toast.error(String(e)); },
  });
}
