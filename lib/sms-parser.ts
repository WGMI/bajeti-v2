import {
  normalizeCurrencyCode,
  SMS_CURRENCY_REGEX_SOURCE,
  type CurrencyCode,
} from "@/lib/currency-codes";

export type SmsType = "income" | "expense" | "transfer" | "neither";

/** Where the transaction `date` should come from when both SMS text and device time exist. */
export type SmsTransactionDateSource = "message" | "received_at";

export interface SmsParseResult {
  message: string;
  type: SmsType;
  amount: number;
  /** ISO currency code parsed from the SMS amount (e.g. USD, KES). */
  currency: CurrencyCode | null;
  date: string;
  charges: number;
  transactionRef: string | null;
  /** Human-readable payee / payer from the SMS (e.g. merchant name). */
  counterparty: string | null;
  /** Normalized key for grouping and user-defined category rules. */
  counterpartyKey: string | null;
  /** Optional account reference used for more specific scoped rules. */
  accountReference: string | null;
}

export interface ParseSmsOptions {
  timestamp?: number | null;
  /**
   * `message` — prefer a calendar date parsed from the SMS body (M-PESA-style), then device time.
   * `received_at` — prefer `timestamp` when provided (e.g. mobile), then body.
   * Default matches historical API behavior: `received_at`.
   */
  transactionDateSource?: SmsTransactionDateSource;
}

function formatDateFromTimestamp(timestamp: number): string {
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/** DD/MM interpretation (slash or hyphen), common in Kenya M-PESA SMS. */
function calendarDayMonthYear(
  dayStr: string,
  monthStr: string,
  yearStr: string
): string | null {
  const day = parseInt(dayStr, 10);
  const month = parseInt(monthStr, 10);
  const fullYear =
    yearStr.length === 2 ? 2000 + parseInt(yearStr, 10) : parseInt(yearStr, 10);
  if (
    Number.isNaN(day) ||
    Number.isNaN(month) ||
    Number.isNaN(fullYear) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  const d = new Date(fullYear, month - 1, day);
  if (
    d.getFullYear() !== fullYear ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) {
    return null;
  }
  return `${fullYear}-${String(month).padStart(2, "0")}-${String(day).padStart(
    2,
    "0"
  )}`;
}

function monthNameToNum(name: string): number | null {
  return MONTH_NAMES[name.toLowerCase()] ?? null;
}

/**
 * Best-effort calendar date from SMS body (ISO, DD/MM/YY, "on 4/4/26", "4 Apr 2026", etc.).
 */
export function extractDateFromSmsBody(message: string): string | null {
  // ISO YYYY-MM-DD
  const iso = message.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const y = parseInt(iso[1], 10);
    const m = parseInt(iso[2], 10);
    const day = parseInt(iso[3], 10);
    const d = new Date(y, m - 1, day);
    if (
      d.getFullYear() === y &&
      d.getMonth() === m - 1 &&
      d.getDate() === day
    ) {
      return `${y}-${iso[2]}-${iso[3]}`;
    }
  }

  // Typical M-PESA: "on 4/4/26 at 10:30 AM"
  const onDate = message.match(
    /\bon\s+(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/i
  );
  if (onDate) {
    const cal = calendarDayMonthYear(onDate[1], onDate[2], onDate[3]);
    if (cal) return cal;
  }

  // DD/MM/YY or DD-MM-YY anywhere (first valid hit)
  const dmyPattern = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/g;
  for (const m of message.matchAll(dmyPattern)) {
    const cal = calendarDayMonthYear(m[1], m[2], m[3]);
    if (cal) return cal;
  }

  // "4 Apr 2026" / "04 APR 26" / "28-SEP-2025"
  const dMonY = message.match(
    /\b(\d{1,2})[\s\/-]+([A-Za-z]{3,9})[\s,\/-]+(\d{2,4})\b/
  );
  if (dMonY) {
    const monthNum = monthNameToNum(dMonY[2]);
    if (monthNum) {
      const yearStr = dMonY[3];
      const y =
        yearStr.length === 2 ? 2000 + parseInt(yearStr, 10) : parseInt(yearStr, 10);
      const day = parseInt(dMonY[1], 10);
      const cal = calendarDayMonthYear(String(day), String(monthNum), String(y));
      if (cal) return cal;
    }
  }

  // "Apr 4, 2026"
  const monDY = message.match(
    /\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})\b/
  );
  if (monDY) {
    const monthNum = monthNameToNum(monDY[1]);
    if (monthNum) {
      const cal = calendarDayMonthYear(monDY[2], String(monthNum), monDY[3]);
      if (cal) return cal;
    }
  }

  return null;
}

