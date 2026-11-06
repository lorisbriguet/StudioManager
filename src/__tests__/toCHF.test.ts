import { describe, it, expect } from "vitest";
import { toCHF } from "../lib/exchangeRate";

// toCHF is pure: kept apart from exchangeRate.test.ts, which covers the
// fetched rates (getExchangeRate) and their cache.
describe("toCHF", () => {
  it("divides by the rate (foreign units per 1 CHF)", () => {
    expect(toCHF(107, 1.07)).toBe(100);
  });

  it("rounds to the centime", () => {
    expect(toCHF(100, 1.07)).toBe(93.46);
    expect(toCHF(1, 3)).toBe(0.33);
  });

  it("returns the amount unchanged for a rate of 1", () => {
    expect(toCHF(1234.56, 1)).toBe(1234.56);
  });

  it("returns the amount as is for a zero or negative stored rate", () => {
    expect(toCHF(250, 0)).toBe(250);
    expect(toCHF(250, -1.1)).toBe(250);
  });
});
