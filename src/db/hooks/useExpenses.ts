import { useQuery, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import * as q from "../queries/expenses";
import type { Expense, ExpenseCategory } from "../../types/expense";
import { useUndoStore } from "../../stores/undo-store";
import { getLabels } from "../../lib/notify";
import { qk, invalidateMoney } from "../queryKeys";

function invalidateExpenses(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: qk.expenses.all });
  invalidateMoney(qc);
}

function invalidateCategories(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: qk.expenseCategories.all });
  invalidateMoney(qc);
}

export function useExpenses() {
  return useQuery({ queryKey: qk.expenses.all, queryFn: q.getExpenses });
}

export function useDistinctSuppliers() {
  return useQuery({
    queryKey: qk.expenses.distinctSuppliers,
    queryFn: q.getDistinctSuppliers,
  });
}

export function useSupplierCounts() {
  return useQuery({
    queryKey: qk.expenses.supplierCounts,
    queryFn: q.getSupplierCounts,
  });
}

export function useMergeSuppliers() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_merge_suppliers" },
    mutationFn: async ({ canonical, variants }: { canonical: string; variants: string[] }) => {
      const prev = await q.mergeSuppliers(canonical, variants);
      useUndoStore.getState().push({
        label: `${getLabels().undo_merge_suppliers} "${canonical}"`,
        execute: async () => {
          // Single transaction — a crash cannot leave a partial revert
          await q.restoreSupplierNames(prev);
          qc.invalidateQueries({ queryKey: qk.expenses.all });
        },
        redo: async () => {
          await q.mergeSuppliers(canonical, variants);
          qc.invalidateQueries({ queryKey: qk.expenses.all });
        },
      });
      return prev.length;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.expenses.all });
    },
  });
}

export function useExpenseCategories() {
  return useQuery({
    queryKey: qk.expenseCategories.all,
    queryFn: q.getExpenseCategories,
  });
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_save_expense" },
    mutationFn: async (data: q.NewExpense) => {
      const id = await q.createExpense(data);
      useUndoStore.getState().push({
        label: `${getLabels().undo_create_expense} "${data.reference}"`,
        execute: async () => {
          await q.deleteExpense(id);
          invalidateExpenses(qc);
        },
      });
      return id;
    },
    onSuccess: () => {
      invalidateExpenses(qc);
    },
  });
}

export function useUpdateExpense() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_save_expense" },
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
          label: `${getLabels().undo_update_expense} "${prev.reference}"`,
          execute: async () => {
            await q.updateExpense(id, prevData as Partial<Omit<Expense, "id" | "created_at" | "updated_at">>);
            invalidateExpenses(qc);
          },
        });
      }
    },
    onSuccess: () => {
      invalidateExpenses(qc);
    },
  });
}

export function useDeleteExpense() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_delete_expense" },
    mutationFn: async (id: number) => {
      const prev = await q.getExpenseById(id);
      await q.deleteExpense(id);
      if (prev) {
        useUndoStore.getState().push({
          label: `${getLabels().undo_delete_expense} "${prev.reference}"`,
          execute: async () => {
            const { id: _id, created_at, updated_at, ...data } = prev;
            await q.createExpense(data);
            invalidateExpenses(qc);
          },
        });
      }
    },
    onSuccess: () => {
      invalidateExpenses(qc);
    },
  });
}

// ── Duplicate Detection ──────────────────────────────────────

export function useDuplicateCheck() {
  return useMutation({
    meta: { errorLabel: "error_check_duplicates" },
    mutationFn: ({ supplier, amount, date }: { supplier: string; amount: number; date: string }) =>
      q.findDuplicateExpenses(supplier, amount, date),
  });
}

// ── Expense Category Mutations ────────────────────────────────

export function useCreateExpenseCategory() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_save_category" },
    mutationFn: async (data: ExpenseCategory) => {
      await q.createExpenseCategory(data);
      useUndoStore.getState().push({
        label: `${getLabels().undo_create_category} "${data.code}"`,
        execute: async () => {
          await q.deleteExpenseCategory(data.code);
          invalidateCategories(qc);
        },
        redo: async () => {
          await q.createExpenseCategory(data);
          invalidateCategories(qc);
        },
      });
    },
    onSuccess: () => invalidateCategories(qc),
  });
}

export function useUpdateExpenseCategory() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_save_category" },
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
          label: `${getLabels().undo_update_category} "${vars.code}"`,
          execute: async () => {
            await q.updateExpenseCategory(vars.code, prevData as Partial<Omit<ExpenseCategory, "code">>);
            invalidateCategories(qc);
          },
          redo: async () => {
            await q.updateExpenseCategory(vars.code, vars.data);
            invalidateCategories(qc);
          },
        });
      }
    },
    onSuccess: () => {
      invalidateCategories(qc);
    },
  });
}

export function useDeleteExpenseCategory() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorLabel: "error_delete_category" },
    mutationFn: async (code: string) => {
      const prev = await q.getExpenseCategory(code);
      await q.deleteExpenseCategory(code);
      if (prev) {
        useUndoStore.getState().push({
          label: `${getLabels().undo_delete_category} "${code}"`,
          execute: async () => {
            await q.createExpenseCategory(prev);
            invalidateCategories(qc);
          },
          redo: async () => {
            await q.deleteExpenseCategory(code);
            invalidateCategories(qc);
          },
        });
      }
    },
    onSuccess: () => {
      invalidateCategories(qc);
    },
  });
}

export { isDefaultCategory } from "../queries/expenses";
