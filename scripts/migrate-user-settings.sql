-- User settings table: one row per user (Clerk user_id).
-- Run with: psql $DATABASE_URL -f scripts/migrate-user-settings.sql

CREATE TABLE IF NOT EXISTS user_settings (
  user_id text PRIMARY KEY,
  currency text NOT NULL DEFAULT 'USD',
  date_format text NOT NULL DEFAULT 'medium',
  first_day_of_week text NOT NULL DEFAULT 'monday'
);
