-- Business profile (singleton)
CREATE TABLE IF NOT EXISTS business_profile (
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
);

INSERT OR IGNORE INTO business_profile (id) VALUES (1);

-- Clients
CREATE TABLE IF NOT EXISTS clients (
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
);

-- Client contacts
CREATE TABLE IF NOT EXISTS client_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    role TEXT DEFAULT ''
);

-- Projects
CREATE TABLE IF NOT EXISTS projects (
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
);

-- Tasks
CREATE TABLE IF NOT EXISTS tasks (
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
);

-- Invoices
CREATE TABLE IF NOT EXISTS invoices (
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
);

-- Invoice line items
CREATE TABLE IF NOT EXISTS invoice_line_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    designation TEXT NOT NULL,
    rate REAL,
    unit TEXT,
    quantity REAL NOT NULL DEFAULT 1,
    amount REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
);

-- Quotes
CREATE TABLE IF NOT EXISTS quotes (
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
);

-- Quote line items
CREATE TABLE IF NOT EXISTS quote_line_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    designation TEXT NOT NULL,
    rate REAL,
    unit TEXT,
    quantity REAL NOT NULL DEFAULT 1,
    amount REAL NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
);

-- Expense categories (pre-populated)
CREATE TABLE IF NOT EXISTS expense_categories (
    code TEXT PRIMARY KEY,
    name_fr TEXT NOT NULL,
    name_en TEXT NOT NULL,
    pl_section TEXT NOT NULL CHECK (pl_section IN ('operating', 'social_charges'))
);

INSERT OR IGNORE INTO expense_categories (code, name_fr, name_en, pl_section) VALUES
    ('AM', 'Dépenses d''achat matériel', 'Material purchases', 'operating'),
    ('FA', 'Frais d''administration', 'Administrative expenses', 'operating'),
    ('FD', 'Frais de déplacement et de représentation', 'Travel & representation', 'operating'),
    ('FR', 'Frais de repas hors domicile', 'Meals outside home', 'operating'),
    ('LO', 'Loyer', 'Rent', 'operating'),
    ('CS', 'Charges sociales AVS', 'Social charges (AVS)', 'social_charges');

-- Expenses
CREATE TABLE IF NOT EXISTS expenses (
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
);