function resolveTransactionDate(
  bodyDate: string | null,
  deviceDate: string | null,
  source: SmsTransactionDateSource
): string {
  if (source === "message") {
    return bodyDate ?? deviceDate ?? "";
  }
  return deviceDate ?? bodyDate ?? "";
}

/**
 * Stable key for matching user rules and clustering recurring payees/payers.
 * Strips common Kenya phone patterns so "JOHN 0722…" and "JOHN" align.
 */
export function normalizeSmsCounterpartyKey(label: string): string {
  const collapsed = label
    .toLowerCase()
    .replace(/\b\+?254\d{9}\b/g, " ")
    .replace(/\b0\d{9}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.$/, "");
  return collapsed.length >= 2 ? collapsed : "";
}

export function normalizeSmsAccountReference(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, "").trim();
}

export function extractSmsAccountReference(message: string): string | null {
  const m = message.match(/\bfor\s+(?:account|acc)\s+([a-z0-9-]{3,})\b/i);
  if (!m?.[1]) return null;
  const normalized = normalizeSmsAccountReference(m[1]);
  return normalized.length >= 3 ? normalized : null;
}

export function makeScopedCounterpartyKey(counterpartyKey: string, accountReference: string): string {
  return `${counterpartyKey}|account:${normalizeSmsAccountReference(accountReference)}`;
}

export function splitScopedCounterpartyKey(counterpartyKey: string): {
  baseKey: string;
  accountReference: string | null;
} {
  const m = /^(.*)\|account:([a-z0-9-]{3,})$/i.exec(counterpartyKey.trim());
  if (!m) return { baseKey: counterpartyKey, accountReference: null };
  return {
    baseKey: m[1].trim(),
    accountReference: normalizeSmsAccountReference(m[2]),
  };
}

export function candidateCounterpartyRuleKeys(counterpartyKey: string, message: string): string[] {
  const base = normalizeSmsCounterpartyKey(counterpartyKey);
  if (!base) return [];
  const accountRef = extractSmsAccountReference(message);
  if (!accountRef) return [base];
  return [makeScopedCounterpartyKey(base, accountRef), base];
}

/** M-PESA-style " on DD/MM/YY " segment used to delimit payee / payer names. */
const ON_DATE_CHUNK = String.raw`\s+on\s+\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}`;
/**
 * Common boundary markers after payee names in expense SMS variants:
 * - old M-PESA: "on 4/4/26"
 * - bill flows: "for account ...", "for acc ..."
 * - refs: "Ref ...", "Ref. ..."
 */
const EXPENSE_COUNTERPARTY_BOUNDARY = String.raw`(?:${ON_DATE_CHUNK}|\s+for\s+(?:account|acc)\b|\s+ref(?:\.|\b)|\.\s*ref(?:\.|\b)|$)`;

function trimCounterpartyLabel(raw: string): string {
  return raw.replace(/\.$/, "").replace(/\s+/g, " ").trim();
}

/**
 * Best-effort payee (expense) or payer (income) for M-PESA-style SMS bodies.
 */
