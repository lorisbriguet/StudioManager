import { getDb, validateFields, TransactionBatch } from "../index";
import { sameAddress, type Client, type ClientContact, type ClientAddress } from "../../types/client";
import { AppError } from "../../lib/errors";

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
  // The address typed in the new-client form also becomes the client's
  // "Main" billing address (startup no longer copies it over).
  if (data.address_line1 || data.postal_city) {
    await db.execute(
      `INSERT INTO client_addresses (client_id, label, billing_name, address_line1, address_line2, postal_city)
       VALUES ($1, 'Main', $2, $3, $4, $5)`,
      [data.id, data.billing_name || data.name, data.address_line1, data.address_line2 || "", data.postal_city || ""]
    );
  }
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

/**
 * Thrown by deleteClient when the client has issued invoices (a real
 * reference, not DRAFT-): those are kept for 10 years (OR art. 958f), so the
 * client is archived instead.
 */
export class ClientHasIssuedInvoicesError extends AppError {
  constructor(public readonly clientId: string, public readonly count: number) {
    super("error_client_has_issued_invoices", `Client ${clientId} has ${count} issued invoice(s) and can't be deleted`);
    this.name = "ClientHasIssuedInvoicesError";
  }
}

/** How many invoices of the client carry a real reference (sent, paid, overdue, cancelled). */
export async function countIssuedInvoices(clientId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ n: number }[]>(
    "SELECT COUNT(*) AS n FROM invoices WHERE client_id = $1 AND reference NOT LIKE 'DRAFT-%'",
    [clientId]
  );
  return Number(rows[0]?.n ?? 0);
}

/** Archive (a timestamp) or restore (null) a client. */
export async function setClientArchived(id: string, archived: boolean): Promise<void> {
  const db = await getDb();
  await db.execute(
    archived
      ? "UPDATE clients SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = $1"
      : "UPDATE clients SET archived_at = NULL, updated_at = datetime('now') WHERE id = $1",
    [id]
  );
}

// MAINTENANCE — adding a table to the client graph requires co-updating:
//   (a) the cascade list in deleteClient below
//   (b) snapshotClientGraph
//   (c) restoreClientGraph
//   (d) the CASCADE_SQL pin in src/__tests__/clientDelete.test.ts
//   (e) CLIENT_GRAPH_QUERY_KEYS in src/db/hooks/useClients.ts
// The test pin only catches (a) — forgetting (b)/(c) silently reintroduces
// lossy undo.
/**
 * Delete a client and its ENTIRE graph (projects, tasks, subtasks, invoices,
 * quotes, line items, recurring templates, time entries, project tables,
 * resource links, contacts, addresses) in one atomic transaction.
 *
 * Ordering strategy: explicit children-first deletes rather than
 * `PRAGMA defer_foreign_keys = ON` (the backup-restore approach). Deferral
 * would not shrink this list — projects/invoices/quotes have NO ON DELETE
 * action from clients, so every DELETE below is required either way — and
 * explicit ordering keeps the cascade correct even on connections where
 * foreign_keys is OFF, while making the statement sequence testable.
 * The only circular FK pair (invoices.from_quote_id <->
 * quotes.converted_to_invoice_id, no ON DELETE actions) is broken by
 * clearing the quote-side pointer first.
 *
 * Refuses (ClientHasIssuedInvoicesError, nothing deleted) when the client has
 * an issued invoice. The cascade itself only deletes DRAFT- invoices, so an
 * issued one created after the check makes the final client DELETE fail on
 * its foreign key and the whole batch rolls back.
 */
