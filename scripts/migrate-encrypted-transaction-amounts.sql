BEGIN;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS amount_encrypted text,
  ADD COLUMN IF NOT EXISTS transaction_charges_encrypted text,
  ADD COLUMN IF NOT EXISTS original_amount_encrypted text,
  ADD COLUMN IF NOT EXISTS fx_rate_encrypted text;

ALTER TABLE transactions
  ALTER COLUMN amount DROP NOT NULL,
  ALTER COLUMN transaction_charges DROP NOT NULL;

ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_amount_positive;

COMMIT;
