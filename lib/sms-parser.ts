export type SmsType = "income" | "expense" | "neither";

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
}

function formatDateFromTimestamp(timestamp: number): string {
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
  const { timestamp = null, includeFeeInExpense = false } = options;

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

  // Extract date
  if (timestamp != null) {
    date = formatDateFromTimestamp(timestamp);
  } else {
    const dateRegex =
      /\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2}/;
    const match = message.match(dateRegex);
    if (match && match[0]) {
      const dateString = match[0];
      if (dateString.includes("/")) {
        const [day, month, year] = dateString.split("/");
        const fullYear = year.length === 2 ? `20${year}` : year;
        const mm = month.padStart(2, "0");
        const dd = day.padStart(2, "0");
        date = `${fullYear}-${mm}-${dd}`;
      } else {
        date = dateString;
      }
    }
  }

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

