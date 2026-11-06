-- The tables, columns and indexes the app's ensureSchema() used to create at
-- every start (src/db/index.ts). They live here now, so the app, the MCP
-- server and `sm` all meet the same schema once the migrations ran.
--
-- A file the app already opened has most of this: the runner skips an
-- `ALTER TABLE ... ADD COLUMN` whose column exists (migrate.rs,
-- `columns_if_missing`), and the tables and indexes are IF NOT EXISTS.
-- Keep one statement per `;` and no `;` inside strings: the runner splits
-- this file on them.

-- Which of the seeded tables the file had before this migration: ensureSchema
-- fills a table with starter rows only on a new file or when the table is new
-- (seedOnce), never in one whose rows the user may have deleted.
INSERT OR IGNORE INTO meta (key, value)
SELECT 'before_014:' || name, '1' FROM sqlite_master
WHERE type = 'table'
  AND name IN ('client_addresses', 'resources', 'dashboard_presets', 'wiki_folders', 'invoice_templates');

-- ensureSchema's own schema version: no longer used.
DELETE FROM meta WHERE key = 'schema_fixups';

-- ── Tables ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS client_addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  billing_name TEXT NOT NULL DEFAULT '',
  address_line1 TEXT NOT NULL DEFAULT '',
  address_line2 TEXT NOT NULL DEFAULT '',
  postal_city TEXT NOT NULL DEFAULT ''
);

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
);

CREATE TABLE IF NOT EXISTS resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  price TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS resource_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  tag TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS resource_projects (
  resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  PRIMARY KEY (resource_id, project_id)
);

CREATE TABLE IF NOT EXISTS recurring_invoice_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  base_invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  frequency TEXT NOT NULL DEFAULT 'monthly',
  next_due TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS saved_filters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page TEXT NOT NULL,
  name TEXT NOT NULL,
  filters TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Untitled',
  column_config TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_table_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id INTEGER NOT NULL REFERENCES project_tables(id) ON DELETE CASCADE,
  data TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dashboard_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  layout_json TEXT NOT NULL,
  is_builtin INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wiki_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wiki_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id INTEGER REFERENCES wiki_folders(id) ON DELETE SET NULL,
  project_id INTEGER DEFAULT NULL,
  title TEXT NOT NULL DEFAULT 'Untitled',
  content TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wiki_article_tags (
  article_id INTEGER NOT NULL REFERENCES wiki_articles(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (article_id, tag)
);

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
);

CREATE TABLE IF NOT EXISTS custom_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS custom_list_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id INTEGER NOT NULL REFERENCES custom_lists(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  color TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);

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
);

-- ── Columns (skipped one by one when the file has them) ─────

ALTER TABLE tasks ADD COLUMN start_time TEXT DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN end_time TEXT DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN reminder TEXT DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN end_date TEXT DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN planned_minutes INTEGER DEFAULT NULL;
ALTER TABLE tasks ADD COLUMN tracked_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN workload_cells TEXT NOT NULL DEFAULT '{}';
ALTER TABLE tasks ADD COLUMN workload_sort_order INTEGER NOT NULL DEFAULT 0;

ALTER TABLE subtasks ADD COLUMN end_date TEXT DEFAULT NULL;
ALTER TABLE subtasks ADD COLUMN start_time TEXT DEFAULT NULL;
ALTER TABLE subtasks ADD COLUMN end_time TEXT DEFAULT NULL;
ALTER TABLE subtasks ADD COLUMN reminder TEXT DEFAULT NULL;
ALTER TABLE subtasks ADD COLUMN calendar_event_id TEXT DEFAULT NULL;

ALTER TABLE projects ADD COLUMN calendar_deadline_id TEXT DEFAULT NULL;
ALTER TABLE projects ADD COLUMN workload_columns TEXT DEFAULT NULL;
ALTER TABLE projects ADD COLUMN workload_template_id INTEGER DEFAULT NULL;
ALTER TABLE projects ADD COLUMN layout_config TEXT DEFAULT NULL;
ALTER TABLE projects ADD COLUMN folder_path TEXT DEFAULT NULL;

ALTER TABLE clients ADD COLUMN postal_city TEXT NOT NULL DEFAULT '';

ALTER TABLE business_profile ADD COLUMN qr_iban TEXT DEFAULT '';

ALTER TABLE invoices ADD COLUMN contact_id INTEGER REFERENCES client_contacts(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN billing_address_id INTEGER DEFAULT NULL;
ALTER TABLE invoices ADD COLUMN currency TEXT NOT NULL DEFAULT 'CHF';
ALTER TABLE invoices ADD COLUMN exchange_rate REAL NOT NULL DEFAULT 1.0;
ALTER TABLE invoices ADD COLUMN chf_equivalent REAL NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN reminder_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN last_reminder_date TEXT DEFAULT NULL;
ALTER TABLE invoices ADD COLUMN template_id INTEGER REFERENCES invoice_templates(id) ON DELETE SET NULL;

ALTER TABLE quotes ADD COLUMN billing_address_id INTEGER DEFAULT NULL;
ALTER TABLE quotes ADD COLUMN converted_to_project_id INTEGER DEFAULT NULL;
ALTER TABLE quotes ADD COLUMN template_id INTEGER REFERENCES invoice_templates(id) ON DELETE SET NULL;

ALTER TABLE expense_categories ADD COLUMN color TEXT DEFAULT NULL;

ALTER TABLE workload_templates ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;

-- ── Indexes on frequent WHERE / JOIN columns ────────────────

CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(invoice_date);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category_code);
CREATE INDEX IF NOT EXISTS idx_expenses_supplier ON expenses(supplier);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_task ON time_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice ON invoice_line_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_quote_line_items_quote ON quote_line_items(quote_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_project ON time_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_date ON time_entries(date);
CREATE INDEX IF NOT EXISTS idx_quotes_client ON quotes(client_id);
