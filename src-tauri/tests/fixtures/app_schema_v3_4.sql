-- Schema of a database file as v3.4.0 left it: migrations 001-013 plus the
-- tables, columns and indexes its ensureSchema() added. Dumped from
-- sqlite_master; migrate.rs checks that migration 014 brings such a file to
-- the same shape as a new one.

CREATE TABLE business_profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    owner_name TEXT NOT NULL DEFAULT '',
    address TEXT DEFAULT '',
    postal_code TEXT DEFAULT '',
    city TEXT DEFAULT '',
    country TEXT DEFAULT 'CH',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    ide_number TEXT DEFAULT '',
    affiliate_number TEXT DEFAULT '',
    bank_name TEXT DEFAULT '',
    bank_address TEXT DEFAULT '',
    iban TEXT DEFAULT '',
    clearing TEXT DEFAULT '',
    bic_swift TEXT DEFAULT '',
    default_activity TEXT DEFAULT 'Graphisme',
    vat_exempt INTEGER NOT NULL DEFAULT 1,
    default_payment_terms_days INTEGER NOT NULL DEFAULT 30
, qr_iban TEXT DEFAULT '');

CREATE TABLE clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    address_line1 TEXT DEFAULT '',
    address_line2 TEXT DEFAULT '',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    language TEXT NOT NULL DEFAULT 'FR' CHECK (language IN ('FR', 'EN')),
    has_discount INTEGER NOT NULL DEFAULT 0,
    discount_rate REAL NOT NULL DEFAULT 0.0,
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, billing_name TEXT DEFAULT '', archived_at TEXT DEFAULT NULL, postal_city TEXT NOT NULL DEFAULT '');

CREATE TABLE client_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    role TEXT DEFAULT ''
);

CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL REFERENCES clients(id),
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'on_hold', 'cancelled')),
    start_date TEXT,
    deadline TEXT,
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, calendar_deadline_id TEXT DEFAULT NULL, workload_columns TEXT DEFAULT NULL, workload_template_id INTEGER DEFAULT NULL, layout_config TEXT DEFAULT NULL, folder_path TEXT DEFAULT NULL);

CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
    priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    due_date TEXT,
    scheduled_start TEXT,
    scheduled_end TEXT,
    calendar_event_id TEXT,
    notes TEXT DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, start_time TEXT DEFAULT NULL, end_time TEXT DEFAULT NULL, reminder TEXT DEFAULT NULL, end_date TEXT DEFAULT NULL, planned_minutes INTEGER DEFAULT NULL, tracked_minutes INTEGER NOT NULL DEFAULT 0, workload_cells TEXT NOT NULL DEFAULT '{}', workload_sort_order INTEGER NOT NULL DEFAULT 0);

CREATE TABLE invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT NOT NULL UNIQUE,
    client_id TEXT NOT NULL REFERENCES clients(id),
    project_id INTEGER REFERENCES projects(id),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'cancelled')),
    language TEXT NOT NULL DEFAULT 'FR',
    activity TEXT DEFAULT '',
    assignment TEXT DEFAULT '',
    invoice_date TEXT NOT NULL DEFAULT (date('now')),
    due_date TEXT,
    payment_terms_days INTEGER NOT NULL DEFAULT 30,
    subtotal REAL NOT NULL DEFAULT 0,
    discount_applied INTEGER NOT NULL DEFAULT 0,
    discount_rate REAL NOT NULL DEFAULT 0,
    discount_label TEXT DEFAULT '',
    total REAL NOT NULL DEFAULT 0,
    paid_date TEXT,
    pdf_path TEXT,
    from_quote_id INTEGER REFERENCES quotes(id),
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, po_number TEXT DEFAULT NULL, activity_id INTEGER, contact_id INTEGER REFERENCES client_contacts(id) ON DELETE SET NULL, billing_address_id INTEGER DEFAULT NULL, currency TEXT NOT NULL DEFAULT 'CHF', exchange_rate REAL NOT NULL DEFAULT 1.0, chf_equivalent REAL NOT NULL DEFAULT 0, reminder_count INTEGER NOT NULL DEFAULT 0, last_reminder_date TEXT DEFAULT NULL, template_id INTEGER REFERENCES invoice_templates(id) ON DELETE SET NULL);

CREATE TABLE invoice_line_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    designation TEXT NOT NULL,
    rate REAL,
    unit TEXT,
    quantity REAL NOT NULL DEFAULT 1,
    amount REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT NOT NULL UNIQUE,
    client_id TEXT NOT NULL REFERENCES clients(id),
    project_id INTEGER REFERENCES projects(id),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired')),
    language TEXT NOT NULL DEFAULT 'FR',
    activity TEXT DEFAULT '',
    assignment TEXT DEFAULT '',
    quote_date TEXT NOT NULL DEFAULT (date('now')),
    valid_until TEXT,
    subtotal REAL NOT NULL DEFAULT 0,
    discount_applied INTEGER NOT NULL DEFAULT 0,
    discount_rate REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    converted_to_invoice_id INTEGER REFERENCES invoices(id),
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, activity_id INTEGER, billing_address_id INTEGER DEFAULT NULL, converted_to_project_id INTEGER DEFAULT NULL, template_id INTEGER REFERENCES invoice_templates(id) ON DELETE SET NULL);

