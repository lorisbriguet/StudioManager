/** "CHF 840.00"; the bare number when there is no currency. */
export function formatMoney(amount: number, currency: string | null | undefined): string {
  const n = amount.toFixed(2);
  return currency ? `${currency} ${n}` : n;
}
