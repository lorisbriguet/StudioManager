import { describe, it, expect } from "vitest";
import { resolveActivityRevenue } from "../lib/activityResolve";
import type { Activity } from "../types/activity";

const ACTS: Activity[] = [
  { id: 1, name_fr: "Graphisme", name_en: "Graphic Design", sort_order: 0 },
  { id: 2, name_fr: "Media Interaction Design", name_en: "Media Interaction Design", sort_order: 1 },
];

describe("resolveActivityRevenue", () => {
  it("merges id, FR-name, EN-name and trailing-space variants into one row", () => {
    const rows = [
      { activity_id: 1, activity: "Graphisme", total: 100 },
      { activity_id: null, activity: "Graphisme", total: 36 },
      { activity_id: null, activity: "Graphic Design", total: 4 },
      { activity_id: null, activity: "Graphic Design ", total: 1 },
    ];
    expect(resolveActivityRevenue(rows, ACTS, "EN")).toEqual([
      { label: "Graphic Design", total: 141 },
    ]);
  });

  it("labels rows in the requested language", () => {
    const rows = [{ activity_id: 1, activity: "Graphisme", total: 10 }];
    expect(resolveActivityRevenue(rows, ACTS, "FR")[0].label).toBe("Graphisme");
    expect(resolveActivityRevenue(rows, ACTS, "EN")[0].label).toBe("Graphic Design");
  });

  it("keeps unmatched legacy text as its own row", () => {
    const rows = [{ activity_id: null, activity: "Old Consulting", total: 5 }];
    expect(resolveActivityRevenue(rows, ACTS, "EN")).toEqual([
      { label: "Old Consulting", total: 5 },
    ]);
  });

  it("buckets empty activity as N/A", () => {
    const rows = [{ activity_id: null, activity: "", total: 7 }];
    expect(resolveActivityRevenue(rows, ACTS, "EN")).toEqual([
      { label: "N/A", total: 7 },
    ]);
  });

  it("falls back to text matching for dangling activity ids", () => {
    const rows = [{ activity_id: 99, activity: "Graphic Design", total: 3 }];
    expect(resolveActivityRevenue(rows, ACTS, "EN")).toEqual([
      { label: "Graphic Design", total: 3 },
    ]);
  });

  it("sorts by total descending", () => {
    const rows = [
      { activity_id: 2, activity: "Media Interaction Design", total: 5 },
      { activity_id: 1, activity: "Graphisme", total: 50 },
    ];
    expect(resolveActivityRevenue(rows, ACTS, "EN").map((r) => r.label)).toEqual([
      "Graphic Design",
      "Media Interaction Design",
    ]);
  });
});
