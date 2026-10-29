import { describe, it, expect, vi } from "vitest";
import { conversionNote, conversionHint, refusalText, toBaseAmount } from "../lib/upkeep/expenseAmount";
import { uiLabels } from "../i18n/ui";

const t = uiLabels.EN;

describe("toBaseAmount: an upkeep amount as a CHF expense", () => {
  it("a CHF amount (or one without currency) passes through without a rate", async () => {
    const rate = vi.fn();
    expect(await toBaseAmount(840, "CHF", rate)).toEqual({ ok: true, amount: 840, converted: null });
    expect(await toBaseAmount(840, null, rate)).toEqual({ ok: true, amount: 840, converted: null });
    expect(await toBaseAmount(840, " chf ", rate)).toEqual({ ok: true, amount: 840, converted: null });
    expect(rate).not.toHaveBeenCalled();
  });

  it("a non-CHF subscription is converted through the CHF rate", async () => {
    // 1 CHF = 1.25 USD: USD 15.00 is CHF 12.00.
    const rate = vi.fn(async () => 1.25);
    const r = await toBaseAmount(15, "usd", rate);
    expect(rate).toHaveBeenCalledWith("USD");
    expect(r).toEqual({ ok: true, amount: 12, converted: { original: "USD 15.00", currency: "USD", rate: 1.25 } });
  });

  it("refuses when the rate can't be fetched, instead of booking the raw number", async () => {
    expect(await toBaseAmount(15, "USD", async () => null)).toEqual({ ok: false, reason: "no_rate", currency: "USD" });
  });

  it("refuses a currency the rate service doesn't offer", async () => {
    const rate = vi.fn();
    expect(await toBaseAmount(15, "BTC", rate)).toEqual({ ok: false, reason: "unsupported", currency: "BTC" });
    expect(rate).not.toHaveBeenCalled();
  });

  it("says what was converted, under the amount and in the expense notes", () => {
    const c = { original: "USD 15.00", currency: "USD" as const, rate: 1.25 };
    expect(conversionHint(c, 12, t)).toBe("USD 15.00 prefilled as CHF 12.00 (1 CHF = 1.2500 USD).");
    expect(conversionNote(c, "2026-10-29", t)).toBe("Converted from USD 15.00 at 1 CHF = 1.2500 USD (2026-10-29).");
    expect(conversionNote(c, "2026-10-29", uiLabels.FR)).toContain("USD 15.00");
  });

  it("says why nothing was prefilled", () => {
    expect(refusalText({ ok: false, reason: "no_rate", currency: "USD" }, t)).toContain("USD");
    expect(refusalText({ ok: false, reason: "unsupported", currency: "BTC" }, t)).toBe(
      t.upkeep_expense_unsupported_currency.replace("{currency}", "BTC")
    );
  });
});
