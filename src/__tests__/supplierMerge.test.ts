import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { suggestSupplierGroups } from "../lib/supplierMerge";
import { getSupplierCounts, mergeSuppliers } from "../db/queries/expenses";
import { getDb } from "../db";
import {
  setSelectHandler,
  executedStatements,
  clearExecutedStatements,
} from "../__mocks__/tauri-sql";

describe("suggestSupplierGroups", () => {
  it("groups case and legal-suffix variants", () => {
    const groups = suggestSupplierGroups([
      { supplier: "Fairtiq", count: 5 },
      { supplier: "FairtiQ", count: 1 },
      { supplier: "Figma Inc", count: 2 },
      { supplier: "Figma", count: 7 },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].map((s) => s.supplier)).toEqual(["Figma", "Figma Inc"]);
    expect(groups[1].map((s) => s.supplier)).toEqual(["Fairtiq", "FairtiQ"]);
  });

  it("groups token-subset variants transitively (Adobe family)", () => {
    const groups = suggestSupplierGroups([
      { supplier: "Adobe", count: 10 },
      { supplier: "Adobe Cloud", count: 3 },
      { supplier: "Adobe Systems Inc", count: 1 },
      { supplier: "Migros", count: 4 },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((s) => s.supplier)).toEqual([
      "Adobe",
      "Adobe Cloud",
      "Adobe Systems Inc",
    ]);
  });

  it("returns no groups when nothing overlaps", () => {
    expect(
      suggestSupplierGroups([
        { supplier: "Migros", count: 2 },
        { supplier: "Coop", count: 3 },
      ])
    ).toEqual([]);
  });

  it("sorts group members by usage so the default canonical is the most used", () => {
    const groups = suggestSupplierGroups([
      { supplier: "Adobe Cloud", count: 2 },
      { supplier: "Adobe", count: 9 },
    ]);
    expect(groups[0][0].supplier).toBe("Adobe");
  });
});

describe("supplier merge queries", () => {
  beforeAll(async () => {
    await getDb();
  });

  beforeEach(() => {
    clearExecutedStatements();
  });

  afterEach(() => {
    setSelectHandler(null);
  });

  it("getSupplierCounts groups and counts by supplier", async () => {
    const seen: string[] = [];
    setSelectHandler((sql) => {
      seen.push(sql.replace(/\s+/g, " "));
      return [];
    });
    await getSupplierCounts();
    expect(seen[0]).toContain("COUNT(*)");
    expect(seen[0]).toContain("GROUP BY supplier");
  });

  it("mergeSuppliers captures previous rows, updates variants, returns prev for undo", async () => {
    setSelectHandler((sql) => {
      if (sql.includes("SELECT id, supplier")) {
        return [
          { id: 1, supplier: "Adobe Cloud" },
          { id: 2, supplier: "Adobe Systems Inc" },
        ];
      }
      return [];
    });
    const prev = await mergeSuppliers("Adobe", ["Adobe Cloud", "Adobe Systems Inc"]);
    expect(prev).toEqual([
      { id: 1, supplier: "Adobe Cloud" },
      { id: 2, supplier: "Adobe Systems Inc" },
    ]);
    const upd = executedStatements.find((s) => s.sql.includes("UPDATE expenses SET supplier"));
    expect(upd).toBeDefined();
    expect(upd!.params[0]).toBe("Adobe");
    expect(upd!.params).toContain("Adobe Cloud");
    expect(upd!.params).toContain("Adobe Systems Inc");
  });
});
