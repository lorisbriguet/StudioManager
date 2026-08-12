import { describe, it, expect } from "vitest";
import { parseAmount } from "../lib/expenseParse";

describe("parseAmount", () => {
  it("parses Swiss apostrophe thousands", () => {
    expect(parseAmount("1'234.56")).toBe(1234.56);
    expect(parseAmount("12'450.00")).toBe(12450);
    expect(parseAmount("1'000")).toBe(1000);
  });

  it("parses German format (dot thousands, comma decimal)", () => {
    expect(parseAmount("1.234,56")).toBe(1234.56);
    expect(parseAmount("1.309,00")).toBe(1309);
  });

  it("parses French format (space thousands, comma decimal)", () => {
    expect(parseAmount("1 234,56")).toBe(1234.56);
  });

  it("parses English format (comma thousands, dot decimal)", () => {
    expect(parseAmount("1,234.56")).toBe(1234.56);
  });

  it("parses plain decimals and integers", () => {
    expect(parseAmount("234.56")).toBe(234.56);
    expect(parseAmount("12,50")).toBe(12.5);
    expect(parseAmount("1500")).toBe(1500);
  });

  it("treats a trailing 3-digit group as thousands, not decimals", () => {
    expect(parseAmount("1,234")).toBe(1234);
    expect(parseAmount("12.345")).toBe(12345);
  });

  it("returns null for non-numeric input", () => {
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });
});
