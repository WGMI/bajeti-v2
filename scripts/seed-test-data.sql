-- Seed test data for user_39IU6L8oLbSWnwJk9NtpyW3EpQ7
--
-- For a clean seed (recommended): clear this user's data first, then run this whole file:
--   DELETE FROM transactions WHERE user_id = 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7';
--   DELETE FROM categories WHERE user_id = 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7';
-- Then run: psql $DATABASE_URL -f scripts/seed-test-data.sql
--
-- If you already have categories from the app and don't want to clear them, run only
-- the transaction INSERT below and replace the category UUIDs with your actual
-- category IDs (e.g. from SELECT id, name FROM categories WHERE user_id = '...').

-- ========== CATEGORIES ==========
INSERT INTO categories (id, user_id, name, type, is_default) VALUES
  ('a1000000-1000-4000-8000-000000000001', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', 'Food', 'expense', true),
  ('a1000000-1000-4000-8000-000000000002', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', 'Rent', 'expense', true),
  ('a1000000-1000-4000-8000-000000000003', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', 'Transport', 'expense', true),
  ('a1000000-1000-4000-8000-000000000004', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', 'Bills', 'expense', true),
  ('a1000000-1000-4000-8000-000000000005', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', 'Entertainment', 'expense', true),
  ('a1000000-1000-4000-8000-000000000006', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', 'Savings', 'expense', true),
  ('a1000000-1000-4000-8000-000000000007', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', 'Salary', 'income', true),
  ('a1000000-1000-4000-8000-000000000008', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', 'Other Income', 'income', true),
  ('a1000000-1000-4000-8000-000000000009', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', 'Groceries', 'expense', false),
  ('a1000000-1000-4000-8000-00000000000a', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', 'Freelance', 'income', false)
ON CONFLICT (id) DO NOTHING;

-- ========== TRANSACTIONS (reference category IDs above) ==========
INSERT INTO transactions (id, user_id, amount, category_id, date, notes, type) VALUES
  ('b2000000-2000-4000-8000-000000000001', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', 4200.00, 'a1000000-1000-4000-8000-000000000007', '2026-01-31', 'Monthly salary', 'income'),
  ('b2000000-2000-4000-8000-000000000002', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', 4200.00, 'a1000000-1000-4000-8000-000000000007', '2025-12-31', 'Monthly salary', 'income'),
  ('b2000000-2000-4000-8000-000000000003', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', 4200.00, 'a1000000-1000-4000-8000-000000000007', '2025-11-30', 'Monthly salary', 'income'),
  ('b2000000-2000-4000-8000-000000000004', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', 380.50, 'a1000000-1000-4000-8000-00000000000a', '2026-02-05', 'Consulting project', 'income'),
  ('b2000000-2000-4000-8000-000000000005', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', 150.00, 'a1000000-1000-4000-8000-000000000008', '2026-01-15', 'Cashback reward', 'income'),
  ('b2000000-2000-4000-8000-000000000006', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', 220.00, 'a1000000-1000-4000-8000-00000000000a', '2025-12-20', 'Side gig', 'income'),
  ('b2000000-2000-4000-8000-000000000010', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', -1200.00, 'a1000000-1000-4000-8000-000000000002', '2026-02-01', 'February rent', 'expense'),
  ('b2000000-2000-4000-8000-000000000011', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', -1200.00, 'a1000000-1000-4000-8000-000000000002', '2026-01-01', 'January rent', 'expense'),
  ('b2000000-2000-4000-8000-000000000012', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', -1200.00, 'a1000000-1000-4000-8000-000000000002', '2025-12-01', 'December rent', 'expense'),
  ('b2000000-2000-4000-8000-000000000013', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', -85.20, 'a1000000-1000-4000-8000-000000000004', '2026-02-03', 'Electricity', 'expense'),
  ('b2000000-2000-4000-8000-000000000014', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', -42.00, 'a1000000-1000-4000-8000-000000000004', '2026-02-01', 'Internet', 'expense'),
  ('b2000000-2000-4000-8000-000000000015', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', -68.50, 'a1000000-1000-4000-8000-000000000004', '2026-01-28', 'Water bill', 'expense'),
  ('b2000000-2000-4000-8000-000000000020', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', -45.30, 'a1000000-1000-4000-8000-000000000009', '2026-02-05', 'Weekly groceries', 'expense'),
  ('b2000000-2000-4000-8000-000000000021', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', -12.80, 'a1000000-1000-4000-8000-000000000001', '2026-02-04', 'Lunch takeaway', 'expense'),
  ('b2000000-2000-4000-8000-000000000022', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', -68.90, 'a1000000-1000-4000-8000-000000000009', '2026-01-28', 'Supermarket', 'expense'),
  ('b2000000-2000-4000-8000-000000000023', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', -8.50, 'a1000000-1000-4000-8000-000000000001', '2026-01-25', 'Coffee', 'expense'),
  ('b2000000-2000-4000-8000-000000000024', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', -52.00, 'a1000000-1000-4000-8000-000000000009', '2026-01-18', 'Groceries', 'expense'),
  ('b2000000-2000-4000-8000-000000000030', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', -65.00, 'a1000000-1000-4000-8000-000000000003', '2026-02-01', 'Monthly transit pass', 'expense'),
  ('b2000000-2000-4000-8000-000000000031', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', -28.40, 'a1000000-1000-4000-8000-000000000003', '2026-01-15', 'Fuel', 'expense'),
  ('b2000000-2000-4000-8000-000000000032', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', -12.00, 'a1000000-1000-4000-8000-000000000003', '2025-12-22', 'Parking', 'expense'),
  ('b2000000-2000-4000-8000-000000000040', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', -15.99, 'a1000000-1000-4000-8000-000000000005', '2026-02-01', 'Streaming subscription', 'expense'),
  ('b2000000-2000-4000-8000-000000000041', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', -42.00, 'a1000000-1000-4000-8000-000000000005', '2026-01-20', 'Concert tickets', 'expense'),
  ('b2000000-2000-4000-8000-000000000042', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', -8.50, 'a1000000-1000-4000-8000-000000000005', '2026-01-10', 'Cinema', 'expense'),
  ('b2000000-2000-4000-8000-000000000050', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', -500.00, 'a1000000-1000-4000-8000-000000000006', '2026-02-05', 'Monthly transfer to savings', 'expense'),
  ('b2000000-2000-4000-8000-000000000051', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', -500.00, 'a1000000-1000-4000-8000-000000000006', '2026-01-05', 'Monthly transfer to savings', 'expense'),
  ('b2000000-2000-4000-8000-000000000052', 'user_39IU6L8oLbSWnwJk9NtpyW3EpQ7', -400.00, 'a1000000-1000-4000-8000-000000000006', '2025-12-05', 'Savings', 'expense')
ON CONFLICT (id) DO NOTHING;
