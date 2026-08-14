import type { Account, Category, CategoryType, Transaction } from "@/lib/budget-types";

export type AssistantMetric =
  | "sum"
  | "count"
  | "average"
  | "list"
  | "category_breakdown"
  | "monthly_insights";

export type AssistantQueryIntent = {
  intent: "query_transactions" | "unsupported";
  metric: AssistantMetric;
  type: CategoryType | "all" | null;
  categoryName: string | null;
  accountName: string | null;
  search: string | null;
  excludeCategoryNames: string[];
  dateFrom: string | null;
  dateTo: string | null;
  limit: number | null;
};

export type AssistantQueryResult = {
  answer: string;
  intent: AssistantQueryIntent;
  total: number;
  count: number;
  average: number | null;
  transactions: Transaction[];
  filters: {
    type: CategoryType | "all" | null;
    categoryName: string | null;
    accountName: string | null;
    search: string | null;
    excludeCategoryNames: string[];
    dateFrom: string | null;
    dateTo: string | null;
  };
  source: "openai" | "fallback";
};

const DEFAULT_INTENT: AssistantQueryIntent = {
  intent: "query_transactions",
  metric: "sum",
  type: null,
  categoryName: null,
  accountName: null,
  search: null,
  excludeCategoryNames: [],
  dateFrom: null,
  dateTo: null,
  limit: null,
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function monthBounds(now: Date, offset: number): { dateFrom: string; dateTo: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + offset;
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0));
  return { dateFrom: isoDate(start), dateTo: isoDate(end) };
}

function yearBounds(now: Date, offset: number): { dateFrom: string; dateTo: string } {
  const year = now.getUTCFullYear() + offset;
  return {
    dateFrom: isoDate(new Date(Date.UTC(year, 0, 1))),
    dateTo: isoDate(new Date(Date.UTC(year, 11, 31))),
  };
}

function thisWeekBounds(now: Date): { dateFrom: string; dateTo: string } {
  const day = now.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = addDays(now, mondayOffset);
  return { dateFrom: isoDate(start), dateTo: isoDate(addDays(start, 6)) };
}

export function detectDateRange(question: string, now = new Date()) {
  const q = question.toLowerCase();
  if (/\btoday\b/.test(q)) {
    const today = isoDate(now);
    return { dateFrom: today, dateTo: today };
  }
  if (/\byesterday\b/.test(q)) {
    const yesterday = isoDate(addDays(now, -1));
    return { dateFrom: yesterday, dateTo: yesterday };
  }
  if (/\blast\s+(7|seven)\s+days\b/.test(q)) {
    return { dateFrom: isoDate(addDays(now, -6)), dateTo: isoDate(now) };
  }
  if (/\bthis\s+week\b/.test(q)) return thisWeekBounds(now);
  if (/\bthis\s+month\b/.test(q)) return monthBounds(now, 0);
  if (/\blast\s+month\b/.test(q)) return monthBounds(now, -1);
  if (/\bthis\s+year\b/.test(q)) return yearBounds(now, 0);
  if (/\blast\s+year\b/.test(q)) return yearBounds(now, -1);

  const yearMatch = q.match(/\b(20\d{2})\b/);
  if (yearMatch) {
    const year = Number(yearMatch[1]);
    return {
      dateFrom: isoDate(new Date(Date.UTC(year, 0, 1))),
      dateTo: isoDate(new Date(Date.UTC(year, 11, 31))),
    };
  }
  return { dateFrom: null, dateTo: null };
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase();
}

function findMentionedName(question: string, names: string[]): string | null {
  const normalizedQuestion = ` ${normalizeName(question)} `;
  const sorted = [...names].sort((a, b) => b.length - a.length);
  return (
    sorted.find((name) => {
      const normalized = normalizeName(name);
      return normalized.length > 0 && normalizedQuestion.includes(` ${normalized} `);
    }) ?? null
  );
}

function detectMetric(question: string): AssistantMetric {
  const q = question.toLowerCase();
  if (/\b(insight|insights|changed|change|different|unusual|spike|spikes|trend|summary)\b/.test(q)) {
    return "monthly_insights";
  }
  if (/\b(biggest|largest|top|most on|highest)\b/.test(q) || /\bcategories\b/.test(q)) {
    return "category_breakdown";
  }
  if (/\b(how many|count|number of)\b/.test(q)) return "count";
  if (/\baverage|avg\b/.test(q)) return "average";
  if (/\b(show|list|which|recent|latest)\b/.test(q)) return "list";
  return "sum";
}

function detectLimit(question: string): number {
  const q = question.toLowerCase();
  const digitMatch = q.match(/\btop\s+(\d{1,2})\b/) ?? q.match(/\b(\d{1,2})\s+biggest\b/);
  if (digitMatch?.[1]) return Math.max(1, Math.min(50, Number(digitMatch[1])));
  if (/\bfive\b/.test(q)) return 5;
  if (/\bten\b/.test(q)) return 10;
  if (/\bbiggest|largest|most on|highest\b/.test(q)) return 1;
  return /\b(all|every)\b/.test(q) ? 50 : 5;
}

