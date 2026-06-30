import { randomUUID } from "crypto";
import { sql } from "@/lib/db";
import { ensureDefaultAccount, resolveAccountId } from "@/lib/accounts";
import { createTransferPair } from "@/lib/transfers";
import { rowToTransaction, type TransactionRow } from "@/lib/transaction-api";
import {
  decryptNumber,
  decryptOptionalText,
  decryptText,
  encryptNumber,
  encryptText,
} from "@/lib/text-encryption";
import type { CategoryType } from "@/lib/budget-types";

/** Rule column null means default Wallet at apply time. */
export async function resolveRuleTransferToAccountId(
  userId: string,
  ruleTransferToAccountId: string | null | undefined
): Promise<string> {
  return resolveAccountId(userId, ruleTransferToAccountId ?? undefined);
}

export function parseTransferToAccountIdFromBody(
  body: Record<string, unknown>,
  transactionType: CategoryType,
  options?: { missingFieldMeans?: "default" | "unchanged" }
): string | null | undefined {
  if (transactionType !== "transfer") return null;
  if (!("transferToAccountId" in body)) {
    return options?.missingFieldMeans === "unchanged" ? undefined : null;
  }
  const raw = body.transferToAccountId;
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string") return undefined;
  return raw.trim();
}

export async function validateTransferToAccountId(
  userId: string,
  accountId: string | null
): Promise<string | null> {
  if (!accountId) return null;
  const rows = await sql`
    SELECT id FROM accounts
    WHERE user_id = ${userId} AND id = ${accountId}
    LIMIT 1
  `;
  if (!rows[0]) {
    throw new Error("Transfer destination account not found");
  }
  return accountId;
}

export async function enrichTransactionRow(userId: string, id: string) {
  const enriched = await sql`
    SELECT
      t.id, t.user_id, t.amount_encrypted,
      t.transaction_charges, t.transaction_charges_encrypted,
      t.currency, t.original_amount, t.original_amount_encrypted, t.original_currency,
      t.fx_rate, t.fx_rate_encrypted, t.fx_rate_date::text AS fx_rate_date, t.fx_source,
      t.account_id, t.category_id, t.date::text AS date, t.notes, t.sms_message, t.type,
      t.sms_counterparty, t.sms_counterparty_key,
      t.transfer_group_id, t.transfer_leg::text AS transfer_leg,
      c.name AS category_name,
      ac.name AS account_name,
      mate.account_id AS counter_account_id,
      mate_ac.name AS counter_account_name
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN accounts ac ON ac.id = t.account_id
    LEFT JOIN transactions mate ON mate.user_id = t.user_id
      AND mate.transfer_group_id = t.transfer_group_id
      AND mate.id <> t.id
    LEFT JOIN accounts mate_ac ON mate_ac.id = mate.account_id
    WHERE t.user_id = ${userId} AND t.id = ${id}
    LIMIT 1
  `;
  const full = enriched[0] as TransactionRow | undefined;
  return full ? rowToTransaction(full) : null;
}

