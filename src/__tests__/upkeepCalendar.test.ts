import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../lib/log", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
  logInfo: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock("../lib/notifyError", () => ({
  notifyError: vi.fn(),
  getLabels: () => new Proxy({}, { get: (_t, k) => String(k) }),
}));

import {
  alertMinutes,
  syncItemEvent,
  syncSubscriptionEvent,
  syncItemCalendar,
  syncSubscriptionCalendar,
  removeItemEvents,
  syncAllUpkeepEvents,
} from "../lib/upkeep/calendar";
import { purgeAllCalendarEvents } from "../lib/appleCalendar";
import { setItemCalendarEvent, getUpkeepItem } from "../db/queries/upkeepItems";
import { setSubscriptionCalendarEvent } from "../db/queries/subscriptions";
import { getDb } from "../db";
import { executedStatements, clearExecutedStatements, setSelectHandler } from "../__mocks__/tauri-sql";
import { useAppStore } from "../stores/app-store";
import { notifyError } from "../lib/notifyError";
import { setInvokeHandler, invokedCommands, clearInvokedCommands } from "../__mocks__/tauri-api";
import type { Machine, Subscription, UpkeepItem } from "../types/upkeep";

function item(over: Partial<UpkeepItem> = {}): UpkeepItem {
  return {
    id: 7, machine_id: 3, title: "Clean nozzle", notes: null, schedule: "interval",
    interval_n: 3, interval_unit: "month", anchor_day: 28, usage_metric: null, usage_every: null,
    last_done_on: null, last_done_reading: null, next_due_on: "2026-11-10", snooze_until: null,
    in_calendar: 1, alert: "default", calendar_event_id: null, calendar_event_date: null,
    overdue_notified_for: null, archived: 0, created_at: "", updated_at: "",
    ...over,
  };
}

function machine(over: Partial<Machine> = {}): Machine {
  return {
    id: 3, name: "Bambu X1", kind: "printer", maker: null, model: null, serial: null,
    location: null, status: "working", lent_to: null, lent_until: null, purchase_date: null,
    supplier: null, price: null, currency: null, expense_id: null, warranty_until: null,
    warranty_notified_for: null, lifespan_years: null, photo_path: null, notes: null,
    template_key: null, connection_id: null, device_id: null, reading_baseline: null,
    created_at: "", updated_at: "",
    ...over,
  };
}

function sub(over: Partial<Subscription> = {}): Subscription {
  return {
    id: 5, name: "Figma", plan: null, vendor: null, url: null, renews_on: "2026-12-01",
    anchor_day: 1, period: "month", cost: 15, currency: "CHF", status: "active",
    in_calendar: 1, alert: "week_before", calendar_event_id: null, coming_notified_for: null,
    notes: null, created_at: "", updated_at: "",
    ...over,
  };
}

const calls = (cmd: string) => invokedCommands.filter((c) => c.cmd === cmd);

beforeEach(() => {
  clearInvokedCommands();
  vi.mocked(notifyError).mockClear();
  useAppStore.setState({ calendarSync: true, calendarName: "TestCal", upkeepAlertDefault: "day_9am" });
  setInvokeHandler((cmd) => (cmd === "calendar_create_event" ? "NEW-UID" : null));
});

afterEach(() => {
  setInvokeHandler(null);
  setSelectHandler(null);
});

describe("alertMinutes", () => {
  it("alertMinutes maps every option", () => {
    expect(alertMinutes("day_9am", "none")).toBe(540);
    expect(alertMinutes("day_before", "none")).toBe(-900);
    expect(alertMinutes("week_before", "none")).toBe(-9540);
    expect(alertMinutes("none", "day_9am")).toBeNull();
    expect(alertMinutes("default", "day_before")).toBe(-900);
    expect(alertMinutes("default", "none")).toBeNull();
  });
});

