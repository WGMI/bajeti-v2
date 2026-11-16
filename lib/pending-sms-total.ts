import type { InboxMessage, PendingSmsSummary } from "./sms-inbox-types";

// Match /api/summary: transfers do not change income/expense totals; expense fees do.
export function pendingSmsTotal(messages: InboxMessage[], month: string, lastUploadedAt: string | null): PendingSmsSummary {
  let income = 0, expenses = 0, count = 0, needsReview = 0;
  for (const item of messages) {
    if (item.status !== "pending" || item.previewStatus === "duplicate") continue;
    const p = item.preview;
    if (!p) { needsReview++; continue; }
    if (!p.date.startsWith(month)) continue;
    count++;
    if (item.previewStatus !== "ready") needsReview++;
    if (p.type === "income") income += Math.abs(p.amount);
    if (p.type === "expense") expenses += Math.abs(p.amount) + Math.max(0, p.transactionCharges ?? 0);
  }
  return { income, expenses, balance: income - expenses, count, needsReview, lastUploadedAt };
}
