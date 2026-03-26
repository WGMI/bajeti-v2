-- Mobile settings table: one row per user (Clerk user_id).
-- Run with: psql $DATABASE_URL -f scripts/migrate-user-mobile-settings.sql

CREATE TABLE IF NOT EXISTS user_mobile_settings (
  user_id text PRIMARY KEY,
  theme text NOT NULL DEFAULT 'system',
  notifications_enabled boolean NOT NULL DEFAULT true,
  biometrics_enabled boolean NOT NULL DEFAULT false
);
