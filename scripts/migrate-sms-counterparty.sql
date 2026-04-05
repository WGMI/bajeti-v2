-- Counterparty (payee/payer) on SMS transactions + user mapping rules.
-- Run with: psql $DATABASE_URL -f scripts/migrate-sms-counterparty.sql

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS sms_counterparty text,
  ADD COLUMN IF NOT EXISTS sms_counterparty_key text;

CREATE INDEX IF NOT EXISTS transactions_user_counterparty_lookup_idx
  ON transactions (user_id, type, sms_counterparty_key)
  WHERE sms_counterparty_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS counterparty_category_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  counterparty_key text NOT NULL,
  transaction_type category_type NOT NULL,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, counterparty_key, transaction_type)
);

CREATE INDEX IF NOT EXISTS counterparty_category_rules_user_idx
  ON counterparty_category_rules (user_id);
