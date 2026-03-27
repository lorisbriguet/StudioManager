import { getDb, validateFields, TransactionBatch } from "../index";
import type { Client, ClientContact, ClientAddress } from "../../types/client";

export async function getClients(): Promise<Client[]> {
  const db = await getDb();
  return db.select<Client[]>("SELECT * FROM clients ORDER BY name");
}

export async function getClient(id: string): Promise<Client | null> {
  const db = await getDb();
  const rows = await db.select<Client[]>(
    "SELECT * FROM clients WHERE id = $1",
    [id]
  );
  return rows[0] ?? null;
}

export async function getNextClientId(): Promise<string> {
  const db = await getDb();
  const rows = await db.select<{ max_num: number | null }[]>(
    "SELECT MAX(CAST(SUBSTR(id, 3) AS INTEGER)) as max_num FROM clients"
  );
  const next = (rows[0]?.max_num ?? 0) + 1;
  return `C-${String(next).padStart(3, "0")}`;
}

export async function createClient(
  data: Omit<Client, "created_at" | "updated_at">
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO clients (id, name, billing_name, address_line1, address_line2, postal_city, email, phone, language, has_discount, discount_rate, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      data.id,
      data.name,
      data.billing_name || data.name,
      data.address_line1,
      data.address_line2,
      data.postal_city,
      data.email,
      data.phone,
      data.language,
      data.has_discount,
      data.discount_rate,
      data.notes,
    ]
  );
}

export async function updateClient(
  id: string,
  data: Partial<Omit<Client, "id" | "created_at" | "updated_at">>
): Promise<void> {
  const db = await getDb();
  const fields = Object.keys(data);
  validateFields(fields);
  const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
  const values = [id, ...fields.map((f) => data[f as keyof typeof data])];
  await db.execute(
    `UPDATE clients SET ${sets}, updated_at = datetime('now') WHERE id = $1`,
    values
  );
}

export async function deleteClient(id: string): Promise<void> {
  const batch = new TransactionBatch();
  // Manually cascade to tables that lack ON DELETE CASCADE in schema
  batch.add("DELETE FROM invoice_line_items WHERE invoice_id IN (SELECT id FROM invoices WHERE client_id = $1)", [id]);
  batch.add("DELETE FROM quote_line_items WHERE quote_id IN (SELECT id FROM quotes WHERE client_id = $1)", [id]);
  batch.add("DELETE FROM invoices WHERE client_id = $1", [id]);
  batch.add("DELETE FROM quotes WHERE client_id = $1", [id]);
  batch.add("DELETE FROM subtasks WHERE task_id IN (SELECT id FROM tasks WHERE project_id IN (SELECT id FROM projects WHERE client_id = $1))", [id]);
  batch.add("DELETE FROM tasks WHERE project_id IN (SELECT id FROM projects WHERE client_id = $1)", [id]);
  batch.add("DELETE FROM workload_rows WHERE project_id IN (SELECT id FROM projects WHERE client_id = $1)", [id]);
  batch.add("DELETE FROM projects WHERE client_id = $1", [id]);
  batch.add("DELETE FROM client_contacts WHERE client_id = $1", [id]);
  batch.add("DELETE FROM client_addresses WHERE client_id = $1", [id]);
  batch.add("DELETE FROM clients WHERE id = $1", [id]);
  await batch.commit();
}

export async function getClientContact(
  id: number
): Promise<ClientContact | null> {
  const db = await getDb();
  const rows = await db.select<ClientContact[]>(
    "SELECT * FROM client_contacts WHERE id = $1",
    [id]
  );
  return rows[0] ?? null;
}

export async function getClientContacts(
  clientId: string
): Promise<ClientContact[]> {
  const db = await getDb();
  return db.select<ClientContact[]>(
    "SELECT * FROM client_contacts WHERE client_id = $1",
    [clientId]
  );
}

export async function createClientContact(
  data: Omit<ClientContact, "id">
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO client_contacts (client_id, first_name, last_name, email, phone, role)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      data.client_id,
      data.first_name,
      data.last_name,
      data.email,
      data.phone,
      data.role,
    ]
  );
}

export async function updateClientContact(
  id: number,
  data: Partial<Omit<ClientContact, "id" | "client_id">>
): Promise<void> {
  const db = await getDb();
  const fields = Object.keys(data);
  if (fields.length === 0) return;
  validateFields(fields);
  const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
  const values = [id, ...fields.map((f) => data[f as keyof typeof data])];
  await db.execute(`UPDATE client_contacts SET ${sets} WHERE id = $1`, values);
}

export async function deleteClientContact(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM client_contacts WHERE id = $1", [id]);
}

// ── Client Addresses ───────────────────────────────────────

export async function getClientAddresses(
  clientId: string
): Promise<ClientAddress[]> {
  const db = await getDb();
  return db.select<ClientAddress[]>(
    "SELECT * FROM client_addresses WHERE client_id = $1 ORDER BY id",
    [clientId]
  );
}

export async function getClientAddress(
  id: number
): Promise<ClientAddress | null> {
  const db = await getDb();
  const rows = await db.select<ClientAddress[]>(
    "SELECT * FROM client_addresses WHERE id = $1",
    [id]
  );
  return rows[0] ?? null;
}

export async function createClientAddress(
  data: Omit<ClientAddress, "id">
): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO client_addresses (client_id, label, billing_name, address_line1, address_line2, postal_city)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [data.client_id, data.label, data.billing_name, data.address_line1, data.address_line2, data.postal_city]
  );
  return result.lastInsertId ?? 0;
}

export async function updateClientAddress(
  id: number,
  data: Partial<Omit<ClientAddress, "id" | "client_id">>
): Promise<void> {
  const db = await getDb();
  const fields = Object.keys(data);
  if (fields.length === 0) return;
  validateFields(fields);
  const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
  const values = [id, ...fields.map((f) => data[f as keyof typeof data])];
  await db.execute(`UPDATE client_addresses SET ${sets} WHERE id = $1`, values);
}

export async function deleteClientAddress(id: number): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM client_addresses WHERE id = $1", [id]);
}

// ── Client Activity Timeline ─────────────────────────────────

export interface ClientActivityEvent {
  type: "invoice" | "quote" | "project";
  action: string;
  entity_id: number;
  label: string;
  date: string;
}

export async function getClientActivity(
  clientId: string,
  limit = 20,
  offset = 0
): Promise<ClientActivityEvent[]> {
  const db = await getDb();
  return db.select<ClientActivityEvent[]>(
    `SELECT * FROM (
       SELECT 'invoice' as type, status as action, id as entity_id, reference as label, invoice_date as date
       FROM invoices WHERE client_id = $1
       UNION ALL
       SELECT 'quote' as type, status as action, id as entity_id, reference as label, quote_date as date
       FROM quotes WHERE client_id = $1
       UNION ALL
       SELECT 'project' as type, status as action, id as entity_id, name as label, created_at as date
       FROM projects WHERE client_id = $1
     ) ORDER BY date DESC LIMIT $2 OFFSET $3`,
    [clientId, limit, offset]
  );
}
