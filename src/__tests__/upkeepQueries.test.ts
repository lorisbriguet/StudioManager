import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { getDb } from "../db";
import {
  executedStatements,
  clearExecutedStatements,
  setSelectHandler,
} from "../__mocks__/tauri-sql";
import { createMachine } from "../db/queries/machines";
import { markUpkeepDone, snoozeUpkeep } from "../db/queries/upkeepItems";
import type { UpkeepItem } from "../types/upkeep";

function item(over: Partial<UpkeepItem>): UpkeepItem {
  return {
    id: 7,
    machine_id: 3,
    title: "Clean",
    notes: null,
    schedule: "interval",
    interval_n: 3,
    interval_unit: "month",
    anchor_day: 28,
    usage_metric: null,
    usage_every: null,
    last_done_on: null,
    last_done_reading: null,
    next_due_on: "2026-10-28",
    snooze_until: "2026-10-30",
    in_calendar: 1,
    alert: "default",
    calendar_event_id: null,
    calendar_event_date: null,
    overdue_notified_for: "2026-10-28",
    archived: 0,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

describe("upkeep queries", () => {
  beforeAll(async () => {
    await getDb();
  });
  beforeEach(() => {
    clearExecutedStatements();
    setSelectHandler(null);
  });

  it("markUpkeepDone on interval item writes log and moves next due", async () => {
    setSelectHandler(() => [item({})]);
    await markUpkeepDone(7, "2026-10-28", null, "oiled");

    const log = executedStatements.find((s) => s.sql.includes("INSERT INTO service_log"));
    expect(log).toBeDefined();
    expect(log!.params).toContain("2026-10-28");
    expect(log!.params).toContain(3);
    expect(log!.params).toContain("oiled");

    const upd = executedStatements.find((s) => s.sql.includes("UPDATE upkeep_items"));
    expect(upd).toBeDefined();
    expect(upd!.params).toContain("2027-01-28");
    expect(upd!.sql).toContain("snooze_until = NULL");
    expect(upd!.sql).toContain("overdue_notified_for = NULL");
  });

  it("markUpkeepDone on usage item stores reading", async () => {
    setSelectHandler(() => [
      item({ schedule: "usage", interval_n: null, interval_unit: null, usage_metric: "print_hours", usage_every: 200 }),
    ]);
    await markUpkeepDone(7, "2026-10-28", 512, undefined);

    const log = executedStatements.find((s) => s.sql.includes("INSERT INTO service_log"));
    expect(log!.params).toContain(512);
    const upd = executedStatements.find((s) => s.sql.includes("UPDATE upkeep_items"));
    expect(upd!.params).toContain(512);
    expect(upd!.sql).toContain("next_due_on = NULL");
  });

  it("snooze sets snooze_until and clears overdue_notified_for", async () => {
    await snoozeUpkeep(7, 3, "2026-10-28");
    const upd = executedStatements.find((s) => s.sql.includes("UPDATE upkeep_items"));
    expect(upd).toBeDefined();
    expect(upd!.params).toContain("2026-10-31");
    expect(upd!.sql).toContain("overdue_notified_for = NULL");
  });

  it("createMachine inserts template items", async () => {
    await createMachine({ name: "Prusa" }, [
      { title: "Lube rods", schedule: "interval", interval_n: 3, interval_unit: "month", last_done_on: "2026-10-28" },
      { title: "Replace nozzle", schedule: "usage", usage_metric: "print_hours", usage_every: 500 },
    ]);
    expect(executedStatements[0].sql).toContain("INSERT INTO machines");
    const items = executedStatements.filter((s) => s.sql.includes("INSERT INTO upkeep_items"));
    expect(items).toHaveLength(2);
    expect(items[0].sql).toContain("$LAST_INSERT_ID");
    expect(items[0].params).toContain("2027-01-28");
    expect(items[0].params).toContain(28);
    expect(items[1].params).not.toContain("2027-01-28");
  });
});
