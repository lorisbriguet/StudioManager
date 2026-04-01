import { getDb, validateFields, TransactionBatch } from "../index";
import { getNextReference } from "./referenceGenerator";
import type { Invoice, InvoiceLineItem } from "../../types/invoice";

export interface InvoiceAgingRow {
  bracket: string;
  count: number;
  total: number;
}

export async function getInvoiceAging(): Promise<InvoiceAgingRow[]> {
  const db = await getDb();
  return db.select<InvoiceAgingRow[]>(`
    SELECT
      CASE
        WHEN julianday('now') - julianday(due_date) BETWEEN 0 AND 30 THEN '0-30'
        WHEN julianday('now') - julianday(due_date) BETWEEN 31 AND 60 THEN '31-60'
        WHEN julianday('now') - julianday(due_date) BETWEEN 61 AND 90 THEN '61-90'
        ELSE '90+'
      END as bracket,
      COUNT(*) as count,
      SUM(total) as total
    FROM invoices
    WHERE status IN ('sent', 'overdue') AND due_date < date('now')
    GROUP BY bracket
  `);
}

export async function getInvoices(): Promise<Invoice[]> {
  const db = await getDb();
  return db.select<Invoice[]>(
    "SELECT * FROM invoices ORDER BY invoice_date DESC"
  );
}

export async function getInvoice(id: number): Promise<Invoice | null> {
  const db = await getDb();
  const rows = await db.select<Invoice[]>(
    "SELECT * FROM invoices WHERE id = $1",
    [id]
  );
  return rows[0] ?? null;
}

export async function getInvoicesByClient(
  clientId: string
): Promise<Invoice[]> {
  const db = await getDb();
  return db.select<Invoice[]>(
    "SELECT * FROM invoices WHERE client_id = $1 ORDER BY invoice_date DESC",
    [clientId]
  );
}

export async function getInvoicesByProject(
  projectId: number
): Promise<Invoice[]> {
  const db = await getDb();
  return db.select<Invoice[]>(
    "SELECT * FROM invoices WHERE project_id = $1 ORDER BY invoice_date DESC",
    [projectId]
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
  batch.add(
    `INSERT INTO invoices (reference, client_id, project_id, status, language, activity, assignment,
     invoice_date, due_date, payment_terms_days, subtotal, discount_applied, discount_rate,
     discount_label, total, paid_date, contact_id, billing_address_id, po_number, pdf_path, from_quote_id, notes,
     currency, exchange_rate, chf_equivalent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)`,
    [
      data.reference, data.client_id, data.project_id, data.status, data.language,
      data.activity, data.assignment, data.invoice_date, data.due_date,
      data.payment_terms_days, data.subtotal, data.discount_applied, data.discount_rate,
      data.discount_label, data.total, data.paid_date, data.contact_id, data.billing_address_id ?? null,
      data.po_number, data.pdf_path,
      data.from_quote_id, data.notes, data.currency ?? "CHF", data.exchange_rate ?? 1.0,
      data.chf_equivalent ?? data.total,
    ]
  );
  for (const item of lineItems) {
    batch.add(
      `INSERT INTO invoice_line_items (invoice_id, designation, rate, unit, quantity, amount, sort_order)
       VALUES ($LAST_INSERT_ID, $1, $2, $3, $4, $5, $6)`,
      [item.designation, item.rate, item.unit, item.quantity, item.amount, item.sort_order]
    );
  }
  const result = await batch.commit();
  return result.lastInsertId;
}

/** Update invoice fields only (no line items) */
export async function updateInvoice(
  id: number,
  data: Partial<Omit<Invoice, "id" | "created_at" | "updated_at">>
): Promise<void> {
  const db = await getDb();
  const fields = Object.keys(data);
  validateFields(fields);
  const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
  const values = [id, ...fields.map((f) => data[f as keyof typeof data])];
  await db.execute(
    `UPDATE invoices SET ${sets}, updated_at = datetime('now') WHERE id = $1`,
    values
  );
}

export async function updateInvoiceWithLineItems(
  id: number,
  data: Partial<Omit<Invoice, "id" | "created_at" | "updated_at">>,
  lineItems?: Omit<InvoiceLineItem, "id" | "invoice_id">[]
): Promise<void> {
  const fields = Object.keys(data);
  validateFields(fields);
  const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
  const values = [id, ...fields.map((f) => data[f as keyof typeof data])];

  const batch = new TransactionBatch();
  batch.add(`UPDATE invoices SET ${sets}, updated_at = datetime('now') WHERE id = $1`, values);
  if (lineItems) {
    batch.add("DELETE FROM invoice_line_items WHERE invoice_id = $1", [id]);
    for (const item of lineItems) {
      batch.add(
        `INSERT INTO invoice_line_items (invoice_id, designation, rate, unit, quantity, amount, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, item.designation, item.rate, item.unit, item.quantity, item.amount, item.sort_order]
      );
    }
  }
  await batch.commit();
}

export async function markOverdueInvoices(): Promise<Invoice[]> {
  const db = await getDb();
  const today = new Date().toISOString().split("T")[0];
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
  // Get the invoice to know its year prefix before deleting
  const rows = await db.select<Invoice[]>("SELECT * FROM invoices WHERE id = $1", [id]);
  const invoice = rows[0];
  await db.execute("DELETE FROM invoices WHERE id = $1", [id]);
  // Reindex remaining invoices for the same year
  if (invoice && !invoice.reference.startsWith("DRAFT")) {
    const year = invoice.reference.split("-")[0];
    await reindexInvoiceReferences(year);
  }
}

async function reindexInvoiceReferences(year: string): Promise<void> {
  const db = await getDb();
  const invoices = await db.select<{ id: number; reference: string }[]>(
    "SELECT id, reference FROM invoices WHERE reference LIKE $1 ORDER BY CAST(SUBSTR(reference, $2) AS INTEGER)",
    [`${year}-%`, year.length + 2]
  );
  for (let i = 0; i < invoices.length; i++) {
    const newRef = `${year}-${String(i + 1).padStart(3, "0")}`;
    if (invoices[i].reference !== newRef) {
      await db.execute(
        "UPDATE invoices SET reference = $1, updated_at = datetime('now') WHERE id = $2",
        [newRef, invoices[i].id]
      );
    }
  }
}

export async function getInvoiceLineItems(
  invoiceId: number
): Promise<InvoiceLineItem[]> {
  const db = await getDb();
  return db.select<InvoiceLineItem[]>(
    "SELECT * FROM invoice_line_items WHERE invoice_id = $1 ORDER BY sort_order",
    [invoiceId]
  );
}
