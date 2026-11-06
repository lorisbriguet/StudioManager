import { getDb, TransactionBatch } from "../index";
import { getNextReference } from "./referenceGenerator";
import { documentQueries } from "./documents";
import { isDraftReference } from "../../types/invoice";
import { todayLocalISO } from "../../utils/localDate";
import type { Invoice, InvoiceLineItem } from "../../types/invoice";

export interface InvoiceAgingRow {
  bracket: string;
  count: number;
  total: number;
}

export async function getInvoiceAging(): Promise<InvoiceAgingRow[]> {
  const db = await getDb();
  // Bind the LOCAL calendar date instead of julianday('now')/date('now'),
  // which are UTC and (for julianday) include the time of day, producing
  // fractional diffs that fall between brackets.
  // $1 is ONE bound value referenced 4x — sqlx binds $N by index, so do not
  // "normalize" to sequential placeholders.
  return db.select<InvoiceAgingRow[]>(`
    SELECT
      CASE
        WHEN julianday($1) - julianday(due_date) BETWEEN 0 AND 30 THEN '0-30'
        WHEN julianday($1) - julianday(due_date) BETWEEN 31 AND 60 THEN '31-60'
        WHEN julianday($1) - julianday(due_date) BETWEEN 61 AND 90 THEN '61-90'
        ELSE '90+'
      END as bracket,
      COUNT(*) as count,
      COALESCE(SUM(CASE WHEN currency != 'CHF' AND chf_equivalent > 0 THEN chf_equivalent ELSE total END), 0) as total
    FROM invoices
    WHERE status IN ('sent', 'overdue') AND due_date < $1
    GROUP BY bracket
  `, [todayLocalISO()]);
}

const docs = documentQueries<Invoice, InvoiceLineItem>("invoice");

export const getInvoices = docs.list;
export const getInvoice = docs.get;
export const getInvoicesByProject = docs.listByProject;
/** Update invoice fields only (no line items) */
export const updateInvoice = docs.update;
export const updateInvoiceWithLineItems = docs.updateWithLineItems;
export const getInvoiceLineItems = docs.lineItems;

export async function getInvoicesByClient(
  clientId: string
): Promise<Invoice[]> {
  const db = await getDb();
  return db.select<Invoice[]>(
    "SELECT * FROM invoices WHERE client_id = $1 ORDER BY invoice_date DESC",
    [clientId]
  );
}

export async function getNextInvoiceReference(year: number): Promise<string> {
  return getNextReference("invoices", "reference", `${year}-`);
}

export async function createInvoiceWithLineItems(
  data: Omit<Invoice, "id" | "created_at" | "updated_at">,
  lineItems: Omit<InvoiceLineItem, "id" | "invoice_id">[]
): Promise<number> {
  const batch = new TransactionBatch();
  // reminder_count / last_reminder_date are intentionally omitted: the DB
  // defaults (0 / NULL) match what every caller passes for a new invoice.
  batch.add(
    `INSERT INTO invoices (reference, client_id, project_id, status, language, activity, activity_id, assignment,
     invoice_date, due_date, payment_terms_days, subtotal, discount_applied, discount_rate,
     discount_label, total, paid_date, contact_id, billing_address_id, po_number, pdf_path, from_quote_id, notes,
     currency, exchange_rate, chf_equivalent, template_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)`,
    [
      data.reference, data.client_id, data.project_id, data.status, data.language,
      data.activity, data.activity_id ?? null, data.assignment, data.invoice_date, data.due_date,
      data.payment_terms_days, data.subtotal, data.discount_applied, data.discount_rate,
      data.discount_label, data.total, data.paid_date, data.contact_id, data.billing_address_id ?? null,
      data.po_number, data.pdf_path,
      data.from_quote_id, data.notes, data.currency ?? "CHF", data.exchange_rate ?? 1.0,
      data.chf_equivalent ?? data.total, data.template_id ?? null,
    ]
  );
  docs.addNewLineItems(batch, lineItems);
  const result = await batch.commit();
  return result.lastInsertId;
}

export async function markOverdueInvoices(): Promise<Invoice[]> {
  const db = await getDb();
  const today = todayLocalISO();
  // Find sent invoices past their due date
  const overdue = await db.select<Invoice[]>(
    `SELECT * FROM invoices
     WHERE status = 'sent'
       AND due_date IS NOT NULL
       AND due_date < $1`,
    [today]
  );
  // Update them to overdue
  if (overdue.length > 0) {
    await db.execute(
      `UPDATE invoices SET status = 'overdue', updated_at = datetime('now')
       WHERE status = 'sent'
         AND due_date IS NOT NULL
         AND due_date < $1`,
      [today]
    );
  }
  return overdue;
}

export async function deleteInvoice(id: number): Promise<void> {
  const db = await getDb();
  // Only drafts (DRAFT- reference) are deletable. An invoice that ever
  // received a real reference must be cancelled instead — issued references
  // are never reused and remaining invoices are never renumbered
  // (gaps in the sequence are accepted).
  const rows = await db.select<{ reference: string }[]>(
    "SELECT reference FROM invoices WHERE id = $1",
    [id]
  );
  const invoice = rows[0];
  if (invoice && !isDraftReference(invoice.reference)) {
    throw new Error("Only draft invoices can be deleted");
  }
  // Clear the conversion back-reference (quotes.converted_to_invoice_id) so
  // FK enforcement doesn't reject deleting a draft created from a quote.
  // Sequential db.execute (not a batch) is intentional, matching deleteProject:
  // the SELECT guard above precedes it and the UPDATE is idempotent/harmless standalone.
  await db.execute(
    "UPDATE quotes SET converted_to_invoice_id = NULL WHERE converted_to_invoice_id = $1",
    [id]
  );
  await db.execute("DELETE FROM invoices WHERE id = $1", [id]);
}

/**
 * Line items for many invoices in one query, grouped by invoice id —
 * bulk flows (trustee export) must not fetch one invoice at a time.
 */
export async function getLineItemsForInvoices(
  invoiceIds: number[]
): Promise<Map<number, InvoiceLineItem[]>> {
  const map = new Map<number, InvoiceLineItem[]>();
  if (invoiceIds.length === 0) return map;
  const db = await getDb();
  const placeholders = invoiceIds.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await db.select<InvoiceLineItem[]>(
    `SELECT * FROM invoice_line_items WHERE invoice_id IN (${placeholders}) ORDER BY invoice_id, sort_order`,
    invoiceIds
  );
  for (const row of rows) {
    const items = map.get(row.invoice_id) ?? [];
    items.push(row);
    map.set(row.invoice_id, items);
  }
  return map;
}
