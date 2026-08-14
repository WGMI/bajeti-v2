import { randomUUID } from "crypto";
import { sql } from "@/lib/db";
import { parseAmountForStorage } from "@/lib/transaction-amount";
import {
  encryptNumber,
  encryptOptionalText,
  encryptText,
} from "@/lib/text-encryption";
import type { TransactionRow } from "@/lib/transaction-api";

const categoryNameSubquery = () => sql`
  (SELECT c.name FROM categories c WHERE c.id = category_id) AS category_name
`;

const accountNameSubquery = () => sql`
  (SELECT a.name FROM accounts a WHERE a.id = account_id) AS account_name
`;

export const transferSelectFields = (userId: string) => sql`
  id,
  user_id,
  group_id,
  added_by_user_id,
  paid_by_user_id,
  approved_by_user_id,
  approval_status::text AS approval_status,
  amount_encrypted,
  transaction_charges,
  transaction_charges_encrypted,
  currency,
  original_amount,
  original_amount_encrypted,
  original_currency,
  fx_rate,
  fx_rate_encrypted,
  fx_rate_date::text AS fx_rate_date,
  fx_source,
  category_id,
  account_id,
  date::text AS date,
  notes,
  sms_message,
  type,
  sms_counterparty,
  sms_counterparty_key,
  transfer_group_id,
  transfer_leg::text AS transfer_leg,
  ${categoryNameSubquery()},
  ${accountNameSubquery()}
`;

export async function assertDistinctAccounts(
  userId: string,
  groupId: string | null,
  fromAccountId: string,
  toAccountId: string
): Promise<void> {
  if (fromAccountId === toAccountId) {
    throw new Error("Transfer source and destination must be different accounts");
  }
  const rows = await sql`
    SELECT id FROM accounts
    WHERE ${
      groupId
        ? sql`group_id = ${groupId}`
        : sql`user_id = ${userId} AND group_id IS NULL`
    }
      AND id IN (
        SELECT (jsonb_array_elements_text(${JSON.stringify([fromAccountId, toAccountId])}::jsonb))::uuid
      )
  `;
  if (rows.length !== 2) {
    throw new Error("Invalid account");
  }
}

export async function createTransferPair(input: {
  userId: string;
  groupId?: string | null;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  categoryId: string;
  date: string;
  notes: string;
  smsMessage?: string | null;
  idempotencyKey?: string | null;
}): Promise<TransactionRow[]> {
  const bajetiGroupId = input.groupId ?? null;
  await assertDistinctAccounts(input.userId, bajetiGroupId, input.fromAccountId, input.toAccountId);
  const numAmount = parseAmountForStorage(input.amount);
  if (numAmount == null) {
    throw new Error("Invalid amount");
  }

  const transferGroupId = randomUUID();
  const encryptionSubjectId = bajetiGroupId ?? input.userId;
  const hashedKey =
    input.idempotencyKey && input.idempotencyKey.trim().length > 0
      ? input.idempotencyKey.trim().slice(0, 255)
      : null;

  await sql`
    INSERT INTO transactions (
      user_id,
      group_id,
      added_by_user_id,
      paid_by_user_id,
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
      transfer_leg,
      sms_idempotency_key
    )
    SELECT
      ${input.userId},
      ${bajetiGroupId},
      ${input.userId},
      ${input.userId},
      ${encryptNumber(numAmount, { userId: encryptionSubjectId, field: "amount" })},
      ${null},
      ${encryptNumber(0, {
        userId: encryptionSubjectId,
        field: "transaction_charges",
      })},
      ${input.categoryId},
      leg.account_id,
      ${input.date}::date,
      ${encryptText(input.notes, { userId: encryptionSubjectId, field: "notes" })},
      ${encryptOptionalText(input.smsMessage ?? null, {
        userId: encryptionSubjectId,
        field: "sms_message",
      })},
      'transfer'::category_type,
      ${transferGroupId},
      leg.transfer_leg,
      CASE WHEN leg.transfer_leg = 'out' THEN ${hashedKey} ELSE NULL END
    FROM (
      VALUES
        (${input.fromAccountId}::uuid, 'out'::transfer_leg),
        (${input.toAccountId}::uuid, 'in'::transfer_leg)
    ) AS leg(account_id, transfer_leg)
  `;

  const rows = await sql`
    SELECT ${transferSelectFields(input.userId)}
    FROM transactions
    WHERE ${
      bajetiGroupId
        ? sql`group_id = ${bajetiGroupId}`
        : sql`user_id = ${input.userId} AND group_id IS NULL`
    } AND transfer_group_id = ${transferGroupId}
    ORDER BY transfer_leg DESC
  `;
  return rows as TransactionRow[];
}

