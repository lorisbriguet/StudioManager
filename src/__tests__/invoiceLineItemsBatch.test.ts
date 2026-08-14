import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { getLineItemsForInvoices } from "../db/queries/invoices";
import { getDb } from "../db";
import { setSelectHandler } from "../__mocks__/tauri-sql";

// The trustee export fetched line items once per invoice (N+1); it must
// batch-fetch them in a single IN (...) query grouped by invoice.

describe("getLineItemsForInvoices", () => {
  beforeAll(async () => {
    await getDb();
  });

  afterEach(() => setSelectHandler(null));

  it("fetches all invoices' line items in one query, grouped by invoice", async () => {
    const seen: { sql: string; params: unknown[] }[] = [];
    setSelectHandler((sql, params) => {
      seen.push({ sql: sql.replace(/\s+/g, " "), params });
      return [
        { id: 1, invoice_id: 10, designation: "A", rate: 1, unit: "h", quantity: 1, amount: 1, sort_order: 0 },
        { id: 2, invoice_id: 10, designation: "B", rate: 2, unit: "h", quantity: 1, amount: 2, sort_order: 1 },
        { id: 3, invoice_id: 20, designation: "C", rate: 3, unit: "h", quantity: 1, amount: 3, sort_order: 0 },
      ];
    });

    const map = await getLineItemsForInvoices([10, 20]);

    expect(seen).toHaveLength(1);
    expect(seen[0].sql).toContain("IN (");
    expect(seen[0].params).toEqual([10, 20]);
    expect(map.get(10)!.map((li) => li.designation)).toEqual(["A", "B"]);
    expect(map.get(20)!.map((li) => li.designation)).toEqual(["C"]);
  });

  it("returns an empty map for no ids without querying", async () => {
    const seen: string[] = [];
    setSelectHandler((sql) => {
      seen.push(sql);
      return [];
    });
    const map = await getLineItemsForInvoices([]);
    expect(map.size).toBe(0);
    expect(seen).toHaveLength(0);
  });
});
