import { describe, it, expect } from "vitest";
import { vatThresholdWarning } from "../lib/vatThreshold";

describe("vatThresholdWarning", () => {
  it("stays quiet below 80% of CHF 100,000", () => {
    expect(vatThresholdWarning(79_999.95, true)).toBeNull();
    expect(vatThresholdWarning(0, true)).toBeNull();
  });

  it("warns from 80%, and past the threshold", () => {
    expect(vatThresholdWarning(80_000, true)).toBe(0.8);
    expect(vatThresholdWarning(104_000, true)).toBe(1.04);
  });

  it("never warns a profile that is not VAT exempt", () => {
    expect(vatThresholdWarning(150_000, false)).toBeNull();
  });

  it("ignores a non-finite turnover", () => {
    expect(vatThresholdWarning(NaN, true)).toBeNull();
  });
});
