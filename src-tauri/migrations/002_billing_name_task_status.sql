-- Add billing_name to clients (used for invoices, distinct from display name)
ALTER TABLE clients ADD COLUMN billing_name TEXT DEFAULT '';

-- Copy current name to billing_name where empty
UPDATE clients SET billing_name = name WHERE billing_name = '' OR billing_name IS NULL;

-- Migrate any 'in_progress' tasks to 'todo' before tightening the constraint
UPDATE tasks SET status = 'todo' WHERE status = 'in_progress';

-- SQLite doesn't support ALTER CHECK constraints, so we keep the old constraint
-- but the app will only use 'todo' and 'done' going forward
