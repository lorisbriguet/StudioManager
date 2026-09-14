/**
 * Static validation of the presentation-mode seed.
 *
 * The seed runs against a copy of the production DB, so a stale column name
 * or enum value only surfaces at demo time. These tests parse the SQL the same
 * way the loader does and check it against the live schema, the current enum
 * sets, and the internal invariants the app maintains at runtime.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import seedSql from "../db/seeds/presentation.sql?raw";
import { splitSeedStatements } from "../db/seeds/splitSql";
import { seedPresentationDb } from "../db";
import { executedStatements, clearExecutedStatements } from "../__mocks__/tauri-sql";

vi.mock("../db/seeds/user-guide", () => ({
  seedUserGuide: vi.fn(async () => {}),
}));
import { seedUserGuide } from "../db/seeds/user-guide";

// ── Schema snapshot (mirrors PRAGMA table_info on the production DB) ──────

const SCHEMA: Record<string, string[]> = {
  clients: ["id", "name", "address_line1", "address_line2", "email", "phone", "language", "has_discount", "discount_rate", "notes", "created_at", "updated_at", "billing_name", "postal_city"],
  client_contacts: ["id", "client_id", "first_name", "last_name", "email", "phone", "role"],
  client_addresses: ["id", "client_id", "label", "billing_name", "address_line1", "address_line2", "postal_city"],
  projects: ["id", "client_id", "name", "description", "status", "start_date", "deadline", "notes", "created_at", "updated_at", "calendar_deadline_id", "workload_columns", "workload_template_id", "layout_config", "folder_path"],
  tasks: ["id", "project_id", "title", "description", "status", "priority", "due_date", "scheduled_start", "scheduled_end", "calendar_event_id", "notes", "sort_order", "created_at", "updated_at", "start_time", "end_time", "reminder", "end_date", "planned_minutes", "tracked_minutes", "workload_cells", "workload_sort_order"],
  subtasks: ["id", "task_id", "title", "status", "due_date", "sort_order", "created_at", "updated_at", "start_time", "end_time", "reminder", "end_date", "calendar_event_id"],
  invoices: ["id", "reference", "client_id", "project_id", "status", "language", "activity", "assignment", "invoice_date", "due_date", "payment_terms_days", "subtotal", "discount_applied", "discount_rate", "discount_label", "total", "paid_date", "pdf_path", "from_quote_id", "notes", "created_at", "updated_at", "po_number", "contact_id", "billing_address_id", "currency", "exchange_rate", "chf_equivalent", "reminder_count", "last_reminder_date", "template_id", "activity_id"],
  invoice_line_items: ["id", "invoice_id", "designation", "rate", "unit", "quantity", "amount", "sort_order"],
  quotes: ["id", "reference", "client_id", "project_id", "status", "language", "activity", "assignment", "quote_date", "valid_until", "subtotal", "discount_applied", "discount_rate", "total", "converted_to_invoice_id", "notes", "created_at", "updated_at", "billing_address_id", "converted_to_project_id", "template_id", "activity_id"],
  quote_line_items: ["id", "quote_id", "designation", "rate", "unit", "quantity", "amount", "sort_order"],
  expenses: ["id", "reference", "supplier", "category_code", "invoice_date", "due_date", "amount", "paid_date", "receipt_path", "notes", "created_at", "updated_at"],
  income: ["id", "reference", "date", "description", "amount", "category", "source", "receipt_path", "notes", "created_at", "updated_at"],
  resources: ["id", "name", "url", "price", "created_at", "updated_at"],
  resource_tags: ["id", "resource_id", "tag"],
  resource_projects: ["resource_id", "project_id"],
  recurring_invoice_templates: ["id", "base_invoice_id", "client_id", "frequency", "next_due", "active", "created_at", "updated_at"],
  time_entries: ["id", "project_id", "task_id", "description", "duration_minutes", "date", "hourly_rate", "invoiced", "created_at", "updated_at"],
  project_tables: ["id", "project_id", "name", "column_config", "sort_order", "created_at"],
  project_table_rows: ["id", "table_id", "data", "sort_order"],
  wiki_folders: ["id", "name", "sort_order", "created_at"],
  wiki_articles: ["id", "folder_id", "project_id", "title", "content", "sort_order", "created_at", "updated_at"],
  wiki_article_tags: ["article_id", "tag"],
};

/** Tables that hold personal data and must be wiped before the demo rows go in. */
const MUST_CLEAR = [
  "clients", "client_contacts", "client_addresses", "projects", "tasks", "subtasks",
  "invoices", "invoice_line_items", "quotes", "quote_line_items", "expenses", "income",
  "resources", "resource_tags", "resource_projects", "recurring_invoice_templates",
  "time_entries", "project_tables", "project_table_rows", "workload_rows",
  "wiki_articles", "wiki_article_tags", "wiki_folders", "custom_lists", "custom_list_items",
  "notifications", "saved_filters",
];

