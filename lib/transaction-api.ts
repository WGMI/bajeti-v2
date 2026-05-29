import { normalizeTransactionDateFromDb } from "@/lib/format-date";
import { normalizeStoredAmount } from "@/lib/transaction-amount";
import type { CategoryType, TransferLeg } from "@/lib/budget-types";

export type TransactionRow = {
  id: string;
  amount: string;
  account_id: string;
  account_name?: string | null;
  category_id: string;
  category_name?: string | null;
  date: string;
  notes: string | null;
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
  const categoryName = categoryNameFromRow(row);
  const transferLeg =
    row.transfer_leg === "out" || row.transfer_leg === "in"
      ? (row.transfer_leg as TransferLeg)
      : null;
  return {
    id: row.id,
    amount: normalizeStoredAmount(Number(row.amount)),
    accountId: row.account_id,
    accountName: accountNameFromRow(row),
    categoryId: row.category_id,
    categoryName,
    category: {
      id: row.category_id,
      name: categoryName,
    },
    date: normalizeTransactionDateFromDb(row.date),
    notes: row.notes ?? "",
    type: row.type as CategoryType,
    transferGroupId: row.transfer_group_id ?? null,
    transferLeg,
    counterAccountId: row.counter_account_id ?? null,
    counterAccountName: row.counter_account_name ?? null,
    smsCounterparty: row.sms_counterparty,
    smsCounterpartyKey: row.sms_counterparty_key,
  };
}