describe("syncItemEvent", () => {
  it("creates an all-day event with title, date and the default alert", async () => {
    const ids = await syncItemEvent(item(), machine());
    expect(ids).toEqual({ calendar_event_id: "NEW-UID", calendar_event_date: "2026-11-10" });
    const [create] = calls("calendar_create_event");
    expect(create.args).toMatchObject({
      calendar: "TestCal",
      title: "Clean nozzle · Bambu X1",
      date: "2026-11-10",
      startTime: null,
      alertMinutes: 540,
    });
  });

  it("removes event when machine retired", async () => {
    const ids = await syncItemEvent(
      item({ calendar_event_id: "OLD", calendar_event_date: "2026-11-10" }),
      machine({ status: "retired" })
    );
    expect(ids).toEqual({ calendar_event_id: null, calendar_event_date: null });
    expect(calls("calendar_delete_event")).toHaveLength(1);
    expect(calls("calendar_delete_event")[0].args).toMatchObject({ uid: "OLD" });
    expect(calls("calendar_create_event")).toHaveLength(0);
  });

  it("removes the event when archived, out of the calendar, undated or sync is off", async () => {
    const withEvent = { calendar_event_id: "OLD", calendar_event_date: "2026-11-10" };
    for (const over of [{ archived: 1 }, { in_calendar: 0 }, { next_due_on: null }]) {
      clearInvokedCommands();
      const ids = await syncItemEvent(item({ ...withEvent, ...over }), machine());
      expect(ids).toEqual({ calendar_event_id: null, calendar_event_date: null });
      expect(calls("calendar_delete_event")).toHaveLength(1);
    }
    clearInvokedCommands();
    useAppStore.setState({ calendarSync: false });
    const ids = await syncItemEvent(item(withEvent), machine());
    expect(ids).toEqual({ calendar_event_id: null, calendar_event_date: null });
    expect(calls("calendar_create_event")).toHaveLength(0);
  });

  it("does nothing when there is no event to remove", async () => {
    const ids = await syncItemEvent(item({ archived: 1 }), machine());
    expect(ids).toEqual({ calendar_event_id: null, calendar_event_date: null });
    expect(invokedCommands).toHaveLength(0);
  });

  it("does not move usage event for 1-day shift", async () => {
    const it0 = item({
      schedule: "usage", next_due_on: "2026-11-11",
      calendar_event_id: "E1", calendar_event_date: "2026-11-10",
    });
    const ids = await syncItemEvent(it0, machine());
    expect(ids).toEqual({ calendar_event_id: "E1", calendar_event_date: "2026-11-10" });
    expect(invokedCommands).toHaveLength(0);
  });

  it("moves the event to a later snooze date", async () => {
    const ids = await syncItemEvent(
      item({ snooze_until: "2026-11-13", calendar_event_id: "E1", calendar_event_date: "2026-11-10" }),
      machine()
    );
    expect(ids).toEqual({ calendar_event_id: "NEW-UID", calendar_event_date: "2026-11-13" });
    expect(calls("calendar_delete_event")[0].args).toMatchObject({ uid: "E1" });
    expect(calls("calendar_create_event")[0].args).toMatchObject({ date: "2026-11-13" });
  });

  it("recreates an unmoved event when forced (title or alert changed)", async () => {
    const ids = await syncItemEvent(
      item({ alert: "none", calendar_event_id: "E1", calendar_event_date: "2026-11-10" }),
      machine(),
      { force: true }
    );
    expect(ids.calendar_event_id).toBe("NEW-UID");
    expect(calls("calendar_create_event")[0].args).toMatchObject({ alertMinutes: null });
  });

  it("save succeeds when calendar create fails", async () => {
    setInvokeHandler(() => { throw new Error("Calendar not authorised"); });
    const ids = await syncItemEvent(item(), machine());
    expect(ids).toEqual({ calendar_event_id: null, calendar_event_date: null });
    expect(notifyError).toHaveBeenCalledTimes(1);
  });

  it("keeps the old ids when moving fails", async () => {
    setInvokeHandler(() => { throw new Error("boom"); });
    const ids = await syncItemEvent(
      item({ next_due_on: "2026-12-10", calendar_event_id: "E1", calendar_event_date: "2026-11-10" }),
      machine()
    );
    expect(ids).toEqual({ calendar_event_id: "E1", calendar_event_date: "2026-11-10" });
    expect(notifyError).toHaveBeenCalledTimes(1);
  });
});

describe("syncSubscriptionEvent", () => {
  it("creates a renewal event on renews_on with the subscription's alert", async () => {
    const ids = await syncSubscriptionEvent(sub());
    expect(ids).toEqual({ calendar_event_id: "NEW-UID" });
    expect(calls("calendar_create_event")[0].args).toMatchObject({
      title: "Figma renews",
      date: "2026-12-01",
      alertMinutes: -9540,
    });
  });

  it("removes the event when cancelled or out of the calendar", async () => {
    for (const over of [{ status: "cancelled" as const }, { in_calendar: 0 }]) {
      clearInvokedCommands();
      const ids = await syncSubscriptionEvent(sub({ ...over, calendar_event_id: "S1" }));
      expect(ids).toEqual({ calendar_event_id: null });
      expect(calls("calendar_delete_event")[0].args).toMatchObject({ uid: "S1" });
    }
  });

  it("leaves an existing event alone unless forced", async () => {
    expect(await syncSubscriptionEvent(sub({ calendar_event_id: "S1" }))).toEqual({ calendar_event_id: "S1" });
    expect(invokedCommands).toHaveLength(0);
    expect(await syncSubscriptionEvent(sub({ calendar_event_id: "S1" }), { force: true }))
      .toEqual({ calendar_event_id: "NEW-UID" });
  });

  it("returns null and notifies once when create fails", async () => {
    setInvokeHandler(() => { throw new Error("nope"); });
    expect(await syncSubscriptionEvent(sub())).toEqual({ calendar_event_id: null });
    expect(notifyError).toHaveBeenCalledTimes(1);
  });
});

