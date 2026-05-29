import { sql } from "@/lib/db";
import { ensureDefaultAccount } from "@/lib/accounts";
import { rowToTransaction, type TransactionRow } from "@/lib/transaction-api";
import { groupTransferLegIfMatched } from "@/lib/transfer-grouping";
import type { CategoryType } from "@/lib/budget-types";

export async function insertSmsTransaction(input: {
  userId: string;
  amount: number;
  categoryId: string;
  date: string;
  message: string;
  transactionType: CategoryType;
  smsIdempotencyKey: string;
  rawMessageHash: string;
  counterparty: string | null;
  counterpartyKey: string | null;
  transferCategoryId?: string | null;
}): Promise<ReturnType<typeof rowToTransaction> | null> {
  const accountId = await ensureDefaultAccount(input.userId);

  const rows = await sql`
    INSERT INTO transactions (
      user_id,
      amount,
      category_id,
      account_id,
      date,
      notes,
      type,
      sms_idempotency_key,
      sms_raw_hash,
      sms_counterparty,
      sms_counterparty_key
    )
    VALUES (
      ${input.userId},
      ${input.amount},
      ${input.categoryId},
      ${accountId},
      ${input.date},
      ${input.message},
      ${input.transactionType}::category_type,
      ${input.smsIdempotencyKey},
      ${input.rawMessageHash},
      ${input.counterparty},
      ${input.counterpartyKey}
    )
    ON CONFLICT DO NOTHING
    RETURNING
      id,
      amount,
      account_id,
      category_id,
      date::text AS date,
      notes,
      type,
      sms_counterparty,
      sms_counterparty_key,
      transfer_group_id,
      transfer_leg::text AS transfer_leg
  `;

  const row = rows[0] as TransactionRow | undefined;
  if (!row) return null;

  if (
    input.transactionType === "transfer" &&
    input.transferCategoryId &&
    input.message.trim().length > 0
  ) {
    await groupTransferLegIfMatched({
      userId: input.userId,
      transactionId: row.id,
      notes: input.message,
      amount: input.amount,
      date: input.date,
      transferCategoryId: input.transferCategoryId,
    });
  }

  const enriched = await sql`
    SELECT
      t.id, t.amount, t.account_id, t.category_id, t.date::text AS date, t.notes, t.type,
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
    WHERE t.user_id = ${input.userId} AND t.id = ${row.id}
    LIMIT 1
  `;
  const full = enriched[0] as TransactionRow | undefined;
  return full ? rowToTransaction(full) : rowToTransaction(row);
}
