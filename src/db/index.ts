import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { exit } from "@tauri-apps/plugin-process";
import { logError } from "../lib/log";
import { getLabels } from "../lib/notify";
import { todayLocalISO } from "../utils/localDate";
import { seedUserGuide } from "./seeds/user-guide";
import { seedPersona } from "./seeds/personas";
import { useOrgStore } from "../stores/org-store";

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

  /**
   * `expectedOrg`: Rust refuses the batch unless that organisation is still
   * the active one, so a write started before a switch can't land in the next.
   */
  constructor(
    private readonly expectedOrg?: string,
    /** Organisation whose database takes the batch (borrowed equipment); absent = the open one. */
    private readonly targetOrg?: string | null,
  ) {}

  /** Queue a SQL statement. Use $LAST_INSERT_ID to reference the last insert rowid. */
  add(sql: string, params: unknown[] = []): void {
    this.statements.push({ sql, params });
  }

  /** Execute all queued statements in a single Rust-side transaction. */
  async commit(): Promise<{ lastInsertId: number }> {
    return invoke<{ lastInsertId: number }>("execute_batch", {
      statements: this.statements,
      expectedOrg: this.expectedOrg,
      targetOrg: this.targetOrg ?? undefined,
    });
  }
}

let dbPromise: Promise<Database> | null = null;
let currentDbName = localStorage.getItem("presentationMode") === "true"
  ? "studiomanager_presentation.db"
  : localStorage.getItem("testMode") === "true"
    ? "studiomanager_test.db"
    : "studiomanager.db";

let dbFatalShown = false;

/**
 * Render a full-screen fatal error overlay directly into the DOM.
 * getDb() is first called from async code (React Query hooks, startup
 * hooks), so a schema-migration failure never reaches the React
 * ErrorBoundary — this guard makes it visibly fatal regardless.
 */
export function showFatalDbError(err: unknown): void {
  if (dbFatalShown) return;
  dbFatalShown = true;
  try {
    const t = getLabels();
    const overlay = document.createElement("div");
    overlay.className = "db-fatal";
    // Its own stylesheet, so it follows the system's dark mode even when the
    // app's tokens never loaded (this can fire before the first render).
    const style = document.createElement("style");
    style.textContent =
      ".db-fatal{position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:32px;text-align:center;background:#fff;color:#111;font-family:system-ui,-apple-system,sans-serif;}" +
      ".db-fatal .db-fatal-detail{color:#666;}" +
      "@media (prefers-color-scheme: dark){.db-fatal{background:#111;color:#e5e5e5;}.db-fatal .db-fatal-detail{color:#a3a3a3;}}";
    overlay.appendChild(style);
    const title = document.createElement("h1");
    title.textContent = t.page_error_title;
    title.setAttribute("style", "font-size:16px;font-weight:600;margin:0;");
    const raw = err instanceof Error ? err.message : String(err);
    // Rust's require_org_data: the data is on a disk that is not connected.
    const missing = raw.match(/^data folder missing: ([^\n]+)/);
    // Rust's migrate_db: an older app must not write to a newer schema.
    const newer = raw.startsWith("database newer than this app: ");
    const message = document.createElement("p");
    message.textContent = missing
      ? t.db_data_missing.replace("{path}", missing[1])
      : newer
        ? t.db_newer_than_app
        : t.db_init_failed;
    message.setAttribute("style", "font-size:13px;max-width:480px;margin:0;");
    const detail = document.createElement("p");
    detail.textContent = missing ? raw.slice(missing[0].length).trim() : raw;
    detail.className = "db-fatal-detail";
    detail.setAttribute("style", "font-size:12px;max-width:480px;margin:0;word-break:break-word;");
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = t.retry;
    retry.setAttribute("style", "margin-top:8px;padding:6px 14px;font:inherit;font-size:13px;border-radius:6px;border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer;");
    // Rust saved the startup error at launch: have it run the startup again
    // first, then reload, since the screens' queries have already failed.
    // ensureSchema is safe to re-run after it stopped partway.
    retry.addEventListener("click", () => {
      retry.disabled = true;
      void invoke("retry_init")
        .catch((e) => logError("[DB] retry_init failed:", e))
        .finally(() => window.location.reload());
    });
    const quit = document.createElement("button");
    quit.type = "button";
    quit.textContent = t.quit_app;
    quit.setAttribute("style", retry.getAttribute("style")!);
    quit.addEventListener("click", () => void exit(0));
    const actions = document.createElement("div");
    actions.setAttribute("style", "display:flex;gap:8px;");
    actions.append(retry, quit);
    overlay.append(title, message, detail, actions);
    overlay.setAttribute("role", "alert");
    overlay.tabIndex = -1;
    document.body.appendChild(overlay);
    overlay.focus();
  } catch {
    // Never mask the original error because the overlay itself failed
  }
}