CREATE TABLE quote_line_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    designation TEXT NOT NULL,
    rate REAL,
    unit TEXT,
    quantity REAL NOT NULL DEFAULT 1,
    amount REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE expense_categories (
    code TEXT PRIMARY KEY,
    name_fr TEXT NOT NULL,
    name_en TEXT NOT NULL,
    pl_section TEXT NOT NULL CHECK (pl_section IN ('operating', 'social_charges'))
, color TEXT DEFAULT NULL);

CREATE TABLE expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT NOT NULL UNIQUE,
    supplier TEXT NOT NULL,
    category_code TEXT NOT NULL REFERENCES expense_categories(code),
    invoice_date TEXT NOT NULL DEFAULT (date('now')),
    due_date TEXT,
    amount REAL NOT NULL,
    paid_date TEXT,
    receipt_path TEXT,
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, currency TEXT NOT NULL DEFAULT 'CHF', exchange_rate REAL NOT NULL DEFAULT 1.0, original_amount REAL DEFAULT NULL);

CREATE TABLE subtasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'done')),
    due_date TEXT DEFAULT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now'))
, end_date TEXT DEFAULT NULL, start_time TEXT DEFAULT NULL, end_time TEXT DEFAULT NULL, reminder TEXT DEFAULT NULL, calendar_event_id TEXT DEFAULT NULL);

CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL DEFAULT 'info',
    title TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    read INTEGER NOT NULL DEFAULT 0,
    link TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT (datetime('now'))
);

CREATE TABLE workload_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    columns TEXT NOT NULL DEFAULT '[]',
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now'))
, is_system INTEGER NOT NULL DEFAULT 0);

CREATE TABLE workload_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    template_id INTEGER REFERENCES workload_templates(id) ON DELETE SET NULL,
    task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    cells TEXT NOT NULL DEFAULT '{}',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now'))
);

CREATE TABLE activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name_fr TEXT NOT NULL,
    name_en TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE machines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'generic', maker TEXT, model TEXT, serial TEXT, location TEXT,
  status TEXT NOT NULL DEFAULT 'working' CHECK (status IN ('working','attention','broken','lent','retired')),
  lent_to TEXT, lent_until TEXT,
  purchase_date TEXT, supplier TEXT, price REAL, currency TEXT,
  expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
  warranty_until TEXT, warranty_notified_for TEXT, lifespan_years REAL, photo_path TEXT, notes TEXT, template_key TEXT,
  connection_id INTEGER REFERENCES connections(id) ON DELETE SET NULL, device_id TEXT, reading_baseline REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, linked_at TEXT);

CREATE TABLE machine_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  label TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('file','link')), path_or_url TEXT NOT NULL
);

CREATE TABLE machine_projects (
  machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  PRIMARY KEY (machine_id, project_id)
);

CREATE TABLE upkeep_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  title TEXT NOT NULL, notes TEXT,
  schedule TEXT NOT NULL CHECK (schedule IN ('interval','usage')),
  interval_n INTEGER, interval_unit TEXT CHECK (interval_unit IN ('day','week','month','year')), anchor_day INTEGER,
  usage_metric TEXT CHECK (usage_metric IN ('print_hours')), usage_every REAL,
  last_done_on TEXT, last_done_reading REAL, next_due_on TEXT, snooze_until TEXT,
  in_calendar INTEGER NOT NULL DEFAULT 1, alert TEXT NOT NULL DEFAULT 'default',
  calendar_event_id TEXT, calendar_event_date TEXT, overdue_notified_for TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, is_backup INTEGER NOT NULL DEFAULT 0);

CREATE TABLE service_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  upkeep_item_id INTEGER REFERENCES upkeep_items(id) ON DELETE SET NULL,
  done_on TEXT NOT NULL, description TEXT NOT NULL, cost REAL,
  expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL, reading REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE consumables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, machine_id INTEGER REFERENCES machines(id) ON DELETE SET NULL,
  unit TEXT NOT NULL DEFAULT 'pcs', stock REAL NOT NULL DEFAULT 0, reorder_level REAL NOT NULL DEFAULT 0,
  supplier TEXT, product_url TEXT, unit_price REAL, currency TEXT, low_notified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE consumable_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  consumable_id INTEGER NOT NULL REFERENCES consumables(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  used_on TEXT NOT NULL, amount REAL NOT NULL, cost REAL
);

CREATE TABLE subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, plan TEXT, vendor TEXT, url TEXT,
  renews_on TEXT NOT NULL, anchor_day INTEGER NOT NULL, period TEXT NOT NULL CHECK (period IN ('month','year')),
  cost REAL NOT NULL DEFAULT 0, currency TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  in_calendar INTEGER NOT NULL DEFAULT 1, alert TEXT NOT NULL DEFAULT 'week_before',
  calendar_event_id TEXT, coming_notified_for TEXT, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE subscription_renewals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  renewed_on TEXT NOT NULL, amount REAL NOT NULL, currency TEXT,
  decision TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','added','skipped')),
  expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL, notified INTEGER NOT NULL DEFAULT 0,
  UNIQUE (subscription_id, renewed_on)
);

