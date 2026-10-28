import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Consumable } from "../types/upkeep";
import { uiLabels } from "../i18n/ui";

const openExternal = vi.fn();
const logUsage = vi.fn();
const restock = vi.fn();
let rows: Consumable[] = [];
const { mut } = vi.hoisted(() => ({
  mut: () => ({ mutate: () => {}, mutateAsync: async () => 0, isPending: false }),
}));

// vitest aliases every @tauri-apps module to one mock file, so one factory covers them all.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  open: (u: string) => openExternal(u),
  ask: async () => true,
}));
vi.mock("../db/hooks/useUpkeep", () => ({
  useConsumables: () => ({ data: rows }),
  useMachines: () => ({ data: [{ id: 1, name: "Prusa MK4" }] }),
  useCreateConsumable: mut,
  useUpdateConsumable: mut,
  useDeleteConsumable: mut,
  useLogConsumableUsage: () => ({ mutate: logUsage, mutateAsync: async (a: unknown) => logUsage(a), isPending: false }),
  useRestockConsumable: () => ({ mutate: restock, mutateAsync: async (a: unknown) => restock(a), isPending: false }),
}));
vi.mock("../db/hooks/useProjects", () => ({ useProjects: () => ({ data: [{ id: 5, name: "Brand site" }] }) }));
vi.mock("../db/hooks/useExpenses", () => ({
  useExpenseCategories: () => ({ data: [{ code: "FA", name_fr: "Frais" }] }),
  useDistinctSuppliers: () => ({ data: [] }),
  useDuplicateCheck: () => ({ mutate: () => {}, mutateAsync: async () => [], isPending: false }),
  useCreateExpense: mut,
}));

import { ConsumablesTab } from "../components/upkeep/ConsumablesTab";

const t = uiLabels.EN;

function cons(over: Partial<Consumable> = {}): Consumable {
  return {
    id: 1, name: "PLA white", machine_id: 1, unit: "kg", stock: 0.5, reorder_level: 1,
    supplier: "Prusa", product_url: "prusa.com/pla", unit_price: 25, currency: "CHF",
    low_notified: 0, created_at: "", updated_at: "", ...over,
  };
}

function renderTab() {
  return render(<MemoryRouter><ConsumablesTab /></MemoryRouter>);
}

describe("ConsumablesTab", () => {
  beforeEach(() => {
    openExternal.mockReset();
    logUsage.mockReset();
    restock.mockReset();
    rows = [
      cons(),
      cons({ id: 2, name: "Nozzle", stock: 0, reorder_level: 2, product_url: null }),
      cons({ id: 3, name: "Ink", stock: 9, reorder_level: 2 }),
    ];
  });

  it("banner counts the low items", () => {
    renderTab();
    expect(screen.getByRole("status")).toHaveTextContent("2 below their reorder level.");
  });

  it("no banner when nothing is low", () => {
    rows = [cons({ stock: 5 })];
    renderTab();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("hides Reorder without a product link and opens it with https:// otherwise", () => {
    renderTab();
    expect(screen.getAllByRole("button", { name: /Reorder/ })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: /Reorder/ })[0]);
    expect(openExternal).toHaveBeenCalledWith("https://prusa.com/pla");
  });

  it("logs usage with an amount and optional project", async () => {
    renderTab();
    fireEvent.click(screen.getAllByRole("button", { name: t.upkeep_log_usage })[0]);
    fireEvent.change(screen.getByLabelText(t.upkeep_amount), { target: { value: "0.2" } });
    fireEvent.change(screen.getByLabelText(t.project), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: t.save }));
    await waitFor(() => expect(logUsage).toHaveBeenCalled());
    expect(logUsage.mock.calls[0][0]).toMatchObject({ id: 1, amount: 0.2, projectId: 5 });
  });

  it("rejects a zero amount", () => {
    renderTab();
    fireEvent.click(screen.getAllByRole("button", { name: t.upkeep_log_usage })[0]);
    fireEvent.change(screen.getByLabelText(t.upkeep_amount), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: t.save }));
    expect(logUsage).not.toHaveBeenCalled();
    expect(screen.getByText(t.upkeep_amount_positive)).toBeInTheDocument();
  });

  it("restock adds stock then offers the prefilled expense", async () => {
    renderTab();
    fireEvent.click(screen.getAllByRole("button", { name: t.upkeep_restock })[0]);
    fireEvent.change(screen.getByLabelText(t.upkeep_amount), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: t.save }));
    await waitFor(() => expect(restock).toHaveBeenCalledWith({ id: 1, amount: 2 }));
    fireEvent.click(await screen.findByRole("button", { name: t.upkeep_restock_expense_yes }));
    expect(await screen.findByDisplayValue("Prusa", {}, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getByDisplayValue("50")).toBeInTheDocument();
  });
});
