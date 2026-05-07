-- Add "transfer" as a valid category/transaction type.
-- Run with: psql $DATABASE_URL -f scripts/migrate-category-type-transfer.sql

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum
    WHERE enumlabel = 'transfer'
      AND enumtypid = 'category_type'::regtype
  ) THEN
    ALTER TYPE category_type ADD VALUE 'transfer';
  END IF;
END $$;
