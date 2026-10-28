-- When a machine was linked to a connection's device (ISO UTC). Bambu print
-- hours count from this moment: the baseline typed at linking covers before.
ALTER TABLE machines ADD COLUMN linked_at TEXT;
