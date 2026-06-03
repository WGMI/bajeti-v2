-- FX rate cache (Frankfurter) + per-transaction currency metadata.
-- Run: psql $DATABASE_URL -f scripts/migrate-fx-rates.sql

CREATE TABLE IF NOT EXISTS fx_rates (
  rate_date date NOT NULL,
  base_currency text NOT NULL,
  quote_currency text NOT NULL,
  rate numeric(20, 10) NOT NULL,
  source text NOT NULL DEFAULT 'frankfurter',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rate_date, base_currency, quote_currency)
);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS original_amount numeric,
  ADD COLUMN IF NOT EXISTS original_currency text,
  ADD COLUMN IF NOT EXISTS fx_rate numeric(20, 10),
  ADD COLUMN IF NOT EXISTS fx_rate_date date,
  ADD COLUMN IF NOT EXISTS fx_source text;
