export type SmsType = "income" | "expense" | "neither";

export interface SmsParseResult {
  message: string;
  type: SmsType;
  amount: number;
  date: string;
  fee: number;
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
    /(?:KES|Ksh|Kshs\.?)\s*([\d\s,]+\.\d{1,2}|[\d\s,]+)|([\d\s,]+\.\d{1,2}|[\d\s,]+)\s*(?:KES|Ksh|Kshs\.?)/gi;
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
    /(Transaction cost|charges|Interest charged).*?(?:(?:KES|Ksh|Kshs\.?)\s*([\d\s,]+\.\d{1,2}|[\d\s,]+)|([\d\s,]+\.\d{1,2}|[\d\s,]+)\s*(?:KES|Ksh|Kshs\.?))/i;
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

  const result = { message, type, amount, date, fee };
  console.log("[SMS parse] result:", { type: result.type, amount: result.amount, date: result.date, fee: result.fee });
  return result;
}

// Convenience alias using camelCase naming.
export const parseSms = parseSMS;