CREATE TABLE machine_readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  metric TEXT NOT NULL, value REAL NOT NULL, read_at TEXT NOT NULL
);

CREATE TABLE machine_disks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  slot TEXT NOT NULL, model TEXT, serial TEXT NOT NULL, size_bytes INTEGER, power_on_hours INTEGER,
  health TEXT NOT NULL CHECK (health IN ('healthy','warning','failing')), notified_health TEXT,
  bad_sectors INTEGER, temperature REAL, first_seen TEXT NOT NULL, last_read_at TEXT NOT NULL,
  UNIQUE (machine_id, serial)
);

CREATE TABLE "connections" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('synology','bambu_cloud','paperless')),
  label TEXT NOT NULL, host TEXT, port INTEGER, region TEXT, account TEXT,
  cert_fingerprint TEXT,
  last_sync_at TEXT, last_ok_at TEXT, last_error TEXT, failing_since TEXT, failing_notified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE paperless_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  paperless_doc_id INTEGER NOT NULL,
  expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
  state TEXT NOT NULL CHECK (state IN ('linked','dismissed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (connection_id, paperless_doc_id)
);

CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE client_addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    label TEXT NOT NULL DEFAULT '',
    billing_name TEXT NOT NULL DEFAULT '',
    address_line1 TEXT NOT NULL DEFAULT '',
    address_line2 TEXT NOT NULL DEFAULT '',
    postal_city TEXT NOT NULL DEFAULT ''
  );

CREATE TABLE income (
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

CREATE TABLE resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      price TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

CREATE TABLE resource_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      tag TEXT NOT NULL
    );

CREATE TABLE resource_projects (
      resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      PRIMARY KEY (resource_id, project_id)
    );

CREATE TABLE recurring_invoice_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      base_invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      frequency TEXT NOT NULL DEFAULT 'monthly',
      next_due TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

CREATE TABLE saved_filters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page TEXT NOT NULL,
      name TEXT NOT NULL,
      filters TEXT NOT NULL DEFAULT '{}',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

CREATE TABLE project_tables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT 'Untitled',
      column_config TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

CREATE TABLE project_table_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_id INTEGER NOT NULL REFERENCES project_tables(id) ON DELETE CASCADE,
      data TEXT NOT NULL DEFAULT '{}',
      sort_order INTEGER NOT NULL DEFAULT 0
    );

CREATE TABLE dashboard_presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      layout_json TEXT NOT NULL,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

CREATE TABLE wiki_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

CREATE TABLE wiki_articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_id INTEGER REFERENCES wiki_folders(id) ON DELETE SET NULL,
      project_id INTEGER DEFAULT NULL,
      title TEXT NOT NULL DEFAULT 'Untitled',
      content TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

CREATE TABLE wiki_article_tags (
      article_id INTEGER NOT NULL REFERENCES wiki_articles(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (article_id, tag)
    );

CREATE TABLE time_entries (
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

CREATE TABLE custom_lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

CREATE TABLE custom_list_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id INTEGER NOT NULL REFERENCES custom_lists(id) ON DELETE CASCADE,
      value TEXT NOT NULL,
      color TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

CREATE TABLE invoice_templates (
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

CREATE INDEX idx_subtasks_task_id ON subtasks(task_id);

CREATE INDEX idx_projects_client_id ON projects(client_id);

CREATE INDEX idx_invoices_client_id ON invoices(client_id);

CREATE INDEX idx_quotes_client_id ON quotes(client_id);

CREATE INDEX idx_invoice_line_items_invoice_id ON invoice_line_items(invoice_id);

CREATE INDEX idx_client_contacts_client_id ON client_contacts(client_id);

CREATE INDEX idx_workload_rows_project_id ON workload_rows(project_id);

CREATE INDEX idx_workload_rows_project_sort ON workload_rows(project_id, sort_order);

CREATE INDEX idx_machine_readings ON machine_readings(machine_id, metric, read_at);

CREATE INDEX idx_invoices_client ON invoices(client_id);

CREATE INDEX idx_invoices_date ON invoices(invoice_date);

CREATE INDEX idx_invoices_status ON invoices(status);

CREATE INDEX idx_expenses_date ON expenses(invoice_date);

CREATE INDEX idx_expenses_category ON expenses(category_code);

CREATE INDEX idx_expenses_supplier ON expenses(supplier);

CREATE INDEX idx_tasks_project ON tasks(project_id);

CREATE INDEX idx_tasks_due ON tasks(due_date);

CREATE INDEX idx_subtasks_task ON subtasks(task_id);

CREATE INDEX idx_time_entries_task ON time_entries(task_id);

CREATE INDEX idx_invoice_line_items_invoice ON invoice_line_items(invoice_id);

CREATE INDEX idx_quote_line_items_quote ON quote_line_items(quote_id);

CREATE INDEX idx_time_entries_project ON time_entries(project_id);

CREATE INDEX idx_time_entries_date ON time_entries(date);

CREATE INDEX idx_quotes_client ON quotes(client_id);
