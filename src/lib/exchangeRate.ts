import { round2 } from "./lineItems";

const SUPPORTED_CURRENCIES = ["CHF", "EUR", "USD", "GBP", "CAD", "AUD", "JPY", "DKK", "SEK", "NOK"] as const;
export type Currency = typeof SUPPORTED_CURRENCIES[number];
export const currencies: readonly Currency[] = SUPPORTED_CURRENCIES;

interface RateCache {
  rates: Record<string, number>;
  fetchedAt: number;
}

// One entry per Frankfurter path: "latest" or a past "YYYY-MM-DD".
const cache = new Map<string, RateCache>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour, for "latest": a past day's rate never changes

function isValidRate(rate: unknown): rate is number {
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0;
}

/** Today as YYYY-MM-DD in local time, like the date fields. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "latest" for no date, a malformed one, today or a later day; the day itself otherwise. */
function ratePath(date: string | null | undefined): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= localToday()) return "latest";
  return date;
}

/**
 * Fetch exchange rate from CHF to target currency (or reverse).
 * Uses frankfurter.app free API. Returns rate relative to CHF.
 * e.g. getExchangeRate("EUR") returns how many EUR per 1 CHF.
 *
 * With a `date` (YYYY-MM-DD: the invoice or expense date) it returns that
 * day's rate; Frankfurter answers a weekend or holiday with the last working
 * day before it. No date, today or a later day gives the latest rate.
 *
 * Returns null when no trustworthy rate is available (offline, API error,
 * malformed response) — never a silent fallback the caller could mistake
 * for a real rate. Callers must handle null loudly.
 */
export async function getExchangeRate(currency: Currency, date?: string | null): Promise<number | null> {
  if (currency === "CHF") return 1;

  const path = ratePath(date);
  const hit = cache.get(path);
  if (hit && (path !== "latest" || Date.now() - hit.fetchedAt < CACHE_TTL)) {
    const rate = hit.rates[currency];
    if (isValidRate(rate)) return rate;
  }

  try {
    const resp = await fetch(
      `https://api.frankfurter.app/${path}?from=CHF&to=${SUPPORTED_CURRENCIES.filter((c) => c !== "CHF").join(",")}`
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const rates: unknown = data?.rates;
    if (!rates || typeof rates !== "object") return null;
    const rate = (rates as Record<string, unknown>)[currency];
    if (!isValidRate(rate)) return null;
    // Only cache once the requested rate proved valid — a failed or
    // malformed fetch must never poison the cache.
    cache.set(path, { rates: rates as Record<string, number>, fetchedAt: Date.now() });
    return rate;
  } catch {
    // Offline or API error: no rate. The caller decides how to surface it.
    return null;
  }
}

/**
 * Convert foreign currency amount to CHF equivalent.
 * exchangeRate = how many foreign units per 1 CHF.
 * So CHF = foreignAmount / exchangeRate.
 */
export function toCHF(foreignAmount: number, exchangeRate: number): number {
  // Legacy display-path guard: unreachable via getExchangeRate results
  // (validated > 0 or null), kept for direct callers passing a stored rate.
  if (exchangeRate <= 0) return foreignAmount;
  return round2(foreignAmount / exchangeRate);
}
