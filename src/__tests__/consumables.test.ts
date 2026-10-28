import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { getDb } from "../db";
import { executedStatements, clearExecutedStatements, setSelectHandler } from "../__mocks__/tauri-sql";
import {
  logConsumableUsage,
  restockConsumable,
  getProjectMaterialCost,
  isLow,
} from "../db/queries/consumables";

describe("consumables queries", () => {
  beforeAll(async () => {
    await getDb();
  });
  beforeEach(() => {
    clearExecutedStatements();
    setSelectHandler(null);
  });

  it("logUsage reduces stock and stores cost at current price", async () => {
    await logConsumableUsage(4, 2.5, 9, "2026-10-28");
    const ins = executedStatements.find((s) => s.sql.includes("INSERT INTO consumable_usage"));
    expect(ins).toBeDefined();
    expect(ins!.sql).toContain("unit_price");
    expect(ins!.params).toEqual([4, 9, "2026-10-28", 2.5]);
    const upd = executedStatements.find((s) => s.sql.includes("UPDATE consumables SET stock"));
    expect(upd).toBeDefined();
    expect(upd!.sql).toContain("stock - $1");
    expect(upd!.params).toEqual([2.5, 4]);
  });

  it("stock never below zero", async () => {
    await logConsumableUsage(4, 100, null, "2026-10-28");
    const upd = executedStatements.find((s) => s.sql.includes("UPDATE consumables SET stock"));
    expect(upd!.sql).toContain("MAX(stock - $1, 0)");
    const ins = executedStatements.find((s) => s.sql.includes("INSERT INTO consumable_usage"));
    expect(ins!.params).toEqual([4, null, "2026-10-28", 100]);
  });

  it("restock above level resets low_notified", async () => {
    await restockConsumable(4, 10);
    const add = executedStatements.find((s) => s.sql.includes("stock = stock + $1"));
    expect(add!.params).toEqual([10, 4]);
    const reset = executedStatements.find((s) => s.sql.includes("low_notified = 0"));
    expect(reset).toBeDefined();
    expect(reset!.sql).toContain("stock > reorder_level");
  });

  it("restock still below level keeps low_notified", async () => {
    await restockConsumable(4, 1);
    const reset = executedStatements.find((s) => s.sql.includes("low_notified"));
    // The reset is conditional in SQL, so it never clears the flag at or below the level.
    expect(reset!.sql).toContain("AND stock > reorder_level");
    expect(reset!.sql).not.toMatch(/SET[^W]*stock\s*=/);
  });

  it("getProjectMaterialCost groups by consumable for the project", async () => {
    setSelectHandler(() => [{ name: "Resin", amount: 3, unit: "L", cost: 30, currency: "CHF" }]);
    const rows = await getProjectMaterialCost(5);
    expect(rows[0].currency).toBe("CHF");
  });

  it("getConsumables sorts items without a reorder level last", async () => {
    const { getConsumables } = await import("../db/queries/consumables");
    let seen = "";
    setSelectHandler((sql) => { seen = sql; return []; });
    await getConsumables();
    expect(seen).toContain(
      "ORDER BY (reorder_level = 0) ASC, stock / NULLIF(reorder_level, 0) ASC, name ASC"
    );
  });

  it("logConsumableUsage and restockConsumable reject amounts not above zero", async () => {
    await expect(logConsumableUsage(4, 0, null, "2026-10-28")).rejects.toThrow();
    await expect(logConsumableUsage(4, -1, null, "2026-10-28")).rejects.toThrow();
    await expect(restockConsumable(4, 0)).rejects.toThrow();
    await expect(restockConsumable(4, -3)).rejects.toThrow();
    expect(executedStatements).toHaveLength(0);
  });

  it("isLow is stock below reorder level", () => {
    expect(isLow({ stock: 1, reorder_level: 2 })).toBe(true);
    expect(isLow({ stock: 2, reorder_level: 2 })).toBe(false);
  });
});
