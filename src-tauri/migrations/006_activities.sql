-- Activities become entities with user-editable FR/EN names.
-- invoices/quotes keep their historical text snapshot in `activity`;
-- `activity_id` links new records to the entity (nullable, no FK — see spec §7).
CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name_fr TEXT NOT NULL,
    name_en TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE invoices ADD COLUMN activity_id INTEGER;
ALTER TABLE quotes ADD COLUMN activity_id INTEGER;
