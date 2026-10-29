import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

vi.mock("../lib/log", () => ({ logError: vi.fn(), logWarn: vi.fn(), logInfo: vi.fn(), logDebug: vi.fn() }));
vi.mock("../lib/notify", async (orig) => {
  const { uiLabels } = await vi.importActual<typeof import("../i18n/ui")>("../i18n/ui");
  return {
    ...(await orig<typeof import("../lib/notify")>()),
    ...(await import("../__mocks__/notify")).notifyMockModule(),
    getLabels: () => uiLabels.EN,
  };
});
vi.mock("../lib/upkeep/calendar", () => ({ syncItemCalendar: vi.fn(async () => {}) }));

import { getDb } from "../db";
import { recomputeUsageForecast } from "../lib/upkeep/connections";
import { planNotifications } from "../lib/upkeep/notify";
import { dueState } from "../lib/upkeep/schedule";
import { clearExecutedStatements, setSelectHandler } from "../__mocks__/tauri-sql";
import { invokedCommands, clearInvokedCommands, setInvokeHandler } from "../__mocks__/tauri-api";
import { useAppStore } from "../stores/app-store";
import { useOrgStore } from "../stores/org-store";
import type { Machine, UpkeepItem } from "../types/upkeep";

const TODAY = "2026-10-28";

const machine = (over: Partial<Machine> = {}): Machine => ({
  id: 3, name: "P2S", kind: "printer", maker: null, model: null, serial: null, location: null,
  status: "working", lent_to: null, lent_until: null, purchase_date: null, supplier: null, price: null,
  currency: null, expense_id: null, warranty_until: null, warranty_notified_for: null, lifespan_years: null,
  photo_path: null, notes: null, template_key: null, connection_id: 2, device_id: "SN-P2S",
  reading_baseline: 100, linked_at: null, created_at: "", updated_at: "",
  ...over,
});

const usageItem = (over: Partial<UpkeepItem> = {}): UpkeepItem => ({
  id: 9, machine_id: 3, title: "Lube rods", notes: null, schedule: "usage", interval_n: null,
  interval_unit: null, anchor_day: null, usage_metric: "print_hours", usage_every: 200,
  last_done_on: null, last_done_reading: 100, next_due_on: null, snooze_until: null, in_calendar: 1,
  alert: "default", calendar_event_id: null, calendar_event_date: null, overdue_notified_for: null,
  archived: 0, created_at: "", updated_at: "",
  ...over,
});

type Stmt = { sql: string; params: unknown[] };
const batchStmts = (): Stmt[] =>
  invokedCommands.filter((c) => c.cmd === "execute_batch").flatMap((b) => (b.args as { statements: Stmt[] }).statements);
const dueWrites = () => batchStmts().filter((s) => s.sql.includes("UPDATE upkeep_items SET next_due_on"));

/**
 * current = latest (150 by default) + baseline 100. Readings: 140 ten days ago,
 * 150 today (1 h/day); `trend: false` leaves one reading only (no daily use).
 * `firstSince`: the first reading on or after the last service, if any.
 */
function route(opts: { trend?: boolean; current?: number; firstSince?: number | null } = {}) {
  setSelectHandler((sql) => {
    if (sql.includes("FROM machines")) return [machine()];
    if (sql.includes("FROM machine_readings") && sql.includes("LIMIT 1") && sql.includes("ASC")) {
      return opts.firstSince == null ? [] : [{ value: opts.firstSince }];
    }
    if (sql.includes("FROM machine_readings") && sql.includes("LIMIT 1")) return [{ value: opts.current ?? 150 }];
    if (sql.includes("FROM machine_readings")) {
      return opts.trend === false
        ? [{ value: 150, read_at: "2026-10-28 10:00:00" }]
        : [{ value: 140, read_at: "2026-10-18 10:00:00" }, { value: 150, read_at: "2026-10-28 10:00:00" }];
    }
    return [];
  });
}

const planFor = (item: UpkeepItem, today: string) =>
  planNotifications({
    items: [item], machines: [machine()], consumables: [], subs: [], pendingRenewals: [], disks: [],
    connections: [], todayISO: today, windows: { warrantyDays: 60, renewalDays: 14 },
  });