export function extractSmsCounterpartyLabel(
  message: string,
  type: SmsType
): string | null {
  if (type === "neither") return null;
  const m = message.replace(/\s+/g, " ").trim();

  if (type === "transfer") {
    const credited = m.match(
      /\bcredited\s+to\s+(?:\+?254\d{9}\s+|0\d{9}\s+)?(.+?)(?=\.\s*Ref(?:\.|\s)|$)/i
    );
    if (credited?.[1]) return trimCounterpartyLabel(credited[1]);
    const from = m.match(new RegExp(`\\bfrom\\s+(.+?)(${ON_DATE_CHUNK})`, "i"));
    if (from?.[1]) return trimCounterpartyLabel(from[1]);
    const sent = m.match(
      new RegExp(
        `\\bsent\\s+to\\s+(.+?)(?=${EXPENSE_COUNTERPARTY_BOUNDARY})`,
        "i"
      )
    );
    if (sent?.[1]) return trimCounterpartyLabel(sent[1]);
    return null;
  }

  if (type === "expense") {
    // Card auth pattern, e.g.
    // "Auth for card 4478..0465 at SPOTIFY AB on 2025-10-11 19:15:45 Ref:..."
    const cardAuth = m.match(
      /\bauth\s+for\s+card\s+\S+\s+at\s+(.+?)(?=\s+on\s+\d{4}-\d{2}-\d{2}\b|\s+ref(?:[:.\s]|$)|$)/i
    );
    if (cardAuth?.[1]) return trimCounterpartyLabel(cardAuth[1]);

    // "… credited to 2547… JOHN DOE. Ref. …" is recipient-side wording -> sender expense.
    const credited = m.match(
      /\bcredited\s+to\s+(?:\+?254\d{9}\s+|0\d{9}\s+)?(.+?)(?=\.\s*Ref(?:\.|\s)|$)/i
    );
    if (credited?.[1]) return trimCounterpartyLabel(credited[1]);

    const paid = m.match(
      new RegExp(
        `\\bpaid\\s+to\\s+(.+?)(?=${EXPENSE_COUNTERPARTY_BOUNDARY})`,
        "i"
      )
    );
    if (paid?.[1]) return trimCounterpartyLabel(paid[1]);
    const sent = m.match(
      new RegExp(
        `\\bsent\\s+to\\s+(.+?)(?=${EXPENSE_COUNTERPARTY_BOUNDARY})`,
        "i"
      )
    );
    if (sent?.[1]) return trimCounterpartyLabel(sent[1]);
    const bill = m.match(
      /\bbill\s+payment\s+to\s+(.+?)(?=\s+on\s+\d{1,2}[\/\-]|\.\s*$|(?=\s+for\s))/i
    );
    if (bill?.[1]) return trimCounterpartyLabel(bill[1]);
    const success = m.match(
      new RegExp(`\\bsuccessfully\\s+sent\\s+to\\s+(.+?)(${ON_DATE_CHUNK})`, "i")
    );
    if (success?.[1]) return trimCounterpartyLabel(success[1]);
    return null;
  }

  const from = m.match(new RegExp(`\\bfrom\\s+(.+?)(${ON_DATE_CHUNK})`, "i"));
  if (from?.[1]) return trimCounterpartyLabel(from[1]);
  return null;
}

