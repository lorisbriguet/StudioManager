import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Fake database that runs the generator's query the way SQLite would:
// LIKE (case-insensitive for ASCII, `%` and `_` wildcards, optional ESCAPE)
// then MAX(CAST(SUBSTR(reference, start) AS INTEGER)).
let references: string[] = [];

function likeToRegExp(pattern: string, escape: string | null): RegExp {
  let src = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (escape !== null && c === escape && i + 1 < pattern.length) {
      src += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (c === "%") src += ".*";
    else if (c === "_") src += ".";
    else src += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${src}$`, "is");
}

const select = vi.fn(async (sql: string, params: unknown[]) => {
  const [start, pattern] = params as [number, string];
  const escape = /ESCAPE '(.)'/.exec(sql)?.[1] ?? null;
  const re = likeToRegExp(pattern, escape);
  const nums = references
    .filter((r) => re.test(r))
    .map((r) => parseInt(r.slice(start - 1), 10) || 0);
  return [{ max_num: nums.length > 0 ? Math.max(...nums) : null }];
});

vi.mock("../db", () => ({ getDb: async () => ({ select }) }));

import { getNextReference, referenceYear } from "../db/queries/referenceGenerator";
import { nextExpenseReferenceFor } from "../db/queries/expenses";
import { nextIncomeReferenceFor } from "../db/queries/income";

beforeEach(() => {
  references = [];
  select.mockClear();
});

describe("getNextReference", () => {
  it("starts a new prefix at 001", async () => {
    expect(await getNextReference("invoices", "reference", "2026-")).toBe("2026-001");
  });

  it("goes from 999 to 1000 without cutting digits", async () => {
    references = ["2026-998", "2026-999"];
    expect(await getNextReference("invoices", "reference", "2026-")).toBe("2026-1000");
  });

  it("keeps counting past 1000 (numeric, not text, maximum)", async () => {
    references = ["2026-999", "2026-1000"];
    expect(await getNextReference("invoices", "reference", "2026-")).toBe("2026-1001");
  });

  it("restarts at 001 when the year changes", async () => {
    references = ["2026-041", "2026-042"];
    expect(await getNextReference("invoices", "reference", "2027-")).toBe("2027-001");
  });

  it("ignores other prefixes that share the year", async () => {
    references = ["D-2026-007", "2026-002"];
    expect(await getNextReference("invoices", "reference", "2026-")).toBe("2026-003");
    expect(await getNextReference("quotes", "reference", "D-2026-")).toBe("D-2026-008");
  });

  it("treats _ in the prefix as a literal underscore", async () => {
    // Unescaped, `A_` would also match `AB…` and pick up 050.
    references = ["A_001", "AB050"];
    expect(await getNextReference("invoices", "reference", "A_")).toBe("A_002");
  });

  it("treats % in the prefix as a literal percent sign", async () => {
    references = ["5%001", "5X900"];
    expect(await getNextReference("invoices", "reference", "5%")).toBe("5%002");
  });

  it("rejects unsafe table or column names", async () => {
    await expect(getNextReference("invoices; DROP", "reference", "2026-")).rejects.toThrow();
    expect(select).not.toHaveBeenCalled();
  });
});

describe("expense and income numbers take the year of their own date", () => {
  // Entered on 5 January 2027.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2027, 0, 5, 10));
  });
  afterEach(() => vi.useRealTimers());

  it("numbers a December receipt entered in January in the old year", async () => {
    references = ["F-26-011", "F-27-002"];
    expect(await nextExpenseReferenceFor("2026-12-28")).toBe("F-26-012");
  });

  it("numbers a January receipt in the new year", async () => {
    references = ["F-26-011", "F-27-002"];
    expect(await nextExpenseReferenceFor("2027-01-03")).toBe("F-27-003");
  });

  it("falls back to this year when the receipt has no date", async () => {
    references = ["F-26-011"];
    expect(await nextExpenseReferenceFor("")).toBe("F-27-001");
    expect(await nextExpenseReferenceFor(null)).toBe("F-27-001");
  });

  it("numbers income the same way", async () => {
    references = ["R-26-004"];
    expect(await nextIncomeReferenceFor("2026-12-31")).toBe("R-26-005");
    expect(await nextIncomeReferenceFor("2027-01-02")).toBe("R-27-001");
  });

  it("reads the year only from a YYYY-MM-DD date", () => {
    expect(referenceYear("2025-06-30")).toBe(2025);
    expect(referenceYear("30.06.2025")).toBe(2027);
    expect(referenceYear(undefined)).toBe(2027);
  });
});
