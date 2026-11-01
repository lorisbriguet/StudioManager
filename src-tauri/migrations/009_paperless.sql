-- Paperless-ngx inbox: widen connections.kind to allow 'paperless' (SQLite
-- cannot alter a CHECK, so rebuild the table keeping ids) and add the table
-- linking Paperless documents to expenses.
-- The test/runtime SQLite build enables foreign keys by default, so DROP TABLE
-- would fire machines.connection_id ON DELETE SET NULL. Stash the links and
-- restore them after the rebuild (ids are preserved).
CREATE TABLE _machine_connection_backup AS
  SELECT id, connection_id FROM machines WHERE connection_id IS NOT NULL;
CREATE TABLE connections_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('synology','bambu_cloud','paperless')),
  label TEXT NOT NULL, host TEXT, port INTEGER, region TEXT, account TEXT,
  cert_fingerprint TEXT,
  last_sync_at TEXT, last_ok_at TEXT, last_error TEXT, failing_since TEXT, failing_notified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO connections_new (id, kind, label, host, port, region, account, cert_fingerprint, last_sync_at, last_ok_at, last_error, failing_since, failing_notified, created_at, updated_at)
  SELECT id, kind, label, host, port, region, account, cert_fingerprint, last_sync_at, last_ok_at, last_error, failing_since, failing_notified, created_at, updated_at FROM connections;
DROP TABLE connections;
ALTER TABLE connections_new RENAME TO connections;
UPDATE machines SET connection_id = (SELECT b.connection_id FROM _machine_connection_backup b WHERE b.id = machines.id)
  WHERE id IN (SELECT id FROM _machine_connection_backup);
DROP TABLE _machine_connection_backup;

CREATE TABLE paperless_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  paperless_doc_id INTEGER NOT NULL,
  expense_id INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
  state TEXT NOT NULL CHECK (state IN ('linked','dismissed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (connection_id, paperless_doc_id)
);
