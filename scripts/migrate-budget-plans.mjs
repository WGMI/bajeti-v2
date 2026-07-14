import { existsSync } from "fs";
import { resolve } from "path";
import { neon } from "@neondatabase/serverless";

for (const filename of [".env.local", ".env"]) {
  const envPath = resolve(process.cwd(), filename);
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const sql = neon(process.env.DATABASE_URL);

  await sql`
    CREATE TABLE IF NOT EXISTS budget_plans (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      type text NOT NULL CHECK (type IN ('overall', 'category')),
      month text NOT NULL CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
      amount numeric(14, 2) NOT NULL CHECK (amount >= 0),
      category_id uuid REFERENCES categories (id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT budget_plans_type_category_check CHECK (
        (type = 'overall' AND category_id IS NULL)
        OR (type = 'category' AND category_id IS NOT NULL)
      )
    )
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS budget_plans_user_month_overall_idx
      ON budget_plans (user_id, month)
      WHERE type = 'overall'
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS budget_plans_user_month_category_idx
      ON budget_plans (user_id, month, category_id)
      WHERE type = 'category'
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS budget_plans_user_month_idx
      ON budget_plans (user_id, month)
  `;

  await sql`
    CREATE OR REPLACE FUNCTION set_budget_plans_updated_at()
    RETURNS trigger AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `;

  await sql`DROP TRIGGER IF EXISTS budget_plans_set_updated_at ON budget_plans`;

  await sql`
    CREATE TRIGGER budget_plans_set_updated_at
    BEFORE UPDATE ON budget_plans
    FOR EACH ROW
    EXECUTE FUNCTION set_budget_plans_updated_at()
  `;

  console.log("Budget plans schema is ready.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
