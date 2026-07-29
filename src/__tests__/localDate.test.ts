import { describe, it, expect, vi, afterEach } from "vitest";
import { todayLocalISO, toLocalISO, parseLocalDate } from "../utils/localDate";
import { formatDisplayDate } from "../utils/formatDate";

// NOTE: the UTC-vs-local distinction these helpers exist for is only
// observable when the test process runs with TZ != UTC (e.g. Europe/Zurich,
// where new Date().toISOString() lags the local day between midnight and
// 01:00/02:00). All expectations below are built from the same local Date
// APIs, so the suite passes in any timezone.

afterEach(() => {
  vi.useRealTimers();
});

describe("todayLocalISO", () => {
  it("returns today's LOCAL calendar date as YYYY-MM-DD", () => {
    const now = new Date();
    const expected = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
    expect(todayLocalISO()).toBe(expected);
    expect(todayLocalISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("uses the local day, not the UTC day, just after local midnight", () => {
    vi.useFakeTimers();
    // 00:30 local on 15 March — in any zone ahead of UTC the UTC day is still the 14th
    vi.setSystemTime(new Date(2026, 2, 15, 0, 30, 0));
    expect(todayLocalISO()).toBe("2026-03-15");
  });

  it("uses the local day just before local midnight", () => {
    vi.useFakeTimers();
    // 23:30 local — in zones behind UTC the UTC day is already the 16th
    vi.setSystemTime(new Date(2026, 2, 15, 23, 30, 0));
    expect(todayLocalISO()).toBe("2026-03-15");
  });
});

describe("toLocalISO", () => {
  it("formats a Date's local calendar date with zero padding", () => {
    expect(toLocalISO(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toLocalISO(new Date(2026, 11, 31, 23, 59, 59))).toBe("2026-12-31");
  });

  it("uses the local day for a local-midnight Date", () => {
    // In UTC+ zones, toISOString() on a local-midnight Date yields the
    // PREVIOUS day; toLocalISO must not.
    expect(toLocalISO(new Date(2026, 6, 20, 0, 0, 0, 0))).toBe("2026-07-20");
  });
});

describe("parseLocalDate", () => {
  it("parses YYYY-MM-DD as local midnight", () => {
    const d = parseLocalDate("2026-03-15");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  it("round-trips with toLocalISO", () => {
    expect(toLocalISO(parseLocalDate("2026-07-21"))).toBe("2026-07-21");
    expect(toLocalISO(parseLocalDate("2024-02-29"))).toBe("2024-02-29");
    expect(toLocalISO(parseLocalDate("2026-01-01"))).toBe("2026-01-01");
    expect(toLocalISO(parseLocalDate("2026-12-31"))).toBe("2026-12-31");
  });
});

describe("formatDisplayDate", () => {
  it("keeps bare YYYY-MM-DD dates date-only (no timezone shift)", () => {
    expect(formatDisplayDate("2026-03-15", "yyyy-MM-dd")).toBe("2026-03-15");
    expect(formatDisplayDate("2026-03-15", "dd.MM.yyyy")).toBe("15.03.2026");
  });

  it("treats SQLite datetime strings as UTC and renders the LOCAL date", () => {
    // "2026-03-15 23:30:00" is a UTC instant (SQLite CURRENT_TIMESTAMP);
    // in CET (+1) it falls on 16 March local time. The expectation is built
    // via the same conversion so it also holds when TZ=UTC.
    const expected = toLocalISO(new Date("2026-03-15T23:30:00Z"));
    expect(formatDisplayDate("2026-03-15 23:30:00", "yyyy-MM-dd")).toBe(expected);
  });

  it("leaves strings with an explicit timezone untouched", () => {
    const expected = toLocalISO(new Date("2026-03-15T23:30:00Z"));
    expect(formatDisplayDate("2026-03-15T23:30:00Z", "yyyy-MM-dd")).toBe(expected);
  });
});
