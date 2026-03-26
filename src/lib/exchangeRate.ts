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

/**
 * Fetch exchange rate from CHF to target currency (or reverse).
 * Uses frankfurter.app free API. Returns rate relative to CHF.
 * e.g. getExchangeRate("EUR") returns how many EUR per 1 CHF.
 */
export async function getExchangeRate(currency: Currency): Promise<number> {
  if (currency === "CHF") return 1;

  // Check cache
  if (cache && cache.base === "CHF" && Date.now() - cache.fetchedAt < CACHE_TTL) {
    const rate = cache.rates[currency];
    if (rate) return rate;
  }

  try {
    const resp = await fetch(
      `https://api.frankfurter.app/latest?from=CHF&to=${SUPPORTED_CURRENCIES.filter((c) => c !== "CHF").join(",")}`
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    cache = {
      base: "CHF",
      rates: data.rates,
      fetchedAt: Date.now(),
    };
    return cache.rates[currency] ?? 1;
  } catch {
    // Fallback: return 1 (user can manually override)
    return 1;
  }
}

/**
 * Convert foreign currency amount to CHF equivalent.
 * exchangeRate = how many foreign units per 1 CHF.
 * So CHF = foreignAmount / exchangeRate.
 */
export function toCHF(foreignAmount: number, exchangeRate: number): number {
  if (exchangeRate <= 0) return foreignAmount;
  return Math.round((foreignAmount / exchangeRate) * 100) / 100;
}
