import { createCipheriv, randomBytes } from "crypto";
import { existsSync } from "fs";
import { resolve } from "path";
import { neon } from "@neondatabase/serverless";

const PREFIX = "bajeti:enc:v1";
const KEY_ENV = "BAJETI_TEXT_ENCRYPTION_KEY";
const BATCH_SIZE = 100;
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
  const raw = process.env[KEY_ENV];
  if (!raw) throw new Error(`${KEY_ENV} is required`);
  const trimmed = raw.trim();
  const key = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  if (key.length !== 32) throw new Error(`${KEY_ENV} must decode to 32 bytes`);
  return key;
}

function encrypt(value, userId, field, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`bajeti-v2:${userId}:${field}`, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(String(value), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const sql = neon(process.env.DATABASE_URL);
  const key = getKey();
  let updated = 0;

  for (;;) {
    const rows = await sql`
      SELECT
        id,
        user_id,
        amount::text AS amount,
        transaction_charges::text AS transaction_charges,
        original_amount::text AS original_amount,
        fx_rate::text AS fx_rate,
        amount_encrypted,
        transaction_charges_encrypted,
        original_amount_encrypted,
        fx_rate_encrypted
      FROM transactions
      WHERE
        (amount IS NOT NULL AND amount_encrypted IS NULL)
        OR (transaction_charges IS NOT NULL AND transaction_charges_encrypted IS NULL)
        OR (original_amount IS NOT NULL AND original_amount_encrypted IS NULL)
        OR (fx_rate IS NOT NULL AND fx_rate_encrypted IS NULL)
      ORDER BY id
      LIMIT ${BATCH_SIZE}
    `;
    if (rows.length === 0) break;

    const batch = rows.map((row) => {
      const encrypted = Object.fromEntries(
        FIELDS.map(([plainField, encryptedField]) => [
          encryptedField,
          row[encryptedField] ??
            (row[plainField] == null
              ? null
              : encrypt(row[plainField], row.user_id, plainField, key)),
        ])
      );
      return { id: row.id, ...encrypted };
    });
    await sql`
      UPDATE transactions AS transaction
      SET
        amount_encrypted = batch.amount_encrypted,
        transaction_charges_encrypted = batch.transaction_charges_encrypted,
        original_amount_encrypted = batch.original_amount_encrypted,
        fx_rate_encrypted = batch.fx_rate_encrypted
      FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS batch(
        id uuid,
        amount_encrypted text,
        transaction_charges_encrypted text,
        original_amount_encrypted text,
        fx_rate_encrypted text
      )
      WHERE transaction.id = batch.id
    `;
    updated += rows.length;
    console.log(`Encrypted numeric fields on ${updated} transaction rows...`);
  }

  console.log(`Done. Encrypted numeric fields on ${updated} transaction rows.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
