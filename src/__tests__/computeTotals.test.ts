import { describe, it, expect } from "vitest";
import { computeTotals } from "../lib/lineItems";

const items = (...amounts: number[]) => amounts.map((amount) => ({ amount }));

describe("computeTotals", () => {
  it("adds the line amounts with no discount", () => {
    expect(computeTotals(items(1200, 350.5), 0)).toEqual({ subtotal: 1550.5, discountAmount: 0, total: 1550.5 });
  });

  it("is all zeros for an empty document", () => {
    expect(computeTotals([], 0.1)).toEqual({ subtotal: 0, discountAmount: 0, total: 0 });
  });

  it("drops float noise from the sum", () => {
    // 0.1 + 0.2 is 0.30000000000000004 in plain float math.
    expect(computeTotals(items(0.1, 0.2), 0).subtotal).toBe(0.3);
  });

  it("rounds a half-centime discount up and takes the rounded discount off", () => {
    // 10 % of 40.25 is 4.025: the discount is 4.03 and the total 36.22.
    expect(computeTotals(items(40.25), 0.1)).toEqual({ subtotal: 40.25, discountAmount: 4.03, total: 36.22 });
  });

  it("keeps subtotal - discount equal to the total, as printed", () => {
    for (const rate of [0.05, 0.1, 0.15, 0.2, 0.333]) {
      const t = computeTotals(items(123.45, 67.8, 9.99), rate);
      expect(Math.round((t.subtotal - t.discountAmount) * 100)).toBe(Math.round(t.total * 100));
    }
  });

  it("handles a credit line", () => {
    expect(computeTotals(items(500, -120), 0.2)).toEqual({ subtotal: 380, discountAmount: 76, total: 304 });
  });
});
