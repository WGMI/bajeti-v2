-- Groups, role-based membership, invites, audit trail, and transaction attachments.
-- Run with: psql $DATABASE_URL -f scripts/migrate-groups-attachments.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE group_member_role AS ENUM ('owner', 'admin', 'accountant', 'contributor', 'viewer');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE group_invite_status AS ENUM ('pending', 'accepted', 'revoked', 'expired');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE transaction_approval_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  currency text NOT NULL DEFAULT 'KES',
  timezone text NOT NULL DEFAULT 'Africa/Nairobi',
  owner_user_id text NOT NULL,
  invite_token text NOT NULL DEFAULT encode(gen_random_bytes(18), 'hex'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  user_id text NOT NULL,
  role group_member_role NOT NULL DEFAULT 'viewer',
  display_name text,
  email text,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS group_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  email text,
  role group_member_role NOT NULL DEFAULT 'viewer',
  token text NOT NULL DEFAULT encode(gen_random_bytes(18), 'hex'),
  status group_invite_status NOT NULL DEFAULT 'pending',
  invited_by_user_id text NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  UNIQUE (token)
);

CREATE TABLE IF NOT EXISTS group_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  actor_user_id text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  action text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES groups (id) ON DELETE CASCADE;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES groups (id) ON DELETE CASCADE;

ALTER TABLE budget_plans
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES groups (id) ON DELETE CASCADE;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES groups (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS added_by_user_id text,
  ADD COLUMN IF NOT EXISTS paid_by_user_id text,
  ADD COLUMN IF NOT EXISTS approved_by_user_id text,
  ADD COLUMN IF NOT EXISTS approval_status transaction_approval_status NOT NULL DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

UPDATE transactions
SET added_by_user_id = user_id
WHERE added_by_user_id IS NULL;

CREATE TABLE IF NOT EXISTS transaction_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
  group_id uuid REFERENCES groups (id) ON DELETE CASCADE,
  user_id text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transaction_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
  group_id uuid REFERENCES groups (id) ON DELETE CASCADE,
  uploaded_by_user_id text NOT NULL,
  provider text NOT NULL DEFAULT 'cloudinary',
  public_id text NOT NULL,
  secure_url text NOT NULL,
  resource_type text NOT NULL,
  format text,
  original_filename text,
  bytes integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS groups_owner_idx ON groups (owner_user_id);
CREATE INDEX IF NOT EXISTS group_members_user_idx ON group_members (user_id);
CREATE INDEX IF NOT EXISTS group_invites_group_idx ON group_invites (group_id, status);
CREATE INDEX IF NOT EXISTS group_audit_events_group_created_idx ON group_audit_events (group_id, created_at DESC);
CREATE INDEX IF NOT EXISTS categories_group_idx ON categories (group_id);
CREATE INDEX IF NOT EXISTS accounts_group_idx ON accounts (group_id);
CREATE INDEX IF NOT EXISTS transactions_group_idx ON transactions (group_id, date DESC);
CREATE INDEX IF NOT EXISTS transaction_attachments_transaction_idx ON transaction_attachments (transaction_id);

-- Replace personal-only account uniqueness with personal + group-scoped uniqueness.
DROP INDEX IF EXISTS accounts_user_default_idx;
DROP INDEX IF EXISTS accounts_user_name_lower_idx;

CREATE UNIQUE INDEX IF NOT EXISTS accounts_user_default_personal_idx
  ON accounts (user_id)
  WHERE is_default = true AND group_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS accounts_group_default_idx
  ON accounts (group_id)
  WHERE is_default = true AND group_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS accounts_user_name_lower_personal_idx
  ON accounts (user_id, lower(name))
  WHERE group_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS accounts_group_name_lower_idx
  ON accounts (group_id, lower(name))
  WHERE group_id IS NOT NULL;

-- Replace personal-only budget uniqueness with personal + group-scoped uniqueness.
DROP INDEX IF EXISTS budget_plans_user_month_overall_idx;
DROP INDEX IF EXISTS budget_plans_user_month_category_idx;

CREATE UNIQUE INDEX IF NOT EXISTS budget_plans_user_month_overall_personal_idx
  ON budget_plans (user_id, month)
  WHERE type = 'overall' AND group_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS budget_plans_group_month_overall_idx
  ON budget_plans (group_id, month)
  WHERE type = 'overall' AND group_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS budget_plans_user_month_category_personal_idx
  ON budget_plans (user_id, month, category_id)
  WHERE type = 'category' AND group_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS budget_plans_group_month_category_idx
  ON budget_plans (group_id, month, category_id)
  WHERE type = 'category' AND group_id IS NOT NULL;
