import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "crypto";

const PREFIX = "bajeti:enc:v1";
const KEY_ENV = "BAJETI_TEXT_ENCRYPTION_KEY";

type TextField = "notes" | "sms_message";
export type NumericField =
  | "amount"
  | "transaction_charges"
  | "original_amount"
  | "fx_rate";
type EncryptedField = TextField | NumericField;

type TextEncryptionContext = {
  userId: string;
  field: EncryptedField;
};

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function getKey(): Buffer {
  const raw = process.env[KEY_ENV];
  if (!raw) {
    throw new Error(`${KEY_ENV} is required to encrypt transaction text`);
  }

  const trimmed = raw.trim();
  const key =
    /^[0-9a-f]{64}$/i.test(trimmed)
      ? Buffer.from(trimmed, "hex")
      : Buffer.from(trimmed, "base64");

  if (key.length !== 32) {
    throw new Error(`${KEY_ENV} must decode to 32 bytes`);
  }
  return key;
}

function aadFor(context: TextEncryptionContext): Buffer {
  return Buffer.from(`bajeti-v2:${context.userId}:${context.field}`, "utf8");
}

export function isEncryptedText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(`${PREFIX}:`);
}

export function encryptText(plaintext: string, context: TextEncryptionContext): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  cipher.setAAD(aadFor(context));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [PREFIX, base64Url(iv), base64Url(tag), base64Url(ciphertext)].join(":");
}

export function encryptOptionalText(
  plaintext: string | null | undefined,
  context: TextEncryptionContext
): string | null {
  if (plaintext == null) return null;
  return encryptText(plaintext, context);
}

export function decryptText(value: string | null | undefined, context: TextEncryptionContext): string {
  if (!value) return "";
  if (!isEncryptedText(value)) return value;

  const [, , , ivPart, tagPart, ciphertextPart] = value.split(":");
  if (!ivPart || !tagPart || ciphertextPart == null) {
    throw new Error("Invalid encrypted transaction text");
  }

  const decipher = createDecipheriv("aes-256-gcm", getKey(), fromBase64Url(ivPart));
  decipher.setAAD(aadFor(context));
  decipher.setAuthTag(fromBase64Url(tagPart));
  return Buffer.concat([
    decipher.update(fromBase64Url(ciphertextPart)),
    decipher.final(),
  ]).toString("utf8");
}

export function decryptOptionalText(
  value: string | null | undefined,
  context: TextEncryptionContext
): string | null {
  if (value == null) return null;
  return decryptText(value, context);
}

export function encryptNumber(
  value: string | number,
  context: { userId: string; field: NumericField }
): string {
  const serialized = String(value);
  if (!serialized || !Number.isFinite(Number(serialized))) {
    throw new Error(`Invalid numeric value for ${context.field}`);
  }
  return encryptText(serialized, context);
}

export function encryptOptionalNumber(
  value: string | number | null | undefined,
  context: { userId: string; field: NumericField }
): string | null {
  return value == null || value === "" ? null : encryptNumber(value, context);
}

export function decryptOptionalNumber(
  encryptedValue: string | null | undefined,
  legacyValue: string | number | null | undefined,
  context: { userId: string; field: NumericField }
): number | null {
  const serialized = encryptedValue
    ? decryptText(encryptedValue, context)
    : legacyValue == null || legacyValue === ""
      ? null
      : String(legacyValue);
  if (serialized == null) return null;

  const value = Number(serialized);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid decrypted numeric value for ${context.field}`);
  }
  return value;
}

export function decryptNumber(
  encryptedValue: string | null | undefined,
  legacyValue: string | number | null | undefined,
  context: { userId: string; field: NumericField }
): number {
  const value = decryptOptionalNumber(encryptedValue, legacyValue, context);
  if (value == null) throw new Error(`Missing numeric value for ${context.field}`);
  return value;
}

export function keyedFingerprint(
  input: string,
  purpose: "sms_idempotency" | "sms_raw"
): string {
  const digest = createHmac("sha256", getKey())
    .update(`bajeti-v2:fingerprint:${purpose}\0${input}`, "utf8")
    .digest("hex");
  return `hmac:v1:${digest}`;
}
