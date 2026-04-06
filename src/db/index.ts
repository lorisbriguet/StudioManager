import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { logError } from "../lib/log";
import { seedUserGuide } from "./seeds/user-guide";

const SAFE_FIELD = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Validate that SQL field names contain only safe characters to prevent injection */
export function validateFields(fields: string[]): void {
  for (const f of fields) {
    if (!SAFE_FIELD.test(f)) {
      throw new Error(`Invalid field name: ${f}`);
    }
  }
}

interface BatchStatement {
  sql: string;
  params: unknown[];
}

/**
 * Collect SQL statements for batch execution in a real transaction.
 * Uses a Rust-side command that opens its own connection and wraps
 * all statements in BEGIN/COMMIT, avoiding the connection-pool issue
 * with the Tauri SQL plugin where each IPC call may use a different connection.
 */
export class TransactionBatch {
  private statements: BatchStatement[] = [];

  /** Queue a SQL statement. Use $LAST_INSERT_ID to reference the last insert rowid. */
  add(sql: string, params: unknown[] = []): void {
    this.statements.push({ sql, params });
  }

  /** Execute all queued statements in a single Rust-side transaction. */
  async commit(): Promise<{ lastInsertId: number }> {
    return invoke<{ lastInsertId: number }>("execute_batch", {
      statements: this.statements,
    });
  }
}

let dbPromise: Promise<Database> | null = null;
let currentDbName = localStorage.getItem("presentationMode") === "true"
  ? "studiomanager_presentation.db"
  : localStorage.getItem("testMode") === "true"
    ? "studiomanager_test.db"
    : "studiomanager.db";

export async function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const database = await Database.load(`sqlite:${currentDbName}`);
      try {
        await ensureSchema(database);
      } catch (e) {
        logError("[DB] ensureSchema failed:", e);
      }
      return database;
    })();
  }
  return dbPromise;
}

/**
 * Switch the frontend DB connection to a different database file.
 * Closes the current connection and opens the new one.
 */