describe("persisting event ids", () => {
  beforeEach(async () => {
    await getDb();
    clearExecutedStatements();
  });

  it("setItemCalendarEvent writes only the calendar columns", async () => {
    await setItemCalendarEvent(7, "UID", "2026-11-10");
    const [stmt] = executedStatements;
    expect(stmt.sql).toMatch(/UPDATE upkeep_items SET calendar_event_id = \$1, calendar_event_date = \$2 WHERE id = \$3/);
    expect(stmt.sql).not.toMatch(/updated_at/);
    expect(stmt.params).toEqual(["UID", "2026-11-10", 7]);
  });

  it("setSubscriptionCalendarEvent writes only the event id", async () => {
    await setSubscriptionCalendarEvent(5, null);
    const [stmt] = executedStatements;
    expect(stmt.sql).toMatch(/UPDATE subscriptions SET calendar_event_id = \$1 WHERE id = \$2/);
    expect(stmt.sql).not.toMatch(/updated_at/);
    expect(stmt.params).toEqual([null, 5]);
  });

  it("syncItemCalendar loads the item and machine, syncs and stores the new ids", async () => {
    setSelectHandler((sql) => {
      if (sql.includes("FROM upkeep_items")) return [item()];
      if (sql.includes("FROM machines")) return [machine()];
      return [];
    });
    await syncItemCalendar(7);
    expect(calls("calendar_create_event")).toHaveLength(1);
    const write = executedStatements.find((st) => st.sql.includes("calendar_event_date"));
    expect(write?.params).toEqual(["NEW-UID", "2026-11-10", 7]);
    expect(await getUpkeepItem(7)).not.toBeNull();
  });

  it("syncItemCalendar writes nothing when the ids did not change", async () => {
    setSelectHandler((sql) => {
      if (sql.includes("FROM upkeep_items")) return [item({ archived: 1 })];
      if (sql.includes("FROM machines")) return [machine()];
      return [];
    });
    await syncItemCalendar(7);
    expect(executedStatements).toHaveLength(0);
    expect(invokedCommands).toHaveLength(0);
  });

  it("two syncs of the same item run one after the other (no duplicate event)", async () => {
    let row = item();
    setSelectHandler((sql) => {
      if (sql.includes("FROM upkeep_items")) return [row];
      if (sql.includes("FROM machines")) return [machine()];
      return [];
    });
    setInvokeHandler((cmd) => {
      if (cmd === "calendar_create_event") {
        row = { ...row, calendar_event_id: "NEW-UID", calendar_event_date: "2026-11-10" };
        return "NEW-UID";
      }
      return null;
    });
    await Promise.all([syncItemCalendar(7), syncItemCalendar(7)]);
    expect(calls("calendar_create_event")).toHaveLength(1);
  });

  it("syncSubscriptionCalendar stores the renewal event id", async () => {
    setSelectHandler((sql) => (sql.includes("FROM subscriptions") ? [sub()] : []));
    await syncSubscriptionCalendar(5);
    const write = executedStatements.find((st) => st.sql.includes("UPDATE subscriptions"));
    expect(write?.params).toEqual(["NEW-UID", 5]);
  });

  it("removeItemEvents deletes the events of rows about to be deleted", async () => {
    await removeItemEvents([item({ calendar_event_id: "A" }), item({ id: 8, calendar_event_id: null })]);
    expect(calls("calendar_delete_event").map((c) => c.args.uid)).toEqual(["A"]);
    expect(executedStatements).toHaveLength(0);
  });
});

describe("turning calendar sync on", () => {
  beforeEach(async () => {
    await getDb();
    clearExecutedStatements();
  });

  it("syncAllUpkeepEvents creates events for every item and subscription and counts them", async () => {
    setSelectHandler((sql, params) => {
      if (sql.includes("FROM upkeep_items WHERE id")) {
        return [item({ id: params[0] as number, archived: params[0] === 9 ? 1 : 0 })];
      }
      if (sql.includes("FROM upkeep_items")) return [item({ id: 7 }), item({ id: 9, archived: 1 })];
      if (sql.includes("FROM machines")) return [machine()];
      if (sql.includes("FROM subscriptions")) return [sub()];
      return [];
    });
    const count = await syncAllUpkeepEvents();
    expect(count).toBe(2); // item 7 + the subscription; archived item 9 skipped
    expect(calls("calendar_create_event")).toHaveLength(2);
  });

  it("purgeAllCalendarEvents also deletes and forgets upkeep and renewal events", async () => {
    setSelectHandler((sql) => {
      if (sql.includes("FROM upkeep_items")) return [{ calendar_event_id: "U1" }];
      if (sql.includes("FROM subscriptions")) return [{ calendar_event_id: "S1" }];
      return [];
    });
    await purgeAllCalendarEvents();
    expect(calls("calendar_delete_event").map((c) => c.args.uid)).toEqual(["U1", "S1"]);
    const sqls = executedStatements.map((st) => st.sql);
    expect(sqls.some((q) => q.includes("UPDATE upkeep_items SET calendar_event_id = NULL, calendar_event_date = NULL"))).toBe(true);
    expect(sqls.some((q) => q.includes("UPDATE subscriptions SET calendar_event_id = NULL"))).toBe(true);
  });
});
