import { currencies, getExchangeRate, toCHF, type Currency } from "../exchangeRate";
import { formatMoney } from "./money";

/** Expenses have no currency column: every amount there is CHF. */
export const EXPENSE_CURRENCY = "CHF";

export interface Conversion {
  /** The source amount, "USD 15.00". */
  original: string;
  currency: Currency;
  /** Units of `currency` per 1 CHF (frankfurter, see `getExchangeRate`). */
  rate: number;
}

export type BaseAmount =
  | { ok: true; amount: number; converted: Conversion | null }
  | { ok: false; reason: "no_rate" | "unsupported"; currency: string };

/**
 * An upkeep amount (renewal, machine price) as it may go into an expense:
 * CHF (or no currency) as is, another currency converted through the app's
 * exchange rate. Without a rate it refuses: the raw number must never be
 * booked as CHF. `rate` is injectable for tests.
 */
export async function toBaseAmount(
  amount: number,
  currency: string | null | undefined,
  rate: (c: Currency) => Promise<number | null> = getExchangeRate
): Promise<BaseAmount> {
  const code = (currency ?? "").trim().toUpperCase() || EXPENSE_CURRENCY;
  if (code === EXPENSE_CURRENCY) return { ok: true, amount, converted: null };
  if (!(currencies as readonly string[]).includes(code)) return { ok: false, reason: "unsupported", currency: code };
  const c = code as Currency;
  const r = await rate(c);
  if (r == null || !(r > 0)) return { ok: false, reason: "no_rate", currency: code };
  return { ok: true, amount: toCHF(amount, r), converted: { original: formatMoney(amount, c), currency: c, rate: r } };
}

type Labels = {
  upkeep_expense_converted: string;
  upkeep_expense_converted_note: string;
  upkeep_expense_no_rate: string;
  upkeep_expense_unsupported_currency: string;
};

function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}

/** Shown when the converted expense form opens. */
export function conversionToast(c: Conversion, amount: number, t: Labels): string {
  return fill(t.upkeep_expense_converted, {
    original: c.original, amount: amount.toFixed(2), rate: c.rate.toFixed(4), currency: c.currency,
  });
}

/** Kept in the expense's notes: the source amount and the rate used. */
export function conversionNote(c: Conversion, dateISO: string, t: Labels): string {
  return fill(t.upkeep_expense_converted_note, {
    original: c.original, rate: c.rate.toFixed(4), currency: c.currency, date: dateISO,
  });
}

/** Why no expense was prefilled. */
export function refusalText(r: Extract<BaseAmount, { ok: false }>, t: Labels): string {
  return fill(r.reason === "no_rate" ? t.upkeep_expense_no_rate : t.upkeep_expense_unsupported_currency, {
    currency: r.currency,
  });
}
