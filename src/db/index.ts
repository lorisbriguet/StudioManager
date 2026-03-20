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

/** Run a callback inside a BEGIN/COMMIT/ROLLBACK transaction */
export async function withTransaction<T>(fn: (db: Database) => Promise<T>): Promise<T> {
  const db = await getDb();
  await db.execute("BEGIN");
  try {
    const result = await fn(db);
    await db.execute("COMMIT");
    return result;
  } catch (e) {
    await db.execute("ROLLBACK");
    throw e;
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

/**
 * Safety-net schema fixups that run after Rust-side migrations.
 * These handle ALTER TABLE ADD COLUMN (SQLite lacks IF NOT EXISTS for ALTER)
 * and one-time data migrations. New tables, indexes, and seeds should go in
 * numbered .sql migration files under src-tauri/migrations/ instead.
 */
async function ensureSchema(db: Database) {
  // Helper: add a column only if it doesn't already exist
  async function addColumnIfMissing(table: string, column: string, definition: string) {
    const cols = await db.select<{ name: string }[]>(
      `SELECT name FROM pragma_table_info('${table}')`
    );
    if (!cols.some((c) => c.name === column)) {
      await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  // ── Tasks columns ──────────────────────────────────────────
  await addColumnIfMissing("tasks", "start_time", "TEXT DEFAULT NULL");
  await addColumnIfMissing("tasks", "end_time", "TEXT DEFAULT NULL");
  await addColumnIfMissing("tasks", "reminder", "TEXT DEFAULT NULL");
  await addColumnIfMissing("tasks", "end_date", "TEXT DEFAULT NULL");
  await addColumnIfMissing("tasks", "calendar_event_id", "TEXT DEFAULT NULL");

  // ── Subtasks columns ───────────────────────────────────────
  await addColumnIfMissing("subtasks", "due_date", "TEXT DEFAULT NULL");
  await addColumnIfMissing("subtasks", "end_date", "TEXT DEFAULT NULL");
  await addColumnIfMissing("subtasks", "start_time", "TEXT DEFAULT NULL");
  await addColumnIfMissing("subtasks", "end_time", "TEXT DEFAULT NULL");
  await addColumnIfMissing("subtasks", "reminder", "TEXT DEFAULT NULL");
  await addColumnIfMissing("subtasks", "calendar_event_id", "TEXT DEFAULT NULL");

  // ── Projects columns ───────────────────────────────────────
  await addColumnIfMissing("projects", "calendar_deadline_id", "TEXT DEFAULT NULL");
  await addColumnIfMissing("projects", "workload_columns", "TEXT DEFAULT NULL");
  await addColumnIfMissing("projects", "workload_template_id", "INTEGER DEFAULT NULL");

  // ── Clients: postal_city + data migration ──────────────────
  const clientCols = await db.select<{ name: string }[]>(
    "SELECT name FROM pragma_table_info('clients')"
  );
  if (!clientCols.some((c) => c.name === "postal_city")) {
    await db.execute("ALTER TABLE clients ADD COLUMN postal_city TEXT NOT NULL DEFAULT ''");
    await db.execute("UPDATE clients SET postal_city = address_line2, address_line2 = '' WHERE address_line2 IS NOT NULL AND address_line2 != ''");
  }

  // ── Invoices: contact_id ───────────────────────────────────
  await addColumnIfMissing("invoices", "contact_id", "INTEGER REFERENCES client_contacts(id) ON DELETE SET NULL");

  // ── One-time data migration: client email/phone → contacts ─
  const clientsWithEmail = await db.select<{ id: string; email: string; phone: string }[]>(
    "SELECT id, email, phone FROM clients WHERE (email IS NOT NULL AND email != '') OR (phone IS NOT NULL AND phone != '')"
  );
  for (const c of clientsWithEmail) {
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
    await db.execute("UPDATE clients SET email = '', phone = '' WHERE id = $1", [c.id]);
  }

  // ── Seed default workload template if none exist ───────────
  const templateCount = await db.select<{ cnt: number }[]>(
    "SELECT COUNT(*) as cnt FROM workload_templates"
  );
  if (templateCount[0]?.cnt === 0) {
    const defaultCols = JSON.stringify([
      { key: "asset", name: "Asset", type: "text", width: 160 },
      { key: "type", name: "Type", type: "multi_select", width: 140, options: [
        { value: "Digital", color: "yellow" }, { value: "Motion", color: "purple" },
        { value: "Print", color: "orange" }, { value: "Admin", color: "pink" },
      ]},
      { key: "og_scope", name: "OG Scope", type: "checkbox", width: 80 },
      { key: "hours", name: "N of Hours", type: "number", width: 90 },
      { key: "template_type", name: "Template Type", type: "multi_select", width: 160, options: [
        { value: "Digital", color: "gray" }, { value: "Video A", color: "blue" },
        { value: "Video B", color: "purple" }, { value: "No Template Used", color: "red" },
      ]},
      { key: "qty", name: "Qty", type: "number", width: 60 },
      { key: "corr_round", name: "Corr. Round", type: "number", width: 90 },
      { key: "notes", name: "Notes", type: "text", width: 200 },
      { key: "oos_hours", name: "OoS Hours", type: "formula", width: 90, formula: "og_scope ? 0 : hours" },
      { key: "ios_hours", name: "IoS Hours", type: "formula", width: 90, formula: "og_scope ? hours : 0" },
    ]);
    await db.execute(
      "INSERT INTO workload_templates (name, columns) VALUES ($1, $2)",
      ["Workload Tracker", defaultCols]
    );
  }
}
