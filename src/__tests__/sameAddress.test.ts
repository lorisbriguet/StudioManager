import { describe, it, expect } from "vitest";
import { sameAddress } from "../types/client";

// The client page hides its read-only "Main address" card when an address
// row already shows the same address, and deleting that row clears it.
describe("sameAddress", () => {
  const own = { address_line1: "Rue du Lac 1", address_line2: "", postal_city: "1200 Genève" };

  it("matches the copied Main row, whatever its label or name", () => {
    expect(sameAddress({ ...own, label: "Main", billing_name: "ACME SA" } as typeof own, own)).toBe(true);
  });

  it("ignores surrounding spaces and empty versus missing lines", () => {
    expect(sameAddress({ address_line1: " Rue du Lac 1 ", address_line2: null, postal_city: "1200 Genève" }, own)).toBe(true);
  });

  it("tells a different address apart", () => {
    expect(sameAddress({ ...own, postal_city: "8001 Zürich" }, own)).toBe(false);
  });
});
