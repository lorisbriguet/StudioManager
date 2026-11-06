-- Notes about this database file. The app's ensureSchema() records here
-- which one-time steps (seed data, data moves) already ran, so they never
-- run again: a resource or address the user deleted stays deleted.
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
