/** Invoices and quotes are both "documents": same shape of rows, line items and queries. */
export type DocumentKind = "invoice" | "quote";

/** The fields every invoice or quote line item has, apart from its ids. */
export interface LineItemFields {
  designation: string;
  rate: number | null;
  unit: string | null;
  quantity: number;
  amount: number;
  sort_order: number;
}
