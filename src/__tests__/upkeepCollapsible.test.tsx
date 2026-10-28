import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useAppStore } from "../stores/app-store";
import { useOrgStore } from "../stores/org-store";
import { uiLabels } from "../i18n/ui";
import type { Consumable, Machine, Subscription, UpkeepItem } from "../types/upkeep";
import type { UpkeepOverview } from "../lib/upkeep/overview";
import type { PendingRenewal } from "../db/queries/subscriptions";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), open: vi.fn(), ask: async () => true }));

const { mut } = vi.hoisted(() => ({
  mut: () => ({ mutate: () => {}, mutateAsync: async () => 0, isPending: false }),
}));

const m1 = {
  id: 1, name: "Prusa MK4", kind: "3D printer", location: "Workshop", status: "working",
  lent_to: null, lent_until: null, purchase_date: "2024-03-01", supplier: null, price: null,
  currency: null, expense_id: null, warranty_until: null, lifespan_years: 5, photo_path: null,
  serial: null, template_key: null, connection_id: null,
} as unknown as Machine;
const cons = {
  id: 1, name: "PLA white", machine_id: 1, unit: "kg", stock: 0.5, reorder_level: 1,
  supplier: null, product_url: null, unit_price: null, currency: "CHF",
} as unknown as Consumable;
const sub = {
  id: 1, name: "Creative Cloud", plan: null, vendor: "Adobe", renews_on: "2026-12-01",
  period: "year", cost: 840, currency: "CHF", status: "active",
} as unknown as Subscription;
const renewal = { id: 5, subscription_id: 1, name: "Adobe", amount: 60, currency: "CHF", renewed_on: "2026-10-20" } as unknown as PendingRenewal;
const upkeepItem = {
  id: 4, machine_id: 1, title: "Clean nozzle", schedule: "interval", interval_n: 3, interval_unit: "month",
  next_due_on: "2026-10-01", snooze_until: null, in_calendar: 1, archived: 0, usage_metric: null,
} as unknown as UpkeepItem;

const overview = {
  due: [{ item: upkeepItem, machine: m1, due: "2026-10-01", state: "overdue" }],
  lowStock: [cons],
  endingSoon: [{ kind: "renewal", name: "Figma", date: "2026-11-02" }],
  replacements: [{ machine: m1, year: 2029 }],
  overdueCount: 1,
} as unknown as UpkeepOverview;

vi.mock("../db/hooks/useConnections", () => {
  const m = () => ({ mutate: () => {}, mutateAsync: async () => 0, isPending: false });
  return {
    useConnections: () => ({ data: [] }),
    useMachineDisks: () => ({ data: [] }),
    useCurrentReading: () => ({ data: null }),
    useLinkMachine: m, useRecordManualReading: m, useSyncNow: m,
    useCreateConnection: m, useUpdateConnection: m, useDeleteConnection: m,
  };
});
vi.mock("../db/hooks/useUpkeep", () => ({
  useUpkeepOverview: () => overview,
  useMachines: () => ({ data: [m1] }),
  useMachine: () => ({ data: m1 }),
  useActiveUpkeepItems: () => ({ data: [upkeepItem] }),
  useUpkeepItems: () => ({ data: [upkeepItem] }),
  useConsumables: () => ({ data: [cons] }),
  useSubscriptions: () => ({ data: [sub] }),
  usePendingRenewals: () => ({ data: [renewal] }),
  useMarkUpkeepDone: mut,
  useSnoozeUpkeep: mut,
  useUpdateMachine: mut,
  useUpdateUpkeepItem: mut,
  useCreateUpkeepItem: mut,
  useArchiveUpkeepItem: mut,
  useMachineFiles: () => ({ data: [] }),
  useAddMachineFile: mut,
  useRemoveMachineFile: mut,
  useServiceLog: () => ({ data: [] }),
  useAddServiceLog: mut,
  useMachineProjectIds: () => ({ data: [] }),
  useSetMachineProjects: mut,
  useDeleteMachine: mut,
  useCreateMachine: mut,
  useCreateConsumable: mut,
  useUpdateConsumable: mut,
  useDeleteConsumable: mut,
  useLogConsumableUsage: mut,
  useRestockConsumable: mut,
  useDecideRenewal: mut,
  useCreateSubscription: mut,
  useUpdateSubscription: mut,
  useCancelSubscription: mut,
  useDeleteSubscription: mut,
}));
vi.mock("../db/hooks/useProjects", () => ({ useProjects: () => ({ data: [] }) }));
vi.mock("../db/hooks/useExpenses", () => ({
  useExpenses: () => ({ data: [] }),
  useExpenseCategories: () => ({ data: [] }),
  useDistinctSuppliers: () => ({ data: [] }),
  useDuplicateCheck: mut,
  useCreateExpense: mut,
}));

