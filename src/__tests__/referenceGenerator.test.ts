import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { getNextReference } from "../db/queries/referenceGenerator";

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