/** Configuration tables that belong to the user and must survive the seed. */
const MUST_KEEP = ["business_profile", "expense_categories", "activities", "dashboard_presets", "invoice_templates", "workload_templates"];

const ENUMS: Record<string, Record<string, string[]>> = {
  projects: { status: ["active", "completed", "on_hold", "cancelled"] },
  tasks: { status: ["todo", "done"], priority: ["low", "medium", "high"] },
  subtasks: { status: ["todo", "done"] },
  invoices: { status: ["draft", "sent", "paid", "overdue", "cancelled"], language: ["FR", "EN"], currency: ["CHF"] },
  quotes: { status: ["draft", "sent", "accepted", "rejected", "expired"], language: ["FR", "EN"] },
  invoice_line_items: { unit: ["hours", "days", "units", "flat"] },
  quote_line_items: { unit: ["hours", "days", "units", "flat"] },
  clients: { language: ["FR", "EN"] },
  expenses: { category_code: ["AM", "FA", "FD", "FR", "LO", "CS"] },
  income: { category: ["side_income", "grant", "refund", "interest", "other"] },
  recurring_invoice_templates: { frequency: ["monthly", "quarterly", "yearly"] },
};

const REFERENCE_FORMATS: Record<string, RegExp> = {
  invoices: /^(\d{4}-\d{3}|DRAFT-.+)$/,
  quotes: /^D-\d{4}-\d{3}$/,
  expenses: /^F-\d{2}-\d{3}$/,
  income: /^R-\d{2}-\d{3}$/,
};

/** Columns that hold calendar dates and must be expressed relative to today. */
const DATE_COLUMNS: Record<string, string[]> = {
  projects: ["start_date", "deadline"],
  tasks: ["due_date", "end_date"],
  subtasks: ["due_date", "end_date"],
  invoices: ["invoice_date", "due_date", "paid_date", "last_reminder_date"],
  quotes: ["quote_date", "valid_until"],
  expenses: ["invoice_date", "due_date", "paid_date"],
  income: ["date"],
  time_entries: ["date"],
  recurring_invoice_templates: ["next_due"],
};

// ── Minimal SQL value parser ─────────────────────────────────────────────

type Expr = { expr: string };
type Value = string | number | null | Expr;
type Row = Record<string, Value>;

function isExpr(v: Value): v is Expr {
  return typeof v === "object" && v !== null && "expr" in v;
}

function parseScalar(raw: string): Value {
  const s = raw.trim();
  if (/^NULL$/i.test(s)) return null;
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return { expr: s };
}

/** Splits `(a, b), (c, d)` into tuples, respecting quotes and nested parens. */
function parseTuples(src: string): Value[][] {
  const tuples: Value[][] = [];
  let depth = 0;
  let inString = false;
  let current: string[] = [];
  let buf = "";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      buf += ch;
      if (ch === "'") {
        if (src[i + 1] === "'") { buf += "'"; i++; } else inString = false;
      }
      continue;
    }
    if (ch === "'") { inString = true; buf += ch; continue; }
    if (ch === "(") {
      depth++;
      if (depth === 1) { current = []; buf = ""; continue; }
    }
    if (ch === ")") {
      depth--;
      if (depth === 0) { current.push(buf); tuples.push(current.map(parseScalar)); buf = ""; continue; }
    }
    if (ch === "," && depth === 1) { current.push(buf); buf = ""; continue; }
    if (depth >= 1) buf += ch;
  }
  return tuples;
}

interface Insert { table: string; columns: string[]; rows: Row[] }

function parseInserts(statements: string[]): Insert[] {
  const inserts: Insert[] = [];
  for (const stmt of statements) {
    const m = stmt.match(/^INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(\w+)\s*\(([^)]*)\)\s*VALUES\s*([\s\S]*)$/i);
    if (!m) continue;
    const columns = m[2].split(",").map((c) => c.trim());
    const rows = parseTuples(m[3]).map((tuple) => {
      expect(tuple.length, `column/value count mismatch in ${m[1]}`).toBe(columns.length);
      return Object.fromEntries(columns.map((c, i) => [c, tuple[i]])) as Row;
    });
    inserts.push({ table: m[1], columns, rows });
  }
  return inserts;
}

