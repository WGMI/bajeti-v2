import { createHmac } from "crypto";
import { existsSync } from "fs";
import { resolve } from "path";
import { neon } from "@neondatabase/serverless";

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

function fingerprint(input, purpose, key) {
  const digest = createHmac("sha256", key)
    .update(`bajeti-v2:fingerprint:${purpose}\0${input}`, "utf8")
    .digest("hex");
  return `hmac:v1:${digest}`;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const sql = neon(process.env.DATABASE_URL);
  const key = getKey();

  const missing = await sql`
    SELECT COUNT(*)::int AS count
    FROM transactions
    WHERE amount_encrypted IS NULL
      OR (transaction_charges IS NOT NULL AND transaction_charges_encrypted IS NULL)
      OR (original_amount IS NOT NULL AND original_amount_encrypted IS NULL)
      OR (fx_rate IS NOT NULL AND fx_rate_encrypted IS NULL)
  `;
  if (missing[0].count > 0) {
    throw new Error(
      `${missing[0].count} rows are not fully encrypted; run the backfill first`
    );
  }

  const existingFingerprints = await sql`
    SELECT id, user_id, sms_idempotency_key
    FROM transactions
    WHERE sms_idempotency_key IS NOT NULL
  `;
  const existingByUserAndKey = new Map(
    existingFingerprints.map((row) => [`${row.user_id}\0${row.sms_idempotency_key}`, row.id])
  );

  const legacyFingerprints = await sql`
    SELECT id, user_id, sms_idempotency_key, sms_raw_hash
    FROM transactions
    WHERE sms_raw_hash IS NOT NULL
      AND (
        sms_idempotency_key NOT LIKE 'hmac:v1:%'
        OR sms_raw_hash NOT LIKE 'hmac:v1:%'
      )
  `;
  if (legacyFingerprints.length > 0) {
    const reservedTargets = new Map();
    const protectedFingerprints = legacyFingerprints.map((row) => {
      let smsIdempotencyKey = row.sms_idempotency_key?.startsWith("hmac:v1:")
        ? row.sms_idempotency_key
        : fingerprint(row.sms_idempotency_key, "sms_idempotency", key);
      const targetKey = `${row.user_id}\0${smsIdempotencyKey}`;
      const existingId = existingByUserAndKey.get(targetKey);
      const reservedId = reservedTargets.get(targetKey);

      if ((existingId && existingId !== row.id) || (reservedId && reservedId !== row.id)) {
        smsIdempotencyKey = fingerprint(`${row.sms_idempotency_key}\0${row.id}`, "sms_idempotency", key);
      }
      reservedTargets.set(targetKey, row.id);

      return {
        id: row.id,
        sms_idempotency_key: smsIdempotencyKey,
        sms_raw_hash: row.sms_raw_hash.startsWith("hmac:v1:")
          ? row.sms_raw_hash
          : fingerprint(row.sms_raw_hash, "sms_raw", key),
      };
    });
    await sql`
      UPDATE transactions AS transaction
      SET
        sms_idempotency_key = protected.sms_idempotency_key,
        sms_raw_hash = protected.sms_raw_hash
      FROM jsonb_to_recordset(${JSON.stringify(protectedFingerprints)}::jsonb) AS protected(
        id uuid,
        sms_idempotency_key text,
        sms_raw_hash text
      )
      WHERE transaction.id = protected.id
    `;
  }

  await sql`
    UPDATE transactions
    SET
      amount = NULL,
      transaction_charges = NULL,
      original_amount = NULL,
      fx_rate = NULL
  `;
  console.log("Done. Plaintext transaction numeric fields have been cleared.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
