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
    ALTER TABLE transactions
      ADD COLUMN IF NOT EXISTS amount_encrypted text,
      ADD COLUMN IF NOT EXISTS transaction_charges_encrypted text,
      ADD COLUMN IF NOT EXISTS original_amount_encrypted text,
      ADD COLUMN IF NOT EXISTS fx_rate_encrypted text
  `;
  await sql`ALTER TABLE transactions ALTER COLUMN amount DROP NOT NULL`;
  await sql`ALTER TABLE transactions ALTER COLUMN transaction_charges DROP NOT NULL`;
  await sql`ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_amount_positive`;
  console.log("Transaction numeric encryption schema is ready.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
