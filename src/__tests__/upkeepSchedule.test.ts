import { describe, it, expect } from "vitest";
import {
  nextIntervalDue, usageLeft, dailyUse, forecastUsageDue, effectiveDue, dueState, shouldMoveEvent,
} from "../lib/upkeep/schedule";
import type { UpkeepItem } from "../types/upkeep";

const item = (o: Partial<UpkeepItem>) => ({ next_due_on: null, snooze_until: null, ...o }) as UpkeepItem;
const T = "2026-10-28";

describe("upkeep schedule", () => {
  it("nextIntervalDue", () => {
    expect(nextIntervalDue({ interval_n: 1, interval_unit: "month", anchor_day: 31 }, "2026-01-31")).toBe("2026-02-28");
  });
  it("usageLeft", () => {
    expect(usageLeft(200, 412, 230)).toBe(18);
    expect(usageLeft(200, 100, 230)).toBe(200);
    expect(usageLeft(200, 900, 230)).toBe(0);
    expect(usageLeft(200, 50, null)).toBe(150);
  });
  it("dailyUse", () => {
    expect(dailyUse([{ value: 100, read_at: "2026-09-28" }, { value: 160, read_at: T }], T)).toBe(2);
    expect(dailyUse([{ value: 100, read_at: T }], T)).toBeNull();
    expect(dailyUse([{ value: 100, read_at: "2026-09-28" }, { value: 100, read_at: T }], T)).toBeNull();
  });
  it("forecastUsageDue", () => {
    expect(forecastUsageDue(18, 2, T)).toBe("2026-11-06");
    expect(forecastUsageDue(18, null, T)).toBeNull();
  });
  it("effectiveDue", () => {
    expect(effectiveDue(item({ next_due_on: "2026-11-01", snooze_until: "2026-11-05" }))).toBe("2026-11-05");
    expect(effectiveDue(item({ next_due_on: "2026-11-01", snooze_until: "2026-10-30" }))).toBe("2026-11-01");
    expect(effectiveDue(item({ snooze_until: "2026-11-05" }))).toBe("2026-11-05");
  });
  it("dueState", () => {
    expect(dueState(item({ next_due_on: "2026-10-27" }), T, 14)).toBe("overdue");
    expect(dueState(item({ next_due_on: "2026-11-11" }), T, 14)).toBe("soon");
    expect(dueState(item({ next_due_on: "2026-11-12" }), T, 14)).toBe("later");
    expect(dueState(item({}), T, 14)).toBe("none");
  });
  it("dueState: due today is soon, not overdue (even with a 0-day window)", () => {
    expect(dueState(item({ next_due_on: T }), T, 14)).toBe("soon");
    expect(dueState(item({ next_due_on: T }), T, 0)).toBe("soon");
    expect(dueState(item({ next_due_on: "2026-10-29" }), T, 0)).toBe("later");
  });
  it("shouldMoveEvent edges: exactly 2 days either way, date to or from none", () => {
    expect(shouldMoveEvent("2026-11-06", "2026-11-04", "usage")).toBe(true);
    expect(shouldMoveEvent("2026-11-06", "2026-11-05", "usage")).toBe(false);
    expect(shouldMoveEvent("2026-11-06", null, "usage")).toBe(true);
    expect(shouldMoveEvent("2026-11-06", null, "interval")).toBe(true);
    expect(shouldMoveEvent(null, null, "usage")).toBe(false);
  });
  it("shouldMoveEvent", () => {
    expect(shouldMoveEvent("2026-11-06", "2026-11-07", "usage")).toBe(false);
    expect(shouldMoveEvent("2026-11-06", "2026-11-08", "usage")).toBe(true);
    expect(shouldMoveEvent(null, "2026-11-08", "usage")).toBe(true);
    expect(shouldMoveEvent("2026-11-06", "2026-11-07", "interval")).toBe(true);
    expect(shouldMoveEvent("2026-11-06", "2026-11-06", "interval")).toBe(false);
  });
});
