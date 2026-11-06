import { describe, it, expect } from "vitest";
import { formatDate, formatRange } from "@fullcalendar/core";
import { calendarLocale, CALENDAR_TIME_FORMAT } from "../lib/calendarLocale";

describe("calendarLocale", () => {
  it("uses en-gb for EN and fr-ch for FR", () => {
    expect(calendarLocale("EN").code).toBe("en-gb");
    expect(calendarLocale("FR").code).toBe("fr-ch");
  });

  it("starts the week on Monday in both languages", () => {
    const dow = (lang: "EN" | "FR") => (calendarLocale(lang) as { week?: { dow: number } }).week?.dow;
    expect(dow("EN")).toBe(1);
    expect(dow("FR")).toBe(1);
  });

  it("formats times on a 24-hour clock", () => {
    const d = new Date(2026, 10, 5, 13, 0);
    const en = formatDate(d, { ...(CALENDAR_TIME_FORMAT as object), locale: "en-gb" });
    expect(en).toBe("13:00");
  });

  it("writes the week title day first, not the US way", () => {
    const opts = { month: "short", day: "numeric", year: "numeric", locale: "en-gb" } as const;
    const title = formatRange(new Date(2026, 10, 2), new Date(2026, 10, 8), opts);
    expect(title).not.toMatch(/^Nov/);
    expect(title).toMatch(/^2/);
  });
});
