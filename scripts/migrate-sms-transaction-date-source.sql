-- SMS transaction date source: prefer date parsed from message text vs device receive time.
-- Run: psql $DATABASE_URL -f scripts/migrate-sms-transaction-date-source.sql

ALTER TABLE user_settings
ADD COLUMN IF NOT EXISTS sms_transaction_date_source text NOT NULL DEFAULT 'received_at';

COMMENT ON COLUMN user_settings.sms_transaction_date_source IS
  'message = use date from SMS body when possible; received_at = prefer device timestamp (API)';
