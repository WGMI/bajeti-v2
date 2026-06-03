import type { CategoryType } from "@/lib/budget-types";
import type { CurrencyCode } from "@/lib/currency-codes";

export interface SmsIdempotencyInput {
  type: CategoryType;
  amount: number;
  currency: CurrencyCode;
  date: string;
  transactionRef?: string | null;
}

export function buildSmsIdempotencyKey(input: SmsIdempotencyInput): string {
  const normalizedRef = (input.transactionRef ?? "no-ref").trim().toUpperCase();
  return [
    "sms",
    input.type,
    input.amount.toFixed(2),
    input.currency,
    input.date,
    normalizedRef,
  ].join("|");
}
