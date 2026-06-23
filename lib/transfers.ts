import { randomUUID } from "crypto";
import { sql } from "@/lib/db";
import { parseAmountForStorage } from "@/lib/transaction-amount";
import type { TransactionRow } from "@/lib/transaction-api";

const categoryNameSubquery = (userId: string) => sql`
  (SELECT c.name FROM categories c WHERE c.id = category_id AND c.user_id = ${userId}) AS category_name
`;

const accountNameSubquery = (userId: string) => sql`
  (SELECT a.name FROM accounts a WHERE a.id = account_id AND a.user_id = ${userId}) AS account_name
`;

export const transferSelectFields = (userId: string) => sql`
  id,
  amount,
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
  ${categoryNameSubquery(userId)},
  ${accountNameSubquery(userId)}
`;

export async function assertDistinctAccounts(
  userId: string,
  fromAccountId: string,
  toAccountId: string
): Promise<void> {
  if (fromAccountId === toAccountId) {
    throw new Error("Transfer source and destination must be different accounts");
  }
  const rows = await sql`
    SELECT id FROM accounts
    WHERE user_id = ${userId}
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
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  categoryId: string;
  date: string;
  notes: string;
  smsMessage?: string | null;
  idempotencyKey?: string | null;
}): Promise<TransactionRow[]> {
  await assertDistinctAccounts(input.userId, input.fromAccountId, input.toAccountId);
  const numAmount = parseAmountForStorage(input.amount);
  if (numAmount == null) {
    throw new Error("Invalid amount");
  }

  const groupId = randomUUID();
  const hashedKey =
    input.idempotencyKey && input.idempotencyKey.trim().length > 0
      ? input.idempotencyKey.trim().slice(0, 255)
      : null;

  await sql`
    INSERT INTO transactions (
      user_id,
      amount,
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
      ${numAmount},
      ${input.categoryId},
      leg.account_id,
      ${input.date}::date,
      ${input.notes},
      ${input.smsMessage ?? null},
      'transfer'::category_type,
      ${groupId},
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
    WHERE user_id = ${input.userId} AND transfer_group_id = ${groupId}
    ORDER BY transfer_leg DESC
  `;
  return rows as TransactionRow[];
}

export async function findTransferGroupMate(
  userId: string,
  transactionId: string,
  transferGroupId: string
): Promise<TransactionRow | null> {
  const rows = await sql`
    SELECT ${transferSelectFields(userId)}
    FROM transactions
    WHERE user_id = ${userId}
      AND transfer_group_id = ${transferGroupId}
      AND id <> ${transactionId}
    LIMIT 1
  `;
  return (rows[0] as TransactionRow | undefined) ?? null;
}

export async function deleteTransferGroup(userId: string, transferGroupId: string): Promise<void> {
  await sql`
    DELETE FROM transactions
    WHERE user_id = ${userId} AND transfer_group_id = ${transferGroupId}
  `;
}

export async function updateTransferPair(input: {
  userId: string;
  transferGroupId: string;
  amount: number;
  categoryId: string;
  date: string;
  notes: string;
  smsMessage?: string | null;
  fromAccountId: string;
  toAccountId: string;
}): Promise<TransactionRow[]> {
  await assertDistinctAccounts(input.userId, input.fromAccountId, input.toAccountId);
  const numAmount = parseAmountForStorage(input.amount);
  if (numAmount == null) {
    throw new Error("Invalid amount");
  }

  await sql`
    UPDATE transactions
    SET
      amount = ${numAmount},
      category_id = ${input.categoryId},
      date = ${input.date}::date,
      notes = ${input.notes},
      sms_message = COALESCE(${input.smsMessage ?? null}, sms_message),
      account_id = CASE transfer_leg
        WHEN 'out' THEN ${input.fromAccountId}::uuid
        WHEN 'in' THEN ${input.toAccountId}::uuid
        ELSE account_id
      END
    WHERE user_id = ${input.userId}
      AND transfer_group_id = ${input.transferGroupId}
  `;

  const rows = await sql`
    SELECT ${transferSelectFields(input.userId)}
    FROM transactions
    WHERE user_id = ${input.userId}
      AND transfer_group_id = ${input.transferGroupId}
    ORDER BY transfer_leg DESC
  `;
  return rows as TransactionRow[];
}
