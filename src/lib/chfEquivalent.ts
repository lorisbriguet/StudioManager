/**
 * True when a foreign-currency amount has no usable CHF equivalent.
 * Finance aggregates fall back to the raw total in that case, silently
 * mixing currencies in the P&L — callers should warn the user (not block:
 * the exchange rate may be legitimately unavailable offline).
 */
export function missingChfEquivalent(currency: string, chfEquivalent: number): boolean {
  return currency !== "CHF" && !(chfEquivalent > 0);
}

/**
 * An invoice's amount in CHF, by the rule the P&L uses (src/db/queries/finance.ts):
 * the CHF equivalent for a foreign invoice that has one, else the total.
 */
export function invoiceChfAmount(inv: { currency?: string | null; total: number; chf_equivalent?: number | null }): number {
  const currency = inv.currency || "CHF";
  return currency !== "CHF" && (inv.chf_equivalent ?? 0) > 0 ? (inv.chf_equivalent as number) : inv.total;
}
