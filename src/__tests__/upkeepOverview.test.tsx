import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { buildUpkeepOverview } from "../lib/upkeep/overview";
import type { Consumable, Machine, Subscription, UpkeepItem } from "../types/upkeep";
import type { UpkeepOverview } from "../lib/upkeep/overview";

const markDone = vi.fn();
const snooze = vi.fn();
let overview: UpkeepOverview;
let machinesData: Machine[] = [];

vi.mock("../db/hooks/useUpkeep", () => ({
  useUpkeepOverview: () => overview,
  useMachines: () => ({ data: machinesData }),
  useMarkUpkeepDone: () => ({ mutate: markDone }),
  useSnoozeUpkeep: () => ({ mutate: snooze }),
}));

import { DueList } from "../components/upkeep/DueList";
import { OverviewTab } from "../components/upkeep/OverviewTab";

const TODAY = "2026-10-28";

function machine(over: Partial<Machine> = {}): Machine {
  return {
    id: 1, name: "Prusa MK4", kind: "3D printer", maker: null, model: null, serial: null,
    location: "Workshop", status: "working", lent_to: null, lent_until: null,
    purchase_date: null, supplier: null, price: null, currency: null, expense_id: null,
    warranty_until: null, warranty_notified_for: null, lifespan_years: null, photo_path: null,
    notes: null, template_key: null, connection_id: null, device_id: null,
    reading_baseline: null, linked_at: null, created_at: "", updated_at: "", ...over,
  };
}

function item(over: Partial<UpkeepItem> = {}): UpkeepItem {
  return {
    id: 1, machine_id: 1, title: "Clean nozzle", notes: null, schedule: "interval",
    interval_n: 3, interval_unit: "month", anchor_day: null, usage_metric: null,
    usage_every: null, last_done_on: null, last_done_reading: null, next_due_on: TODAY,
    snooze_until: null, in_calendar: 0, alert: "default", calendar_event_id: null,
    calendar_event_date: null, overdue_notified_for: null, archived: 0,
    created_at: "", updated_at: "", ...over,
  };
}

const base = {
  consumables: [] as Consumable[],
  subscriptions: [] as Subscription[],
  todayISO: TODAY,
  soonDays: 14,
  warrantyWindowDays: 60,
  renewalWindowDays: 14,
};

describe("buildUpkeepOverview", () => {
  it("lists overdue rows first, then by date, and counts overdue", () => {
    const o = buildUpkeepOverview({
      ...base,
      machines: [machine()],
      items: [
        item({ id: 1, title: "soon late", next_due_on: "2026-11-05" }),
        item({ id: 2, title: "overdue recent", next_due_on: "2026-10-20" }),
        item({ id: 3, title: "soon early", next_due_on: "2026-10-30" }),
        item({ id: 4, title: "overdue old", next_due_on: "2026-10-01" }),
        item({ id: 5, title: "far away", next_due_on: "2027-03-01" }),
      ],
    });
    expect(o.due.map((r) => r.item.title)).toEqual([
      "overdue old", "overdue recent", "soon early", "soon late",
    ]);
    expect(o.overdueCount).toBe(2);
  });

  it("skips retired machines and archived items", () => {
    const o = buildUpkeepOverview({
      ...base,
      machines: [machine({ status: "retired" })],
      items: [item()],
    });
    expect(o.due).toEqual([]);
  });

  it("collects warranty, renewals, replacements and low stock", () => {
    const o = buildUpkeepOverview({
      ...base,
      machines: [
        machine({ id: 1, name: "A", warranty_until: "2026-12-01" }),
        machine({ id: 2, name: "B", warranty_until: "2027-06-01" }),
        machine({ id: 3, name: "C", purchase_date: "2022-03-01", lifespan_years: 4.2 }),
        machine({ id: 4, name: "D", purchase_date: "2024-03-01", lifespan_years: 5 }),
      ],
      items: [],
      subscriptions: [
        { name: "Cloud", status: "active", renews_on: "2026-11-05" } as Subscription,
        { name: "Old", status: "cancelled", renews_on: "2026-11-05" } as Subscription,
        { name: "Later", status: "active", renews_on: "2027-02-01" } as Subscription,
      ],
      consumables: [
        { id: 1, name: "PLA", stock: 0.3, reorder_level: 1 } as Consumable,
        { id: 2, name: "Ink", stock: 5, reorder_level: 1 } as Consumable,
      ],
    });
    expect(o.endingSoon.map((e) => [e.kind, e.name])).toEqual([
      ["renewal", "Cloud"], ["warranty", "A"],
    ]);
    // 2022 + ceil(4.2) = 2027 <= next year; 2024 + 5 = 2029 is not
    expect(o.replacements.map((r) => [r.machine.name, r.year])).toEqual([["C", 2027]]);
    expect(o.lowStock.map((c) => c.name)).toEqual(["PLA"]);
  });
});

describe("DueList", () => {
  beforeEach(() => {
    markDone.mockClear();
    snooze.mockClear();
  });

  const rows = buildUpkeepOverview({
    ...base,
    machines: [machine()],
    items: [item({ id: 7, title: "Clean nozzle", next_due_on: "2026-10-20" })],
  }).due;

  it("marks done with today and no reading", () => {
    render(<MemoryRouter><DueList rows={rows} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
    expect(markDone).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7, reading: null, doneOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) })
    );
  });

  it("offers 1, 3 and 7 day snoozes", () => {
    render(<MemoryRouter><DueList rows={rows} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Snooze" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((b) => b.textContent)).toEqual([
      "1 day", "3 days", "7 days",
    ]);
    fireEvent.click(within(menu).getByText("3 days"));
    expect(snooze).toHaveBeenCalledWith(expect.objectContaining({ id: 7, days: 3 }));
  });
});

describe("OverviewTab", () => {
  it("shows quiet lines for empty sections, never fake data", () => {
    overview = { due: [], lowStock: [], endingSoon: [], replacements: [], overdueCount: 0 };
    machinesData = [];
    render(<MemoryRouter><OverviewTab /></MemoryRouter>);
    expect(screen.getByText("Nothing due. All up to date.")).toBeInTheDocument();
    expect(screen.getByText("Nothing running low.")).toBeInTheDocument();
    expect(screen.getByText("No warranty or renewal ending soon.")).toBeInTheDocument();
    expect(screen.getByText("No machine near the end of its life.")).toBeInTheDocument();
  });
});
