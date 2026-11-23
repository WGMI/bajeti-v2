import type { Transaction } from "./budget-types";

export type InboxPreview = Pick<Transaction, "amount" | "transactionCharges" | "currency" | "date" | "type" | "notes" | "smsMessage" | "smsCounterparty" | "smsCounterpartyKey"> & {
  categoryId: string | null;
  transferToAccountId: string | null;
};
export type InboxMessage = {
  id: string;
  sender: string;
  message: string;
  timestamp: number;
  accountId: string | null;
  status: "pending" | "synced" | "dismissed";
  transactionId: string | null;
  preview: InboxPreview | null;
  previewStatus: string;
  reason: string | null;
};
export type PendingSmsSummary = {
  savedBalance?: number;
  income: number;
  expenses: number;
  balance: number;
  count: number;
  needsReview: number;
  lastUploadedAt: string | null;
};
