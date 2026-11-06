import { TransactionBatch } from "../index";
import { getNextReference } from "./referenceGenerator";
import { documentQueries } from "./documents";
import type { Quote, QuoteLineItem } from "../../types/quote";

const docs = documentQueries<Quote, QuoteLineItem>("quote");

export const getQuotes = docs.list;
export const getQuote = docs.get;
export const getQuotesByProject = docs.listByProject;
/** Update quote fields only (no line items) */
export const updateQuote = docs.update;
export const updateQuoteWithLineItems = docs.updateWithLineItems;
export const getQuoteLineItems = docs.lineItems;

export async function getNextQuoteReference(year: number): Promise<string> {
  return getNextReference("quotes", "reference", `D-${year}-`);
}

export async function createQuoteWithLineItems(
  data: Omit<Quote, "id" | "created_at" | "updated_at">,
  lineItems: Omit<QuoteLineItem, "id" | "quote_id">[]
): Promise<number> {
  const batch = new TransactionBatch();
  batch.add(
    `INSERT INTO quotes (reference, client_id, project_id, status, language, activity, activity_id, assignment, quote_date, valid_until, subtotal, discount_applied, discount_rate, total, converted_to_invoice_id, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      data.reference, data.client_id, data.project_id, data.status, data.language,
      data.activity, data.activity_id ?? null, data.assignment, data.quote_date, data.valid_until,
      data.subtotal, data.discount_applied, data.discount_rate, data.total,
      data.converted_to_invoice_id, data.notes,
    ]
  );
  docs.addNewLineItems(batch, lineItems);
  const result = await batch.commit();
  return result.lastInsertId;
}

export async function deleteQuote(id: number): Promise<void> {
  // Quotes are deletable at any status; remaining quotes are never
  // renumbered (gaps in the sequence are accepted).
  const batch = new TransactionBatch();
  // FK enforcement is active in batches: clear the conversion back-reference
  // (invoices.from_quote_id) before deleting the quote it points to.
  batch.add("UPDATE invoices SET from_quote_id = NULL WHERE from_quote_id = $1", [id]);
  batch.add("DELETE FROM quote_line_items WHERE quote_id = $1", [id]);
  batch.add("DELETE FROM quotes WHERE id = $1", [id]);
  await batch.commit();
}
