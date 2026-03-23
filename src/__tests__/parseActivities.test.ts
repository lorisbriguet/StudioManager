import { describe, it, expect } from "vitest";
import { parseActivities } from "../types/business-profile";

describe("parseActivities", () => {
  it("parses JSON array", () => {
    expect(parseActivities('["Graphisme","Web design"]')).toEqual(["Graphisme", "Web design"]);
  });

  it("handles legacy plain string", () => {
    expect(parseActivities("Graphisme")).toEqual(["Graphisme"]);
  });

  it("handles null/undefined/empty", () => {
    expect(parseActivities(null)).toEqual([]);
    expect(parseActivities(undefined)).toEqual([]);
    expect(parseActivities("")).toEqual([]);
  });

  it("filters out empty strings from array", () => {
    expect(parseActivities('["Graphisme","","Web"]')).toEqual(["Graphisme", "Web"]);
  });

  it("filters out non-string array elements", () => {
    expect(parseActivities('[1, "Graphisme", null]')).toEqual(["Graphisme"]);
  });

  it("handles whitespace-only string", () => {
    expect(parseActivities("   ")).toEqual([]);
  });
});
