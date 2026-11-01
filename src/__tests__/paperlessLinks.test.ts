import { describe, it, expect, beforeEach, vi } from "vitest";

interface Row { connection_id: number; paperless_doc_id: number; expense_id: number | null; state: string }
let rows: Row[] = [];

// Tiny in-memory stand-in for the statements paperlessLinks.ts runs.
const fakeDb = {
  async execute(sql: string, p: unknown[] = []) {
    const [c, d] = p as number[];
    if (sql.startsWith("INSERT INTO paperless_links")) {
      const state = sql.includes("'dismissed'") ? "dismissed" : "linked";
      const expense = p.length === 3 ? (p[2] as number) : null;
      const row = rows.find((r) => r.connection_id === c && r.paperless_doc_id === d);
      if (row) { row.state = state; row.expense_id = expense; }
      else rows.push({ connection_id: c, paperless_doc_id: d, expense_id: expense, state });
    } else if (sql.startsWith("DELETE FROM paperless_links")) {
      expect(sql).toContain("state = 'dismissed'");
      rows = rows.filter((r) => !(r.connection_id === c && r.paperless_doc_id === d && r.state === "dismissed"));
    }
    return { rowsAffected: 1, lastInsertId: 1 };
  },
  async select(_sql: string, p: unknown[] = []) {
    return rows.filter((r) => r.connection_id === p[0]);
  },
};
vi.mock("../db", () => ({ getDb: async () => fakeDb }));

import {
  getPaperlessLinks, linkPaperlessDoc, dismissPaperlessDoc, undismissPaperlessDoc,
} from "../db/queries/paperlessLinks";

beforeEach(() => { rows = []; });

describe("paperless links", () => {
  it("linking twice keeps one row", async () => {
    await linkPaperlessDoc(1, 42, 7);
    await linkPaperlessDoc(1, 42, 8);
    const m = await getPaperlessLinks(1);
    expect(m.size).toBe(1);
    expect(m.get(42)).toEqual({ state: "linked", expense_id: 8 });
  });

  it("dismiss then link ends linked", async () => {
    await dismissPaperlessDoc(1, 42);
    expect((await getPaperlessLinks(1)).get(42)?.state).toBe("dismissed");
    await linkPaperlessDoc(1, 42, 7);
    const m = await getPaperlessLinks(1);
    expect(m.size).toBe(1);
    expect(m.get(42)).toEqual({ state: "linked", expense_id: 7 });
  });

  it("undismiss removes only dismissed rows", async () => {
    await dismissPaperlessDoc(1, 1);
    await linkPaperlessDoc(1, 2, 7);
    await undismissPaperlessDoc(1, 1);
    await undismissPaperlessDoc(1, 2);
    const m = await getPaperlessLinks(1);
    expect([...m.keys()]).toEqual([2]);
  });
});