/** SQL plugin connection string for a database file of the active organisation. */
export function dbUrlFor(name: string): string {
  const id = useOrgStore.getState().activeId;
  return id ? `sqlite:orgs/${id}/${name}` : `sqlite:${name}`;
}

/**
 * The organisation whose machines and consumables the open one uses, or null
 * when it keeps its own. Never set in test or presentation mode, which stay
 * on their own copy.
 */
export function equipmentOrgId(): string | null {
  if (currentDbName !== "studiomanager.db") return null;
  const org = useOrgStore.getState();
  const from = org.activePrefs()?.equipmentFrom;
  if (!from || from === org.activeId) return null;
  return org.organisations.some((o) => o.id === from) ? from : null;
}

let equipmentDb: { orgId: string; promise: Promise<Database> } | null = null;

/** Database holding the machines, upkeep and consumables for the open organisation. */
export async function getEquipmentDb(): Promise<Database> {
  const orgId = equipmentOrgId();
  if (!orgId) return getDb();
  if (equipmentDb?.orgId !== orgId) {
    // Only the open organisation is migrated at startup: bring the lender up to date first.
    const promise = invoke("prepare_equipment_org", { id: orgId })
      .then(() => Database.load(`sqlite:orgs/${orgId}/studiomanager.db`));
    equipmentDb = { orgId, promise };
    equipmentDb.promise.catch(() => { equipmentDb = null; });
  }
  return equipmentDb.promise;
}

/** Drop the borrowed connection (organisation switch, or the setting changed). */
export async function closeEquipmentDb(): Promise<void> {
  const current = equipmentDb;
  equipmentDb = null;
  if (!current) return;
  try {
    await (await current.promise).close();
  } catch { /* ignore close errors */ }
}

export async function getDb(): Promise<Database> {
  if (!dbPromise) {
    const opening = (async () => {
      // Dev only: a hot reload can re-run the organisation store behind OrgGate,
      // leaving no active organisation, and dbUrlFor would then open (and create)
      // an empty file at the data-folder root. Reload the registry first.
      // The built app never gets here without one: OrgGate loads it before any query.
      if (import.meta.env.MODE === "development" && !useOrgStore.getState().activeId) {
        await useOrgStore.getState().load();
      }
      const database = await Database.load(dbUrlFor(currentDbName));
      try {
        await ensureSchema(database);
      } catch (e) {
        // Do NOT continue on a half-migrated schema: surface fatally and
        // rethrow so every getDb() caller rejects.
        logError("[DB] ensureSchema failed:", e);
        showFatalDbError(e);
        throw e instanceof Error ? e : new Error(String(e));
      }
      return database;
    })();
    // Don't keep a failure: a busy database at startup must not stay broken
    // until a restart. The next getDb() (or the overlay's Retry) opens again.
    opening.catch(() => { if (dbPromise === opening) dbPromise = null; });
    dbPromise = opening;
  }
  return dbPromise;
}

/**
 * Switch the frontend DB connection to a different database file.
 * Closes the current connection and opens the new one.
 */
