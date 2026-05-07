-- Group two SMS legs into one logical transfer event.
-- Run with: psql $DATABASE_URL -f scripts/migrate-transfer-group-id.sql

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS transfer_group_id uuid;

CREATE INDEX IF NOT EXISTS transactions_user_transfer_group_idx
  ON transactions (user_id, transfer_group_id)
  WHERE transfer_group_id IS NOT NULL;
