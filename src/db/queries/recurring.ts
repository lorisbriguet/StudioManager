import { getDb, validateFields } from "../index";
import type { RecurringInvoiceTemplate } from "../../types/recurring";

export async function getRecurringTemplates(): Promise<RecurringInvoiceTemplate[]> {
  const db = await getDb();
  return db.select<RecurringInvoiceTemplate[]>(
    "SELECT * FROM recurring_invoice_templates ORDER BY next_due ASC"
  );
}

export async function getRecurringTemplate(id: number): Promise<RecurringInvoiceTemplate | null> {
  const db = await getDb();
  const rows = await db.select<RecurringInvoiceTemplate[]>(
    "SELECT * FROM recurring_invoice_templates WHERE id = $1",
    [id]
  );
  return rows[0] ?? null;
}

export async function createRecurringTemplate(
  data: Omit<RecurringInvoiceTemplate, "id" | "created_at" | "updated_at">
): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO recurring_invoice_templates (base_invoice_id, client_id, frequency, next_due, active)
     VALUES ($1, $2, $3, $4, $5)`,
    [data.base_invoice_id, data.client_id, data.frequency, data.next_due, data.active]
  );
  return result.lastInsertId as number;
}

export async function updateRecurringTemplate(
  id: number,
  data: Partial<Omit<RecurringInvoiceTemplate, "id" | "created_at" | "updated_at">>
): Promise<void> {
  const db = await getDb();
  const fields = Object.keys(data);
  validateFields(fields);
  const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
  const values = [id, ...fields.map((f) => data[f as keyof typeof data])];
  await db.execute(
    `UPDATE recurring_invoice_templates SET ${sets}, updated_at = datetime('now') WHERE id = $1`,
    values
  );
}

export async function deleteRecurringTemplate(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM recurring_invoice_templates WHERE id = $1", [id]);
}

/** Get all active templates whose next_due is today or in the past. */
export async function getDueTemplates(): Promise<RecurringInvoiceTemplate[]> {
  const db = await getDb();
  const today = new Date().toISOString().split("T")[0];
  return db.select<RecurringInvoiceTemplate[]>(
    "SELECT * FROM recurring_invoice_templates WHERE active = 1 AND next_due <= $1",
    [today]
  );
}
