import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import * as q from "../queries/income";
import type { Income } from "../../types/income";
import { useUndoStore } from "../../stores/undo-store";
import { getLabels } from "../../lib/notify";
import { qk, invalidateMoney } from "../queryKeys";

function invalidateIncome(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: qk.incomes.all });
  invalidateMoney(qc);
}

export function useIncomes() {
  return useQuery({ queryKey: qk.incomes.all, queryFn: q.getIncomes });
}

export function useCreateIncome() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_save_income" },
    mutationFn: async (data: Omit<Income, "id" | "created_at" | "updated_at">) => {
      const id = await q.createIncome(data);
      useUndoStore.getState().push({
        label: `${getLabels().undo_create_income} "${data.reference}"`,
        execute: async () => {
          await q.deleteIncome(id);
          invalidateIncome(qc);
        },
        redo: async () => {
          await q.createIncome(data);
          invalidateIncome(qc);
        },
      });
      return id;
    },
    onSuccess: () => {
      invalidateIncome(qc);
    },
  });
}

export function useUpdateIncome() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_save_income" },
    mutationFn: async ({
      id,
      data,
    }: {
      id: number;
      data: Partial<Omit<Income, "id" | "created_at" | "updated_at">>;
    }) => {
      const prev = await q.getIncomeById(id);
      await q.updateIncome(id, data);
      if (prev) {
        const prevData: Record<string, unknown> = {};
        for (const key of Object.keys(data)) {
          prevData[key] = (prev as unknown as Record<string, unknown>)[key];
        }
        useUndoStore.getState().push({
          label: `${getLabels().undo_update_income} "${prev.reference}"`,
          execute: async () => {
            await q.updateIncome(id, prevData as Partial<Omit<Income, "id" | "created_at" | "updated_at">>);
            invalidateIncome(qc);
          },
          redo: async () => {
            await q.updateIncome(id, data);
            invalidateIncome(qc);
          },
        });
      }
    },
    onSuccess: () => {
      invalidateIncome(qc);
    },
  });
}

export function useDeleteIncome() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_delete_income" },
    mutationFn: async (id: number) => {
      const prev = await q.getIncomeById(id);
      await q.deleteIncome(id);
      if (prev) {
        const { id: _id, created_at, updated_at, ...data } = prev;
        // The restore assigns a fresh rowid; redo targets exactly that id —
        // a reference lookup could hit a different row with the same reference.
        let restoredId: number | null = null;
        useUndoStore.getState().push({
          label: `${getLabels().undo_delete_income} "${prev.reference}"`,
          execute: async () => {
            restoredId = await q.createIncome(data);
            invalidateIncome(qc);
          },
          redo: async () => {
            if (restoredId !== null) {
              await q.deleteIncome(restoredId);
              invalidateIncome(qc);
            }
          },
        });
      }
    },
    onSuccess: () => {
      invalidateIncome(qc);
    },
  });
}
