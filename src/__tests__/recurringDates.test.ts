import { describe, it, expect } from "vitest";
import { advanceDate } from "../utils/recurringDates";

// advanceDate advances a recurring template's next_due by one period,
// targeting min(anchorDay, daysInTargetMonth) each step. The anchor is the
// base invoice's day-of-month, which is immutable — deriving it from the
// mutating next_due would decay permanently after one short-month clamp
// (Jan 31 → Feb 28 → Mar 28 forever).

describe("advanceDate", () => {
  describe("monthly", () => {
    it("clamps Jan 31 to Feb 28 in a non-leap year", () => {
      expect(advanceDate("2026-01-31", "monthly", 31)).toBe("2026-02-28");
    });

    it("clamps Jan 31 to Feb 29 in a leap year", () => {
      expect(advanceDate("2024-01-31", "monthly", 31)).toBe("2024-02-29");
    });

    it("recovers the anchor day after a short month (no permanent drift)", () => {
      // From a clamped Feb 28 with anchor 31, the next step must be Mar 31,
      // not Mar 28.
      expect(advanceDate("2026-02-28", "monthly", 31)).toBe("2026-03-31");
    });

    it("clamps anchor 31 in 30-day months and recovers afterwards", () => {
      expect(advanceDate("2026-03-31", "monthly", 31)).toBe("2026-04-30");
      expect(advanceDate("2026-04-30", "monthly", 31)).toBe("2026-05-31");
    });

    it("keeps a mid-month anchor unchanged", () => {
      expect(advanceDate("2026-01-15", "monthly", 15)).toBe("2026-02-15");
    });

    it("rolls over the year end", () => {
      expect(advanceDate("2026-12-31", "monthly", 31)).toBe("2027-01-31");
    });

    it("never drifts across a full year of advances from Jan 31", () => {
      const expected = [
        "2026-02-28",
        "2026-03-31",
        "2026-04-30",
        "2026-05-31",
        "2026-06-30",
        "2026-07-31",
        "2026-08-31",
        "2026-09-30",
        "2026-10-31",
        "2026-11-30",
        "2026-12-31",
        "2027-01-31",
      ];
      let date = "2026-01-31";
      for (const next of expected) {
        date = advanceDate(date, "monthly", 31);
        expect(date).toBe(next);
      }
    });
  });

  describe("quarterly", () => {
    it("advances 3 months", () => {
      expect(advanceDate("2026-01-15", "quarterly", 15)).toBe("2026-04-15");
    });

    it("clamps anchor 31 into a 30-day month", () => {
      expect(advanceDate("2026-01-31", "quarterly", 31)).toBe("2026-04-30");
    });
  });

  describe("biannual", () => {
    it("advances 6 months", () => {
      expect(advanceDate("2026-01-15", "biannual", 15)).toBe("2026-07-15");
    });

    it("recovers the anchor from a clamped date", () => {
      // Apr 30 (clamped from anchor 31) + 6 months → Oct 31, not Oct 30.
      expect(advanceDate("2026-04-30", "biannual", 31)).toBe("2026-10-31");
    });
  });

  describe("annual", () => {
    it("clamps leap-day Feb 29 to Feb 28 in the next (non-leap) year", () => {
      expect(advanceDate("2024-02-29", "annual", 29)).toBe("2025-02-28");
    });

    it("recovers Feb 29 when the target year is a leap year", () => {
      expect(advanceDate("2027-02-28", "annual", 29)).toBe("2028-02-29");
    });

    it("advances a plain anniversary by one year", () => {
      expect(advanceDate("2026-06-10", "annual", 10)).toBe("2027-06-10");
    });
  });

  describe("safety", () => {
    it("always strictly increases (guarantees catch-up loop termination)", () => {
      const frequencies = ["monthly", "quarterly", "biannual", "annual"] as const;
      for (const freq of frequencies) {
        let date = "2026-01-31";
        for (let i = 0; i < 24; i++) {
          const next = advanceDate(date, freq, 31);
          expect(next > date, `${freq}: expected ${next} to be after ${date}`).toBe(true);
          date = next;
        }
      }
    });

    it("returns YYYY-MM-DD with zero padding", () => {
      expect(advanceDate("2026-08-05", "monthly", 5)).toBe("2026-09-05");
      expect(advanceDate("2025-12-09", "monthly", 9)).toBe("2026-01-09");
    });
  });
});
