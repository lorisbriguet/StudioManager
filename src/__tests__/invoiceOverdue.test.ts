import { describe, it, expect, beforeEach, vi } from "vitest";

// A real SQLite so the status update and the date brackets run as shipped.
vi.mock("@tauri-apps/plugin-sql", async () => ({ default: (await import("./fixtures/realSqlite")).RealDatabase }));
vi.mock("@tauri-apps/api/core", async (orig) => ({
  ...(await orig<object>()),
  invoke: (await import("./fixtures/realSqlite")).realInvoke,
}));
vi.mock("../db/seeds/user-guide", () => ({ seedUserGuide: async () => {} }));
// A fixed local "today", so the brackets don't depend on when the suite runs.
vi.mock("../utils/localDate", async (orig) => ({
  ...(await orig<object>()),
  todayLocalISO: () => "2026-06-30",
}));

import { freshRealDb, rawDb } from "./fixtures/realSqlite";
import { getInvoiceAging, markOverdueInvoices } from "../db/queries/invoices";

let n = 0;
function add(status: string, due: string | null, total = 100, currency = "CHF", chf = total) {
  n += 1;
  rawDb()
    .prepare(
      `INSERT INTO invoices (reference, client_id, status, invoice_date, due_date, total, subtotal, currency, chf_equivalent)
       VALUES (?, 'C-1', ?, '2026-01-01', ?, ?, ?, ?, ?)`
    )
    .run(`T-${n}`, status, due, total, total, currency, chf);
  return `T-${n}`;
}

const status = (ref: string) =>
  (rawDb().prepare("SELECT status FROM invoices WHERE reference = ?").get(ref) as { status: string }).status;

beforeEach(async () => {
  await freshRealDb();
  n = 0;
  rawDb().prepare("INSERT INTO clients (id, name) VALUES ('C-1', 'Client')").run();
});

describe("markOverdueInvoices", () => {
  it("marks sent invoices past their due date as overdue and returns them", async () => {
    const late = add("sent", "2026-06-29");
    const dueToday = add("sent", "2026-06-30");
    const noDue = add("sent", null);
    const paid = add("paid", "2026-01-31");
    const draft = add("draft", "2026-01-31");

    const marked = await markOverdueInvoices();

    expect(marked.map((i) => i.reference)).toEqual([late]);
    expect(status(late)).toBe("overdue");
    expect(status(dueToday)).toBe("sent");
    expect(status(noDue)).toBe("sent");
    expect(status(paid)).toBe("paid");
    expect(status(draft)).toBe("draft");
  });

  it("returns nothing and changes nothing when no invoice is late", async () => {
    const ref = add("sent", "2026-07-01");
    expect(await markOverdueInvoices()).toEqual([]);
    expect(status(ref)).toBe("sent");
  });
});

describe("getInvoiceAging", () => {
  const bracketsOf = async () =>
    Object.fromEntries((await getInvoiceAging()).map((r) => [r.bracket, { count: r.count, total: r.total }]));

  it("puts each late invoice in its bracket by days past due", async () => {
    add("sent", "2026-06-29", 1); // 1 day
    add("overdue", "2026-05-31", 2); // 30 days
    add("overdue", "2026-05-30", 4); // 31 days
    add("overdue", "2026-05-01", 8); // 60 days
    add("overdue", "2026-04-30", 16); // 61 days
    add("overdue", "2026-04-01", 32); // 90 days
    add("overdue", "2026-03-31", 64); // 91 days

    expect(await bracketsOf()).toEqual({
      "0-30": { count: 2, total: 3 },
      "31-60": { count: 2, total: 12 },
      "61-90": { count: 2, total: 48 },
      "90+": { count: 1, total: 64 },
    });
  });

  it("leaves out paid, draft and not-yet-due invoices", async () => {
    add("paid", "2026-01-31");
    add("draft", "2026-01-31");
    add("sent", "2026-06-30");
    expect(await getInvoiceAging()).toEqual([]);
  });

  it("counts a foreign-currency invoice at its CHF equivalent", async () => {
    add("overdue", "2026-06-20", 100, "EUR", 93.5);
    add("overdue", "2026-06-20", 50, "EUR", 0); // no CHF equivalent stored: falls back to the total
    add("overdue", "2026-06-20", 10, "CHF", 10);
    expect(await bracketsOf()).toEqual({ "0-30": { count: 3, total: 153.5 } });
  });
});
