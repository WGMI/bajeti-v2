-- SMS idempotency columns and unique key for duplicate-safe ingestion.
-- Run with: psql $DATABASE_URL -f scripts/migrate-sms-idempotency.sql

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS sms_idempotency_key text,
  ADD COLUMN IF NOT EXISTS sms_raw_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_user_sms_idempotency_key_uidx
  ON transactions (user_id, sms_idempotency_key)
  WHERE sms_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS transactions_user_sms_raw_hash_idx
  ON transactions (user_id, sms_raw_hash)
  WHERE sms_raw_hash IS NOT NULL;
