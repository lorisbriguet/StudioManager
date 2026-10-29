import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useAppStore } from "../stores/app-store";

let machines: { id: number; name: string; kind: string | null }[] = [];
let costs: { name: string; amount: number; unit: string; cost: number; currency: string | null }[] = [];

vi.mock("../db/hooks/useUpkeep", () => ({
  useMachinesByProject: () => ({ data: machines }),
  useProjectMaterialCost: () => ({ data: costs }),
}));

import { EquipmentBlock, sumByCurrency } from "../components/upkeep/EquipmentBlock";

beforeEach(() => { useAppStore.setState({ language: "EN" }); localStorage.clear(); machines = []; costs = []; });
afterEach(cleanup);

describe("sumByCurrency", () => {
  it("sums per currency without mixing", () => {
    const rows = [
      { name: "a", amount: 1, unit: "kg", cost: 10, currency: "CHF" },
      { name: "b", amount: 1, unit: "kg", cost: 5.5, currency: "CHF" },
      { name: "c", amount: 1, unit: "kg", cost: 7, currency: "EUR" },
    ];
    expect(sumByCurrency(rows)).toEqual([["CHF", 15.5], ["EUR", 7]]);
  });
});

describe("EquipmentBlock", () => {
  it("shows a quiet line with no machines and no usage", () => {
    render(<MemoryRouter><EquipmentBlock projectId={1} /></MemoryRouter>);
    expect(screen.getByText("No machine or material linked to this project.")).toBeInTheDocument();
  });

  it("lists machines and material totals per currency", () => {
    machines = [{ id: 3, name: "Prusa", kind: "3D printer" }];
    costs = [
      { name: "PLA", amount: 2, unit: "kg", cost: 40, currency: "CHF" },
      { name: "Resin", amount: 1, unit: "l", cost: 30, currency: "EUR" },
    ];
    render(<MemoryRouter><EquipmentBlock projectId={1} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: /Prusa/ })).toHaveAttribute("href", "/upkeep/machines/3");
    expect(screen.getByText("PLA")).toBeInTheDocument();
    expect(screen.getByTestId("equipment-total-CHF")).toHaveTextContent(/40/);
    expect(screen.getByTestId("equipment-total-EUR")).toHaveTextContent(/30/);
  });

  it("shows section headings and no collapse toggle", () => {
    costs = [{ name: "PLA", amount: 2, unit: "kg", cost: 40, currency: "CHF" }];
    render(<MemoryRouter><EquipmentBlock projectId={1} /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: /Materials used/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /collapse|expand/i })).toBeNull();
  });
});
