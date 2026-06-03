-- Optional transfer destination on counterparty rules (null = default Wallet).
-- Run with: psql $DATABASE_URL -f scripts/migrate-counterparty-transfer-account.sql

ALTER TABLE counterparty_category_rules
  ADD COLUMN IF NOT EXISTS transfer_to_account_id uuid REFERENCES accounts (id) ON DELETE SET NULL;
