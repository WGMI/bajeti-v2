export type SmsType = "income" | "expense" | "neither";

/** Where the transaction `date` should come from when both SMS text and device time exist. */
export type SmsTransactionDateSource = "message" | "received_at";

export interface SmsParseResult {
  message: string;
  type: SmsType;
  amount: number;
  date: string;
  fee: number;
  transactionRef: string | null;
}

export interface ParseSmsOptions {
  timestamp?: number | null;
  includeFeeInExpense?: boolean;
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

  // "4 Apr 2026" / "04 APR 26"
  const dMonY = message.match(
    /\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{2,4})\b/
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
 * Web equivalent of the Android parseSMS helper.
 * Takes a raw SMS body and returns a normalized parse result.
 */
export function parseSMS(
  messageRaw: string,
  options: ParseSmsOptions = {}
): SmsParseResult {
  const {
    timestamp = null,
    includeFeeInExpense = false,
    transactionDateSource = "received_at",
  } = options;

  let type: SmsType = "neither";
  let amount = 0;
  let fee = 0;
  let date = "";
  let transactionRef: string | null = null;

  // Normalize spacing
  const message = messageRaw.replace(/\s+/g, " ").trim();
  console.log("[SMS parse] normalized message (first 120 chars):", message.slice(0, 120));

  // Early exit for cancelled transactions
  if (message.toLowerCase().includes("cancelled")) {
    return {
      message,
      type: "neither",
      amount: 0,
      date: "",
      fee: 0,
      transactionRef: null,
    };
  }

  // Contextual keyword rules
  const smsRules: Record<string, string[]> = {
    income: ["received"],
    expense: [
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
      "credited to",
    ],
    transaction: ["Transaction cost", "charges", "Interest charged"],
  };

  for (const [ruleType, keywords] of Object.entries(smsRules)) {
    const lower = message.toLowerCase();
    const matched = keywords.filter((kw) => lower.includes(kw.toLowerCase()));
    if (matched.length) {
      console.log("[SMS parse] rule:", ruleType, "keywords matched:", matched);
    }
    if (
      type === "neither" &&
      keywords.some((kw) => lower.includes(kw.toLowerCase()))
    ) {
      if (ruleType !== "transaction") {
        type = ruleType as SmsType;
      }
    }
  }
  console.log("[SMS parse] resolved type:", type);

  // Extract amount - first currency amount in message is usually transaction amount.
  // Support both "KES 2000" and "2000 KES" formats.
  const amountRegex =
    /(?:KES|Ksh|Kshs\.?)\s*(\d[\d\s,]*\.\d{1,2}|\d[\d\s,]*)|(\d[\d\s,]*\.\d{1,2}|\d[\d\s,]*)\s*(?:KES|Ksh|Kshs\.?)/gi;
  const allMatches: number[] = [];

  for (const match of message.matchAll(amountRegex)) {
    const raw = match[1] ?? match[2] ?? "";
    const normalized = raw.replace(/[\s,]/g, "");
    const value = parseFloat(normalized);
    if (!Number.isNaN(value)) {
      allMatches.push(value);
    }
  }

  if (allMatches.length > 0) {
    amount = allMatches[0];
  }

  // Extract fee (look for phrases like "Transaction cost Ksh..." or "Charges 25.51 KES")
  const feeRegex =
    /(Transaction cost|charges|Interest charged).*?(?:(?:KES|Ksh|Kshs\.?)\s*(\d[\d\s,]*\.\d{1,2}|\d[\d\s,]*)|(\d[\d\s,]*\.\d{1,2}|\d[\d\s,]*)\s*(?:KES|Ksh|Kshs\.?))/i;
  const feeMatch = message.match(feeRegex);
  const feeRaw = feeMatch?.[2] ?? feeMatch?.[3] ?? "";
  if (feeRaw) {
    const normalized = feeRaw.replace(/[\s,]/g, "");
    const value = parseFloat(normalized);
    if (!Number.isNaN(value)) {
      fee = value;
    }
  }

  // Add fee to amount if needed
  if (includeFeeInExpense && type === "expense") {
    amount += fee;
  }

  transactionRef = extractTransactionRef(message);

  const bodyDate = message.trim() ? extractDateFromSmsBody(message) : null;
  const deviceDate =
    timestamp != null && Number.isFinite(timestamp)
      ? formatDateFromTimestamp(timestamp)
      : null;
  date = resolveTransactionDate(bodyDate, deviceDate, transactionDateSource);

  const result = { message, type, amount, date, fee, transactionRef };
  console.log("[SMS parse] result:", {
    type: result.type,
    amount: result.amount,
    date: result.date,
    fee: result.fee,
    transactionRef: result.transactionRef,
  });
  return result;
}

// Convenience alias using camelCase naming.
export const parseSms = parseSMS;

