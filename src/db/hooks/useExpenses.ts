import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as q from "../queries/expenses";
import type { Expense, ExpenseCategory } from "../../types/expense";
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
    onError: (e) => { toast.error(String(e)); },
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
    onError: (e) => { toast.error(String(e)); },
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
    onError: (e) => { toast.error(String(e)); },
  });
}

// ── Duplicate Detection ──────────────────────────────────────

export function useDuplicateCheck() {
  return useMutation({
    mutationFn: ({ supplier, amount, date }: { supplier: string; amount: number; date: string }) =>
      q.findDuplicateExpenses(supplier, amount, date),
  });
}

// ── Expense Category Mutations ────────────────────────────────

export function useCreateExpenseCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: ExpenseCategory) => {
      await q.createExpenseCategory(data);
      useUndoStore.getState().push({
        label: `Create category "${data.code}"`,
        execute: async () => {
          await q.deleteExpenseCategory(data.code);
          qc.invalidateQueries({ queryKey: ["expense-categories"] });
        },
        redo: async () => {
          await q.createExpenseCategory(data);
          qc.invalidateQueries({ queryKey: ["expense-categories"] });
        },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["expense-categories"] }),
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useUpdateExpenseCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      code: string;
      data: Partial<Omit<ExpenseCategory, "code">>;
    }) => {
      const prev = await q.getExpenseCategory(vars.code);
      await q.updateExpenseCategory(vars.code, vars.data);
      if (prev) {
        const prevData: Record<string, unknown> = {};
        for (const key of Object.keys(vars.data)) {
          prevData[key] = (prev as unknown as Record<string, unknown>)[key];
        }
        useUndoStore.getState().push({
          label: `Update category "${vars.code}"`,
          execute: async () => {
            await q.updateExpenseCategory(vars.code, prevData as Partial<Omit<ExpenseCategory, "code">>);
            qc.invalidateQueries({ queryKey: ["expense-categories"] });
          },
          redo: async () => {
            await q.updateExpenseCategory(vars.code, vars.data);
            qc.invalidateQueries({ queryKey: ["expense-categories"] });
          },
        });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["expense-categories"] }),
    onError: (e) => { toast.error(String(e)); },
  });
}

export function useDeleteExpenseCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) => {
      const prev = await q.getExpenseCategory(code);
      await q.deleteExpenseCategory(code);
      if (prev) {
        useUndoStore.getState().push({
          label: `Delete category "${code}"`,
          execute: async () => {
            await q.createExpenseCategory(prev);
            qc.invalidateQueries({ queryKey: ["expense-categories"] });
          },
          redo: async () => {
            await q.deleteExpenseCategory(code);
            qc.invalidateQueries({ queryKey: ["expense-categories"] });
          },
        });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["expense-categories"] }),
    onError: (e) => { toast.error(String(e)); },
  });
}

export { isDefaultCategory } from "../queries/expenses";