beforeAll(async () => {
  await getDb();
});

beforeEach(() => {
  clearExecutedStatements();
  clearInvokedCommands();
  setInvokeHandler(null);
  setSelectHandler(null);
  useAppStore.setState({ testMode: false, presentationMode: false });
  useOrgStore.setState({ activeId: "6kun0b", switching: false });
});

describe("usage items that ran out stay due", () => {
  it("left = 0 across days: the date never moves forward, one overdue notice, then none", async () => {
    route();
    // 250 used of 200 since the reading at 0.
    let row = usageItem({ last_done_reading: 0, next_due_on: null });
    await recomputeUsageForecast(row, "2026-10-28");
    expect(dueWrites().map((s) => s.params)).toEqual([["2026-10-28", 9]]);
    row = { ...row, next_due_on: "2026-10-28" };
    expect(planFor(row, "2026-10-28")).toHaveLength(0);

    clearInvokedCommands();
    expect(await recomputeUsageForecast(row, "2026-10-29")).toBe(false);
    expect(dueWrites()).toHaveLength(0);
    const day2 = planFor(row, "2026-10-29");
    expect(day2).toHaveLength(1);
    expect(day2[0].marker).toBe("2026-10-28");
    row = { ...row, overdue_notified_for: "2026-10-28" };

    expect(await recomputeUsageForecast(row, "2026-10-30")).toBe(false);
    expect(dueState(row, "2026-10-30", 14)).toBe("overdue");
    expect(planFor(row, "2026-10-30")).toHaveLength(0);
  });

  it("left = 0 brings a later forecast back to today", async () => {
    route();
    await recomputeUsageForecast(usageItem({ last_done_reading: 0, next_due_on: "2026-11-15" }), TODAY);
    expect(dueWrites().map((s) => s.params)).toEqual([[TODAY, 9]]);
  });

  it("left = 0 on an idle printer (no trend) keeps the date", async () => {
    route({ trend: false });
    expect(await recomputeUsageForecast(usageItem({ last_done_reading: 0, next_due_on: "2026-10-20" }), TODAY)).toBe(false);
    expect(dueWrites()).toHaveLength(0);
  });

  it("left = 0 with no trend and no date yet sets today", async () => {
    route({ trend: false });
    await recomputeUsageForecast(usageItem({ last_done_reading: 0, next_due_on: null }), TODAY);
    expect(dueWrites().map((s) => s.params)).toEqual([[TODAY, 9]]);
  });

  it("left > 0 without a trend clears the date", async () => {
    route({ trend: false });
    await recomputeUsageForecast(usageItem({ last_done_reading: 200, next_due_on: "2026-12-01" }), TODAY);
    expect(dueWrites().map((s) => s.params)).toEqual([[null, 9]]);
  });

  it("a counter reset (reading below the one at the last service) keeps the item due", async () => {
    route({ current: 10, trend: false }); // 10 + 100 = 110 < 300
    expect(await recomputeUsageForecast(usageItem({ last_done_reading: 300, next_due_on: "2026-10-20" }), TODAY)).toBe(false);
    expect(dueWrites()).toHaveLength(0);
  });
});

describe("usage item done without a reading", () => {
  it("the first reading after the service is the baseline", async () => {
    // Done on 10-20 with no reading; first reading since then 140 (+100) = 240;
    // now 250 → 10 used, 190 left at 1 h/day.
    route({ firstSince: 140 });
    await recomputeUsageForecast(usageItem({ last_done_reading: null, last_done_on: "2026-10-20" }), TODAY);
    expect(dueWrites().map((s) => s.params)).toEqual([["2027-05-06", 9]]);
  });

  it("no reading since the service: nothing used yet", async () => {
    route({ firstSince: null });
    await recomputeUsageForecast(usageItem({ last_done_reading: null, last_done_on: "2026-10-28" }), TODAY);
    // 200 left at 1 h/day.
    expect(dueWrites().map((s) => s.params)).toEqual([["2027-05-16", 9]]);
  });
});
