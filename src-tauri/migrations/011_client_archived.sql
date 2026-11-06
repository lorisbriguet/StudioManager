-- Archived clients: hidden from lists and pickers, kept with their invoices.
-- A client with issued invoices can't be deleted (invoices are kept 10 years,
-- OR art. 958f), so archiving is how it leaves the everyday lists.
ALTER TABLE clients ADD COLUMN archived_at TEXT DEFAULT NULL;
