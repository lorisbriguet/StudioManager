/**
 * True when a foreign-currency amount has no usable CHF equivalent.
 * Finance aggregates fall back to the raw total in that case, silently
 * mixing currencies in the P&L — callers should warn the user (not block:
 * the exchange rate may be legitimately unavailable offline).
 */
export function missingChfEquivalent(currency: string, chfEquivalent: number): boolean {
  return currency !== "CHF" && !(chfEquivalent > 0);
}
