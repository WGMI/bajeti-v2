import { createDecipheriv } from "crypto";
import { existsSync } from "fs";
import { resolve } from "path";
import { neon } from "@neondatabase/serverless";

const PREFIX = "bajeti:enc:v1";
const FIELDS = [
  ["amount", "amount_encrypted"],
  ["transaction_charges", "transaction_charges_encrypted"],
  ["original_amount", "original_amount_encrypted"],
  ["fx_rate", "fx_rate_encrypted"],
];

for (const filename of [".env.local", ".env"]) {
  const envPath = resolve(process.cwd(), filename);
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}

function getKey() {
  const raw = process.env.BAJETI_TEXT_ENCRYPTION_KEY;
  if (!raw) throw new Error("BAJETI_TEXT_ENCRYPTION_KEY is required");
  const trimmed = raw.trim();
  const key = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  if (key.length !== 32) throw new Error("Encryption key must decode to 32 bytes");
  return key;
}

function decrypt(value, userId, field, key) {
  const parts = value.split(":");
  if (parts.slice(0, 3).join(":") !== PREFIX || parts.length !== 6) {
    throw new Error(`Invalid ciphertext for ${field}`);
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(parts[3], "base64url")
  );
  decipher.setAAD(Buffer.from(`bajeti-v2:${userId}:${field}`, "utf8"));
  decipher.setAuthTag(Buffer.from(parts[4], "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(parts[5], "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const sql = neon(process.env.DATABASE_URL);
  const key = getKey();
  const columns = await sql`
    SELECT column_name, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'transactions'
      AND column_name IN ('amount', 'transaction_charges')
  `;
  for (const column of columns) {
    if (column.is_nullable !== "YES") {
      throw new Error(`Legacy column ${column.column_name} must be nullable`);
    }
  }
  const rows = await sql`
    SELECT
      id,
      user_id,
      type::text AS type,
      amount::text AS amount,
      transaction_charges::text AS transaction_charges,
      original_amount::text AS original_amount,
      fx_rate::text AS fx_rate,
      amount_encrypted,
      transaction_charges_encrypted,
      original_amount_encrypted,
      fx_rate_encrypted
    FROM transactions
  `;

  let encryptedValues = 0;
  const decryptedTotals = new Map();
  for (const row of rows) {
    const decrypted = {};
    for (const [plainField, encryptedField] of FIELDS) {
      const plaintext = row[plainField];
      const ciphertext = row[encryptedField];
      if (plainField === "amount" && !ciphertext) {
        throw new Error(`Transaction ${row.id} has no encrypted amount`);
      }
      if (!ciphertext) continue;
      const value = decrypt(ciphertext, row.user_id, plainField, key);
      if (!Number.isFinite(Number(value))) {
        throw new Error(`Transaction ${row.id} has invalid encrypted ${plainField}`);
      }
      if (plaintext != null && Number(plaintext) !== Number(value)) {
        throw new Error(`Transaction ${row.id} has mismatched ${plainField}`);
      }
      decrypted[plainField] = Number(value);
      encryptedValues += 1;
    }
    const totals = decryptedTotals.get(row.user_id) ?? { income: 0, expense: 0 };
    if (row.type === "income") totals.income += Math.abs(decrypted.amount);
    if (row.type === "expense") {
      totals.expense +=
        Math.abs(decrypted.amount) + Math.max(0, decrypted.transaction_charges ?? 0);
    }
    decryptedTotals.set(row.user_id, totals);
  }

  if (rows.some((row) => row.amount != null)) {
    const plaintextTotals = await sql`
      SELECT
        user_id,
        COALESCE(SUM(CASE WHEN type = 'income' THEN ABS(amount) ELSE 0 END), 0)::text
          AS income,
        COALESCE(SUM(
          CASE WHEN type = 'expense'
            THEN ABS(amount) + COALESCE(transaction_charges, 0)
            ELSE 0
          END
        ), 0)::text AS expense
      FROM transactions
      GROUP BY user_id
    `;
    for (const plaintext of plaintextTotals) {
      const decrypted = decryptedTotals.get(plaintext.user_id) ?? {
        income: 0,
        expense: 0,
      };
      if (
        Math.abs(decrypted.income - Number(plaintext.income)) > 0.000001 ||
        Math.abs(decrypted.expense - Number(plaintext.expense)) > 0.000001
      ) {
        throw new Error(`Decrypted totals do not match for user ${plaintext.user_id}`);
      }
    }
  }

  console.log(
    `Verified ${encryptedValues} encrypted numeric values across ${rows.length} transaction rows.`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
