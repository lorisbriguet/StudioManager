-- Notifications shown in the current UI language. A notice the app writes
-- itself also keeps the label keys of its title and message, and the values
-- that fill them (JSON object), so the list can translate it when shown.
-- NULL keys (older rows, error notices): the saved text is shown as is.
ALTER TABLE notifications ADD COLUMN title_key TEXT DEFAULT NULL;
ALTER TABLE notifications ADD COLUMN message_key TEXT DEFAULT NULL;
ALTER TABLE notifications ADD COLUMN params TEXT DEFAULT NULL;
