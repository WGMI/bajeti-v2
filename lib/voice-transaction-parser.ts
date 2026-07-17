import type { Account, Category, CategoryType } from "@/lib/budget-types";

export type VoiceTransactionPreviewStatus = "ready" | "needs_review" | "ignored";

export interface VoiceTransactionPreview {
  amount?: number;
  transactionCharges?: number;
  categoryId?: string;
  categoryName?: string;
  date?: string;
  notes?: string;
  type?: CategoryType;
  accountId?: string;
  accountName?: string;
  fromAccountId?: string;
  fromAccountName?: string;
  toAccountId?: string;
  toAccountName?: string;
  counterparty?: string | null;
}

export interface VoiceTransactionParseResult {
  status: VoiceTransactionPreviewStatus;
  confidence: number;
  missingFields: string[];
  transcript: string;
  preview: VoiceTransactionPreview | null;
  explanation: string;
}

interface ParseVoiceTransactionOptions {
  transcript: string;
  categories: Category[];
  accounts: Account[];
  timestamp?: number | null;
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  a: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const MONTHS: Record<string, number> = {
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

const ORDINALS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17,
  eighteenth: 18,
  nineteenth: 19,
  twentieth: 20,
  "twenty-first": 21,
  "twenty-second": 22,
  "twenty-third": 23,
  "twenty-fourth": 24,
  "twenty-fifth": 25,
  "twenty-sixth": 26,
  "twenty-seventh": 27,
  "twenty-eighth": 28,
  "twenty-ninth": 29,
  thirtieth: 30,
  "thirty-first": 31,
};

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Food: [
    "food",
    "lunch",
    "dinner",
    "breakfast",
    "groceries",
    "grocery",
    "restaurant",
    "cafe",
    "coffee",
    "java",
    "naivas",
    "quickmart",
    "carrefour",
  ],
  Transport: [
    "transport",
    "fare",
    "bus",
    "matatu",
    "taxi",
    "uber",
    "bolt",
    "fuel",
    "petrol",
    "parking",
  ],
  Rent: ["rent", "landlord"],
  Bills: [
    "bill",
    "bills",
    "electricity",
    "power",
    "water",
    "internet",
    "wifi",
    "airtime",
    "data",
    "token",
    "tokens",
  ],
  Entertainment: ["movie", "movies", "cinema", "netflix", "show", "concert", "game"],
  Savings: ["savings", "save", "saving"],
  Salary: ["salary", "paycheck", "payroll", "wages"],
  Transfer: ["transfer", "moved", "move"],
};

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}.,/\-\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function normalizeSpeechAmountArtifacts(value: string): string {
  return value.replace(
    /\b(\d{1,2})[:.](\d{2})\b(?!\s*(?:am|pm)\b)/gi,
    (_, whole: string, tens: string) => `${whole}${tens}`
  );
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function baseDate(timestamp?: number | null): Date {
  const d = typeof timestamp === "number" && Number.isFinite(timestamp) ? new Date(timestamp) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function parseDay(raw: string | undefined): number | null {
  if (!raw) return null;
  const numeric = raw.match(/^(\d{1,2})(?:st|nd|rd|th)?$/i);
  if (numeric) return parseInt(numeric[1], 10);
  return ORDINALS[raw.toLowerCase()] ?? null;
}

function validDate(year: number, month: number, day: number): string | null {
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return formatDate(date);
}

function parseDate(text: string, timestamp?: number | null): { date: string; reason: string } {
  const base = baseDate(timestamp);
  if (/\byesterday\b/.test(text)) {
    const d = new Date(base);
    d.setDate(d.getDate() - 1);
    return { date: formatDate(d), reason: "Interpreted 'yesterday' from the request." };
  }
  if (/\btomorrow\b/.test(text)) {
    const d = new Date(base);
    d.setDate(d.getDate() + 1);
    return { date: formatDate(d), reason: "Interpreted 'tomorrow' from the request." };
  }
  if (/\btoday\b/.test(text)) {
    return { date: formatDate(base), reason: "Interpreted 'today' from the request." };
  }

  const iso = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) {
    const parsed = validDate(parseInt(iso[1], 10), parseInt(iso[2], 10), parseInt(iso[3], 10));
    if (parsed) return { date: parsed, reason: "Used the explicit date in the request." };
  }

  const slash = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (slash) {
    const year = slash[3]
      ? slash[3].length === 2
        ? 2000 + parseInt(slash[3], 10)
        : parseInt(slash[3], 10)
      : base.getFullYear();
    const parsed = validDate(year, parseInt(slash[2], 10), parseInt(slash[1], 10));
    if (parsed) return { date: parsed, reason: "Used the explicit date in the request." };
  }

  const monthName = Object.keys(MONTHS).join("|");
  const monthDay = text.match(
    new RegExp(`\\b(${monthName})\\s+(\\d{1,2}(?:st|nd|rd|th)?|[a-z-]+)(?:,?\\s+(\\d{4}))?\\b`)
  );
  if (monthDay) {
    const day = parseDay(monthDay[2]);
    const month = MONTHS[monthDay[1]];
    const year = monthDay[3] ? parseInt(monthDay[3], 10) : base.getFullYear();
    if (day && month) {
      const parsed = validDate(year, month, day);
      if (parsed) return { date: parsed, reason: "Used the explicit date in the request." };
    }
  }

  const dayMonth = text.match(
    new RegExp(`\\b(\\d{1,2}(?:st|nd|rd|th)?|[a-z-]+)\\s+(${monthName})(?:,?\\s+(\\d{4}))?\\b`)
  );
  if (dayMonth) {
    const day = parseDay(dayMonth[1]);
    const month = MONTHS[dayMonth[2]];
    const year = dayMonth[3] ? parseInt(dayMonth[3], 10) : base.getFullYear();
    if (day && month) {
      const parsed = validDate(year, month, day);
      if (parsed) return { date: parsed, reason: "Used the explicit date in the request." };
    }
  }

  return { date: formatDate(base), reason: "No date was spoken, so I used today." };
}

function parseNumberWords(tokens: string[]): number | null {
  let total = 0;
  let current = 0;
  let consumed = false;
  for (const token of tokens) {
    if (token === "and") continue;
    if (NUMBER_WORDS[token] != null) {
      current += NUMBER_WORDS[token];
      consumed = true;
      continue;
    }
    if (token === "hundred") {
      current = Math.max(current, 1) * 100;
      consumed = true;
      continue;
    }
    if (token === "thousand" || token === "grand") {
      total += Math.max(current, 1) * 1000;
      current = 0;
      consumed = true;
      continue;
    }
    return consumed ? total + current : null;
  }
  return consumed ? total + current : null;
}

function parseAmount(text: string): { amount: number | null; reason: string | null } {
  const principalText = text
    .replace(
      /\b(?:with\s+)?(?:transaction\s+)?(?:charge|charges|fee|fees|transaction cost)\b.*$/i,
      ""
    )
    .trim();
  const amountText = normalizeSpeechAmountArtifacts(principalText);
  const numeric = amountText.match(
    /\b(?:kes|ksh|shillings?|bob|usd|dollars?)?\s*(\d[\d,]*(?:\.\d+)?)(k)?\s*(?:kes|ksh|shillings?|bob|usd|dollars?)?\b/i
  );
  if (numeric) {
    const raw = parseFloat(numeric[1].replace(/,/g, ""));
    if (Number.isFinite(raw) && raw > 0) {
      return {
        amount: numeric[2] ? raw * 1000 : raw,
        reason: "Found a numeric amount in the request.",
      };
    }
  }

  const words = amountText.split(/\s+/);
  for (let start = 0; start < words.length; start += 1) {
    for (let end = Math.min(words.length, start + 8); end > start; end -= 1) {
      const value = parseNumberWords(words.slice(start, end));
      if (value && value > 0) {
        return { amount: value, reason: "Converted the spoken amount into a number." };
      }
    }
  }

  return { amount: null, reason: null };
}

function parseCharges(text: string): number {
  const m = text.match(
    /\b(?:charge|charges|fee|fees|transaction cost)\D{0,20}(\d[\d,]*(?:\.\d+)?)(k)?\b/i
  );
  if (!m) return 0;
  const amount = parseFloat(m[1].replace(/,/g, ""));
  return Number.isFinite(amount) && amount > 0 ? (m[2] ? amount * 1000 : amount) : 0;
}

function inferType(text: string): { type: CategoryType | null; reason: string | null } {
  if (/\b(transfer|moved?|move|shift)\b/.test(text)) {
    return { type: "transfer", reason: "Detected transfer language." };
  }
  if (/\b(received|got|earned|salary|income|paid me|deposit|deposited)\b/.test(text)) {
    return { type: "income", reason: "Detected income language." };
  }
  if (/\b(spent|paid|bought|buy|purchase|purchased|expense|used)\b/.test(text)) {
    return { type: "expense", reason: "Detected expense language." };
  }
  if (/\b(?:on|for)\s+[a-z0-9]|\bat\s+[a-z0-9]/.test(text)) {
    return { type: "expense", reason: "Treated the spoken purchase context as an expense." };
  }
  return { type: null, reason: null };
}

function findByName<T extends { name: string }>(items: T[], text: string): T | null {
  const sorted = [...items].sort((a, b) => b.name.length - a.name.length);
  return (
    sorted.find((item) => {
      const name = normalizeText(item.name);
      return name.length > 1 && new RegExp(`\\b${escapeRegExp(name)}\\b`).test(text);
    }) ?? null
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function categoryByName(categories: Category[], name: string, type: CategoryType): Category | null {
  return (
    categories.find(
      (category) =>
        category.type === type && category.name.toLowerCase() === name.toLowerCase()
    ) ?? null
  );
}

function fallbackCategory(categories: Category[], type: CategoryType): Category | null {
  const names =
    type === "income"
      ? ["Other Income", "Salary"]
      : type === "transfer"
        ? ["Transfer"]
        : ["Other"];
  for (const name of names) {
    const found = categoryByName(categories, name, type);
    if (found) return found;
  }
  return categories.find((category) => category.type === type) ?? null;
}

function inferCategory(
  text: string,
  categories: Category[],
  type: CategoryType
): { category: Category | null; reason: string | null; strong: boolean } {
  const direct = findByName(
    categories.filter((category) => category.type === type),
    text
  );
  if (direct) {
    return { category: direct, reason: `Matched the spoken category '${direct.name}'.`, strong: true };
  }

  for (const [categoryName, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const category = categoryByName(categories, categoryName, type);
    if (!category) continue;
    if (keywords.some((keyword) => new RegExp(`\\b${escapeRegExp(keyword)}\\b`).test(text))) {
      return { category, reason: `Suggested ${category.name} from the wording.`, strong: true };
    }
  }

  const fallback = fallbackCategory(categories, type);
  if (fallback) {
    return {
      category: fallback,
      reason: `No exact category was spoken, so I used ${fallback.name}.`,
      strong: false,
    };
  }
  return { category: null, reason: null, strong: false };
}

function defaultAccount(accounts: Account[]): Account | null {
  return accounts.find((account) => account.isDefault) ?? accounts[0] ?? null;
}

function inferAccounts(
  text: string,
  accounts: Account[],
  type: CategoryType
): {
  account: Account | null;
  fromAccount: Account | null;
  toAccount: Account | null;
  reason: string | null;
} {
  const fallback = defaultAccount(accounts);
  const direct = findByName(accounts, text);
  if (type !== "transfer") {
    return {
      account: direct ?? fallback,
      fromAccount: null,
      toAccount: null,
      reason: direct ? `Matched account '${direct.name}'.` : "Used the default account.",
    };
  }

  const fromMatch = text.match(/\bfrom\s+([a-z0-9 ]{2,40}?)(?:\s+to\b|$)/);
  const toMatch = text.match(/\bto\s+([a-z0-9 ]{2,40}?)(?:\s+from\b|$)/);
  const fromText = fromMatch?.[1]?.trim() ?? "";
  const toText = toMatch?.[1]?.trim() ?? "";
  const fromAccount = fromText ? findByName(accounts, fromText) : fallback;
  const toAccount = toText ? findByName(accounts, toText) : direct && direct.id !== fromAccount?.id ? direct : null;

  return {
    account: null,
    fromAccount,
    toAccount,
    reason:
      fromAccount || toAccount
        ? "Matched transfer accounts from the request where possible."
        : null,
  };
}

function inferCounterparty(original: string): string | null {
  const m = original.match(/\b(?:at|to|from|for)\s+([A-Za-z][A-Za-z0-9 '&.-]{1,40})/);
  if (!m) return null;
  return m[1].replace(/\b(today|yesterday|tomorrow|from|using|with|account|wallet)\b.*$/i, "").trim() || null;
}

function cleanNotes(original: string, counterparty: string | null): string {
  const trimmed = normalizeSpeechAmountArtifacts(original).trim().replace(/\s+/g, " ");
  if (counterparty && trimmed.length > 80) return counterparty;
  return trimmed.slice(0, 180);
}

export function parseVoiceTransaction({
  transcript,
  categories,
  accounts,
  timestamp,
}: ParseVoiceTransactionOptions): VoiceTransactionParseResult {
  const original = normalizeSpeechAmountArtifacts(transcript.trim());
  const text = normalizeText(original);
  if (text.length < 3) {
    return {
      status: "ignored",
      confidence: 0,
      missingFields: ["transcript"],
      transcript: original,
      preview: null,
      explanation: "Say or type a transaction, for example: 'Spent 500 on lunch today.'",
    };
  }

  const amount = parseAmount(text);
  const txType = inferType(text);
  const type = txType.type ?? "expense";
  const date = parseDate(text, timestamp);
  const category = inferCategory(text, categories, type);
  const account = inferAccounts(text, accounts, type);
  const charges = type === "transfer" ? 0 : parseCharges(text);
  const counterparty = inferCounterparty(original);

  const missingFields: string[] = [];
  if (!txType.type) missingFields.push("type");
  if (amount.amount == null) missingFields.push("amount");
  if (!category.category) missingFields.push("categoryId");
  if (type === "transfer") {
    if (!account.fromAccount) missingFields.push("fromAccountId");
    if (!account.toAccount) missingFields.push("toAccountId");
    if (account.fromAccount?.id && account.fromAccount.id === account.toAccount?.id) {
      missingFields.push("toAccountId");
    }
  } else if (!account.account) {
    missingFields.push("accountId");
  }

  let confidence = 0.35;
  if (txType.type) confidence += 0.18;
  if (amount.amount != null) confidence += 0.22;
  if (category.category) confidence += category.strong ? 0.14 : 0.06;
  if (type === "transfer" ? account.fromAccount && account.toAccount : account.account) {
    confidence += 0.08;
  }
  if (date.reason.includes("explicit") || text.includes("today") || text.includes("yesterday")) {
    confidence += 0.03;
  }
  confidence = Math.min(0.98, Math.max(0, Number(confidence.toFixed(2))));

  const preview: VoiceTransactionPreview = {
    amount: amount.amount ?? undefined,
    transactionCharges: charges,
    categoryId: category.category?.id,
    categoryName: category.category?.name,
    date: date.date,
    notes: cleanNotes(original, counterparty),
    type,
    counterparty,
    ...(type === "transfer"
      ? {
          fromAccountId: account.fromAccount?.id,
          fromAccountName: account.fromAccount?.name,
          toAccountId: account.toAccount?.id,
          toAccountName: account.toAccount?.name,
        }
      : {
          accountId: account.account?.id,
          accountName: account.account?.name,
        }),
  };

  const explanationParts = [
    txType.reason,
    amount.reason,
    category.reason,
    account.reason,
    date.reason,
  ].filter(Boolean);

  return {
    status: missingFields.length === 0 && confidence >= 0.72 ? "ready" : "needs_review",
    confidence,
    missingFields: [...new Set(missingFields)],
    transcript: original,
    preview,
    explanation: explanationParts.join(" "),
  };
}
