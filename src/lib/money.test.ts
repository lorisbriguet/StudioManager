import { describe, it, expect } from "vitest";
import { formatMoney, formatMoneyPdf } from "./money";

const NBSP = " ";

describe("formatMoney", () => {
  it("groups thousands with the typographic apostrophe", () => {
    expect(formatMoney(33021.4, "CHF")).toBe(`CHF${NBSP}33’021.40`);
    expect(formatMoney(1234567.891, "CHF")).toBe(`CHF${NBSP}1’234’567.89`);
  });

  it("always writes two decimals", () => {
    expect(formatMoney(1080, "CHF")).toBe(`CHF${NBSP}1’080.00`);
    expect(formatMoney(0, "CHF")).toBe(`CHF${NBSP}0.00`);
  });

  it("puts the sign on the number", () => {
    expect(formatMoney(-5, "CHF")).toBe(`CHF${NBSP}-5.00`);
    expect(formatMoney(-1234.5, "EUR")).toBe(`EUR${NBSP}-1’234.50`);
  });

  it("never prints a negative zero", () => {
    expect(formatMoney(-0.004, "CHF")).toBe(`CHF${NBSP}0.00`);
    expect(formatMoney(-0, null)).toBe("0.00");
  });

  it("normalises the currency code", () => {
    expect(formatMoney(120, " eur ")).toBe(`EUR${NBSP}120.00`);
  });

  it("keeps a code that isn't ISO 4217 as typed", () => {
    expect(formatMoney(1500, "Fr.")).toBe("Fr. 1’500.00");
  });

  it("writes the number alone without a currency", () => {
    expect(formatMoney(1500, null)).toBe("1’500.00");
    expect(formatMoney(-1500, "")).toBe("-1’500.00");
  });
});

describe("formatMoneyPdf", () => {
  it("uses a plain space after the code and CHF by default", () => {
    expect(formatMoneyPdf(2205)).toBe("CHF 2’205.00");
    expect(formatMoneyPdf(-5, "EUR")).toBe("EUR -5.00");
  });
});
