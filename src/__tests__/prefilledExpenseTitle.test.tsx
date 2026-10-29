import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAppStore } from "../stores/app-store";
import { uiLabels } from "../i18n/ui";

const { mut } = vi.hoisted(() => ({
  mut: () => ({ mutate: () => {}, mutateAsync: async () => 0, isPending: false }),
}));

vi.mock("../db/hooks/useExpenses", () => ({
  useExpenseCategories: () => ({ data: [{ code: "FA", name_fr: "Frais" }] }),
  useDistinctSuppliers: () => ({ data: [] }),
  useDuplicateCheck: () => ({ mutate: () => {}, mutateAsync: async () => [], isPending: false }),
  useCreateExpense: mut,
}));

import { PrefilledExpenseModal } from "../components/upkeep/PrefilledExpenseModal";

describe("PrefilledExpenseModal", () => {
  beforeAll(async () => { await import("../pages/ExpensesPage"); }, 30000);
  beforeEach(() => useAppStore.setState({ language: "EN" }));

  it("shows the caller's title", async () => {
    render(<PrefilledExpenseModal title={uiLabels.EN.upkeep_renewal_expense_title} supplier="Adobe" amount={10} onCancel={() => {}} onSaved={() => {}} />);
    expect(await screen.findByRole("dialog", { name: uiLabels.EN.upkeep_renewal_expense_title })).toBeInTheDocument();
  });

  it("falls back to the new-expense title", async () => {
    render(<PrefilledExpenseModal supplier="Adobe" onCancel={() => {}} onSaved={() => {}} />);
    expect(await screen.findByRole("dialog", { name: uiLabels.EN.new_expense })).toBeInTheDocument();
  });
});
