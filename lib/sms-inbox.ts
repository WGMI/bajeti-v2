import { createHash } from "crypto";
import { sql } from "./db";
import { decryptText, decryptNumber, decryptOptionalNumber, keyedFingerprint } from "./text-encryption";
import { getUserCurrency } from "./user-currency";
import { getSmsTransactionDateSource } from "./user-sms-settings";
import { ensureDefaultCategoriesForScope } from "./bajeti-scope";
import type { SmsRuleRow } from "./counterparty-helpers";
import { previewSms, type SmsPreviewContext } from "./sms-preview-service";
import { extractSmsCurrencyAmounts } from "./sms-parser";
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

type SavedSmsRow = {
  id: string;
  sms_raw_hash: string | null;
  sms_idempotency_key: string | null;
  sms_message: string | null;
  type: string;
  transfer_group_id: string | null;
  transfer_leg: string | null;
};

// A bank confirmation and an M-PESA confirmation can describe the same
// transfer. Require the provider's transaction code and the original amount.
function mpesaConfirmationKey(message: string): string | null {
  const code = message.match(/^\s*([a-z0-9]{8,16})\s+confirmed\b/i)?.[1]
    ?? message.match(/\bm[- ]?pesa\s+ref(?:erence)?\.?\s*[:#-]?\s*([a-z0-9]{8,16})\b/i)?.[1];
  if (!code || !/[a-z]/i.test(code) || !/\d/.test(code)) return null;
  const [amount] = extractSmsCurrencyAmounts(message);
  return amount?.amount > 0 ? `${code.toUpperCase()}|${amount.currency}|${amount.amount}` : null;
}

function indexSavedSms(userId: string, rows: SavedSmsRow[]) {
  const fingerprints = new Map<string, string>();
  const idempotencyKeys = new Map<string, string>();
  const confirmations = new Map<string, string | null>();
  const outLegs = new Map<string, string>();
  const inLegs = new Set<string>();
  for (const row of rows) {
    if (row.sms_raw_hash) fingerprints.set(row.sms_raw_hash, row.id);
    if (row.sms_idempotency_key) idempotencyKeys.set(row.sms_idempotency_key, row.id);
    if (row.type !== "transfer" || !row.transfer_group_id) continue;
    if (row.transfer_leg === "out") outLegs.set(row.transfer_group_id, row.id);
    if (row.transfer_leg === "in") inLegs.add(row.transfer_group_id);
  }
  for (const row of rows) {
    if (row.type !== "transfer" || !row.sms_message) continue;
    const message = decryptText(row.sms_message, { userId, field: "sms_message" });
    const fingerprint = keyedFingerprint(message.replace(/\s+/g, " ").trim().toLowerCase(), "sms_raw");
    const outLeg = row.transfer_group_id ? outLegs.get(row.transfer_group_id) : undefined;
    if (!fingerprints.has(fingerprint)) fingerprints.set(fingerprint, outLeg ?? row.id);

    if (!outLeg || !row.transfer_group_id || !inLegs.has(row.transfer_group_id)) continue;
    const key = mpesaConfirmationKey(message);
    if (!key) continue;
    // Leave an ambiguous confirmation pending if it matches multiple transfers.
    if (!confirmations.has(key)) confirmations.set(key, outLeg);
    else if (confirmations.get(key) !== outLeg) confirmations.set(key, null);
  }
  return { fingerprints, idempotencyKeys, confirmations };
}

function matchSavedMessage(userId: string, saved: ReturnType<typeof indexSavedSms>, row: InboxRow, message?: string) {
  const exact = saved.fingerprints.get(row.fingerprint);
  if (exact) return exact;
  if (!saved.confirmations.size) return;
  const confirmation = mpesaConfirmationKey(message ?? decryptText(row.message_encrypted, { userId, field: "sms_message" }));
  return confirmation ? saved.confirmations.get(confirmation) : undefined;
}

type InboxContext = { preview: SmsPreviewContext; saved: ReturnType<typeof indexSavedSms> };

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
  let existingId = context
    ? keys.map(key => context.saved.idempotencyKeys.get(key)).find(Boolean)
    : (await sql`SELECT id FROM transactions WHERE user_id = ${userId} AND group_id IS NULL
      AND (sms_idempotency_key IN (SELECT jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb)) OR sms_raw_hash = ${row.fingerprint}) LIMIT 1`)[0]?.id as string | undefined;
  if (!context && !existingId) {
    const transfers = await sql`
      SELECT id, type::text, sms_message, sms_raw_hash, sms_idempotency_key, transfer_group_id, transfer_leg::text
      FROM transactions WHERE user_id = ${userId} AND group_id IS NULL AND type = 'transfer'
    ` as SavedSmsRow[];
    existingId = matchSavedMessage(userId, indexSavedSms(userId, transfers), row, message) ?? undefined;
  }
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

async function readInboxSnapshot(userId: string, includeHandled: boolean) {
  // One SQL statement gives pending rows and saved transactions the same database snapshot.
  // A concurrent import is therefore either pending or saved in this preview, never both.
  const snapshot = await sql`SELECT
    COALESCE((SELECT jsonb_agg(
      CASE WHEN i.status = 'pending' THEN to_jsonb(i) ELSE jsonb_build_object('id', i.id, 'status', i.status) END
      ORDER BY i.received_at DESC, i.id
    ) FROM sms_inbox i WHERE i.user_id = ${userId} AND (${includeHandled}::boolean OR i.status = 'pending')), '[]'::jsonb) AS inbox,
    COALESCE((SELECT jsonb_agg(t) FROM (
      SELECT id, sms_idempotency_key, sms_raw_hash, date::text, type::text, amount_encrypted, transaction_charges, transaction_charges_encrypted,
        CASE WHEN type = 'transfer' THEN sms_message END AS sms_message, transfer_group_id, transfer_leg::text
      FROM transactions WHERE user_id = ${userId} AND group_id IS NULL
        AND (NOT ${includeHandled}::boolean OR sms_raw_hash IS NOT NULL OR type = 'transfer')
    ) t), '[]'::jsonb) AS saved`;
  return snapshot[0] as {
    inbox: InboxRow[];
    saved: (SavedSmsRow & { date: string; amount_encrypted: string; transaction_charges: number | null; transaction_charges_encrypted: string | null })[];
  };
}

export async function inspectInboxStates(userId: string) {
  const { inbox, saved: savedRows } = await readInboxSnapshot(userId, true);
  const saved = inbox.some(row => row.status === "pending") ? indexSavedSms(userId, savedRows) : null;
  return inbox.map(row => {
    const status = saved && row.status === "pending" && matchSavedMessage(userId, saved, row) ? "synced" : row.status;
    return { id: row.id, status };
  });
}

export async function inspectPendingMessages(userId: string, month: string) {
  const { inbox, saved: savedRows } = await readInboxSnapshot(userId, false);
  let savedBalance = 0;
  for (const row of savedRows) {
    if (!row.date.startsWith(month)) continue;
    const amount = Math.abs(decryptNumber(row.amount_encrypted, null, { userId, field: "amount" }));
    if (row.type === "income") savedBalance += amount;
    if (row.type === "expense") savedBalance -= amount + Math.max(0, decryptOptionalNumber(row.transaction_charges_encrypted, row.transaction_charges, { userId, field: "transaction_charges" }) ?? 0);
  }
  if (!inbox.length) return { messages: [], savedBalance };
  const saved = indexSavedSms(userId, savedRows);
  const rows = inbox.filter(row => !matchSavedMessage(userId, saved, row));
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
