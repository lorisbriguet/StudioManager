import { getDb, validateFields, TransactionBatch } from "../index";
import type { InvoiceTemplate } from "../../types/invoice-template";

export async function getInvoiceTemplates(): Promise<InvoiceTemplate[]> {
  const db = await getDb();
  return db.select<InvoiceTemplate[]>(
    "SELECT * FROM invoice_templates ORDER BY is_default DESC, name ASC"
  );
}

export async function getInvoiceTemplate(id: number): Promise<InvoiceTemplate | null> {
  const db = await getDb();
  const rows = await db.select<InvoiceTemplate[]>(
    "SELECT * FROM invoice_templates WHERE id = $1 LIMIT 1",
    [id]
  );
  return rows[0] ?? null;
}

export async function getDefaultTemplate(): Promise<InvoiceTemplate | null> {
  const db = await getDb();
  const rows = await db.select<InvoiceTemplate[]>(
    "SELECT * FROM invoice_templates WHERE is_default = 1 LIMIT 1"
  );
  return rows[0] ?? null;
}

export async function createInvoiceTemplate(
  data: Omit<InvoiceTemplate, "id" | "created_at" | "updated_at">
): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO invoice_templates
      (name, is_default, accent_color, font_family, logo_position,
       margins_top, margins_right, margins_bottom, margins_left,
       show_notes, show_project_name, show_po_number, show_bank_details,
       show_qr_bill, show_footer, columns)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      data.name,
      data.is_default,
      data.accent_color,
      data.font_family,
      data.logo_position,
      data.margins_top,
      data.margins_right,
      data.margins_bottom,
      data.margins_left,
      data.show_notes,
      data.show_project_name,
      data.show_po_number,
      data.show_bank_details,
      data.show_qr_bill,
      data.show_footer,
      data.columns,
    ]
  );
  return result.lastInsertId ?? 0;
}

export async function updateInvoiceTemplate(
  id: number,
  data: Partial<Omit<InvoiceTemplate, "id" | "created_at" | "updated_at">>
): Promise<void> {
  const db = await getDb();
  const fields = Object.keys(data);
  if (fields.length === 0) return;
  validateFields(fields);
  const setClauses = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
  const values = fields.map((f) => data[f as keyof typeof data]);
  await db.execute(
    `UPDATE invoice_templates SET ${setClauses}, updated_at = datetime('now') WHERE id = $1`,
    [id, ...values]
  );
}

export async function deleteInvoiceTemplate(id: number): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ is_default: number }[]>(
    "SELECT is_default FROM invoice_templates WHERE id = $1",
    [id]
  );
  if (rows.length === 0) return;
  if (rows[0].is_default === 1) {
    throw new Error("Cannot delete the default template");
  }
  await db.execute("DELETE FROM invoice_templates WHERE id = $1", [id]);
}

export async function setDefaultTemplate(id: number): Promise<void> {
  const batch = new TransactionBatch();
  batch.add("UPDATE invoice_templates SET is_default = 0");
  batch.add("UPDATE invoice_templates SET is_default = 1, updated_at = datetime('now') WHERE id = $1", [id]);
  await batch.commit();
}
