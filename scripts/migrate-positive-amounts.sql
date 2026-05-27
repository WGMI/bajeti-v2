-- Store all transaction amounts as positive magnitudes; type drives income vs expense semantics.
-- Run with: psql $DATABASE_URL -f scripts/migrate-positive-amounts.sql

UPDATE transactions
SET amount = ABS(amount)
WHERE amount < 0;

-- Optional: fail fast on bad writes after migration (skip if you still have zero-amount rows).
ALTER TABLE transactions
  DROP CONSTRAINT IF EXISTS transactions_amount_positive_chk;

ALTER TABLE transactions
  ADD CONSTRAINT transactions_amount_positive_chk
  CHECK (amount > 0);