export async function seedPresentationDb(): Promise<void> {
  const db = await getDb();
  // Import seed SQL as raw text (Vite raw import)
  const seedSql = (await import("./seeds/presentation.sql?raw")).default;
  // Split on semicolons, strip comment-only lines, then execute each statement
  const statements = seedSql
    .split(";")
    .map((s: string) =>
      s
        .split("\n")
        .filter((line: string) => !line.trim().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter((s: string) => s.length > 0);
  for (const stmt of statements) {
    await db.execute(stmt + ";");
  }
}

export async function switchDb(dbName: string): Promise<void> {
  if (dbPromise) {
    try {
      const db = await dbPromise;
      await db.close();
    } catch { /* ignore close errors */ }
    dbPromise = null;
  }
  currentDbName = dbName;
  // Pre-warm the new connection
  await getDb();
}

/**
 * Reset the DB connection (e.g., after restoring a snapshot).
 * Closes and reopens with the same DB name.
 */
export async function resetDb(): Promise<void> {
  if (dbPromise) {
    try {
      const db = await dbPromise;
      await db.close();
    } catch { /* ignore close errors */ }
    dbPromise = null;
  }
  await getDb();
}

/**
 * Safety-net schema fixups that run after Rust-side migrations.
 * These handle ALTER TABLE ADD COLUMN (SQLite lacks IF NOT EXISTS for ALTER)
 * and one-time data migrations. New tables, indexes, and seeds should go in
 * numbered .sql migration files under src-tauri/migrations/ instead.
 */
async function ensureSchema(db: Database) {
  // Clean up orphan indices (indices referencing dropped tables)
  try {
    const orphans = await db.select<{ name: string; tbl_name: string }[]>(
      `SELECT i.name, i.tbl_name FROM sqlite_master i
       WHERE i.type = 'index' AND i.tbl_name NOT IN (SELECT name FROM sqlite_master WHERE type = 'table')`
    );
    for (const o of orphans) {
      await db.execute(`DROP INDEX IF EXISTS "${o.name.replace(/"/g, '""')}"`).catch(() => {});
    }
  } catch { /* ignore if schema query fails */ }

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

  // ── Business profile: QR-IBAN ────────────────────────────────
  await addColumnIfMissing("business_profile", "qr_iban", "TEXT DEFAULT ''");

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

  // ── Client addresses table + migration ───────────────────
  await db.execute(`CREATE TABLE IF NOT EXISTS client_addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    label TEXT NOT NULL DEFAULT '',
    billing_name TEXT NOT NULL DEFAULT '',
    address_line1 TEXT NOT NULL DEFAULT '',
    address_line2 TEXT NOT NULL DEFAULT '',
    postal_city TEXT NOT NULL DEFAULT ''
  )`);
  // Migrate existing client addresses into client_addresses (one-time)
  const clientsWithAddr = await db.select<{ id: string; billing_name: string; address_line1: string; address_line2: string; postal_city: string }[]>(
    "SELECT id, billing_name, address_line1, address_line2, postal_city FROM clients WHERE (address_line1 != '' OR postal_city != '') AND id NOT IN (SELECT client_id FROM client_addresses)"
  );
  for (const c of clientsWithAddr) {
    await db.execute(
      "INSERT INTO client_addresses (client_id, label, billing_name, address_line1, address_line2, postal_city) VALUES ($1, $2, $3, $4, $5, $6)",
      [c.id, "Main", c.billing_name || "", c.address_line1 || "", c.address_line2 || "", c.postal_city || ""]
    );
  }

  // ── Invoices/Quotes: billing_address_id ────────────────────
  await addColumnIfMissing("invoices", "billing_address_id", "INTEGER DEFAULT NULL");
  await addColumnIfMissing("quotes", "billing_address_id", "INTEGER DEFAULT NULL");
  await addColumnIfMissing("quotes", "converted_to_project_id", "INTEGER DEFAULT NULL");

  // ── Invoices: multi-currency columns ──────────────────────
  await addColumnIfMissing("invoices", "currency", "TEXT NOT NULL DEFAULT 'CHF'");
  await addColumnIfMissing("invoices", "exchange_rate", "REAL NOT NULL DEFAULT 1.0");
  await addColumnIfMissing("invoices", "chf_equivalent", "REAL NOT NULL DEFAULT 0");
  // Backfill chf_equivalent for existing invoices where it's 0
  await db.execute(
    "UPDATE invoices SET chf_equivalent = total WHERE chf_equivalent = 0 AND currency = 'CHF'"
  );

  // ── Income table ────────────────────────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS income (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference TEXT NOT NULL,
      date TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT 'side_income',
      source TEXT NOT NULL DEFAULT '',
      receipt_path TEXT,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // ── Resources tables ──────────────────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      price TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS resource_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      tag TEXT NOT NULL
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS resource_projects (
      resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      PRIMARY KEY (resource_id, project_id)
    )
  `);

  // ── Seed resources from Notion export (one-time) ─────────
  const resourceCount = await db.select<{ cnt: number }[]>(
    "SELECT COUNT(*) as cnt FROM resources"
  );
  if (resourceCount[0]?.cnt === 0) {
    const seedResources: { name: string; url: string; price: string; tags: string[] }[] = [
      { name: "miniEngine", url: "http://www.minie.airiclenz.com/tag/bezier/", price: "", tags: ["motor"] },
      { name: "SimpleFoc", url: "https://simplefoc.com/", price: "", tags: ["motor"] },
      { name: "Ubu", url: "https://www.ubu.com/sound/", price: "", tags: ["sound"] },
      { name: "icons8", url: "https://icons8.com/upscaler", price: "", tags: ["Upscaling"] },
      { name: "vanceAI", url: "https://vanceai.com/workspace/", price: "", tags: ["Upscaling"] },
      { name: "Wikipedia commons", url: "https://commons.wikimedia.org/", price: "", tags: ["CC Photo", "CC Video"] },
      { name: "Unsplash", url: "https://unsplash.com/fr", price: "", tags: ["CC Photo"] },
      { name: "Russian Photo", url: "https://russiainphoto.ru/", price: "", tags: ["CC Photo"] },
      { name: "Archive.gov", url: "https://catalog.archives.gov/", price: "", tags: ["CC Video"] },
      { name: "ultralibrarian", url: "https://ultralibrarian.com", price: "", tags: ["CAD"] },
      { name: "grabcad", url: "https://grabcad.com/", price: "", tags: ["CAD"] },
      { name: "web haptics", url: "https://haptics.lochie.me/", price: "free", tags: ["npm", "web"] },
      { name: "Vercel", url: "https://vercel.com/", price: "", tags: ["web"] },
      { name: "Notion Cafe", url: "https://calendar.notion.cafe/calendars", price: "", tags: ["Tools"] },
      { name: "AdobeColor", url: "https://color.adobe.com/fr/create/color-wheel", price: "", tags: ["Tools"] },
      { name: "Book Mockups", url: "https://mockups-design.com/free-book-mockups/", price: "", tags: ["Mockup"] },
      { name: "VHS look After Effect", url: "https://www.rocketstock.com/blog/create-vhs-look-after-effects/", price: "", tags: ["Tuto"] },
      { name: "Chord Generator", url: "https://chordchord.com/generator", price: "", tags: ["Music"] },
      { name: "House Of Blanks", url: "https://wholesale.houseofblanks.com/wholesale/dashboard", price: "", tags: ["merch"] },
      { name: "Rory King", url: "https://rorykingetc.com/dasickfonts", price: "free", tags: ["Type"] },
      { name: "Plain", url: "https://plain-form.com/typefaces/ready", price: "", tags: ["Type"] },
      { name: "Free Faces", url: "https://www.freefaces.gallery/", price: "free", tags: ["Type"] },
      { name: "Font of the Month", url: "https://djr.com/font-of-the-month-club#2017-08", price: "paid", tags: ["Type"] },
      { name: "Out of the Dark", url: "https://www.outofthedark.xyz/", price: "paid", tags: ["Type"] },
      { name: "Written Shape", url: "https://www.writtenshape.com/", price: "paid", tags: ["Type"] },
      { name: "Eliott Grunewald", url: "https://eliottgrunewald.xyz/typefaces/herbus", price: "paid", tags: ["Type"] },
      { name: "New Letters", url: "https://www.new-letters.de/shop/", price: "paid", tags: ["Type"] },
      { name: "Fresh Luts", url: "https://freshluts.com/", price: "paid", tags: ["video"] },
      { name: "Skew Pro", url: "https://www.goodboy.ninja/skew-pro", price: "", tags: ["AfterEffect", "plugin"] },
      { name: "React Old Icons", url: "https://gsnoopy.github.io/react-old-icons/", price: "", tags: ["Tools", "npm", "web"] },
    ];
    for (const r of seedResources) {
      await db.execute(
        "INSERT INTO resources (name, url, price) VALUES ($1, $2, $3)",
        [r.name, r.url, r.price]
      );
      const inserted = await db.select<{ id: number }[]>(
        "SELECT last_insert_rowid() as id"
      );
      const rid = inserted[0]?.id;
      if (rid) {
        for (const tag of r.tags) {
          await db.execute(
            "INSERT INTO resource_tags (resource_id, tag) VALUES ($1, $2)",
            [rid, tag]
          );
        }
      }
    }
  }

  // ── Expense category color ─────────────────────────────────
  await addColumnIfMissing("expense_categories", "color", "TEXT DEFAULT NULL");

  // ── Invoice reminder tracking ──────────────────────────────
  await addColumnIfMissing("invoices", "reminder_count", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing("invoices", "last_reminder_date", "TEXT DEFAULT NULL");

  // ── Recurring invoice templates ────────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS recurring_invoice_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      base_invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      frequency TEXT NOT NULL DEFAULT 'monthly',
      next_due TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // ── Saved filters ────────────────────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS saved_filters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page TEXT NOT NULL,
      name TEXT NOT NULL,
      filters TEXT NOT NULL DEFAULT '{}',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // ── Named Tables (custom project tables) ─────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS project_tables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT 'Untitled',
      column_config TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS project_table_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_id INTEGER NOT NULL REFERENCES project_tables(id) ON DELETE CASCADE,
      data TEXT NOT NULL DEFAULT '{}',
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `);

  // ── Modular project pages (layout_config) ────────────────
  await addColumnIfMissing("projects", "layout_config", "TEXT DEFAULT NULL");
  await addColumnIfMissing("projects", "folder_path", "TEXT DEFAULT NULL");

  // ── Planned time on tasks (for quote→project comparison) ──
  await addColumnIfMissing("tasks", "planned_minutes", "INTEGER DEFAULT NULL");

  // ── Boosted workload: time tracking + workload data on tasks ──
  await addColumnIfMissing("tasks", "tracked_minutes", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing("tasks", "workload_cells", "TEXT NOT NULL DEFAULT '{}'");
  await addColumnIfMissing("tasks", "workload_sort_order", "INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing("workload_templates", "is_system", "INTEGER NOT NULL DEFAULT 0");

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

  // Mark first template as system (protected, non-deletable)
  await db.execute(
    "UPDATE workload_templates SET is_system = 1 WHERE id = (SELECT MIN(id) FROM workload_templates) AND is_system = 0"
  );

  // ── Dashboard presets ─────────────────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS dashboard_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      layout_json TEXT NOT NULL,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  const presetCount = await db.select<{ cnt: number }[]>(
    "SELECT COUNT(*) as cnt FROM dashboard_presets"
  );
  if (presetCount[0]?.cnt === 0) {
    const builtinPresets = [
      {
        name: "Financial",
        sort_order: 0,
        layout_json: JSON.stringify({
          widgets: [
            { id: "w-chart-revenue", type: "chart-revenue" },
            { id: "w-kpi-balance", type: "kpi-balance" },
            { id: "w-expense-breakdown", type: "expense-breakdown" },
            { id: "w-monthly-comparison", type: "monthly-comparison" },
            { id: "w-recent-invoices", type: "recent-invoices" },
          ],
          layout: [
            { i: "w-chart-revenue", x: 0, y: 0, w: 8, h: 5, minW: 4, minH: 4 },
            { i: "w-kpi-balance", x: 8, y: 0, w: 4, h: 2, minW: 2, minH: 2 },
            { i: "w-expense-breakdown", x: 8, y: 2, w: 4, h: 3, minW: 2, minH: 3 },
            { i: "w-monthly-comparison", x: 0, y: 5, w: 6, h: 4, minW: 3, minH: 2 },
            { i: "w-recent-invoices", x: 6, y: 5, w: 6, h: 4, minW: 3, minH: 3 },
          ],
        }),
      },
      {
        name: "Project Manager",
        sort_order: 1,
        layout_json: JSON.stringify({
          widgets: [
            { id: "w-project-progress", type: "project-progress" },
            { id: "w-overdue-tasks", type: "overdue-tasks" },
            { id: "w-time-this-week", type: "time-this-week" },
            { id: "w-planned-vs-actual", type: "planned-vs-actual" },
            { id: "w-upcoming-deadlines", type: "upcoming-deadlines" },
          ],
          layout: [
            { i: "w-project-progress", x: 0, y: 0, w: 6, h: 4, minW: 3, minH: 3 },
            { i: "w-overdue-tasks", x: 6, y: 0, w: 6, h: 4, minW: 3, minH: 3 },
            { i: "w-time-this-week", x: 0, y: 4, w: 4, h: 4, minW: 3, minH: 3 },
            { i: "w-planned-vs-actual", x: 4, y: 4, w: 4, h: 4, minW: 3, minH: 3 },
            { i: "w-upcoming-deadlines", x: 8, y: 4, w: 4, h: 4, minW: 3, minH: 3 },
          ],
        }),
      },
      {
        name: "Time Tracker",
        sort_order: 2,
        layout_json: JSON.stringify({
          widgets: [
            { id: "w-time-this-week", type: "time-this-week" },
            { id: "w-weekly-trend", type: "weekly-trend" },
            { id: "w-top-time-consumers", type: "top-time-consumers" },
            { id: "w-billable-summary", type: "billable-summary" },
            { id: "w-project-time-distribution", type: "project-time-distribution" },
          ],
          layout: [
            { i: "w-time-this-week", x: 0, y: 0, w: 6, h: 4, minW: 3, minH: 3 },
            { i: "w-weekly-trend", x: 6, y: 0, w: 6, h: 4, minW: 3, minH: 3 },
            { i: "w-top-time-consumers", x: 0, y: 4, w: 4, h: 4, minW: 3, minH: 3 },
            { i: "w-billable-summary", x: 4, y: 4, w: 4, h: 2, minW: 2, minH: 2 },
            { i: "w-project-time-distribution", x: 8, y: 4, w: 4, h: 4, minW: 3, minH: 3 },
          ],
        }),
      },
      {
        name: "Minimal",
        sort_order: 3,
        layout_json: JSON.stringify({
          widgets: [
            { id: "w-kpi-invoiced", type: "kpi-invoiced" },
            { id: "w-kpi-balance", type: "kpi-balance" },
            { id: "w-profit-margin", type: "profit-margin" },
            { id: "w-recent-invoices", type: "recent-invoices" },
          ],
          layout: [
            { i: "w-kpi-invoiced", x: 0, y: 0, w: 4, h: 2, minW: 2, minH: 2 },
            { i: "w-kpi-balance", x: 4, y: 0, w: 4, h: 2, minW: 2, minH: 2 },
            { i: "w-profit-margin", x: 8, y: 0, w: 4, h: 2, minW: 2, minH: 2 },
            { i: "w-recent-invoices", x: 0, y: 2, w: 12, h: 5, minW: 3, minH: 3 },
          ],
        }),
      },
    ];
    for (const p of builtinPresets) {
      await db.execute(
        "INSERT INTO dashboard_presets (name, layout_json, is_builtin, sort_order) VALUES ($1, $2, 1, $3)",
        [p.name, p.layout_json, p.sort_order]
      );
    }
  }

  // ── Wiki tables ─────────────────────────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS wiki_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS wiki_articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id INTEGER REFERENCES wiki_folders(id) ON DELETE SET NULL,
      project_id INTEGER DEFAULT NULL,
      title TEXT NOT NULL DEFAULT 'Untitled',
      content TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS wiki_article_tags (
      article_id INTEGER NOT NULL REFERENCES wiki_articles(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (article_id, tag)
    )
  `);

  // ── Seed wiki user guide (one-time) ──────────────────────
  const wikiFolderCount = await db.select<{ cnt: number }[]>(
    "SELECT COUNT(*) as cnt FROM wiki_folders"
  );
  if (wikiFolderCount[0]?.cnt === 0) {
    await seedUserGuide(db);
  }

  // ── Time entries table (created by TimeTrackingPage migration) ──
  // Ensure it exists for fresh installs
  await db.execute(`
    CREATE TABLE IF NOT EXISTS time_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      description TEXT NOT NULL DEFAULT '',
      duration_minutes INTEGER NOT NULL DEFAULT 0,
      date TEXT NOT NULL,
      hourly_rate REAL DEFAULT NULL,
      invoiced INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // One-time migration: backfill time_entries from tasks.tracked_minutes
  // for tasks that have tracked time but no corresponding time_entries yet
  const tasksNeedingMigration = await db.select<{ id: number; project_id: number; tracked_minutes: number; updated_at: string }[]>(
    `SELECT t.id, t.project_id, t.tracked_minutes, t.updated_at
     FROM tasks t
     WHERE t.tracked_minutes > 0
       AND t.id NOT IN (SELECT DISTINCT task_id FROM time_entries WHERE task_id IS NOT NULL)`
  );
  for (const tt of tasksNeedingMigration) {
    const entryDate = tt.updated_at ? tt.updated_at.slice(0, 10) : new Date().toISOString().slice(0, 10);
    await db.execute(
      "INSERT INTO time_entries (task_id, project_id, duration_minutes, date, description) VALUES ($1, $2, $3, $4, $5)",
      [tt.id, tt.project_id, tt.tracked_minutes, entryDate, "Migrated from tracked_minutes"]
    );
  }

  // ── Custom Lists ─────────────────────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS custom_lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS custom_list_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id INTEGER NOT NULL REFERENCES custom_lists(id) ON DELETE CASCADE,
      value TEXT NOT NULL,
      color TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `);

  // ── Invoice templates ─────────────────────────────────────
  await db.execute(`
    CREATE TABLE IF NOT EXISTS invoice_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      accent_color TEXT NOT NULL DEFAULT '#1a1a1a',
      font_family TEXT NOT NULL DEFAULT 'Helvetica',
      logo_position TEXT NOT NULL DEFAULT 'left',
      margins_top REAL NOT NULL DEFAULT 35,
      margins_right REAL NOT NULL DEFAULT 50,
      margins_bottom REAL NOT NULL DEFAULT 35,
      margins_left REAL NOT NULL DEFAULT 50,
      show_notes INTEGER NOT NULL DEFAULT 1,
      show_project_name INTEGER NOT NULL DEFAULT 1,
      show_po_number INTEGER NOT NULL DEFAULT 1,
      show_bank_details INTEGER NOT NULL DEFAULT 1,
      show_qr_bill INTEGER NOT NULL DEFAULT 1,
      show_footer INTEGER NOT NULL DEFAULT 1,
      columns TEXT NOT NULL DEFAULT '["designation","rate","unit","qty","amount"]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  // Seed default template (one-time) — values must match InvoicePDF hardcoded defaults
  await db.execute(
    `INSERT INTO invoice_templates (
       name, is_default,
       accent_color, font_family, logo_position,
       margins_top, margins_right, margins_bottom, margins_left,
       show_notes, show_project_name, show_po_number,
       show_bank_details, show_qr_bill, show_footer,
       columns
     )
     SELECT
       'Default', 1,
       '#1a1a1a', 'Helvetica', 'left',
       35, 50, 35, 50,
       1, 1, 1,
       1, 1, 1,
       '["designation","rate","unit","qty","amount"]'
     WHERE NOT EXISTS (SELECT 1 FROM invoice_templates)`
  );
  // Add template_id to invoices and quotes
  await addColumnIfMissing("invoices", "template_id", "INTEGER REFERENCES invoice_templates(id) ON DELETE SET NULL");
  await addColumnIfMissing("quotes", "template_id", "INTEGER REFERENCES invoice_templates(id) ON DELETE SET NULL");

  // ── Migrate workload_rows → tasks (one-time) ─────────────
  const hasWorkloadRows = await db.select<{ cnt: number }[]>(
    "SELECT COUNT(*) as cnt FROM workload_rows"
  ).catch(() => [{ cnt: 0 }]); // table may not exist yet
  if (hasWorkloadRows[0]?.cnt > 0) {
    const wRows = await db.select<{
      id: number; project_id: number; task_id: number | null;
      cells: string; sort_order: number;
    }[]>("SELECT id, project_id, task_id, cells, sort_order FROM workload_rows");
    for (const wr of wRows) {
      if (wr.task_id) {
        // Linked row — copy cells to existing task
        await db.execute(
          "UPDATE tasks SET workload_cells = $1, workload_sort_order = $2 WHERE id = $3 AND workload_cells = '{}'",
          [wr.cells, wr.sort_order, wr.task_id]
        );
      } else {
        // Unlinked row — create a task
        await db.execute(
          `INSERT INTO tasks (project_id, title, description, status, priority, sort_order, workload_cells, workload_sort_order)
           VALUES ($1, 'Untitled', '', 'todo', 'low', 0, $2, $3)`,
          [wr.project_id, wr.cells, wr.sort_order]
        );
      }
    }
    // Clear migrated rows so this doesn't run again
    await db.execute("DELETE FROM workload_rows");
  }
}
