import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { neon } from "@neondatabase/serverless";

const PREFIX = "bajeti:enc:v1";
const KEY_ENV = "BAJETI_TEXT_ENCRYPTION_KEY";

function cleanEnv(value) {
  return value?.trim().replace(/^['"]|['"]$/g, "");
}

function getKey() {
  const raw = cleanEnv(process.env[KEY_ENV]);
  if (!raw) throw new Error(`${KEY_ENV} is required`);
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error(`${KEY_ENV} must decode to 32 bytes`);
  return key;
}

function isEncryptedText(value) {
  return typeof value === "string" && value.startsWith(`${PREFIX}:`);
}

function aadFor(subjectId, field) {
  return Buffer.from(`bajeti-v2:${subjectId}:${field}`, "utf8");
}

function decryptText(value, subjectId, field) {
  if (!value) return "";
  if (!isEncryptedText(value)) return value;
  const [, , , ivPart, tagPart, ciphertextPart] = value.split(":");
  if (!ivPart || !tagPart || ciphertextPart == null) {
    throw new Error("Invalid encrypted text");
  }
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivPart, "base64url"));
  decipher.setAAD(aadFor(subjectId, field));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function encryptText(value, subjectId, field) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  cipher.setAAD(aadFor(subjectId, field));
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

function reencryptValue(value, fromSubjectId, toSubjectId, field) {
  if (value == null) return { value, changed: false };
  try {
    decryptText(value, toSubjectId, field);
    return { value, changed: false };
  } catch {
    const plaintext = decryptText(value, fromSubjectId, field);
    return { value: encryptText(plaintext, toSubjectId, field), changed: true };
  }
}

const databaseUrl = cleanEnv(process.env.DATABASE_URL);
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const sql = neon(databaseUrl);

const rows = await sql`
  SELECT
    id,
    user_id,
    group_id,
    amount_encrypted,
    transaction_charges_encrypted,
    original_amount_encrypted,
    fx_rate_encrypted,
    notes,
    sms_message
  FROM transactions
  WHERE group_id IS NOT NULL
`;

let updated = 0;
let skipped = 0;

for (const row of rows) {
  const next = {
    amount_encrypted: reencryptValue(row.amount_encrypted, row.user_id, row.group_id, "amount"),
    transaction_charges_encrypted: reencryptValue(
      row.transaction_charges_encrypted,
      row.user_id,
      row.group_id,
      "transaction_charges"
    ),
    original_amount_encrypted: reencryptValue(
      row.original_amount_encrypted,
      row.user_id,
      row.group_id,
      "original_amount"
    ),
    fx_rate_encrypted: reencryptValue(row.fx_rate_encrypted, row.user_id, row.group_id, "fx_rate"),
    notes: reencryptValue(row.notes, row.user_id, row.group_id, "notes"),
    sms_message: reencryptValue(row.sms_message, row.user_id, row.group_id, "sms_message"),
  };

  if (!Object.values(next).some((entry) => entry.changed)) {
    skipped += 1;
    continue;
  }

  await sql`
    UPDATE transactions
    SET
      amount_encrypted = ${next.amount_encrypted.value},
      transaction_charges_encrypted = ${next.transaction_charges_encrypted.value},
      original_amount_encrypted = ${next.original_amount_encrypted.value},
      fx_rate_encrypted = ${next.fx_rate_encrypted.value},
      notes = ${next.notes.value},
      sms_message = ${next.sms_message.value}
    WHERE id = ${row.id}
  `;
  updated += 1;
}

console.log(JSON.stringify({ scanned: rows.length, updated, skipped }, null, 2));