const statements = splitSeedStatements(seedSql);
const inserts = parseInserts(statements);
const rowsOf = (table: string): Row[] => inserts.filter((i) => i.table === table).flatMap((i) => i.rows);
const idsOf = (table: string, col = "id"): Set<Value> => new Set(rowsOf(table).map((r) => r[col]));

// ── Tests ────────────────────────────────────────────────────────────────

describe("presentation seed — structure", () => {
  it("contains only PRAGMA, DELETE, INSERT and UPDATE statements", () => {
    for (const s of statements) {
      expect(s, s.slice(0, 60)).toMatch(/^(PRAGMA|DELETE FROM|INSERT INTO|UPDATE)\b/i);
    }
  });

  it("only inserts into known columns", () => {
    for (const ins of inserts) {
      expect(SCHEMA, `unknown table ${ins.table}`).toHaveProperty(ins.table);
      for (const col of ins.columns) {
        expect(SCHEMA[ins.table], `${ins.table}.${col} does not exist`).toContain(col);
      }
    }
  });

  it("clears every personal-data table before inserting", () => {
    const cleared = statements
      .map((s) => s.match(/^DELETE FROM (\w+)/i)?.[1])
      .filter((t): t is string => !!t);
    for (const t of MUST_CLEAR) expect(cleared, `${t} is not cleared`).toContain(t);
    const firstInsert = statements.findIndex((s) => /^INSERT/i.test(s));
    const lastDelete = statements.map((s) => /^DELETE/i.test(s)).lastIndexOf(true);
    expect(lastDelete).toBeLessThan(firstInsert);
  });

  it("resets autoincrement counters so demo ids are stable", () => {
    expect(statements.some((s) => /^DELETE FROM sqlite_sequence/i.test(s))).toBe(true);
  });

  it("never touches user configuration tables", () => {
    for (const s of statements) {
      for (const t of MUST_KEEP) {
        expect(s, `statement touches ${t}`).not.toMatch(new RegExp(`\\b(DELETE FROM|INSERT INTO)\\s+${t}\\b`, "i"));
      }
    }
  });
});

