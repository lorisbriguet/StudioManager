import { currencies, toCHF, type Currency } from "./exchangeRate";

/** A currency code the app can convert ("usd" → "USD"); null otherwise. */
export function asCurrency(code: string | null | undefined): Currency | null {
  const c = (code ?? "").trim().toUpperCase();
  return (currencies as readonly string[]).includes(c) ? (c as Currency) : null;
}

/** The money columns of an expense: `amount` is always CHF. */
export interface ExpenseMoney {
  amount: number;
  currency: Currency;
  exchange_rate: number;
  original_amount: number | null;
}

/**
 * What an expense entered as `entered` in `currency` stores.
 * `rate` is units of `currency` per 1 CHF, as on invoices.
 */
export function expenseMoney(entered: number, currency: Currency, rate: number): ExpenseMoney {
  if (currency === "CHF") return { amount: entered, currency, exchange_rate: 1, original_amount: null };
  return { amount: toCHF(entered, rate), currency, exchange_rate: rate, original_amount: entered };
}
