import { round2 } from "./lineItems";

const SUPPORTED_CURRENCIES = ["CHF", "EUR", "USD", "GBP", "CAD", "AUD", "JPY", "DKK", "SEK", "NOK"] as const;
export type Currency = typeof SUPPORTED_CURRENCIES[number];
export const currencies: readonly Currency[] = SUPPORTED_CURRENCIES;

interface RateCache {
  base: string;
  rates: Record<string, number>;
  fetchedAt: number;
}

let cache: RateCache | null = null;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function isValidRate(rate: unknown): rate is number {
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0;
}

/**
 * Fetch exchange rate from CHF to target currency (or reverse).
 * Uses frankfurter.app free API. Returns rate relative to CHF.
 * e.g. getExchangeRate("EUR") returns how many EUR per 1 CHF.
 * Returns null when no trustworthy rate is available (offline, API error,
 * malformed response) — never a silent fallback the caller could mistake
 * for a real rate. Callers must handle null loudly.
 */
export async function getExchangeRate(currency: Currency): Promise<number | null> {
  if (currency === "CHF") return 1;

  // Check cache
  if (cache && cache.base === "CHF" && Date.now() - cache.fetchedAt < CACHE_TTL) {
    const rate = cache.rates[currency];
    if (isValidRate(rate)) return rate;
  }

  try {
    const resp = await fetch(
      `https://api.frankfurter.app/latest?from=CHF&to=${SUPPORTED_CURRENCIES.filter((c) => c !== "CHF").join(",")}`
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const rates: unknown = data?.rates;
    if (!rates || typeof rates !== "object") return null;
    const rate = (rates as Record<string, unknown>)[currency];
    if (!isValidRate(rate)) return null;
    // Only cache once the requested rate proved valid — a failed or
    // malformed fetch must never poison the cache.
    cache = {
      base: "CHF",
      rates: rates as Record<string, number>,
      fetchedAt: Date.now(),
    };
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
