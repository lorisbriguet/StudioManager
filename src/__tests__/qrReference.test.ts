import { describe, it, expect } from "vitest";
import { isQRReferenceValid } from "swissqrbill/utils";
import { toQRReference } from "../components/invoice/qr-bill";

describe("toQRReference", () => {
  it("gives the check digit of the SIX sample reference", () => {
    // Sample QR reference from the Swiss Implementation Guidelines for the QR-bill.
    expect(toQRReference("21000000000313947143000901")).toBe("210000000003139471430009017");
  });

  it("pads an invoice reference to 26 digits and appends its check digit", () => {
    const ref = toQRReference("2026-001");
    expect(ref).toHaveLength(27);
    expect(ref.slice(0, 26)).toBe("2026001".padStart(26, "0"));
    expect(isQRReferenceValid(ref)).toBe(true);
  });

  it("gives a valid reference for every check digit", () => {
    const seen = new Set<string>();
    for (let i = 1; i <= 60; i++) {
      const ref = toQRReference(`2026-${String(i).padStart(3, "0")}`);
      expect(isQRReferenceValid(ref), ref).toBe(true);
      seen.add(ref.slice(-1));
    }
    expect(seen.size).toBe(10);
  });

  it("is all zeros with a 0 check digit for a reference without digits", () => {
    expect(toQRReference("ABC")).toBe("0".repeat(27));
  });
});