export async function deleteClient(id: string): Promise<void> {
  const issued = await countIssuedInvoices(id);
  if (issued > 0) throw new ClientHasIssuedInvoicesError(id, issued);
  const batch = new TransactionBatch();
  // 1. Break the circular FK so invoices can be deleted mid-batch
  batch.add("UPDATE quotes SET converted_to_invoice_id = NULL WHERE client_id = $1", [id]);
  // 2. Invoice/quote subtree (children before parents)
  batch.add("DELETE FROM recurring_invoice_templates WHERE client_id = $1", [id]);
  batch.add("DELETE FROM invoice_line_items WHERE invoice_id IN (SELECT id FROM invoices WHERE client_id = $1 AND reference LIKE 'DRAFT-%')", [id]);
  batch.add("DELETE FROM invoices WHERE client_id = $1 AND reference LIKE 'DRAFT-%'", [id]);
  batch.add("DELETE FROM quote_line_items WHERE quote_id IN (SELECT id FROM quotes WHERE client_id = $1)", [id]);
  batch.add("DELETE FROM quotes WHERE client_id = $1", [id]);
  // 3. Project subtree (children before parents)
  batch.add("DELETE FROM time_entries WHERE project_id IN (SELECT id FROM projects WHERE client_id = $1)", [id]);
  batch.add("DELETE FROM subtasks WHERE task_id IN (SELECT id FROM tasks WHERE project_id IN (SELECT id FROM projects WHERE client_id = $1))", [id]);
  // workload_rows is legacy (drained into tasks by ensureSchema on every
  // startup) — deleted defensively, intentionally NOT snapshotted for undo
  batch.add("DELETE FROM workload_rows WHERE project_id IN (SELECT id FROM projects WHERE client_id = $1)", [id]);
  batch.add("DELETE FROM tasks WHERE project_id IN (SELECT id FROM projects WHERE client_id = $1)", [id]);
  batch.add("DELETE FROM project_table_rows WHERE table_id IN (SELECT id FROM project_tables WHERE project_id IN (SELECT id FROM projects WHERE client_id = $1))", [id]);
  batch.add("DELETE FROM project_tables WHERE project_id IN (SELECT id FROM projects WHERE client_id = $1)", [id]);
  batch.add("DELETE FROM resource_projects WHERE project_id IN (SELECT id FROM projects WHERE client_id = $1)", [id]);
  batch.add("DELETE FROM projects WHERE client_id = $1", [id]);
  // 4. Client-owned rows, then the client itself
  batch.add("DELETE FROM client_contacts WHERE client_id = $1", [id]);
  batch.add("DELETE FROM client_addresses WHERE client_id = $1", [id]);
  batch.add("DELETE FROM clients WHERE id = $1", [id]);
  await batch.commit();
}

// ── Client graph snapshot (honest undo for deleteClient) ─────

/** Generic SELECT * row — restored verbatim, original IDs included. */
type Row = Record<string, unknown>;

export interface ClientGraphSnapshot {
  client: Client;
  contacts: Row[];
  addresses: Row[];
  projects: Row[];
  tasks: Row[];
  subtasks: Row[];
  invoices: Row[];
  invoiceLineItems: Row[];
  quotes: Row[];
  quoteLineItems: Row[];
  recurringTemplates: Row[];
  timeEntries: Row[];
  projectTables: Row[];
  projectTableRows: Row[];
  resourceProjects: Row[];
}

/**
 * Capture every row deleteClient's cascade will remove, so undo can restore
 * the full graph with original IDs. Must mirror the delete statement list
 * (workload_rows excepted — legacy, always drained by ensureSchema).
 */
export async function snapshotClientGraph(
  id: string
): Promise<ClientGraphSnapshot | null> {
  const db = await getDb();
  const clients = await db.select<Client[]>(
    "SELECT * FROM clients WHERE id = $1",
    [id]
  );
  const client = clients[0];
  if (!client) return null;
  const grab = (sql: string) => db.select<Row[]>(sql, [id]);
  return {
    client,
    contacts: await grab("SELECT * FROM client_contacts WHERE client_id = $1"),
    addresses: await grab("SELECT * FROM client_addresses WHERE client_id = $1"),
    projects: await grab("SELECT * FROM projects WHERE client_id = $1"),
    tasks: await grab("SELECT * FROM tasks WHERE project_id IN (SELECT id FROM projects WHERE client_id = $1)"),
    subtasks: await grab("SELECT * FROM subtasks WHERE task_id IN (SELECT id FROM tasks WHERE project_id IN (SELECT id FROM projects WHERE client_id = $1))"),
    invoices: await grab("SELECT * FROM invoices WHERE client_id = $1"),
    invoiceLineItems: await grab("SELECT * FROM invoice_line_items WHERE invoice_id IN (SELECT id FROM invoices WHERE client_id = $1)"),
    quotes: await grab("SELECT * FROM quotes WHERE client_id = $1"),
    quoteLineItems: await grab("SELECT * FROM quote_line_items WHERE quote_id IN (SELECT id FROM quotes WHERE client_id = $1)"),
    recurringTemplates: await grab("SELECT * FROM recurring_invoice_templates WHERE client_id = $1"),
    timeEntries: await grab("SELECT * FROM time_entries WHERE project_id IN (SELECT id FROM projects WHERE client_id = $1)"),
    projectTables: await grab("SELECT * FROM project_tables WHERE project_id IN (SELECT id FROM projects WHERE client_id = $1)"),
    projectTableRows: await grab("SELECT * FROM project_table_rows WHERE table_id IN (SELECT id FROM project_tables WHERE project_id IN (SELECT id FROM projects WHERE client_id = $1))"),
    resourceProjects: await grab("SELECT * FROM resource_projects WHERE project_id IN (SELECT id FROM projects WHERE client_id = $1)"),
  };
}

