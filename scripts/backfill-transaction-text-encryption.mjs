import { createCipheriv, randomBytes } from "crypto";
import { existsSync } from "fs";
import { resolve } from "path";
import { neon } from "@neondatabase/serverless";

const PREFIX = "bajeti:enc:v1";
const KEY_ENV = "BAJETI_TEXT_ENCRYPTION_KEY";
const BATCH_SIZE = 100;

for (const filename of [".env.local", ".env"]) {
  const envPath = resolve(process.cwd(), filename);
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}

function getKey() {
  const raw = process.env[KEY_ENV];
  if (!raw) throw new Error(`${KEY_ENV} is required`);
  const trimmed = raw.trim();
  const key =
    /^[0-9a-f]{64}$/i.test(trimmed)
      ? Buffer.from(trimmed, "hex")
      : Buffer.from(trimmed, "base64");
  if (key.length !== 32) throw new Error(`${KEY_ENV} must decode to 32 bytes`);
  return key;
}

function isEncrypted(value) {
  return typeof value === "string" && value.startsWith(`${PREFIX}:`);
}

function aadFor(userId, field) {
  return Buffer.from(`bajeti-v2:${userId}:${field}`, "utf8");
}

function encrypt(value, userId, field, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aadFor(userId, field));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
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
      SELECT id, user_id, notes, sms_message
      FROM transactions
      WHERE
        (notes IS NOT NULL AND notes NOT LIKE 'bajeti:enc:v1:%')
        OR (sms_message IS NOT NULL AND sms_message NOT LIKE 'bajeti:enc:v1:%')
      ORDER BY id
      LIMIT ${BATCH_SIZE}
    `;

    if (rows.length === 0) break;

    for (const row of rows) {
      const notes = isEncrypted(row.notes)
        ? row.notes
        : encrypt(row.notes ?? "", row.user_id, "notes", key);
      const smsMessage =
        row.sms_message == null || isEncrypted(row.sms_message)
          ? row.sms_message
          : encrypt(row.sms_message, row.user_id, "sms_message", key);

      await sql`
        UPDATE transactions
        SET notes = ${notes}, sms_message = ${smsMessage}
        WHERE id = ${row.id} AND user_id = ${row.user_id}
      `;
      updated += 1;
    }

    console.log(`Encrypted ${updated} transaction rows...`);
  }

  console.log(`Done. Encrypted ${updated} transaction rows.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
