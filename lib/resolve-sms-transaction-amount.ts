import type { CurrencyCode } from "@/lib/currency-codes";
import { convertWithRate, getExchangeRate } from "@/lib/fx-rates";
import { parseAmountForStorage } from "@/lib/transaction-amount";
import { getUserCurrency } from "@/lib/user-currency";
import type { SmsParseResult } from "@/lib/sms-parser";

export type ResolvedSmsTransactionAmount = {
  storedAmount: number;
  currency: CurrencyCode;
  originalAmount: number | null;
  originalCurrency: CurrencyCode | null;
  fxRate: number | null;
  fxRateDate: string | null;
  fxSource: string | null;
  /** Amount + currency as parsed from SMS (for idempotency keys). */
  idempotencyAmount: number;
  idempotencyCurrency: CurrencyCode;
};

export type ResolveSmsTransactionAmountResult =
  | { ok: true; resolved: ResolvedSmsTransactionAmount }
  | { ok: false; reason: string };

export async function resolveSmsTransactionAmount(
  userId: string,
  parsed: Pick<SmsParseResult, "amount" | "currency" | "date">
): Promise<ResolveSmsTransactionAmountResult> {
  if (parsed.amount <= 0) {
    return { ok: false, reason: "Parsed transaction amount is missing or invalid" };
  }
  if (!parsed.currency) {
    return { ok: false, reason: "Parsed transaction currency is missing or invalid" };
  }
  if (!parsed.date) {
    return { ok: false, reason: "Parsed transaction date is missing or invalid" };
  }

  const userCurrency = await getUserCurrency(userId);
  const parsedAmount = parseAmountForStorage(parsed.amount);
  if (parsedAmount == null) {
    return { ok: false, reason: "Parsed transaction amount is missing or invalid" };
  }

  if (parsed.currency === userCurrency) {
    return {
      ok: true,
      resolved: {
        storedAmount: parsedAmount,
        currency: userCurrency,
        originalAmount: null,
        originalCurrency: null,
        fxRate: null,
        fxRateDate: null,
        fxSource: null,
        idempotencyAmount: parsedAmount,
        idempotencyCurrency: parsed.currency,
      },
    };
  }

  try {
    const { rate, rateDate, source } = await getExchangeRate(
      parsed.currency,
      userCurrency,
      parsed.date
    );
    const storedAmount = parseAmountForStorage(convertWithRate(parsedAmount, rate));
    if (storedAmount == null) {
      return { ok: false, reason: "Converted transaction amount is invalid" };
    }
    return {
      ok: true,
      resolved: {
        storedAmount,
        currency: userCurrency,
        originalAmount: parsedAmount,
        originalCurrency: parsed.currency,
        fxRate: rate,
        fxRateDate: rateDate,
        fxSource: source,
        idempotencyAmount: parsedAmount,
        idempotencyCurrency: parsed.currency,
      },
    };
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Unknown FX error";
    console.error("[resolveSmsTransactionAmount]", detail);
    return {
      ok: false,
      reason: `Could not convert ${parsed.currency} to ${userCurrency}: ${detail}`,
    };
  }
}
