import { describe, it, expect } from "vitest";
import { pdfUnitLabel } from "../i18n/invoice-labels";

describe("pdfUnitLabel", () => {
  it("translates the stored unit to the document language", () => {
    expect(pdfUnitLabel("FR", "hours")).toBe("heure");
    expect(pdfUnitLabel("FR", "units")).toBe("unité");
    expect(pdfUnitLabel("EN", "hours")).toBe("hour");
    expect(pdfUnitLabel("EN", "flat")).toBe("flat rate");
  });

  it("prints an unknown unit as stored and an empty one as nothing", () => {
    expect(pdfUnitLabel("FR", "m2")).toBe("m2");
    expect(pdfUnitLabel("FR", null)).toBe("");
    expect(pdfUnitLabel("EN", "")).toBe("");
  });
});
