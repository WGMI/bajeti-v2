-- Separate transaction charges (e.g. M-PESA fees) from principal amount.
-- Run: psql $DATABASE_URL -f scripts/migrate-transaction-charges.sql

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS transaction_charges numeric(12, 2) NOT NULL DEFAULT 0;
