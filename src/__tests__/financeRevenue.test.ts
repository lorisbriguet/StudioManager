import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  getPLData,
  getMonthlyData,
  getRevenueByActivity,
  getRevenueByClient,
  getDashboardKPIs,
} from "../db/queries/finance";
import { getDb } from "../db";
import { setSelectHandler } from "../__mocks__/tauri-sql";

// P&L draft fix: unsent drafts (including recurring-template output) must not
// count as revenue anywhere — P&L, monthly chart, revenue breakdowns, KPIs.

const COUNTED = "status IN ('sent', 'paid', 'overdue')";

/** Route select() through a capture so tests can assert the SQL sent. */
function captureSelects(): string[] {
  const seen: string[] = [];
  setSelectHandler((sql) => {
    seen.push(sql.replace(/\s+/g, " "));
    return [];
  });
  return seen;
}

/** The capture's invoice queries — expense/income/category queries are exempt. */
const invoiceQueries = (seen: string[]) => seen.filter((sql) => sql.includes("FROM invoices"));

describe("finance revenue excludes draft invoices", () => {
  beforeAll(async () => {
    // Warm the DB singleton so ensureSchema noise doesn't pollute the capture
    await getDb();
  });

  beforeEach(() => {
    setSelectHandler(null);
  });

  it("getPLData counts only sent/paid/overdue invoices as revenue", async () => {
    const seen = captureSelects();
    await getPLData(2026);
    const inv = invoiceQueries(seen);
    expect(inv).toHaveLength(1);
    expect(inv[0]).toContain(COUNTED);
    expect(inv[0]).not.toContain("!= 'cancelled'");
  });

  it("getMonthlyData revenue series excludes drafts", async () => {
    const seen = captureSelects();
    await getMonthlyData(2026);
    const inv = invoiceQueries(seen);
    expect(inv).toHaveLength(1);
    expect(inv[0]).toContain(COUNTED);
  });

  it("revenue breakdowns by activity and client exclude drafts", async () => {
    const seen = captureSelects();
    await getRevenueByActivity(2026);
    await getRevenueByClient(2026);
    const inv = invoiceQueries(seen);
    expect(inv).toHaveLength(2);
    expect(inv[0]).toContain(COUNTED);
    expect(inv[1]).toContain(`i.${COUNTED}`);
  });

  it("dashboard KPIs (invoiced total and open balance) exclude drafts", async () => {
    const seen = captureSelects();
    await getDashboardKPIs(2026);
    const inv = invoiceQueries(seen);
    // invoiced, open balance, overdue count
    expect(inv.length).toBeGreaterThanOrEqual(2);
    const invoiced = inv.find((sql) => sql.includes("COUNT(*) as count"));
    const open = inv.find((sql) => sql.includes("!= 'paid'"));
    expect(invoiced).toBeDefined();
    expect(invoiced).toContain(COUNTED);
    expect(open).toBeDefined();
    expect(open).toContain(COUNTED);
  });
});
