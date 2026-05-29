-- Financial accounts (Wallet default) and transaction ownership.
-- Run with: psql $DATABASE_URL -f scripts/migrate-accounts.sql

CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS accounts_user_default_idx
  ON accounts (user_id)
  WHERE is_default = true;

CREATE UNIQUE INDEX IF NOT EXISTS accounts_user_name_lower_idx
  ON accounts (user_id, lower(name));

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES accounts (id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'transfer_leg') THEN
    CREATE TYPE transfer_leg AS ENUM ('out', 'in');
  END IF;
END $$;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS transfer_leg transfer_leg;

-- Default Wallet for every user that already has categories or transactions
INSERT INTO accounts (user_id, name, is_default)
SELECT DISTINCT src.user_id, 'Wallet', true
FROM (
  SELECT user_id FROM categories
  UNION
  SELECT user_id FROM transactions
) src
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a
  WHERE a.user_id = src.user_id AND a.is_default = true
);

UPDATE transactions t
SET account_id = a.id
FROM accounts a
WHERE a.user_id = t.user_id
  AND a.is_default = true
  AND t.account_id IS NULL;

-- Paired transfer legs: infer direction from notes when grouped (best-effort)
UPDATE transactions t
SET transfer_leg = 'out'::transfer_leg
FROM (
  SELECT transfer_group_id, min(id::text)::uuid AS first_id
  FROM transactions
  WHERE transfer_group_id IS NOT NULL
    AND transfer_leg IS NULL
    AND type = 'transfer'::category_type
  GROUP BY transfer_group_id
  HAVING count(*) = 2
) g
WHERE t.transfer_group_id = g.transfer_group_id
  AND t.id = g.first_id
  AND t.transfer_leg IS NULL;

UPDATE transactions t
SET transfer_leg = 'in'::transfer_leg
FROM (
  SELECT transfer_group_id, max(id::text)::uuid AS second_id
  FROM transactions
  WHERE transfer_group_id IS NOT NULL
    AND transfer_leg IS NULL
    AND type = 'transfer'::category_type
  GROUP BY transfer_group_id
  HAVING count(*) = 2
) g
WHERE t.transfer_group_id = g.transfer_group_id
  AND t.id = g.second_id
  AND t.transfer_leg IS NULL;

CREATE INDEX IF NOT EXISTS transactions_user_account_idx
  ON transactions (user_id, account_id);
