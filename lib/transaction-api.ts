import { normalizeTransactionDateFromDb } from "@/lib/format-date";
import type { CategoryType } from "@/lib/budget-types";

export type TransactionRow = {
  id: string;
  amount: string;
  category_id: string;
  category_name?: string | null;
  date: string;
  notes: string | null;
  type: string;
  sms_counterparty: string | null;
  sms_counterparty_key: string | null;
};

export function categoryNameFromRow(row: TransactionRow): string {
  const name = row.category_name;
  return typeof name === "string" && name.trim().length > 0 ? name.trim() : "Unknown";
}

export function rowToTransaction(row: TransactionRow) {
  const categoryName = categoryNameFromRow(row);
  return {
    id: row.id,
    amount: Number(row.amount),
    categoryId: row.category_id,
    categoryName,
    category: {
      id: row.category_id,
      name: categoryName,
    },
    date: normalizeTransactionDateFromDb(row.date),
    notes: row.notes ?? "",
    type: row.type as CategoryType,
    smsCounterparty: row.sms_counterparty,
    smsCounterpartyKey: row.sms_counterparty_key,
  };
}
