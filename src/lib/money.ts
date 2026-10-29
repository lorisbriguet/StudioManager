/**
 * "CHF 1’234.50", "EUR 120.00"; "1’234.50" when there is no currency.
 *
 * The app's money format in both languages, the same as the invoice and quote
 * PDFs and the dashboard: Swiss grouping (de-CH), the ISO code before the
 * amount. French Swiss business documents write it that way too, so FR does not
 * switch to fr-CH's "1 234.50 CHF".
 */
export function formatMoney(amount: number, currency: string | null | undefined): string {
  const code = currency?.trim().toUpperCase();
  if (code) {
    try {
      const text = new Intl.NumberFormat("de-CH", { style: "currency", currency: code, currencyDisplay: "code" }).format(Math.abs(amount));
      // de-CH glues the sign to the code ("CHF-5.00"): put it on the number.
      return amount < 0 ? text.replace(/\d/, (d) => `-${d}`) : text;
    } catch {
      // Not an ISO 4217 code (a typed-in "Fr." or "$"): keep it as written.
      return `${currency} ${NUMBER.format(amount)}`;
    }
  }
  return NUMBER.format(amount);
}

const NUMBER = new Intl.NumberFormat("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
