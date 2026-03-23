import { describe, it, expect } from "vitest";
import { sortRows } from "../components/SortHeader";

describe("sortRows", () => {
  const rows = [
    { name: "Charlie", total: 300 },
    { name: "Alice", total: 100 },
    { name: "Bob", total: 200 },
  ];

  it("sorts strings ascending", () => {
    const sorted = sortRows(rows, "name", "asc");
    expect(sorted.map((r) => r.name)).toEqual(["Alice", "Bob", "Charlie"]);
  });

  it("sorts strings descending", () => {
    const sorted = sortRows(rows, "name", "desc");
    expect(sorted.map((r) => r.name)).toEqual(["Charlie", "Bob", "Alice"]);
  });

  it("sorts numbers ascending", () => {
    const sorted = sortRows(rows, "total", "asc");
    expect(sorted.map((r) => r.total)).toEqual([100, 200, 300]);
  });

  it("sorts numbers descending", () => {
    const sorted = sortRows(rows, "total", "desc");
    expect(sorted.map((r) => r.total)).toEqual([300, 200, 100]);
  });

  it("handles null values (pushed to end)", () => {
    const withNull = [
      { name: "Alice", total: 100 },
      { name: null, total: null },
      { name: "Bob", total: 200 },
    ];
    const sorted = sortRows(withNull, "name", "asc");
    expect(sorted[2].name).toBeNull();
  });

  it("does not mutate the original array", () => {
    const original = [...rows];
    sortRows(rows, "name", "asc");
    expect(rows).toEqual(original);
  });
});