describe("presentation seed — values match the current app", () => {
  it("uses only current enum values", () => {
    for (const [table, cols] of Object.entries(ENUMS)) {
      for (const row of rowsOf(table)) {
        for (const [col, allowed] of Object.entries(cols)) {
          if (!(col in row)) continue;
          expect(allowed, `${table}.${col} = ${JSON.stringify(row[col])}`).toContain(row[col]);
        }
      }
    }
  });

  it("uses the reference formats the generators produce", () => {
    for (const [table, re] of Object.entries(REFERENCE_FORMATS)) {
      const rows = rowsOf(table);
      expect(rows.length, `${table} has no rows`).toBeGreaterThan(0);
      for (const row of rows) expect(String(row.reference), `${table}.reference`).toMatch(re);
    }
  });

  it("renumbers references per year from each row's own date, like the generators do", () => {
    const updates = statements.filter((s) => /^UPDATE/i.test(s));
    // SQLite's strftime has no two-digit-year format, so short years must use substr.
    for (const [table, yearExpr] of [
      ["invoices", "strftime('%Y', invoice_date)"],
      ["quotes", "strftime('%Y', quote_date)"],
      ["expenses", "substr(strftime('%Y', invoice_date), 3, 2)"],
      ["income", "substr(strftime('%Y', date), 3, 2)"],
    ]) {
      const u = updates.find((s) => new RegExp(`^UPDATE ${table}\\s+SET reference`, "i").test(s));
      expect(u, `no reference renumbering for ${table}`).toBeDefined();
      expect(u).toContain(yearExpr);
      expect(u, `${table} uses unsupported %y`).not.toContain("%y");
      expect(u).toMatch(/printf\('%03d'/);
    }
    // Drafts keep their DRAFT- placeholder
    const inv = updates.find((s) => /^UPDATE invoices\s+SET reference/i.test(s))!;
    expect(inv).toMatch(/WHERE reference NOT LIKE 'DRAFT-%'/);
  });

  it("expresses every date relative to today, never as a literal", () => {
    expect(seedSql).not.toMatch(/'\d{4}-\d{2}-\d{2}/);
    for (const [table, cols] of Object.entries(DATE_COLUMNS)) {
      for (const row of rowsOf(table)) {
        for (const col of cols) {
          const v = row[col];
          if (v === undefined || v === null) continue;
          expect(isExpr(v) && /date\('now'/.test(v.expr), `${table}.${col} = ${JSON.stringify(v)}`).toBe(true);
        }
      }
    }
  });

  it("links invoices and quotes to an activity entity via subquery", () => {
    for (const table of ["invoices", "quotes"]) {
      for (const row of rowsOf(table)) {
        const v = row.activity_id;
        expect(isExpr(v) && /SELECT id FROM activities/i.test(v.expr), `${table} ${row.reference}`).toBe(true);
      }
    }
  });
});

describe("presentation seed — referential integrity", () => {
  const fk = (child: string, col: string, parent: string, parentCol = "id", nullable = false) => {
    it(`${child}.${col} points at a seeded ${parent}`, () => {
      const parents = idsOf(parent, parentCol);
      for (const row of rowsOf(child)) {
        const v = row[col];
        if (nullable && (v === null || v === undefined)) continue;
        expect(parents, `${child}.${col} = ${JSON.stringify(v)}`).toContain(v);
      }
    });
  };
  fk("client_contacts", "client_id", "clients");
  fk("client_addresses", "client_id", "clients");
  fk("projects", "client_id", "clients");
  fk("tasks", "project_id", "projects");
  fk("subtasks", "task_id", "tasks");
  fk("invoices", "client_id", "clients");
  fk("invoices", "project_id", "projects", "id", true);
  fk("invoice_line_items", "invoice_id", "invoices");
  fk("quotes", "client_id", "clients");
  fk("quotes", "project_id", "projects", "id", true);
  fk("quotes", "converted_to_project_id", "projects", "id", true);
  fk("quote_line_items", "quote_id", "quotes");
  fk("resource_tags", "resource_id", "resources");
  fk("resource_projects", "resource_id", "resources");
  fk("resource_projects", "project_id", "projects");
  fk("recurring_invoice_templates", "base_invoice_id", "invoices");
  fk("recurring_invoice_templates", "client_id", "clients");
  fk("time_entries", "project_id", "projects");
  fk("time_entries", "task_id", "tasks", "id", true);
  fk("project_tables", "project_id", "projects");
  fk("project_table_rows", "table_id", "project_tables");
  fk("wiki_articles", "folder_id", "wiki_folders", "id", true);
  fk("wiki_articles", "project_id", "projects", "id", true);
  fk("wiki_article_tags", "article_id", "wiki_articles");

  it("time entries belong to the same project as their task", () => {
    const taskProject = new Map(rowsOf("tasks").map((t) => [t.id, t.project_id]));
    for (const te of rowsOf("time_entries")) {
      if (te.task_id === null) continue;
      expect(taskProject.get(te.task_id), `time entry on task ${te.task_id}`).toBe(te.project_id);
    }
  });

  it("invoices bill the client that owns the linked project", () => {
    const projectClient = new Map(rowsOf("projects").map((p) => [p.id, p.client_id]));
    for (const inv of rowsOf("invoices")) {
      if (inv.project_id === null) continue;
      expect(projectClient.get(inv.project_id), `invoice ${inv.reference}`).toBe(inv.client_id);
    }
  });
});

describe("presentation seed — runtime invariants the app maintains", () => {
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const lineItemsConsistent = (docTable: string, itemTable: string, fkCol: string) => {
    it(`${itemTable} amounts and ${docTable} totals add up`, () => {
      const items = rowsOf(itemTable);
      for (const it of items) {
        expect(it.amount, `${itemTable} "${it.designation}"`).toBe(round2(Number(it.quantity) * Number(it.rate)));
      }
      for (const doc of rowsOf(docTable)) {
        const sum = round2(items.filter((i) => i[fkCol] === doc.id).reduce((a, i) => a + Number(i.amount), 0));
        expect(doc.subtotal, `${docTable} ${doc.reference} subtotal`).toBe(sum);
        const expectedTotal = doc.discount_applied === 1 ? round2(sum * (1 - Number(doc.discount_rate))) : sum;
        expect(doc.total, `${docTable} ${doc.reference} total`).toBe(expectedTotal);
      }
    });
  };
  lineItemsConsistent("invoices", "invoice_line_items", "invoice_id");
  lineItemsConsistent("quotes", "quote_line_items", "quote_id");

  it("CHF invoices carry chf_equivalent equal to total", () => {
    for (const inv of rowsOf("invoices")) {
      expect(inv.chf_equivalent, `invoice ${inv.reference}`).toBe(inv.total);
      expect(inv.exchange_rate).toBe(1);
    }
  });

  it("discounted invoices go to clients flagged for the cultural discount", () => {
    const discountClients = new Set(rowsOf("clients").filter((c) => c.has_discount === 1).map((c) => c.id));
    expect(discountClients.size).toBeGreaterThan(0);
    for (const inv of rowsOf("invoices")) {
      if (inv.discount_applied === 1) expect(discountClients, `invoice ${inv.reference}`).toContain(inv.client_id);
    }
  });

  it("task tracked_minutes equals the sum of its time entries", () => {
    const sums = new Map<Value, number>();
    for (const te of rowsOf("time_entries")) {
      if (te.task_id === null) continue;
      sums.set(te.task_id, (sums.get(te.task_id) ?? 0) + Number(te.duration_minutes));
    }
    for (const t of rowsOf("tasks")) {
      expect(t.tracked_minutes ?? 0, `task ${t.id} "${t.title}"`).toBe(sums.get(t.id) ?? 0);
    }
  });

  it("paid invoices have a paid_date and unpaid ones do not", () => {
    for (const inv of rowsOf("invoices")) {
      if (inv.status === "paid") expect(inv.paid_date, `invoice ${inv.reference}`).not.toBeNull();
      else expect(inv.paid_date ?? null, `invoice ${inv.reference}`).toBeNull();
    }
  });

  it("JSON columns hold valid JSON", () => {
    const jsonCols: [string, string][] = [
      ["projects", "layout_config"], ["projects", "workload_columns"],
      ["project_tables", "column_config"], ["project_table_rows", "data"],
      ["tasks", "workload_cells"],
    ];
    for (const [table, col] of jsonCols) {
      for (const row of rowsOf(table)) {
        const v = row[col];
        if (v === undefined || v === null) continue;
        expect(() => JSON.parse(String(v)), `${table}.${col}`).not.toThrow();
      }
    }
  });
});

describe("presentation seed — demo coverage", () => {
  it("shows a believable mix of document and task states", () => {
    const invStatuses = new Set(rowsOf("invoices").map((i) => i.status));
    for (const s of ["paid", "sent", "overdue", "draft"]) expect(invStatuses).toContain(s);
    const quoteStatuses = new Set(rowsOf("quotes").map((q) => q.status));
    for (const s of ["accepted", "sent", "rejected", "draft"]) expect(quoteStatuses).toContain(s);
    const projStatuses = new Set(rowsOf("projects").map((p) => p.status));
    for (const s of ["active", "completed", "on_hold"]) expect(projStatuses).toContain(s);
    expect(rowsOf("tasks").some((t) => t.status === "todo")).toBe(true);
    expect(rowsOf("tasks").some((t) => t.status === "done")).toBe(true);
  });

  it("seeds the features added since v1.6", () => {
    expect(rowsOf("time_entries").length).toBeGreaterThanOrEqual(30);
    expect(rowsOf("project_tables").length).toBeGreaterThanOrEqual(1);
    expect(rowsOf("project_table_rows").length).toBeGreaterThanOrEqual(3);
    expect(rowsOf("wiki_articles").filter((a) => a.project_id !== null).length).toBeGreaterThanOrEqual(3);
    expect(rowsOf("income").length).toBeGreaterThanOrEqual(3);
    expect(rowsOf("projects").filter((p) => p.layout_config !== null && p.layout_config !== undefined).length).toBeGreaterThanOrEqual(2);
    expect(rowsOf("recurring_invoice_templates").length).toBeGreaterThanOrEqual(1);
  });

  it("covers roughly a year of invoices and expenses for the finance charts", () => {
    const monthsBack = (rows: Row[], col: string) =>
      rows.map((r) => Number((r[col] as Expr).expr.match(/-(\d+) months?/)?.[1] ?? 0));
    expect(Math.max(...monthsBack(rowsOf("invoices"), "invoice_date"))).toBeGreaterThanOrEqual(10);
    expect(Math.max(...monthsBack(rowsOf("expenses"), "invoice_date"))).toBeGreaterThanOrEqual(10);
    expect(rowsOf("expenses").length).toBeGreaterThanOrEqual(30);
  });

  it("uses every expense category so the P&L breakdown is populated", () => {
    const used = new Set(rowsOf("expenses").map((e) => e.category_code));
    for (const c of ["AM", "FA", "FD", "FR", "LO", "CS"]) expect(used).toContain(c);
  });
});

describe("seedPresentationDb loader", () => {
  beforeEach(() => {
    clearExecutedStatements();
    vi.mocked(seedUserGuide).mockClear();
  });

  it("executes every seed statement and then restores the user guide", async () => {
    await seedPresentationDb();
    const executed = executedStatements.map((s) => s.sql.replace(/;$/, ""));
    for (const s of statements) expect(executed).toContain(s);
    expect(seedUserGuide).toHaveBeenCalledTimes(1);
  });
});