export async function seedPresentationDb(): Promise<void> {
  const db = await getDb();
  // Presentation mode keeps the owner's configuration: data layer only.
  await seedPersona(db, "designer", { withConfig: false });
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
 * Close the connection without reopening it. The organisation switch closes
 * here BEFORE asking Rust to move the active organisation (spec §4), so the
 * old database is never held open across the swap; it reopens with getDb()
 * once the new organisation is live.
 */
export async function closeDb(): Promise<void> {
  await closeEquipmentDb();
  if (!dbPromise) return;
  try {
    const db = await dbPromise;
    await db.close();
  } catch { /* ignore close errors */ }
  dbPromise = null;
}

/**
 * Reset the DB connection (e.g., after restoring a snapshot).
 * Closes and reopens with the same DB name.
 */
export async function resetDb(): Promise<void> {
  await closeDb();
  await getDb();
}

/**
 * Starter rows and data repairs that run after the Rust migrations. The schema
 * itself (tables, columns, indexes) lives in the numbered migrations under
 * src-tauri/migrations/ only: 014 took over what this function used to create.
 *
 * Seed data and the address copy run once per database file, recorded in
 * `meta` (seedOnce / markDone), so what the user deletes stays deleted. The
 * other repairs are cheap and run at every start: new clients still arrive
 * with an email on the client row (app and MCP), and a CSV restore brings
 * back rows without `meta`.
 */
async function ensureSchema(db: Database) {
  const metaRows = await db.select<{ key: string; value: string }[]>("SELECT key, value FROM meta");

  // ── One-time steps ─────────────────────────────────────────
  // Migration 014 noted which seeded tables the file had before it ran
  // (`before_014:<table>`). None: the app never opened this file, so its
  // seeds are due.
  const doneSteps = new Set(metaRows.map((r) => r.key));
  const hadBefore014 = (table: string) => doneSteps.has(`before_014:${table}`);
  const firstOpen = !hadBefore014("client_addresses");
  /** Tables created by the app before migration 014 (the others come from older migrations). */
  const APP_SEEDED = new Set(["resources", "dashboard_presets", "wiki_folders", "invoice_templates"]);
  const markDone = (key: string) =>
    db.execute("INSERT OR IGNORE INTO meta (key, value) VALUES ($1, '1')", [key]);
  /** Fill `table` with its starter rows, once. On a file the app opened
   *  before, a table that already existed was seeded back then (the old
   *  code seeded it whenever it was empty), so it's only marked as done. */
  async function seedOnce(key: string, table: string, seed: () => Promise<void>) {
    if (doneSteps.has(key)) return;
    if (firstOpen || (APP_SEEDED.has(table) && !hadBefore014(table))) {
      const rows = await db.select<{ cnt: number }[]>(`SELECT COUNT(*) as cnt FROM ${table}`);
      if (rows[0]?.cnt === 0) await seed();
    }
    await markDone(key);
  }

  // ── Client email/phone → contacts (new clients still arrive with them) ─
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

  // ── Client addresses (one-time copy) ───────────────────────
  // Copy each client's own address into client_addresses as "Main" (one-time).
  // New clients get their row from createClient; deleting that row clears the
  // client's own address (deleteClientAddress), so it can't come back.
  if (!doneSteps.has("moved:client_addresses")) {
    const clientsWithAddr = await db.select<{ id: string; billing_name: string; address_line1: string; address_line2: string; postal_city: string }[]>(
      "SELECT id, billing_name, address_line1, address_line2, postal_city FROM clients WHERE (address_line1 != '' OR postal_city != '') AND id NOT IN (SELECT client_id FROM client_addresses)"
    );
    for (const c of clientsWithAddr) {
      await db.execute(
        "INSERT INTO client_addresses (client_id, label, billing_name, address_line1, address_line2, postal_city) VALUES ($1, $2, $3, $4, $5, $6)",
        [c.id, "Main", c.billing_name || "", c.address_line1 || "", c.address_line2 || "", c.postal_city || ""]
      );
    }
    await markDone("moved:client_addresses");
  }

  // ── Invoices: chf_equivalent for CHF invoices that have none ──
  // Backfill chf_equivalent for existing invoices where it's 0
  await db.execute(
    "UPDATE invoices SET chf_equivalent = total WHERE chf_equivalent = 0 AND currency = 'CHF'"
  );

  // ── Seed resources from Notion export (one-time) ─────────
  await seedOnce("seeded:resources", "resources", async () => {
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
  });

  // ── Seed default workload template (one-time) ─────────────
  await seedOnce("seeded:workload_templates", "workload_templates", async () => {
    // Keep in sync with DEFAULT_WORKLOAD_COLUMNS (src/types/workload.ts); differs only in asset type "text" vs "link".
    const defaultCols = JSON.stringify([
      { key: "asset", name: "Asset", type: "text", width: 160 },
      { key: "type", name: "Type", type: "multi_select", width: 140, options: [
        { value: "Digital", color: "yellow" }, { value: "Motion", color: "purple" },
        { value: "Print", color: "orange" }, { value: "Admin", color: "red" },
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
  });

  // Mark first template as system (protected, non-deletable)
  await db.execute(
    "UPDATE workload_templates SET is_system = 1 WHERE id = (SELECT MIN(id) FROM workload_templates) AND is_system = 0"
  );

  // ── Dashboard presets ─────────────────────────────────────
  await seedOnce("seeded:dashboard_presets", "dashboard_presets", async () => {
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
  });

  // ── Seed wiki user guide (one-time) ──────────────────────
  await seedOnce("seeded:wiki_guide", "wiki_folders", () => seedUserGuide(db));

  // ── Time entries from tasks.tracked_minutes ────────────────

  // One-time migration: backfill time_entries from tasks.tracked_minutes
  // for tasks that have tracked time but no corresponding time_entries yet
  const tasksNeedingMigration = await db.select<{ id: number; project_id: number; tracked_minutes: number; updated_at: string }[]>(
    `SELECT t.id, t.project_id, t.tracked_minutes, t.updated_at
     FROM tasks t
     WHERE t.tracked_minutes > 0
       AND t.id NOT IN (SELECT DISTINCT task_id FROM time_entries WHERE task_id IS NOT NULL)`
  );
  for (const tt of tasksNeedingMigration) {
    const entryDate = tt.updated_at ? tt.updated_at.slice(0, 10) : todayLocalISO();
    await db.execute(
      "INSERT INTO time_entries (task_id, project_id, duration_minutes, date, description) VALUES ($1, $2, $3, $4, $5)",
      [tt.id, tt.project_id, tt.tracked_minutes, entryDate, "Migrated from tracked_minutes"]
    );
  }

  // Seed default template (one-time) — values must match InvoicePDF hardcoded defaults
  await seedOnce("seeded:invoice_templates", "invoice_templates", async () => {
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
  });
  // Add template_id to invoices and quotes

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

  // ── Legacy bundle-identifier path migration ────────────────
  // Files written before the identifier change (ch.lorisbriguet.studiomanager
  // → ch.studiomanager.app) were migrated on disk, but the stored ABSOLUTE
  // paths were not — leaving receipts/PDFs unresolvable. Idempotent rewrite;
  // also heals databases restored from pre-rename backups.
  await db.execute(
    `UPDATE expenses SET receipt_path = REPLACE(receipt_path, '/ch.lorisbriguet.studiomanager/', '/ch.studiomanager.app/')
     WHERE receipt_path LIKE '%/ch.lorisbriguet.studiomanager/%'`
  ).catch((e) => logError("[DB] receipt path migration failed:", e));
  await db.execute(
    `UPDATE income SET receipt_path = REPLACE(receipt_path, '/ch.lorisbriguet.studiomanager/', '/ch.studiomanager.app/')
     WHERE receipt_path LIKE '%/ch.lorisbriguet.studiomanager/%'`
  ).catch((e) => logError("[DB] income receipt path migration failed:", e));
  await db.execute(
    `UPDATE invoices SET pdf_path = REPLACE(pdf_path, '/ch.lorisbriguet.studiomanager/', '/ch.studiomanager.app/')
     WHERE pdf_path LIKE '%/ch.lorisbriguet.studiomanager/%'`
  ).catch((e) => logError("[DB] invoice pdf path migration failed:", e));
}