import { OverviewTab } from "../components/upkeep/OverviewTab";
import { MachinesTab } from "../components/upkeep/MachinesTab";
import { MachineDetail } from "../components/upkeep/MachineDetail";
import { ConsumablesTab } from "../components/upkeep/ConsumablesTab";
import { SubscriptionsTab } from "../components/upkeep/SubscriptionsTab";

const t = uiLabels.EN;
const wrap = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);
const toggle = (title: string) => screen.getByRole("button", { name: new RegExp(`^${t.collapse}: ${title}`) });

beforeEach(() => {
  useAppStore.setState({ language: "EN" });
  localStorage.clear();
  useOrgStore.setState({ activeId: "o1", savePrefs: vi.fn(async () => {}) });
});
afterEach(cleanup);

describe("upkeep screens: collapsible sections", () => {
  it("Overview: every section has a toggle; collapsing Low stock hides it and survives a remount", () => {
    const first = wrap(<OverviewTab />);
    for (const title of [t.upkeep_due_soon, t.upkeep_low_stock, t.upkeep_warranty_renewals, t.upkeep_replacements, "Machines · 1"]) {
      expect(toggle(title)).toBeInTheDocument();
    }
    expect(screen.getByText("PLA white")).toBeInTheDocument();
    fireEvent.click(toggle(t.upkeep_low_stock));
    expect(screen.queryByText("PLA white")).toBeNull();
    first.unmount();
    wrap(<OverviewTab />);
    expect(screen.queryByText("PLA white")).toBeNull();
  });

  it("MachineDetail: facts, schedule, readings, files, service log and projects each toggle", () => {
    wrap(<MachineDetail machineId={1} />);
    for (const title of [
      t.upkeep_details, t.upkeep_schedule, t.upkeep_readings,
      t.upkeep_files_links, t.upkeep_service_log, t.upkeep_linked_projects,
    ]) {
      expect(toggle(title)).toBeInTheDocument();
    }
    expect(screen.getByText("Clean nozzle")).toBeInTheDocument();
    fireEvent.click(toggle(t.upkeep_schedule));
    expect(screen.queryByText("Clean nozzle")).toBeNull();
    expect(localStorage.getItem("upkeep-collapsed:machine-1-schedule:o1")).toBe("1");
  });

  it("MachinesTab: the table collapses", () => {
    wrap(<MachinesTab />);
    expect(screen.getByText("Workshop")).toBeInTheDocument();
    fireEvent.click(toggle(t.upkeep_tab_machines));
    expect(screen.queryByText("Workshop")).toBeNull();
  });

  it("ConsumablesTab: banner and table collapse", () => {
    wrap(<ConsumablesTab />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    fireEvent.click(toggle(t.upkeep_low_stock));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("PLA white")).toBeInTheDocument();
    fireEvent.click(toggle(t.upkeep_consumables));
    expect(screen.queryByText("PLA white")).toBeNull();
  });

  it("SubscriptionsTab: pending renewals and table collapse", () => {
    wrap(<SubscriptionsTab />);
    expect(screen.getByText("Creative Cloud")).toBeInTheDocument();
    fireEvent.click(toggle(t.upkeep_widget_pending));
    expect(screen.queryByRole("button", { name: t.upkeep_renewal_skip })).toBeNull();
    fireEvent.click(toggle(t.upkeep_subscriptions));
    expect(screen.queryByText("Creative Cloud")).toBeNull();
  });
});

describe("upkeep screens: one dot size", () => {
  it("renders no dot-sm anywhere", () => {
    for (const ui of [<OverviewTab />, <MachinesTab />, <MachineDetail machineId={1} />, <ConsumablesTab />, <SubscriptionsTab />]) {
      const { container, unmount } = wrap(ui);
      expect(container.querySelectorAll(".dot-sm")).toHaveLength(0);
      unmount();
    }
  });
});
