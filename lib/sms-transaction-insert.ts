import { sql } from "@/lib/db";
import { resolveAccountId } from "@/lib/accounts";
import { rowToTransaction, type TransactionRow } from "@/lib/transaction-api";
import { parseChargesForStorage } from "@/lib/transaction-amount";
import {
  findExistingTransferGroupOutLeg,
  groupTransferLegIfMatched,
} from "@/lib/transfer-grouping";
import {
  enrichTransactionRow,
  insertSmsTransferWithDestination,
} from "@/lib/counterparty-transfer-accounts";
import type { CategoryType } from "@/lib/budget-types";
import type { CurrencyCode } from "@/lib/currency-codes";
import {
  encryptNumber,
  encryptOptionalNumber,
  encryptText,
} from "@/lib/text-encryption";

export async function insertSmsTransaction(input: {
  userId: string;
  amount: number;
  currency?: CurrencyCode | null;
  originalAmount?: number | null;
  originalCurrency?: CurrencyCode | null;
  fxRate?: number | null;
  fxRateDate?: string | null;
  fxSource?: string | null;
  categoryId: string;
  date: string;
  message: string;
  transactionType: CategoryType;
  smsIdempotencyKey: string;
  rawMessageHash: string;
  counterparty: string | null;
  counterpartyKey: string | null;
  transferCategoryId?: string | null;
  /** Defaults to Wallet when omitted or invalid. */
  accountId?: string | null;
  /** From counterparty rule; null uses default Wallet. */
  transferToAccountId?: string | null;
  transactionCharges?: number | null;
}): Promise<ReturnType<typeof rowToTransaction> | null> {
  if (input.transactionType === "transfer") {
    const existingOutLegId = await findExistingTransferGroupOutLeg({
      userId: input.userId,
      notes: input.message,
      amount: input.amount,
      date: input.date,
    });
    if (existingOutLegId) {
      return enrichTransactionRow(input.userId, existingOutLegId);
    }

    const paired = await insertSmsTransferWithDestination({
      userId: input.userId,
      amount: input.amount,
      categoryId: input.categoryId,
      date: input.date,
      message: input.message,
      smsIdempotencyKey: input.smsIdempotencyKey,
      rawMessageHash: input.rawMessageHash,
      counterparty: input.counterparty,
      counterpartyKey: input.counterpartyKey,
      fromAccountId: input.accountId ?? null,
      transferToAccountId: input.transferToAccountId ?? null,
    });
    if (paired) return paired;
  }

  const accountId = await resolveAccountId(input.userId, input.accountId);
  const numCharges =
    input.transactionType === "transfer"
      ? 0
      : (parseChargesForStorage(input.transactionCharges) ?? 0);

  const rows = await sql`
    INSERT INTO transactions (
      user_id,
      amount,
      amount_encrypted,
      transaction_charges,
      transaction_charges_encrypted,
      currency,
      original_amount,
      original_amount_encrypted,
      original_currency,
      fx_rate,
      fx_rate_encrypted,
      fx_rate_date,
      fx_source,
      category_id,
      account_id,
      date,
      notes,
      sms_message,
      type,
      sms_idempotency_key,
      sms_raw_hash,
      sms_counterparty,
      sms_counterparty_key
    )
    VALUES (
      ${input.userId},
      ${null},
      ${encryptNumber(input.amount, { userId: input.userId, field: "amount" })},
      ${null},
      ${encryptNumber(numCharges, {
        userId: input.userId,
        field: "transaction_charges",
      })},
      ${input.currency ?? null},
      ${null},
      ${encryptOptionalNumber(input.originalAmount, {
        userId: input.userId,
        field: "original_amount",
      })},
      ${input.originalCurrency ?? null},
      ${null},
      ${encryptOptionalNumber(input.fxRate, {
        userId: input.userId,
        field: "fx_rate",
      })},
      ${input.fxRateDate ?? null},
      ${input.fxSource ?? null},
      ${input.categoryId},
      ${accountId},
      ${input.date},
      ${encryptText("", { userId: input.userId, field: "notes" })},
      ${encryptText(input.message, { userId: input.userId, field: "sms_message" })},
      ${input.transactionType}::category_type,
      ${input.smsIdempotencyKey},
      ${input.rawMessageHash},
      ${input.counterparty},
      ${input.counterpartyKey}
    )
    ON CONFLICT DO NOTHING
    RETURNING
      id,
      user_id,
      amount,
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
      account_id,
      category_id,
      date::text AS date,
      notes,
      sms_message,
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
      t.id, t.user_id, t.amount, t.amount_encrypted,
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
    WHERE t.user_id = ${input.userId} AND t.id = ${row.id}
    LIMIT 1
  `;
  const full = enriched[0] as TransactionRow | undefined;
  return full ? rowToTransaction(full) : rowToTransaction(row);
}
