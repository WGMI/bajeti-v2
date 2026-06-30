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

  const columns = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'transactions'
      AND column_name IN ('amount', 'amount_encrypted')
  `;
  const columnNames = new Set(columns.map((row) => row.column_name));

  if (!columnNames.has("amount")) {
    console.log("Done. transactions.amount is already absent.");
    return;
  }
  if (!columnNames.has("amount_encrypted")) {
    throw new Error("transactions.amount_encrypted is missing; refusing to drop amount");
  }

  const missing = await sql`
    SELECT COUNT(*)::int AS count
    FROM transactions
    WHERE amount_encrypted IS NULL
  `;
  if (missing[0].count > 0) {
    throw new Error(`${missing[0].count} rows are missing amount_encrypted; run backfill first`);
  }

  await sql`ALTER TABLE transactions DROP COLUMN amount`;
  console.log("Done. Dropped transactions.amount.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
