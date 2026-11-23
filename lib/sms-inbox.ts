import { createHash } from "crypto";
import { sql } from "./db";
import { decryptText, decryptNumber, decryptOptionalNumber, keyedFingerprint } from "./text-encryption";
import { getUserCurrency } from "./user-currency";
import { getSmsTransactionDateSource } from "./user-sms-settings";
import { ensureDefaultCategoriesForScope } from "./bajeti-scope";
import type { SmsRuleRow } from "./counterparty-helpers";
import { previewSms, type SmsPreviewContext } from "./sms-preview-service";
import type { InboxMessage, InboxPreview } from "./sms-inbox-types";

export type InboxRow = {
  id: string; sender: string; message_encrypted: string; received_at: string;
  fingerprint: string;
  account_id: string | null; status: InboxMessage["status"]; transaction_id: string | null;
};

export function smsRequest(message: string, timestamp: number, accountId?: string | null) {
  return new Request("http://bajeti.internal/api/sms", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, timestamp, accountId }),
  });
}

type InboxContext = { preview: SmsPreviewContext; saved: Map<string, string> };

export async function inspectInboxMessage(userId: string, row: InboxRow, context?: InboxContext): Promise<InboxMessage & { smsIdempotencyKey: string | null }> {
  const message = decryptText(row.message_encrypted, { userId, field: "sms_message" });
  const timestamp = new Date(row.received_at).getTime();
  const response = await previewSms(userId, smsRequest(message, timestamp), context?.preview);
  if (!response.ok) throw new Error("Could not preview inbox message");
  const result = await response.json() as { preview: InboxPreview | null; status: string; reason?: string; smsIdempotencyKey?: string };
  let status = result.status;
  let transactionId = row.transaction_id;
  const keys: string[] = [];
  const rawKey = result.smsIdempotencyKey;
  if (rawKey) {
    const legacy = createHash("sha256").update(rawKey).digest("hex");
    keys.push(rawKey, legacy, keyedFingerprint(rawKey, "sms_idempotency"), keyedFingerprint(legacy, "sms_idempotency"));
  }
  const existingId = context
    ? [row.fingerprint, ...keys].map(key => context.saved.get(key)).find(Boolean)
    : (await sql`SELECT id FROM transactions WHERE user_id = ${userId} AND group_id IS NULL
      AND (sms_idempotency_key IN (SELECT jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb)) OR sms_raw_hash = ${row.fingerprint}) LIMIT 1`)[0]?.id as string | undefined;
  if (existingId) {
    status = "duplicate";
    transactionId = existingId;
  }
  return {
    id: row.id, sender: row.sender, message, timestamp, accountId: row.account_id,
    status: row.status, transactionId, preview: result.preview,
    previewStatus: status, reason: status === "duplicate" ? "Already saved" : result.reason ?? null,
    smsIdempotencyKey: result.smsIdempotencyKey ?? null,
  };
}

export async function inspectPendingMessages(userId: string, month: string) {
  // One SQL statement gives pending rows and saved transactions the same database snapshot.
  // A concurrent import is therefore either pending or saved in this preview, never both.
  const snapshot = await sql`SELECT
    COALESCE((SELECT jsonb_agg(i ORDER BY i.received_at DESC, i.id) FROM sms_inbox i WHERE i.user_id = ${userId} AND i.status = 'pending'), '[]'::jsonb) AS inbox,
    COALESCE((SELECT jsonb_agg(t) FROM (
      SELECT id, sms_idempotency_key, sms_raw_hash, date::text, type::text, amount_encrypted, transaction_charges, transaction_charges_encrypted
      FROM transactions WHERE user_id = ${userId} AND group_id IS NULL
    ) t), '[]'::jsonb) AS saved`;
  const savedRows = snapshot[0].saved as { id: string; sms_idempotency_key: string | null; sms_raw_hash: string | null; date: string; type: string; amount_encrypted: string; transaction_charges: number | null; transaction_charges_encrypted: string | null }[];
  const saved = new Map<string, string>();
  let savedBalance = 0;
  for (const row of savedRows) {
    if (row.sms_idempotency_key) saved.set(row.sms_idempotency_key, row.id);
    if (row.sms_raw_hash) saved.set(row.sms_raw_hash, row.id);
    if (!row.date.startsWith(month)) continue;
    const amount = Math.abs(decryptNumber(row.amount_encrypted, null, { userId, field: "amount" }));
    if (row.type === "income") savedBalance += amount;
    if (row.type === "expense") savedBalance -= amount + Math.max(0, decryptOptionalNumber(row.transaction_charges_encrypted, row.transaction_charges, { userId, field: "transaction_charges" }) ?? 0);
  }
  const rows = (snapshot[0].inbox as InboxRow[]).filter(row => !saved.has(row.fingerprint));
  if (!rows.length) return { messages: [], savedBalance };
  await ensureDefaultCategoriesForScope(userId, null);
  const [categories, rules, currency, dateSource] = await Promise.all([
    sql`SELECT id, name, type::text AS type FROM categories WHERE user_id = ${userId} AND group_id IS NULL ORDER BY type, name`,
    sql`SELECT counterparty_key, transaction_type::text, category_id, transfer_to_account_id FROM counterparty_category_rules WHERE user_id = ${userId}`,
    getUserCurrency(userId), getSmsTransactionDateSource(userId),
  ]);
  const context: InboxContext = { preview: { categories: categories as { id: string; name: string; type: string }[], rules: rules as SmsRuleRow[], currency, dateSource }, saved };
  const messages: InboxMessage[] = [];
  const seen = new Set<string>();
  // Bound database concurrency while preserving deterministic duplicate selection.
  for (let index = 0; index < rows.length; index += 5) {
    const batch = await Promise.all(rows.slice(index, index + 5).map(row => inspectInboxMessage(userId, row, context)));
    for (const item of batch) {
      if (item.previewStatus === "duplicate" && item.transactionId) continue;
      if (item.smsIdempotencyKey && seen.has(item.smsIdempotencyKey)) {
        item.previewStatus = "duplicate";
        item.reason = "Another pending message represents this transaction";
      }
      if (item.smsIdempotencyKey) seen.add(item.smsIdempotencyKey);
      messages.push(item);
    }
  }
  return { messages, savedBalance };
}
