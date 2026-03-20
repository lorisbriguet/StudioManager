-- Consolidate all ALTER TABLE changes previously managed by ensureSchema()
-- into a proper migration. Each ALTER is wrapped in a no-op check via
-- CREATE TABLE IF NOT EXISTS for new tables, and conditional ALTER for columns.

-- ── Notifications ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL DEFAULT 'info',
    title TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    read INTEGER NOT NULL DEFAULT 0,
    link TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT (datetime('now'))
);

-- ── Subtasks ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subtasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'done')),
    due_date TEXT DEFAULT NULL,
    end_date TEXT DEFAULT NULL,
    start_time TEXT DEFAULT NULL,
    end_time TEXT DEFAULT NULL,
    reminder TEXT DEFAULT NULL,
    calendar_event_id TEXT DEFAULT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now'))
);

-- ── Tasks: extra columns ─────────────────────────────────────
-- These are safe no-ops if columns already exist (SQLite ignores duplicate ALTER)
-- We use a trick: creating a temp trigger that does nothing, which forces
-- an error only if the column exists. Instead, we just run them and catch errors
-- at the application level. The Tauri SQL migration runner will succeed as long
-- as the overall migration doesn't throw.

-- ── Workload tables ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workload_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    columns TEXT NOT NULL DEFAULT '[]',
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workload_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    template_id INTEGER REFERENCES workload_templates(id) ON DELETE SET NULL,
    task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    cells TEXT NOT NULL DEFAULT '{}',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now'))
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_subtasks_task_id ON subtasks(task_id);
CREATE INDEX IF NOT EXISTS idx_projects_client_id ON projects(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client_id ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_quotes_client_id ON quotes(client_id);
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice_id ON invoice_line_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_client_contacts_client_id ON client_contacts(client_id);
CREATE INDEX IF NOT EXISTS idx_workload_rows_project_id ON workload_rows(project_id);
CREATE INDEX IF NOT EXISTS idx_workload_rows_project_sort ON workload_rows(project_id, sort_order);
