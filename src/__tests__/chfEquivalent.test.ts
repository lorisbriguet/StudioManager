import { describe, it, expect } from "vitest";
import { missingChfEquivalent } from "../lib/chfEquivalent";

// A non-CHF invoice without a CHF equivalent silently mixes currencies in
// the P&L — the form must warn (not block: the rate may be unavailable).

describe("missingChfEquivalent", () => {
  it("flags foreign-currency invoices without a positive CHF equivalent", () => {
    expect(missingChfEquivalent("EUR", 0)).toBe(true);
    expect(missingChfEquivalent("USD", -5)).toBe(true);
    expect(missingChfEquivalent("EUR", NaN)).toBe(true);
  });

  it("passes CHF invoices and converted foreign ones", () => {
    expect(missingChfEquivalent("CHF", 0)).toBe(false);
    expect(missingChfEquivalent("EUR", 108.5)).toBe(false);
  });
});
