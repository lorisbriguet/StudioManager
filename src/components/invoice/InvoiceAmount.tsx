import { formatMoney } from "../../lib/money";

interface Props {
  invoice: { total: number; currency?: string | null; chf_equivalent?: number | null; status: string };
  className?: string;
}

/**
 * An invoice's amount in its own currency. A foreign one also shows its CHF
 * equivalent; a cancelled one is struck through. Used by the invoice list,
 * the dashboard, the client page and the project page.
 */
export function InvoiceAmount({ invoice, className = "" }: Props) {
  const currency = invoice.currency || "CHF";
  if (invoice.status === "cancelled") {
    return <span className={`text-muted line-through ${className}`}>{formatMoney(invoice.total, currency)}</span>;
  }
  if (currency !== "CHF") {
    return (
      <span className={className}>
        <span className="text-muted text-xs">{formatMoney(invoice.total, currency)}</span>
        {" "}
        {/* A missing equivalent shows as CHF 0.00, not the foreign total. */}
        <span>{formatMoney(invoice.chf_equivalent ?? invoice.total, "CHF")}</span>
      </span>
    );
  }
  return <span className={className}>{formatMoney(invoice.total, "CHF")}</span>;
}
