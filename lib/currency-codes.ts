export const CURRENCY_CODES = [
  "USD",
  "EUR",
  "GBP",
  "TZS",
  "KES",
  "NGN",
  "ZAR",
  "INR",
] as const;

export type CurrencyCode = (typeof CURRENCY_CODES)[number];

const CURRENCY_ALIASES: Record<string, CurrencyCode> = {
  kes: "KES",
  ksh: "KES",
  kshs: "KES",
  usd: "USD",
  eur: "EUR",
  gbp: "GBP",
  tzs: "TZS",
  ngn: "NGN",
  zar: "ZAR",
  inr: "INR",
};

/** Regex fragment for SMS amount extraction (case-insensitive). */
export const SMS_CURRENCY_REGEX_SOURCE =
  "USD|EUR|GBP|TZS|KES|NGN|ZAR|INR|Ksh|Kshs\\.?";

export function normalizeCurrencyCode(raw: string): CurrencyCode | null {
  const cleaned = raw.replace(/\./g, "").trim();
  const upper = cleaned.toUpperCase();
  if ((CURRENCY_CODES as readonly string[]).includes(upper)) {
    return upper as CurrencyCode;
  }
  const alias = CURRENCY_ALIASES[cleaned.toLowerCase()];
  return alias ?? null;
}

export function isCurrencyCode(value: string): value is CurrencyCode {
  return (CURRENCY_CODES as readonly string[]).includes(value);
}
