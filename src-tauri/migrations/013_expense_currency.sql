-- Expenses in another currency. `amount` stays the CHF value that P&L and
-- exports add up; a foreign receipt also keeps what it said and the rate used.
-- exchange_rate = units of `currency` per 1 CHF, as on invoices.
ALTER TABLE expenses ADD COLUMN currency TEXT NOT NULL DEFAULT 'CHF';
ALTER TABLE expenses ADD COLUMN exchange_rate REAL NOT NULL DEFAULT 1.0;
ALTER TABLE expenses ADD COLUMN original_amount REAL DEFAULT NULL;