/** Queue an INSERT built from a snapshot row's own columns (keeps original IDs).
 *  `table` must be a call-site literal — it is interpolated into SQL unescaped. */
function addRowInsert(batch: TransactionBatch, table: string, row: Row): void {
  const fields = Object.keys(row);
  if (fields.length === 0) {
    throw new Error(`Cannot restore an empty snapshot row into ${table}`);
  }
  validateFields(fields);
  const placeholders = fields.map((_, i) => `$${i + 1}`).join(", ");
  batch.add(
    `INSERT INTO ${table} (${fields.join(", ")}) VALUES (${placeholders})`,
    fields.map((f) => row[f])
  );
}

/**
 * Restore everything deleteClient removed, with original IDs, atomically.
 * Parents-first mirror of the delete order. The circular invoices <-> quotes
 * pair is handled by inserting quotes with converted_to_invoice_id = NULL,
 * then patching the pointer once the invoices exist.
 */
export async function restoreClientGraph(
  snap: ClientGraphSnapshot
): Promise<void> {
  const batch = new TransactionBatch();
  addRowInsert(batch, "clients", snap.client as unknown as Row);
  for (const row of snap.contacts) addRowInsert(batch, "client_contacts", row);
  for (const row of snap.addresses) addRowInsert(batch, "client_addresses", row);
  for (const row of snap.projects) addRowInsert(batch, "projects", row);
  for (const row of snap.tasks) addRowInsert(batch, "tasks", row);
  for (const row of snap.subtasks) addRowInsert(batch, "subtasks", row);
  for (const row of snap.quotes) {
    addRowInsert(batch, "quotes", { ...row, converted_to_invoice_id: null });
  }
  for (const row of snap.invoices) addRowInsert(batch, "invoices", row);
  for (const row of snap.quotes) {
    if (row.converted_to_invoice_id != null) {
      batch.add(
        "UPDATE quotes SET converted_to_invoice_id = $1 WHERE id = $2",
        [row.converted_to_invoice_id, row.id]
      );
    }
  }
  for (const row of snap.invoiceLineItems) addRowInsert(batch, "invoice_line_items", row);
  for (const row of snap.quoteLineItems) addRowInsert(batch, "quote_line_items", row);
  for (const row of snap.recurringTemplates) addRowInsert(batch, "recurring_invoice_templates", row);
  for (const row of snap.timeEntries) addRowInsert(batch, "time_entries", row);
  for (const row of snap.projectTables) addRowInsert(batch, "project_tables", row);
  for (const row of snap.projectTableRows) addRowInsert(batch, "project_table_rows", row);
  for (const row of snap.resourceProjects) addRowInsert(batch, "resource_projects", row);
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
): Promise<number> {
  const db = await getDb();
  const result = await db.execute(
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
  return result.lastInsertId ?? 0;
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

export type OwnAddress = Pick<Client, "address_line1" | "address_line2" | "postal_city">;

/**
 * The client's own address (clients.address_line1/2, postal_city) feeds the
 * "Main address" card, PDFs without a chosen address and the QR bill. Clear
 * it after the user deletes that same address, or the client's last one, so
 * a deleted address stays gone. Returns what was cleared (for undo), or null.
 */
export async function clearOwnAddressAfterDelete(
  clientId: string,
  deleted: Pick<ClientAddress, "address_line1" | "address_line2" | "postal_city">
): Promise<OwnAddress | null> {
  const db = await getDb();
  const own = (await db.select<OwnAddress[]>(
    "SELECT address_line1, address_line2, postal_city FROM clients WHERE id = $1",
    [clientId]
  ))[0];
  if (!own || (!own.address_line1 && !own.address_line2 && !own.postal_city)) return null;
  const left = await db.select<{ cnt: number }[]>(
    "SELECT COUNT(*) as cnt FROM client_addresses WHERE client_id = $1",
    [clientId]
  );
  if (!sameAddress(own, deleted) && (left[0]?.cnt ?? 0) > 0) return null;
  await setOwnAddress(clientId, { address_line1: "", address_line2: "", postal_city: "" });
  return { address_line1: own.address_line1 ?? "", address_line2: own.address_line2 ?? "", postal_city: own.postal_city ?? "" };
}

export async function setOwnAddress(clientId: string, addr: OwnAddress): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE clients SET address_line1 = $2, address_line2 = $3, postal_city = $4 WHERE id = $1",
    [clientId, addr.address_line1, addr.address_line2, addr.postal_city]
  );
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