/** Pairs a lone SMS transfer leg (Wallet out) with an explicit destination account. */
async function pairLoneTransferToDestination(input: {
  userId: string;
  transactionId: string;
  toAccountId: string;
  categoryId: string;
}): Promise<void> {
  const fromAccountId = await ensureDefaultAccount(input.userId);
  if (fromAccountId === input.toAccountId) return;

  const rows = (await sql`
    SELECT amount_encrypted, date::text AS date, notes, sms_message, transfer_group_id
    FROM transactions
    WHERE user_id = ${input.userId} AND id = ${input.transactionId}
    LIMIT 1
  `) as {
    amount_encrypted: string | null;
    date: string;
    notes: string | null;
    sms_message: string | null;
    transfer_group_id: string | null;
  }[];
  const row = rows[0];
  if (!row) return;

  if (row.transfer_group_id) {
    await sql`
      UPDATE transactions
      SET account_id = ${input.toAccountId}
      WHERE user_id = ${input.userId}
        AND transfer_group_id = ${row.transfer_group_id}
        AND transfer_leg = 'in'
    `;
    await sql`
      UPDATE transactions
      SET account_id = ${fromAccountId}
      WHERE user_id = ${input.userId}
        AND transfer_group_id = ${row.transfer_group_id}
        AND transfer_leg = 'out'
    `;
    return;
  }

  const groupId = randomUUID();
  const amount = decryptNumber(row.amount_encrypted, null, {
    userId: input.userId,
    field: "amount",
  });
  const notes = decryptText(row.notes, { userId: input.userId, field: "notes" });
  const smsMessage = decryptOptionalText(row.sms_message, {
    userId: input.userId,
    field: "sms_message",
  });
  await sql`
    UPDATE transactions
    SET
      transfer_group_id = ${groupId},
      transfer_leg = 'out'::transfer_leg,
      account_id = ${fromAccountId},
      category_id = ${input.categoryId}
    WHERE user_id = ${input.userId} AND id = ${input.transactionId}
  `;
  await sql`
    INSERT INTO transactions (
      user_id,
      amount_encrypted,
      transaction_charges,
      transaction_charges_encrypted,
      category_id,
      account_id,
      date,
      notes,
      sms_message,
      type,
      transfer_group_id,
      transfer_leg
    )
    VALUES (
      ${input.userId},
      ${encryptNumber(amount, { userId: input.userId, field: "amount" })},
      ${null},
      ${encryptNumber(0, {
        userId: input.userId,
        field: "transaction_charges",
      })},
      ${input.categoryId},
      ${input.toAccountId},
      ${row.date}::date,
      ${encryptText(notes, { userId: input.userId, field: "notes" })},
      ${smsMessage == null
        ? null
        : encryptText(smsMessage, { userId: input.userId, field: "sms_message" })},
      'transfer'::category_type,
      ${groupId},
      'in'::transfer_leg
    )
  `;
}

export async function applyTransferDestinationToTransactionIds(input: {
  userId: string;
  transactionIds: string[];
  transferToAccountId: string | null;
  categoryId: string;
}): Promise<void> {
  if (input.transactionIds.length === 0) return;
  const toAccountId = await resolveRuleTransferToAccountId(
    input.userId,
    input.transferToAccountId
  );
  const fromAccountId = await ensureDefaultAccount(input.userId);
  if (fromAccountId === toAccountId) return;

  for (const id of input.transactionIds) {
    await pairLoneTransferToDestination({
      userId: input.userId,
      transactionId: id,
      toAccountId,
      categoryId: input.categoryId,
    });
  }
}

export async function insertSmsTransferWithDestination(input: {
  userId: string;
  amount: number;
  categoryId: string;
  date: string;
  message: string;
  smsIdempotencyKey: string;
  rawMessageHash: string;
  counterparty: string | null;
  counterpartyKey: string | null;
  /** Defaults to Wallet when omitted or invalid. */
  fromAccountId?: string | null;
  transferToAccountId: string | null;
}): Promise<ReturnType<typeof rowToTransaction> | null> {
  const fromAccountId = await resolveAccountId(input.userId, input.fromAccountId);
  const toAccountId = await resolveRuleTransferToAccountId(
    input.userId,
    input.transferToAccountId
  );
  if (fromAccountId === toAccountId) return null;

  try {
    const rows = await createTransferPair({
      userId: input.userId,
      fromAccountId,
      toAccountId,
      amount: input.amount,
      categoryId: input.categoryId,
      date: input.date,
      notes: "",
      smsMessage: input.message,
      idempotencyKey: input.smsIdempotencyKey,
    });
    const outLeg = rows.find((r) => r.transfer_leg === "out") ?? rows[0];
    if (!outLeg?.id) return null;

    await sql`
      UPDATE transactions
      SET
        notes = ${encryptText("", { userId: input.userId, field: "notes" })},
        sms_message = ${encryptText(input.message, { userId: input.userId, field: "sms_message" })},
        sms_raw_hash = ${input.rawMessageHash},
        sms_counterparty = ${input.counterparty},
        sms_counterparty_key = ${input.counterpartyKey}
      WHERE user_id = ${input.userId}
        AND transfer_group_id = ${outLeg.transfer_group_id}
    `;

    return enrichTransactionRow(input.userId, outLeg.id);
  } catch {
    return null;
  }
}
