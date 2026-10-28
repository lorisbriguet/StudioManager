import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Machine, UpkeepItem } from "../types/upkeep";
import { uiLabels } from "../i18n/ui";

const updateItem = vi.fn();
const updateMachine = vi.fn();
let machineRow: Machine;
let items: UpkeepItem[] = [];
const { mut } = vi.hoisted(() => ({
  mut: () => ({ mutate: () => {}, mutateAsync: async () => 0, isPending: false }),
}));

vi.mock("../db/hooks/useUpkeep", () => ({
  useMachine: () => ({ data: machineRow }),
  useUpkeepItems: () => ({ data: items }),
  useUpdateMachine: () => ({ mutate: updateMachine, isPending: false }),
  useUpdateUpkeepItem: () => ({ mutate: updateItem }),
  useCreateUpkeepItem: mut,
  useArchiveUpkeepItem: mut,
  useMarkUpkeepDone: mut,
  useMachineFiles: () => ({ data: [] }),
  useAddMachineFile: mut,
  useRemoveMachineFile: mut,
  useServiceLog: () => ({ data: [] }),
  useAddServiceLog: mut,
  useMachineProjectIds: () => ({ data: [] }),
  useSetMachineProjects: mut,
  useDeleteMachine: mut,
  useCreateMachine: mut,
}));
vi.mock("../db/hooks/useProjects", () => ({ useProjects: () => ({ data: [] }) }));
vi.mock("../db/hooks/useExpenses", () => ({
  useExpenses: () => ({ data: [] }),
  useExpenseCategories: () => ({ data: [] }),
  useDistinctSuppliers: () => ({ data: [] }),
  useCreateExpense: mut,
}));

import { MachineDetail } from "../components/upkeep/MachineDetail";

const t = uiLabels.EN;

function machine(over: Partial<Machine> = {}): Machine {
  return {
    id: 1, name: "Prusa MK4", kind: "3D printer", maker: null, model: null, serial: null,
    location: "Workshop", status: "working", lent_to: null, lent_until: null,
    purchase_date: "2024-03-01", supplier: null, price: null, currency: null, expense_id: null,
    warranty_until: null, warranty_notified_for: null, lifespan_years: 5, photo_path: null,
    notes: null, template_key: null, connection_id: null, device_id: null,
    reading_baseline: null, created_at: "", updated_at: "", ...over,
  };
}

function item(over: Partial<UpkeepItem> = {}): UpkeepItem {
  return {
    id: 4, machine_id: 1, title: "Clean nozzle", notes: null, schedule: "interval",
    interval_n: 3, interval_unit: "month", anchor_day: null, usage_metric: null,
    usage_every: null, last_done_on: null, last_done_reading: null, next_due_on: "2020-01-01",
    snooze_until: null, in_calendar: 1, alert: "default", calendar_event_id: null,
    calendar_event_date: null, overdue_notified_for: null, archived: 0,
    created_at: "", updated_at: "", ...over,
  };
}

function renderDetail() {
  return render(<MemoryRouter><MachineDetail machineId={1} /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  machineRow = machine();
  items = [item()];
});

describe("MachineDetail", () => {
  it("shows the overdue badge on an overdue item", () => {
    renderDetail();
    expect(screen.getByText("Clean nozzle")).toBeInTheDocument();
    expect(screen.getByText(t.overdue)).toBeInTheDocument();
  });

  it("toggling In calendar updates the item with in_calendar 0", () => {
    renderDetail();
    fireEvent.click(screen.getByRole("switch", { name: t.upkeep_in_calendar }));
    expect(updateItem).toHaveBeenCalledWith({ id: 4, data: { in_calendar: 0 } });
  });

  it("setting status Retired shows the reminders-stop note", () => {
    renderDetail();
    expect(screen.queryByText(t.upkeep_retired_note)).toBeNull();
    fireEvent.change(screen.getByLabelText(t.upkeep_col_status), { target: { value: "retired" } });
    expect(updateMachine).toHaveBeenCalledWith({ id: 1, data: { status: "retired" } });
    expect(screen.getByText(t.upkeep_retired_note)).toBeInTheDocument();
  });

  it("Lent out asks for who before saving", () => {
    renderDetail();
    fireEvent.change(screen.getByLabelText(t.upkeep_col_status), { target: { value: "lent" } });
    expect(updateMachine).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: t.save }));
    expect(updateMachine).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(new RegExp(`^${t.upkeep_lent_to}`)), { target: { value: "Anna" } });
    fireEvent.click(screen.getByRole("button", { name: t.save }));
    expect(updateMachine).toHaveBeenCalledWith({
      id: 1, data: { status: "lent", lent_to: "Anna", lent_until: null },
    });
  });

  it("shows replace-around year from purchase year plus lifespan", () => {
    renderDetail();
    expect(screen.getByLabelText(t.upkeep_replace_around_label)).toHaveValue(2029);
  });

  it("shows No connection in the readings slot", () => {
    renderDetail();
    expect(screen.getByText(t.upkeep_no_connection)).toBeInTheDocument();
  });
});
