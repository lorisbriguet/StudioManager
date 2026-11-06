import { describe, it, expect } from "vitest";
import { asCurrency, expenseMoney } from "../lib/expenseCurrency";

describe("expenseMoney: what an expense stores", () => {
  it("keeps a CHF amount as is, with no original", () => {
    expect(expenseMoney(42.5, "CHF", 1)).toEqual({ amount: 42.5, currency: "CHF", exchange_rate: 1, original_amount: null });
    // A stray rate on a CHF expense is ignored.
    expect(expenseMoney(42.5, "CHF", 0.9).exchange_rate).toBe(1);
  });

  it("books a foreign amount in CHF and keeps what the receipt said", () => {
    // 1 CHF = 1.25 USD: USD 15 is CHF 12.
    expect(expenseMoney(15, "USD", 1.25)).toEqual({ amount: 12, currency: "USD", exchange_rate: 1.25, original_amount: 15 });
    expect(expenseMoney(100, "EUR", 1.06).amount).toBe(94.34);
  });
});

describe("asCurrency", () => {
  it("normalises supported codes and rejects the rest", () => {
    expect(asCurrency(" usd ")).toBe("USD");
    expect(asCurrency("CHF")).toBe("CHF");
    expect(asCurrency("BTC")).toBeNull();
    expect(asCurrency(null)).toBeNull();
  });
});
