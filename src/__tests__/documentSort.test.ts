import { describe, it, expect } from "vitest";
import { sortDocuments } from "../lib/documentSort";

// Drafts get a random DRAFT-<uuid> reference, so sorting by reference used to
// put same-day drafts in random order (UI test D5).
const rows = [
  { id: 3, reference: "DRAFT-f0c1" },
  { id: 1, reference: "2026-001" },
  { id: 5, reference: "DRAFT-0a9e" },
  { id: 4, reference: "DRAFT-9b2d" },
  { id: 2, reference: "2026-002" },
];

describe("sortDocuments", () => {
  it("sorts drafts by creation when sorting by reference, newest first", () => {
    expect(sortDocuments(rows, "reference", "desc").map((r) => r.id)).toEqual([5, 4, 3, 2, 1]);
  });

  it("oldest first in ascending order", () => {
    expect(sortDocuments(rows, "reference", "asc").map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("leaves other keys to the plain sort", () => {
    const withTotal = rows.map((r) => ({ ...r, total: r.id * 10 }));
    expect(sortDocuments(withTotal, "total", "asc").map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
  });
});
