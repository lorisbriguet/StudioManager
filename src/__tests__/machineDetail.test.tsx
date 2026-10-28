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

const recordReading = vi.fn();
const syncNow = vi.fn();
let connections: unknown[] = [];
let disks: unknown[] = [];
let reading: number | null = null;
vi.mock("../db/hooks/useConnections", () => ({
  useConnections: () => ({ data: connections }),
  useMachineDisks: () => ({ data: disks }),
  useCurrentReading: () => ({ data: reading }),
  useLinkMachine: mut,
  useRecordManualReading: () => ({ mutate: recordReading, isPending: false }),
  useSyncNow: () => ({ mutate: syncNow, isPending: false }),
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
  connections = [];
  disks = [];
  reading = null;
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

  it("readings: a usage item without a connection offers the current reading input", () => {
    items = [item({ id: 9, schedule: "usage", usage_metric: "print_hours", usage_every: 200, next_due_on: null })];
    reading = 120;
    renderDetail();
    expect(screen.queryByText(t.upkeep_no_connection)).not.toBeInTheDocument();
    expect(screen.getByText(/120 h/)).toBeInTheDocument();
    const input = screen.getByLabelText(t.upkeep_current_reading);
    fireEvent.change(input, { target: { value: "135" } });
    fireEvent.click(screen.getByRole("button", { name: t.upkeep_current_reading_save }));
    expect(recordReading).toHaveBeenCalledWith(
      { machine: expect.objectContaining({ id: 1 }), value: 135 },
      expect.anything()
    );
  });

  it("readings: a linked machine shows its connection, error, disks and Sync now", () => {
    machineRow = machine({ connection_id: 2, device_id: "SN1" });
    connections = [{
      id: 2, kind: "synology", label: "Studio NAS", last_sync_at: "2026-10-28T08:00:00.000Z",
      last_error: "timeout", failing_since: "2026-10-27",
    }];
    disks = [{
      id: 1, machine_id: 1, slot: "Drive 1", model: "WD Red", serial: "X", size_bytes: null,
      power_on_hours: 8760 * 2, health: "warning", notified_health: null, bad_sectors: 0,
      temperature: null, first_seen: "2026-01-01 00:00:00", last_read_at: "",
    }];
    renderDetail();
    expect(screen.getByText(t.upkeep_connected_to.replace("{label}", "Studio NAS"))).toBeInTheDocument();
    expect(screen.getByText(/timeout/)).toBeInTheDocument();
    expect(screen.getByText(t.upkeep_disk_health_warning)).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: t.upkeep_disk_age_years.replace("{n}", "2") })).toBeInTheDocument();
    expect(screen.queryByLabelText(t.upkeep_current_reading)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t.upkeep_sync_now }));
    expect(syncNow).toHaveBeenCalledWith(2);
  });
});
