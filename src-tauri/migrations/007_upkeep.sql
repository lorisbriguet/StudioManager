-- Studio upkeep: machines, maintenance, consumables, subscriptions, connections.
CREATE TABLE connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('synology','bambu_cloud')),
  label TEXT NOT NULL, host TEXT, port INTEGER, region TEXT, account TEXT,
  cert_fingerprint TEXT,
  last_sync_at TEXT, last_ok_at TEXT, last_error TEXT, failing_since TEXT, failing_notified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
);
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
);
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
CREATE INDEX idx_machine_readings ON machine_readings(machine_id, metric, read_at);
CREATE TABLE machine_disks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  slot TEXT NOT NULL, model TEXT, serial TEXT NOT NULL, size_bytes INTEGER, power_on_hours INTEGER,
  health TEXT NOT NULL CHECK (health IN ('healthy','warning','failing')), notified_health TEXT,
  bad_sectors INTEGER, temperature REAL, first_seen TEXT NOT NULL, last_read_at TEXT NOT NULL,
  UNIQUE (machine_id, serial)
);
