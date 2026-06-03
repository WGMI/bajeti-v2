import { neon } from "@neondatabase/serverless";
import fs from "fs";
import path from "path";

const envPath = path.join(process.cwd(), ".env");
const url =
  process.env.DATABASE_URL ??
  fs.readFileSync(envPath, "utf8").match(/DATABASE_URL='([^']+)'/)?.[1];
if (!url) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = neon(url);

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS fx_rates (
      rate_date date NOT NULL,
      base_currency text NOT NULL,
      quote_currency text NOT NULL,
      rate numeric(20, 10) NOT NULL,
      source text NOT NULL DEFAULT 'frankfurter',
      fetched_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (rate_date, base_currency, quote_currency)
    )
  `;
  await sql`
    ALTER TABLE transactions
      ADD COLUMN IF NOT EXISTS currency text,
      ADD COLUMN IF NOT EXISTS original_amount numeric,
      ADD COLUMN IF NOT EXISTS original_currency text,
      ADD COLUMN IF NOT EXISTS fx_rate numeric(20, 10),
      ADD COLUMN IF NOT EXISTS fx_rate_date date,
      ADD COLUMN IF NOT EXISTS fx_source text
  `;
  console.log("Migration complete: fx_rates + transaction currency columns");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
