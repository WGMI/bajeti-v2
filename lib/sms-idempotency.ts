import type { CategoryType } from "@/lib/budget-types";

export interface SmsIdempotencyInput {
  type: CategoryType;
  amount: number;
  date: string;
  transactionRef?: string | null;
}

export function buildSmsIdempotencyKey(input: SmsIdempotencyInput): string {
  const normalizedRef = (input.transactionRef ?? "no-ref").trim().toUpperCase();
  return [
    "sms",
    input.type,
    input.amount.toFixed(2),
    input.date,
    normalizedRef,
  ].join("|");
}
