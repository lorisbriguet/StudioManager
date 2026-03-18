import { getDb, validateFields } from "../index";
import type { Quote, QuoteLineItem } from "../../types/quote";

export async function getQuotes(): Promise<Quote[]> {
  const db = await getDb();
  return db.select<Quote[]>("SELECT * FROM quotes ORDER BY quote_date DESC");
}

export async function getQuote(id: number): Promise<Quote | null> {
  const db = await getDb();
  const rows = await db.select<Quote[]>(
    "SELECT * FROM quotes WHERE id = $1",
    [id]
  );
  return rows[0] ?? null;
}

export async function getNextQuoteReference(year: number): Promise<string> {
  const db = await getDb();
  const prefix = `D-${year}-`;
  const rows = await db.select<{ max_num: number | null }[]>(
    "SELECT MAX(CAST(SUBSTR(reference, $1) AS INTEGER)) as max_num FROM quotes WHERE reference LIKE $2",
    [prefix.length + 1, `${prefix}%`]
  );
  const next = (rows[0]?.max_num ?? 0) + 1;
  return `${prefix}${String(next).padStart(3, "0")}`;
}

export async function createQuote(
  data: Omit<Quote, "id" | "created_at" | "updated_at">
): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO quotes (reference, client_id, project_id, status, language, activity, assignment, quote_date, valid_until, subtotal, discount_applied, discount_rate, total, converted_to_invoice_id, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      data.reference,
      data.client_id,
      data.project_id,
      data.status,
      data.language,
      data.activity,
      data.assignment,
      data.quote_date,
      data.valid_until,
      data.subtotal,
      data.discount_applied,
      data.discount_rate,
      data.total,
      data.converted_to_invoice_id,
      data.notes,
    ]
  );
  return result.lastInsertId ?? 0;
}

export async function updateQuote(
  id: number,
  data: Partial<Omit<Quote, "id" | "created_at" | "updated_at">>
): Promise<void> {
  const db = await getDb();
  const fields = Object.keys(data);
  validateFields(fields);
  const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
  const values = [id, ...fields.map((f) => data[f as keyof typeof data])];
  await db.execute(
    `UPDATE quotes SET ${sets}, updated_at = datetime('now') WHERE id = $1`,
    values
  );
}

export async function getQuoteLineItems(quoteId: number): Promise<QuoteLineItem[]> {
  const db = await getDb();
  return db.select<QuoteLineItem[]>(
    "SELECT * FROM quote_line_items WHERE quote_id = $1 ORDER BY sort_order",
    [quoteId]
  );
}

export async function setQuoteLineItems(
  quoteId: number,
  items: Omit<QuoteLineItem, "id" | "quote_id">[]
): Promise<void> {
  const db = await getDb();
  await db.execute("BEGIN");
  try {
    await db.execute("DELETE FROM quote_line_items WHERE quote_id = $1", [quoteId]);
    for (const item of items) {
      await db.execute(
        `INSERT INTO quote_line_items (quote_id, designation, rate, unit, quantity, amount, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [quoteId, item.designation, item.rate, item.unit, item.quantity, item.amount, item.sort_order]
      );
    }
    await db.execute("COMMIT");
  } catch (e) {
    await db.execute("ROLLBACK");
    throw e;
  }
}