export async function findTransferGroupMate(
  userId: string,
  groupId: string | null,
  transactionId: string,
  transferGroupId: string
): Promise<TransactionRow | null> {
  const rows = await sql`
    SELECT ${transferSelectFields(userId)}
    FROM transactions
    WHERE ${
      groupId
        ? sql`group_id = ${groupId}`
        : sql`user_id = ${userId} AND group_id IS NULL`
    }
      AND transfer_group_id = ${transferGroupId}
      AND id <> ${transactionId}
    LIMIT 1
  `;
  return (rows[0] as TransactionRow | undefined) ?? null;
}

export async function deleteTransferGroup(
  userId: string,
  groupId: string | null,
  transferGroupId: string
): Promise<void> {
  await sql`
    DELETE FROM transactions
    WHERE ${
      groupId
        ? sql`group_id = ${groupId}`
        : sql`user_id = ${userId} AND group_id IS NULL`
    } AND transfer_group_id = ${transferGroupId}
  `;
}

export async function updateTransferPair(input: {
  userId: string;
  groupId?: string | null;
  transferGroupId: string;
  amount: number;
  categoryId: string;
  date: string;
  notes: string;
  smsMessage?: string | null;
  fromAccountId: string;
  toAccountId: string;
}): Promise<TransactionRow[]> {
  const bajetiGroupId = input.groupId ?? null;
  await assertDistinctAccounts(input.userId, bajetiGroupId, input.fromAccountId, input.toAccountId);
  const numAmount = parseAmountForStorage(input.amount);
  if (numAmount == null) {
    throw new Error("Invalid amount");
  }

  const encryptionSubjectId = bajetiGroupId ?? input.userId;

  await sql`
    UPDATE transactions
    SET
      amount_encrypted = ${encryptNumber(numAmount, {
        userId: encryptionSubjectId,
        field: "amount",
      })},
      transaction_charges = NULL,
      transaction_charges_encrypted = ${encryptNumber(0, {
        userId: encryptionSubjectId,
        field: "transaction_charges",
      })},
      category_id = ${input.categoryId},
      date = ${input.date}::date,
      notes = ${encryptText(input.notes, { userId: encryptionSubjectId, field: "notes" })},
      sms_message = COALESCE(${encryptOptionalText(input.smsMessage ?? null, {
        userId: encryptionSubjectId,
        field: "sms_message",
      })}, sms_message),
      account_id = CASE transfer_leg
        WHEN 'out' THEN ${input.fromAccountId}::uuid
        WHEN 'in' THEN ${input.toAccountId}::uuid
        ELSE account_id
      END
    WHERE ${
      bajetiGroupId
        ? sql`group_id = ${bajetiGroupId}`
        : sql`user_id = ${input.userId} AND group_id IS NULL`
    }
      AND transfer_group_id = ${input.transferGroupId}
  `;

  const rows = await sql`
    SELECT ${transferSelectFields(input.userId)}
    FROM transactions
    WHERE ${
      bajetiGroupId
        ? sql`group_id = ${bajetiGroupId}`
        : sql`user_id = ${input.userId} AND group_id IS NULL`
    }
      AND transfer_group_id = ${input.transferGroupId}
    ORDER BY transfer_leg DESC
  `;
  return rows as TransactionRow[];
}
