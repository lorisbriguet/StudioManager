import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as q from "../queries/income";
import type { Income } from "../../types/income";
import { useUndoStore } from "../../stores/undo-store";

export function useIncomes() {
  return useQuery({ queryKey: ["incomes"], queryFn: q.getIncomes });
}

export function useCreateIncome() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Omit<Income, "id" | "created_at" | "updated_at">) => {
      const id = await q.createIncome(data);
      useUndoStore.getState().push({
        label: `Create income "${data.reference}"`,
        execute: async () => {
          await q.deleteIncome(id);
          qc.invalidateQueries({ queryKey: ["incomes"] });
        },
        redo: async () => {
          await q.createIncome(data);
          qc.invalidateQueries({ queryKey: ["incomes"] });
        },
      });
      return id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["incomes"] }),
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useUpdateIncome() {
  const qc = useQueryClient();
  return useMutation({
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
          label: `Update income "${prev.reference}"`,
          execute: async () => {
            await q.updateIncome(id, prevData as Partial<Omit<Income, "id" | "created_at" | "updated_at">>);
            qc.invalidateQueries({ queryKey: ["incomes"] });
          },
          redo: async () => {
            await q.updateIncome(id, data);
            qc.invalidateQueries({ queryKey: ["incomes"] });
          },
        });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["incomes"] }),
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useDeleteIncome() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const prev = await q.getIncomeById(id);
      await q.deleteIncome(id);
      if (prev) {
        const { id: _id, created_at, updated_at, ...data } = prev;
        useUndoStore.getState().push({
          label: `Delete income "${prev.reference}"`,
          execute: async () => {
            await q.createIncome(data);
            qc.invalidateQueries({ queryKey: ["incomes"] });
          },
          redo: async () => {
            const incomes = await q.getIncomes();
            const restored = incomes.find((i) => i.reference === prev.reference);
            if (restored) {
              await q.deleteIncome(restored.id);
              qc.invalidateQueries({ queryKey: ["incomes"] });
            }
          },
        });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["incomes"] }),
    onError: (e) => { toast.error(String(e)); },
  });
}
