-- Upkeep items marked as backups ("Refresh the HDD copy"): the Network page's Backups card lists them.
ALTER TABLE upkeep_items ADD COLUMN is_backup INTEGER NOT NULL DEFAULT 0;
