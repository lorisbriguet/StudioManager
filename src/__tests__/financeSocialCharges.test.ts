import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { getPLData } from "../db/queries/finance";
import { getDb } from "../db";
import { setSelectHandler } from "../__mocks__/tauri-sql";

// CS bug: social charges were aggregated to a single scalar, so the expense
// breakdown pie chart (built from per-category rows) silently dropped them.
// getPLData must return social-charge categories with the same row shape as
// operating expenses, in addition to the scalar total used by the P&L lines.

describe("getPLData social charges", () => {
  beforeAll(async () => {
    // Warm the DB singleton so ensureSchema noise doesn't hit the handler
    await getDb();
  });

  beforeEach(() => {
    setSelectHandler(null);
  });

  it("returns social-charge category rows alongside the scalar total", async () => {
    setSelectHandler((sql) => {
      const flat = sql.replace(/\s+/g, " ");
      if (flat.includes("pl_section = 'social_charges'")) {
        return [
          {
            category_code: "CS",
            name_fr: "Charges sociales AVS",
            name_en: "Social charges (AVS)",
            total: 1200,
          },
        ];
      }
      if (flat.includes("pl_section = 'operating'")) {
        return [
          {
            category_code: "FA",
            name_fr: "Frais administratifs",
            name_en: "Admin fees",
            total: 300,
          },
        ];
      }
      return [];
    });

    const pl = await getPLData(2026);

    expect(pl.social_charge_categories).toEqual([
      {
        category_code: "CS",
        name_fr: "Charges sociales AVS",
        name_en: "Social charges (AVS)",
        total: 1200,
      },
    ]);
    // Scalar total still feeds the P&L statement and net result
    expect(pl.social_charges).toBe(1200);
    expect(pl.net_result).toBe(-1500); // 0 revenue - 300 operating - 1200 social
  });
});
