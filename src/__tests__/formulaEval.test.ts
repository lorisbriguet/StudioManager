import { describe, it, expect } from "vitest";
import { evaluateFormula } from "../lib/formulaEval";

describe("evaluateFormula", () => {
  it("evaluates basic arithmetic", () => {
    expect(evaluateFormula("2 + 3", {})).toBe(5);
    expect(evaluateFormula("10 - 4", {})).toBe(6);
    expect(evaluateFormula("3 * 4", {})).toBe(12);
    expect(evaluateFormula("10 / 4", {})).toBe(2.5);
  });

  it("handles operator precedence", () => {
    expect(evaluateFormula("2 + 3 * 4", {})).toBe(14);
    expect(evaluateFormula("(2 + 3) * 4", {})).toBe(20);
  });

  it("resolves cell references", () => {
    expect(evaluateFormula("hours * rate", { hours: 10, rate: 150 })).toBe(1500);
    expect(evaluateFormula("qty + 1", { qty: 5 })).toBe(6);
  });

  it("treats missing cells as 0", () => {
    expect(evaluateFormula("missing + 1", {})).toBe(1);
  });

  it("handles comparisons", () => {
    expect(evaluateFormula("hours > 5 ? hours : 5", { hours: 10 })).toBe(10);
    expect(evaluateFormula("hours > 5 ? hours : 5", { hours: 3 })).toBe(5);
  });

  it("handles ternary expressions", () => {
    expect(evaluateFormula("active ? rate * hours : 0", { active: true, rate: 100, hours: 8 })).toBe(800);
    expect(evaluateFormula("active ? rate * hours : 0", { active: false, rate: 100, hours: 8 })).toBe(0);
  });

  it("handles division by zero gracefully", () => {
    expect(evaluateFormula("10 / 0", {})).toBe(0);
  });

  it("handles malformed formulas gracefully", () => {
    // Parser is lenient — unmatched parens return 0 rather than erroring
    const result = evaluateFormula("((", {});
    expect(typeof result === "number" || result === "#ERR").toBe(true);
  });

  it("rounds to 2 decimal places", () => {
    expect(evaluateFormula("10 / 3", {})).toBe(3.33);
    expect(evaluateFormula("1 / 7", {})).toBe(0.14);
  });

  it("handles unary minus", () => {
    expect(evaluateFormula("-5 + 3", {})).toBe(-2);
  });

  it("handles equality and inequality", () => {
    expect(evaluateFormula("x == 5 ? 1 : 0", { x: 5 })).toBe(1);
    expect(evaluateFormula("x != 5 ? 1 : 0", { x: 3 })).toBe(1);
  });

  it("handles boolean cell values", () => {
    expect(evaluateFormula("done ? 100 : 0", { done: true })).toBe(100);
    expect(evaluateFormula("done ? 100 : 0", { done: false })).toBe(0);
  });
});
