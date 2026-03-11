import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as q from "../queries/expenses";
import type { Expense } from "../../types/expense";
import { useUndoStore } from "../../stores/undo-store";

export function useExpenses() {
  return useQuery({ queryKey: ["expenses"], queryFn: q.getExpenses });
}

export function useDistinctSuppliers() {
  return useQuery({
    queryKey: ["expenses", "distinct-suppliers"],
    queryFn: q.getDistinctSuppliers,
  });
}

export function useExpenseCategories() {
  return useQuery({
    queryKey: ["expense-categories"],
    queryFn: q.getExpenseCategories,
  });
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: Omit<Expense, "id" | "created_at" | "updated_at">) => {
      const id = await q.createExpense(data);
      useUndoStore.getState().push({
        label: `Create expense "${data.reference}"`,
        execute: async () => {
          await q.deleteExpense(id);
          qc.invalidateQueries({ queryKey: ["expenses"] });
        },
      });
      return id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["expenses"] }),
  });
}

export function useUpdateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: number;
      data: Partial<Omit<Expense, "id" | "created_at" | "updated_at">>;
    }) => {
      const prev = await q.getExpenseById(id);
      await q.updateExpense(id, data);
      if (prev) {
        const prevData: Record<string, unknown> = {};
        for (const key of Object.keys(data)) {
          prevData[key] = (prev as unknown as Record<string, unknown>)[key];
        }
        useUndoStore.getState().push({
          label: `Update expense "${prev.reference}"`,
          execute: async () => {
            await q.updateExpense(id, prevData as Partial<Omit<Expense, "id" | "created_at" | "updated_at">>);
            qc.invalidateQueries({ queryKey: ["expenses"] });
          },
        });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["expenses"] }),
  });
}

export function useDeleteExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const prev = await q.getExpenseById(id);
      await q.deleteExpense(id);
      if (prev) {
        useUndoStore.getState().push({
          label: `Delete expense "${prev.reference}"`,
          execute: async () => {
            const { id: _id, created_at, updated_at, ...data } = prev;
            await q.createExpense(data);
            qc.invalidateQueries({ queryKey: ["expenses"] });
          },
        });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["expenses"] }),
  });
}
