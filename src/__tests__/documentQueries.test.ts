import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import * as inv from "../db/queries/invoices";
import * as quo from "../db/queries/quotes";
import { getDb } from "../db";
import {
  executedStatements,
  clearExecutedStatements,
  setSelectHandler,
} from "../__mocks__/tauri-sql";

// Invoices and quotes share their query module. These tests pin the exact
// SQL and parameters each kind sends, so the shared code can't drift.

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

const selects: { sql: string; params: unknown[] }[] = [];
const executed = () =>
  executedStatements.map((s) => ({ sql: norm(s.sql), params: s.params }));

beforeAll(async () => {
  await getDb();
});

beforeEach(() => {
  selects.length = 0;
  clearExecutedStatements();
  setSelectHandler((sql, params) => {
    selects.push({ sql: norm(sql), params });
    return [{ id: 7 }];
  });
});

afterEach(() => setSelectHandler(null));

const item = { designation: "Logo", rate: 100, unit: "h", quantity: 2, amount: 200, sort_order: 0 };

const kinds = [
  {
    name: "invoices",
    table: "invoices",
    lineTable: "invoice_line_items",
    fk: "invoice_id",
    date: "invoice_date",
    q: {
      list: inv.getInvoices,
      get: inv.getInvoice,
      byProject: inv.getInvoicesByProject,
      update: inv.updateInvoice,
      updateWithLineItems: inv.updateInvoiceWithLineItems,
      lineItems: inv.getInvoiceLineItems,
    },
  },
  {
    name: "quotes",
    table: "quotes",
    lineTable: "quote_line_items",
    fk: "quote_id",
    date: "quote_date",
    q: {
      list: quo.getQuotes,
      get: quo.getQuote,
      byProject: quo.getQuotesByProject,
      update: quo.updateQuote,
      updateWithLineItems: quo.updateQuoteWithLineItems,
      lineItems: quo.getQuoteLineItems,
    },
  },
] as const;

describe.each(kinds)("$name queries", ({ table, lineTable, fk, date, q }) => {
  it("lists newest first", async () => {
    await q.list();
    expect(selects).toEqual([{ sql: `SELECT * FROM ${table} ORDER BY ${date} DESC`, params: [] }]);
  });

  it("gets one by id, or null", async () => {
    expect(await q.get(7)).toEqual({ id: 7 });
    expect(selects).toEqual([{ sql: `SELECT * FROM ${table} WHERE id = $1`, params: [7] }]);
    setSelectHandler(() => []);
    expect(await q.get(8)).toBeNull();
  });

  it("lists by project, newest first", async () => {
    await q.byProject(3);
    expect(selects).toEqual([
      { sql: `SELECT * FROM ${table} WHERE project_id = $1 ORDER BY ${date} DESC`, params: [3] },
    ]);
  });

  it("gets line items in order", async () => {
    await q.lineItems(7);
    expect(selects).toEqual([
      { sql: `SELECT * FROM ${lineTable} WHERE ${fk} = $1 ORDER BY sort_order`, params: [7] },
    ]);
  });

  it("updates fields only", async () => {
    await q.update(7, { notes: "n", total: 5 });
    expect(executed()).toEqual([
      {
        sql: `UPDATE ${table} SET notes = $2, total = $3, updated_at = datetime('now') WHERE id = $1`,
        params: [7, "n", 5],
      },
    ]);
  });

  it("rejects unknown field names", async () => {
    await expect(q.update(7, { "x; DROP TABLE y": 1 } as never)).rejects.toThrow();
    expect(executed()).toEqual([]);
  });

  it("updates fields and replaces line items in one batch", async () => {
    await q.updateWithLineItems(7, { notes: "n" }, [item]);
    expect(executed()).toEqual([
      {
        sql: `UPDATE ${table} SET notes = $2, updated_at = datetime('now') WHERE id = $1`,
        params: [7, "n"],
      },
      { sql: `DELETE FROM ${lineTable} WHERE ${fk} = $1`, params: [7] },
      {
        sql: `INSERT INTO ${lineTable} (${fk}, designation, rate, unit, quantity, amount, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        params: [7, "Logo", 100, "h", 2, 200, 0],
      },
    ]);
  });

  it("leaves line items alone when none are passed", async () => {
    await q.updateWithLineItems(7, { notes: "n" });
    expect(executed()).toHaveLength(1);
  });
});

describe("create with line items", () => {
  it("inserts the invoice, then its line items against the new id", async () => {
    await inv.createInvoiceWithLineItems(
      { reference: "DRAFT-1", total: 200 } as never,
      [item]
    );
    const [doc, line] = executed();
    expect(doc.sql).toMatch(/^INSERT INTO invoices \(reference, client_id/);
    expect(doc.params).toHaveLength(27);
    expect(line).toEqual({
      sql: "INSERT INTO invoice_line_items (invoice_id, designation, rate, unit, quantity, amount, sort_order) VALUES ($LAST_INSERT_ID, $1, $2, $3, $4, $5, $6)",
      params: ["Logo", 100, "h", 2, 200, 0],
    });
  });

  it("inserts the quote, then its line items against the new id", async () => {
    await quo.createQuoteWithLineItems({ reference: "D-2026-001" } as never, [item]);
    const [doc, line] = executed();
    expect(doc.sql).toMatch(/^INSERT INTO quotes \(reference, client_id/);
    expect(doc.params).toHaveLength(16);
    expect(line).toEqual({
      sql: "INSERT INTO quote_line_items (quote_id, designation, rate, unit, quantity, amount, sort_order) VALUES ($LAST_INSERT_ID, $1, $2, $3, $4, $5, $6)",
      params: ["Logo", 100, "h", 2, 200, 0],
    });
  });
});