function extractTransactionRef(message: string): string | null {
  // Typical M-PESA format: "UC4L68HQ9G Confirmed. ..."
  const confirmedPrefixMatch = message.match(
    /^\s*([A-Z0-9]{8,16})\s+confirmed\b/i
  );
  if (confirmedPrefixMatch?.[1]) {
    return confirmedPrefixMatch[1].toUpperCase();
  }

  // Labeled references: "Ref. ABC123...", "Reference: ABC123...", "Txn ID ABC123..."
  const explicitRefMatch = message.match(
    /\b(?:tx(?:n|id)?|trans(?:action)?(?:\s*id)?|ref(?:erence)?|code)\.?\s*[:#-]?\s*([A-Z0-9-]{6,24})\b/i
  );
  if (explicitRefMatch?.[1]) {
    return explicitRefMatch[1].toUpperCase();
  }

  // Fallback: find an alphanumeric token that looks like a transaction code.
  // Ignore numeric-only tokens (e.g. phone numbers) to avoid bad idempotency keys.
  const candidateTokens = message.matchAll(/\b([A-Z0-9]{8,16})\b/gi);
  for (const tokenMatch of candidateTokens) {
    const token = tokenMatch[1]?.toUpperCase();
    if (!token) continue;
    const hasLetter = /[A-Z]/.test(token);
    const hasDigit = /\d/.test(token);
    if (hasLetter && hasDigit) {
      return token;
    }
  }

  return null;
}

/**
 * Extract stable reference-like tokens used to link two legs of a transfer.
 * Includes common transaction IDs and account-like numeric references.
 */
export function extractTransferReferenceTokens(messageRaw: string): string[] {
  const message = messageRaw.replace(/\s+/g, " ").trim();
  if (!message) return [];

  const tokens = new Set<string>();
  const push = (value: string | null | undefined) => {
    const normalized = (value ?? "").trim().toUpperCase();
    if (normalized.length >= 6) tokens.add(normalized);
  };

  // Reuse primary transaction reference extraction.
  push(extractTransactionRef(message));

  // Explicit labeled refs: "Ref. XYZ", "MPESA Ref. XYZ", "Reference: XYZ"
  for (const match of message.matchAll(
    /\b(?:mpesa\s+ref|ref(?:erence)?|txn(?:\s*id)?|transaction(?:\s*id)?)\.?\s*[:#-]?\s*([A-Z0-9-]{6,24})\b/gi
  )) {
    push(match[1]);
  }

  // Account/phone-like identifiers often present in transfer messages.
  for (const match of message.matchAll(/\b(?:\+?254\d{9}|0\d{9}|\d{10,16})\b/g)) {
    push(match[0]);
  }

  return [...tokens];
}

const SMS_AMOUNT_REGEX = new RegExp(
  `(?:(${SMS_CURRENCY_REGEX_SOURCE}))\\s*(\\d[\\d\\s,]*\\.\\d{1,2}|\\d[\\d\\s,]*)|(\\d[\\d\\s,]*\\.\\d{1,2}|\\d[\\d\\s,]*)\\s*(?:(${SMS_CURRENCY_REGEX_SOURCE}))`,
  "gi"
);

function parseAmountToken(raw: string): number | null {
  const normalized = raw.replace(/[\s,]/g, "");
  const value = parseFloat(normalized);
  return Number.isNaN(value) ? null : value;
}

/** Extract currency-tagged amounts in message order. */
export function extractSmsCurrencyAmounts(
  message: string
): Array<{ amount: number; currency: CurrencyCode }> {
  const results: Array<{ amount: number; currency: CurrencyCode }> = [];
  for (const match of message.matchAll(SMS_AMOUNT_REGEX)) {
    const codeRaw = match[1] ?? match[4] ?? "";
    const amountRaw = match[2] ?? match[3] ?? "";
    const currency = normalizeCurrencyCode(codeRaw);
    const amount = parseAmountToken(amountRaw);
    if (currency && amount != null) {
      results.push({ amount, currency });
    }
  }
  return results;
}

const SMS_CHARGE_LABELS =
  "Transaction cost|charges|Interest charged|Fee";
const SMS_CHARGE_AMOUNT =
  "(\\d[\\d\\s,]*\\.\\d{1,2}|\\d[\\d\\s,]*)";

/**
 * Extract transaction fees from SMS (e.g. "Transaction cost Ksh 7",
 * "Charges 25.51 KES", "Fee:KES.5.75" on LOOP send confirmations).
 */
export function extractSmsTransactionCharges(message: string): number {
  const chargesRegex = new RegExp(
    `\\b(?:${SMS_CHARGE_LABELS})\\b\\s*:?\\s*.*?(?:(${SMS_CURRENCY_REGEX_SOURCE}))[\\s.]*${SMS_CHARGE_AMOUNT}|${SMS_CHARGE_AMOUNT}\\s*(?:(${SMS_CURRENCY_REGEX_SOURCE}))`,
    "i"
  );
  const chargesMatch = message.match(chargesRegex);
  const tryChargeAmount = (raw: string | undefined) => {
    const value = raw ? parseAmountToken(raw) : null;
    return value != null && value > 0 ? value : null;
  };
  const chargesValue =
    tryChargeAmount(chargesMatch?.[2]) ?? tryChargeAmount(chargesMatch?.[1]);
  return chargesValue ?? 0;
}

/**
 * Web equivalent of the Android parseSMS helper.
 * Takes a raw SMS body and returns a normalized parse result.
 */
export function parseSMS(
  messageRaw: string,
  options: ParseSmsOptions = {}
): SmsParseResult {
  const {
    timestamp = null,
    transactionDateSource = "received_at",
  } = options;

  let type: SmsType = "neither";
  let amount = 0;
  let currency: CurrencyCode | null = null;
  let charges = 0;
  let date = "";
  let transactionRef: string | null = null;

  // Normalize spacing
  const message = messageRaw.replace(/\s+/g, " ").trim();
  console.log("[SMS parse] normalized message (first 120 chars):", message.slice(0, 120));

  // Early exit for cancelled transactions and informational Fuliza notices.
  // Fuliza outstanding/charge reminders are not user-spend events.
  const lowerMessage = message.toLowerCase();
  const ignorePhrases = [
    "fuliza m-pesa amount is",
    "total fuliza m-pesa outstanding amount is",
    "access fee charged",
    "query charges",
  ];
  if (
    lowerMessage.includes("cancelled") ||
    ignorePhrases.some((phrase) => lowerMessage.includes(phrase))
  ) {
    return {
      message,
      type: "neither",
      amount: 0,
      currency: null,
      date: "",
      charges: 0,
      transactionRef: null,
      counterparty: null,
      counterpartyKey: null,
      accountReference: null,
    };
  }

  // Contextual keyword rules
  const smsRules: Record<string, string[]> = {
    income: ["received"],
    expense: [
      "credited to",
      "drawn from",
      "sent to",
      "paid to",
      "bought",
      "withdraw",
      "Auth for card",
      "used to fully pay your outstanding Fuliza",
      "successfully sent",
      "Bill payment to",
      "Fuliza M-PESA amount is",
    ],
    transaction: ["Transaction cost", "charges", "Interest charged", "Fee"],
  };
  for (const [ruleType, keywords] of Object.entries(smsRules)) {
    const matched = keywords.filter((kw) => lowerMessage.includes(kw.toLowerCase()));
    if (matched.length) {
      console.log("[SMS parse] rule:", ruleType, "keywords matched:", matched);
    }
    if (
      type === "neither" &&
      keywords.some((kw) => lowerMessage.includes(kw.toLowerCase()))
    ) {
      if (ruleType !== "transaction") {
        type = ruleType as SmsType;
      }
    }
  }
  console.log("[SMS parse] resolved type:", type);

  // First currency amount in message is usually the transaction amount.
  const currencyAmounts = extractSmsCurrencyAmounts(message);
  if (currencyAmounts.length > 0) {
    amount = currencyAmounts[0].amount;
    currency = currencyAmounts[0].currency;
  }

  charges = extractSmsTransactionCharges(message);

  transactionRef = extractTransactionRef(message);

  const bodyDate = message.trim() ? extractDateFromSmsBody(message) : null;
  const deviceDate =
    timestamp != null && Number.isFinite(timestamp)
      ? formatDateFromTimestamp(timestamp)
      : null;
  date = resolveTransactionDate(bodyDate, deviceDate, transactionDateSource);

  let counterparty: string | null = null;
  let counterpartyKey: string | null = null;
  let accountReference: string | null = null;
  if (type !== "neither") {
    counterparty = extractSmsCounterpartyLabel(message, type);
    const keyRaw = counterparty
      ? normalizeSmsCounterpartyKey(counterparty)
      : "";
    counterpartyKey = keyRaw || null;
    accountReference = extractSmsAccountReference(message);
  }

  const result = {
    message,
    type,
    amount,
    currency,
    date,
    charges,
    transactionRef,
    counterparty,
    counterpartyKey,
    accountReference,
  };
  console.log("[SMS parse] result:", {
    type: result.type,
    amount: result.amount,
    currency: result.currency,
    date: result.date,
    charges: result.charges,
    transactionRef: result.transactionRef,
    counterparty: result.counterparty,
    counterpartyKey: result.counterpartyKey,
    accountReference: result.accountReference,
  });
  return result;
}

// Convenience alias using camelCase naming.
export const parseSms = parseSMS;

/** JSON shape returned by `/api/sms` for the parsed block. */
export function smsParseResultForApi(p: SmsParseResult) {
  return {
    message: p.message,
    type: p.type,
    amount: p.amount,
    currency: p.currency,
    date: p.date,
    charges: p.charges,
    transactionRef: p.transactionRef,
    counterparty: p.counterparty,
    counterpartyKey: p.counterpartyKey,
    accountReference: p.accountReference,
  };
}
