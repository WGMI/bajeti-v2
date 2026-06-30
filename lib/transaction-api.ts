import { normalizeTransactionDateFromDb } from "@/lib/format-date";
import { normalizeStoredAmount } from "@/lib/transaction-amount";
import {
  decryptNumber,
  decryptOptionalNumber,
  decryptOptionalText,
  decryptText,
} from "@/lib/text-encryption";
import type { CategoryType, TransferLeg } from "@/lib/budget-types";

export type TransactionRow = {
  id: string;
  user_id?: string;
  amount_encrypted?: string | null;
  transaction_charges?: string | null;
  transaction_charges_encrypted?: string | null;
  currency?: string | null;
  original_amount?: string | null;
  original_amount_encrypted?: string | null;
  original_currency?: string | null;
  fx_rate?: string | null;
  fx_rate_encrypted?: string | null;
  fx_rate_date?: string | null;
  fx_source?: string | null;
  account_id: string;
  account_name?: string | null;
  category_id: string;
  category_name?: string | null;
  date: string;
  notes: string | null;
  sms_message: string | null;
  type: string;
  sms_counterparty: string | null;
  sms_counterparty_key: string | null;
  transfer_group_id?: string | null;
  transfer_leg?: string | null;
  counter_account_id?: string | null;
  counter_account_name?: string | null;
};

export function categoryNameFromRow(row: TransactionRow): string {
  const name = row.category_name;
  return typeof name === "string" && name.trim().length > 0 ? name.trim() : "Unknown";
}

export function accountNameFromRow(row: TransactionRow): string {
  const name = row.account_name;
  return typeof name === "string" && name.trim().length > 0 ? name.trim() : "Wallet";
}

/** Shown when POST /api/transactions replays an existing row (idempotency / SMS dedupe). */
export const TRANSACTION_CREATE_DUPLICATE_MESSAGE =
  "Duplicate SMS ignored: this transaction is already saved.";

export type TransactionCreateStatus = "created" | "duplicate";

export function transactionCreateResponse(
  row: TransactionRow,
  createStatus: TransactionCreateStatus
) {
  const transaction = rowToTransaction(row);
  if (createStatus === "duplicate") {
    return {
      ...transaction,
      status: createStatus,
      message: TRANSACTION_CREATE_DUPLICATE_MESSAGE,
    };
  }
  return { ...transaction, status: createStatus };
}

export function rowToTransaction(row: TransactionRow) {
  const userId = row.user_id ?? "";
  const notes = decryptText(row.notes, { userId, field: "notes" });
  const smsMessage = decryptOptionalText(row.sms_message, { userId, field: "sms_message" });
  const categoryName = categoryNameFromRow(row);
  const transferLeg =
    row.transfer_leg === "out" || row.transfer_leg === "in"
      ? (row.transfer_leg as TransferLeg)
      : null;
  const originalAmount =
    decryptOptionalNumber(row.original_amount_encrypted, row.original_amount, {
      userId,
      field: "original_amount",
    });
  const fxRate = decryptOptionalNumber(row.fx_rate_encrypted, row.fx_rate, {
    userId,
    field: "fx_rate",
  });
  const charges = decryptOptionalNumber(
    row.transaction_charges_encrypted,
    row.transaction_charges,
    { userId, field: "transaction_charges" }
  );
  return {
    id: row.id,
    amount: normalizeStoredAmount(
      decryptNumber(row.amount_encrypted, null, { userId, field: "amount" })
    ),
    transactionCharges: normalizeStoredAmount(charges ?? 0),
    currency: row.currency ?? null,
    originalAmount: originalAmount == null ? null : normalizeStoredAmount(originalAmount),
    originalCurrency: row.original_currency ?? null,
    fxRate: fxRate != null && Number.isFinite(fxRate) ? fxRate : null,
    fxRateDate: row.fx_rate_date ?? null,
    fxSource: row.fx_source ?? null,
    accountId: row.account_id,
    accountName: accountNameFromRow(row),
    categoryId: row.category_id,
    categoryName,
    category: {
      id: row.category_id,
      name: categoryName,
    },
    date: normalizeTransactionDateFromDb(row.date),
    notes,
    smsMessage,
    type: row.type as CategoryType,
    transferGroupId: row.transfer_group_id ?? null,
    transferLeg,
    counterAccountId: row.counter_account_id ?? null,
    counterAccountName: row.counter_account_name ?? null,
    smsCounterparty: row.sms_counterparty,
    smsCounterpartyKey: row.sms_counterparty_key,
  };
}