function detectExcludedCategoryNames(question: string, categories: Category[]): string[] {
  const q = question.toLowerCase();
  const excluded = new Set<string>();
  for (const pattern of [
    /\bother than\s+(.+?)(?:[?.!]|$)/i,
    /\bexcept\s+(.+?)(?:[?.!]|$)/i,
    /\bexcluding\s+(.+?)(?:[?.!]|$)/i,
  ]) {
    const match = question.match(pattern);
    if (!match?.[1]) continue;
    const text = match[1].toLowerCase();
    for (const category of categories) {
      if (text.includes(category.name.toLowerCase())) excluded.add(category.name);
    }
  }
  if (/\bnot\s+other\b/.test(q)) {
    const other = categories.find((category) => category.name.toLowerCase() === "other");
    if (other) excluded.add(other.name);
  }
  return [...excluded];
}

function detectType(question: string): CategoryType | "all" | null {
  const q = question.toLowerCase();
  if (/\btransfer|moved|sent between accounts\b/.test(q)) return "transfer";
  if (/\bincome|earned|received|salary|paid me|came in\b/.test(q)) return "income";
  if (/\bspent|spend|expense|expenses|paid|bought|cost\b/.test(q)) return "expense";
  return null;
}

function detectSearch(question: string, categoryName: string | null): string | null {
  const q = question.trim();
  const atMatch = q.match(/\bat\s+(.+?)(?:\s+(?:this|last|today|yesterday|in|on)\b|[?.!]|$)/i);
  if (atMatch?.[1]) {
    const value = atMatch[1].trim();
    if (value && value.toLowerCase() !== categoryName?.toLowerCase()) return value;
  }
  return null;
}

export function fallbackParseAssistantIntent(
  question: string,
  categories: Category[],
  accounts: Account[],
  now = new Date()
): AssistantQueryIntent {
  const categoryName = findMentionedName(
    question,
    categories.map((category) => category.name)
  );
  const accountName = findMentionedName(
    question,
    accounts.map((account) => account.name)
  );
  const dates = detectDateRange(question, now);
  return {
    ...DEFAULT_INTENT,
    metric: detectMetric(question),
    type: detectType(question),
    categoryName,
    accountName,
    search: detectSearch(question, categoryName),
    excludeCategoryNames: detectExcludedCategoryNames(question, categories),
    dateFrom: dates.dateFrom,
    dateTo: dates.dateTo,
    limit: detectLimit(question),
  };
}

function isCategoryType(value: unknown): value is CategoryType {
  return value === "income" || value === "expense" || value === "transfer";
}

export function normalizeAssistantIntent(value: unknown): AssistantQueryIntent | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<AssistantQueryIntent>;
  const metric =
    record.metric === "count" ||
    record.metric === "average" ||
    record.metric === "list" ||
    record.metric === "category_breakdown" ||
    record.metric === "monthly_insights" ||
    record.metric === "sum"
      ? record.metric
      : "sum";
  const type = isCategoryType(record.type) || record.type === "all" ? record.type : null;
  const limit = Number.isFinite(record.limit) ? Math.max(1, Math.min(50, Number(record.limit))) : null;
  const excludeCategoryNames = Array.isArray(record.excludeCategoryNames)
    ? record.excludeCategoryNames
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim())
    : [];
  return {
    intent: record.intent === "unsupported" ? "unsupported" : "query_transactions",
    metric,
    type,
    categoryName: typeof record.categoryName === "string" && record.categoryName.trim() ? record.categoryName.trim() : null,
    accountName: typeof record.accountName === "string" && record.accountName.trim() ? record.accountName.trim() : null,
    search: typeof record.search === "string" && record.search.trim() ? record.search.trim() : null,
    excludeCategoryNames,
    dateFrom: typeof record.dateFrom === "string" && record.dateFrom.trim() ? record.dateFrom.trim() : null,
    dateTo: typeof record.dateTo === "string" && record.dateTo.trim() ? record.dateTo.trim() : null,
    limit,
  };
}

function includesText(value: string | null | undefined, search: string): boolean {
  return value?.toLowerCase().includes(search.toLowerCase()) ?? false;
}

export function transactionAmountForMetric(transaction: Transaction): number {
  const amount = Math.abs(transaction.amount);
  return transaction.type === "expense" ? amount + (transaction.transactionCharges ?? 0) : amount;
}

export function filterTransactions(
  transactions: Transaction[],
  intent: AssistantQueryIntent
): Transaction[] {
  const category = intent.categoryName?.toLowerCase() ?? null;
  const account = intent.accountName?.toLowerCase() ?? null;
  const search = intent.search?.toLowerCase() ?? null;
  const excludedCategories = new Set(
    intent.excludeCategoryNames.map((name) => name.toLowerCase())
  );
  return transactions.filter((transaction) => {
    if (intent.type && intent.type !== "all" && transaction.type !== intent.type) return false;
    if (intent.dateFrom && transaction.date < intent.dateFrom) return false;
    if (intent.dateTo && transaction.date > intent.dateTo) return false;
    if (category && transaction.categoryName?.toLowerCase() !== category) return false;
    if (
      transaction.categoryName &&
      excludedCategories.has(transaction.categoryName.toLowerCase())
    ) {
      return false;
    }
    if (account && transaction.accountName?.toLowerCase() !== account) return false;
    if (
      search &&
      ![
        transaction.notes,
        transaction.smsMessage,
        transaction.categoryName,
        transaction.accountName,
        transaction.smsCounterparty,
      ].some((value) => includesText(value, search))
    ) {
      return false;
    }
    return true;
  });
}
