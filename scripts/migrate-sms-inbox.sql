-- Run before deploying the shared SMS inbox endpoints.
CREATE TABLE IF NOT EXISTS sms_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  fingerprint text NOT NULL,
  sender text NOT NULL,
  message_encrypted text NOT NULL,
  received_at timestamptz NOT NULL,
  account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'synced', 'dismissed')),
  transaction_id uuid REFERENCES transactions(id) ON DELETE SET NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS sms_inbox_pending_idx ON sms_inbox(user_id, status, received_at DESC);
CREATE TABLE IF NOT EXISTS sms_inbox_devices (
  user_id text NOT NULL,
  device_id text NOT NULL,
  last_uploaded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, device_id)
);
