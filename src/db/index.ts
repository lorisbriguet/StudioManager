import Database from "@tauri-apps/plugin-sql";

const SAFE_FIELD = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Validate that SQL field names contain only safe characters to prevent injection */
export function validateFields(fields: string[]): void {
  for (const f of fields) {
    if (!SAFE_FIELD.test(f)) {
      throw new Error(`Invalid field name: ${f}`);
    }
  }
}

let dbPromise: Promise<Database> | null = null;

export async function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const database = await Database.load("sqlite:studiomanager.db");
      await ensureSchema(database);
      return database;
    })();
    // Clear cached promise on failure so next call retries
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

async function ensureSchema(db: Database) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL DEFAULT 'info',
      title TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      read INTEGER NOT NULL DEFAULT 0,
      link TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT (datetime('now'))
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS subtasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'done')),
      due_date TEXT DEFAULT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now'))
    )
  `);
  // Add due_date column if missing (table was created without it)
  const cols = await db.select<{ name: string }[]>(
    "SELECT name FROM pragma_table_info('subtasks')"
  );
  if (!cols.some((c) => c.name === "due_date")) {
    await db.execute("ALTER TABLE subtasks ADD COLUMN due_date TEXT DEFAULT NULL");
  }
  if (!cols.some((c) => c.name === "start_time")) {
    await db.execute("ALTER TABLE subtasks ADD COLUMN start_time TEXT DEFAULT NULL");
  }
  if (!cols.some((c) => c.name === "end_time")) {
    await db.execute("ALTER TABLE subtasks ADD COLUMN end_time TEXT DEFAULT NULL");
  }

  // Add start_time/end_time to tasks if missing
  const taskCols = await db.select<{ name: string }[]>(
    "SELECT name FROM pragma_table_info('tasks')"
  );
  if (!taskCols.some((c) => c.name === "start_time")) {
    await db.execute("ALTER TABLE tasks ADD COLUMN start_time TEXT DEFAULT NULL");
  }
  if (!taskCols.some((c) => c.name === "end_time")) {
    await db.execute("ALTER TABLE tasks ADD COLUMN end_time TEXT DEFAULT NULL");
  }
  if (!taskCols.some((c) => c.name === "reminder")) {
    await db.execute("ALTER TABLE tasks ADD COLUMN reminder TEXT DEFAULT NULL");
  }
  if (!taskCols.some((c) => c.name === "end_date")) {
    await db.execute("ALTER TABLE tasks ADD COLUMN end_date TEXT DEFAULT NULL");
  }
  if (!cols.some((c) => c.name === "reminder")) {
    await db.execute("ALTER TABLE subtasks ADD COLUMN reminder TEXT DEFAULT NULL");
  }
  if (!cols.some((c) => c.name === "end_date")) {
    await db.execute("ALTER TABLE subtasks ADD COLUMN end_date TEXT DEFAULT NULL");
  }
  if (!cols.some((c) => c.name === "calendar_event_id")) {
    await db.execute("ALTER TABLE subtasks ADD COLUMN calendar_event_id TEXT DEFAULT NULL");
  }
  if (!taskCols.some((c) => c.name === "calendar_event_id")) {
    await db.execute("ALTER TABLE tasks ADD COLUMN calendar_event_id TEXT DEFAULT NULL");
  }

  // Add calendar_deadline_id to projects if missing
  const projCols = await db.select<{ name: string }[]>(
    "SELECT name FROM pragma_table_info('projects')"
  );
  if (!projCols.some((c) => c.name === "calendar_deadline_id")) {
    await db.execute("ALTER TABLE projects ADD COLUMN calendar_deadline_id TEXT DEFAULT NULL");
  }

  // Add postal_city column and migrate address_line2 data into it
  const clientCols = await db.select<{ name: string }[]>(
    "SELECT name FROM pragma_table_info('clients')"
  );
  if (!clientCols.some((c) => c.name === "postal_city")) {
    await db.execute("ALTER TABLE clients ADD COLUMN postal_city TEXT NOT NULL DEFAULT ''");
    // Migrate existing address_line2 to postal_city
    await db.execute("UPDATE clients SET postal_city = address_line2, address_line2 = '' WHERE address_line2 IS NOT NULL AND address_line2 != ''");
  }

  // Migrate client email/phone to client_contacts (one-time)
  const clientsWithEmail = await db.select<{ id: string; email: string; phone: string }[]>(
    "SELECT id, email, phone FROM clients WHERE (email IS NOT NULL AND email != '') OR (phone IS NOT NULL AND phone != '')"
  );
  for (const c of clientsWithEmail) {
    // Only migrate if no contacts exist for this client yet
    const existing = await db.select<{ id: number }[]>(
      "SELECT id FROM client_contacts WHERE client_id = $1 LIMIT 1",
      [c.id]
    );
    if (existing.length === 0) {
      await db.execute(
        "INSERT INTO client_contacts (client_id, email, phone) VALUES ($1, $2, $3)",
        [c.id, c.email || "", c.phone || ""]
      );
    }
    // Clear the old fields
    await db.execute(
      "UPDATE clients SET email = '', phone = '' WHERE id = $1",
      [c.id]
    );
  }

  // Add contact_id to invoices if missing
  const invoiceCols = await db.select<{ name: string }[]>(
    "SELECT name FROM pragma_table_info('invoices')"
  );
  if (!invoiceCols.some((c) => c.name === "contact_id")) {
    await db.execute("ALTER TABLE invoices ADD COLUMN contact_id INTEGER REFERENCES client_contacts(id) ON DELETE SET NULL");
  }

  // Indexes on foreign keys for query performance
  await db.execute("CREATE INDEX IF NOT EXISTS idx_subtasks_task_id ON subtasks(task_id)");
  await db.execute("CREATE INDEX IF NOT EXISTS idx_projects_client_id ON projects(client_id)");
  await db.execute("CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON invoices(client_id)");
  await db.execute("CREATE INDEX IF NOT EXISTS idx_quotes_client_id ON quotes(client_id)");
  await db.execute("CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice_id ON invoice_line_items(invoice_id)");
  await db.execute("CREATE INDEX IF NOT EXISTS idx_client_contacts_client_id ON client_contacts(client_id)");
}
