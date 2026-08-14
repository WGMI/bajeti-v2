import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { rowToTransaction, type TransactionRow } from "@/lib/transaction-api";
import type { Account, Category, Transaction } from "@/lib/budget-types";
import {
  fallbackParseAssistantIntent,
  filterTransactions,
  normalizeAssistantIntent,
  transactionAmountForMetric,
  type AssistantQueryIntent,
} from "@/lib/assistant-query";

type CategoryRow = {
  id: string;
  name: string;
  type: "income" | "expense" | "transfer";
  is_default: boolean;
};

type AccountRow = {
  id: string;
  name: string;
  is_default: boolean;
};

type SettingsRow = {
  currency: string;
};

const INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: { type: "string", enum: ["query_transactions", "unsupported"] },
    metric: {
      type: "string",
      enum: ["sum", "count", "average", "list", "category_breakdown", "monthly_insights"],
    },
    type: { type: ["string", "null"], enum: ["income", "expense", "transfer", "all", null] },
    categoryName: { type: ["string", "null"] },
    accountName: { type: ["string", "null"] },
    search: { type: ["string", "null"] },
    excludeCategoryNames: {
      type: "array",
      items: { type: "string" },
    },
    dateFrom: { type: ["string", "null"] },
    dateTo: { type: ["string", "null"] },
    limit: { type: ["number", "null"] },
  },
  required: [
    "intent",
    "metric",
    "type",
    "categoryName",
    "accountName",
    "search",
    "excludeCategoryNames",
    "dateFrom",
    "dateTo",
    "limit",
  ],
};

function rowToCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    isDefault: row.is_default,
  };
}

function rowToAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    isDefault: row.is_default,
  };
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

function describeFilters(intent: AssistantQueryIntent): string {
  const parts: string[] = [];
  if (intent.type && intent.type !== "all") parts.push(intent.type);
  if (intent.categoryName) parts.push(intent.categoryName);
  if (intent.accountName) parts.push(intent.accountName);
  if (intent.search) parts.push(`matching "${intent.search}"`);
  if (intent.dateFrom && intent.dateTo && intent.dateFrom === intent.dateTo) {
    parts.push(`on ${intent.dateFrom}`);
  } else if (intent.dateFrom && intent.dateTo) {
    parts.push(`from ${intent.dateFrom} to ${intent.dateTo}`);
  } else if (intent.dateFrom) {
    parts.push(`from ${intent.dateFrom}`);
  } else if (intent.dateTo) {
    parts.push(`up to ${intent.dateTo}`);
  }
  return parts.length > 0 ? parts.join(", ") : "matching transactions";
}

function extractResponseText(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const record = data as { output_text?: unknown; output?: unknown };
  if (typeof record.output_text === "string") return record.output_text;
  if (!Array.isArray(record.output)) return null;
  for (const item of record.output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const text = (part as { text?: unknown }).text;
      if (typeof text === "string") return text;
    }
  }
  return null;
}

async function parseIntentWithOpenAI(
  question: string,
  categories: Category[],
  accounts: Account[]
): Promise<AssistantQueryIntent | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const today = new Date().toISOString().slice(0, 10);
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-5",
      input: [
        {
          role: "system",
          content:
            "Translate a personal finance question into one safe transaction query intent. " +
            "Use only categoryName and accountName values from the provided lists. " +
            "For merchant, payee, payer, or note text, use search. " +
            "Use metric category_breakdown for biggest, largest, top categories, or spent the most on questions. " +
            "Use metric monthly_insights for changed, unusual, spike, trend, summary, or insight questions. " +
            "Use excludeCategoryNames for phrases like other than, except, or excluding. " +
            "Resolve relative dates using today's date. Return unsupported for non-transaction questions.",
        },
        {
          role: "user",
          content: JSON.stringify({
            today,
            categories: categories.map(({ name, type }) => ({ name, type })),
            accounts: accounts.map(({ name }) => name),
            question,
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "bajeti_transaction_query_intent",
          strict: true,
          schema: INTENT_SCHEMA,
        },
      },
    }),
  });

  if (!res.ok) {
    console.error("OpenAI intent parse failed", await res.text().catch(() => res.statusText));
    return null;
  }
  const text = extractResponseText(await res.json().catch(() => null));
  if (!text) return null;
  return normalizeAssistantIntent(JSON.parse(text));
}

async function loadMetadata(userId: string) {
  const [categoryRows, accountRows, settingsRows] = await Promise.all([
    sql`
      SELECT id, name, type::text AS type, is_default
      FROM categories
      WHERE user_id = ${userId}
      ORDER BY type, name
    `,
    sql`
      SELECT id, name, is_default
      FROM accounts
      WHERE user_id = ${userId}
      ORDER BY is_default DESC, name
    `,
    sql`
      SELECT currency
      FROM user_settings
      WHERE user_id = ${userId}
      LIMIT 1
    `,
  ]);
  return {
    categories: (categoryRows as CategoryRow[]).map(rowToCategory),
    accounts: (accountRows as AccountRow[]).map(rowToAccount),
    currency: ((settingsRows[0] as SettingsRow | undefined)?.currency ?? "USD") as string,
  };
}

async function loadTransactions(userId: string): Promise<TransactionRow[]> {
  return (await sql`
    SELECT
      t.id, t.user_id, t.group_id, t.added_by_user_id, t.paid_by_user_id,
      t.approved_by_user_id, t.approval_status::text AS approval_status,
      t.amount_encrypted,
      t.transaction_charges, t.transaction_charges_encrypted,
      t.currency, t.original_amount, t.original_amount_encrypted, t.original_currency,
      t.fx_rate, t.fx_rate_encrypted, t.fx_rate_date::text AS fx_rate_date, t.fx_source,
      t.account_id, t.category_id, t.date::text AS date, t.notes, t.sms_message, t.type,
      t.sms_counterparty, t.sms_counterparty_key,
      t.transfer_group_id, t.transfer_leg::text AS transfer_leg,
      c.name AS category_name,
      ac.name AS account_name,
      mate.account_id AS counter_account_id,
      mate_ac.name AS counter_account_name
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN accounts ac ON ac.id = t.account_id
    LEFT JOIN transactions mate ON mate.user_id = t.user_id
      AND mate.transfer_group_id = t.transfer_group_id
      AND mate.id <> t.id
    LEFT JOIN accounts mate_ac ON mate_ac.id = mate.account_id
    WHERE t.user_id = ${userId}
    ORDER BY t.date DESC, t.id DESC
  `) as TransactionRow[];
}

function answerForIntent(
  question: string,
  intent: AssistantQueryIntent,
  transactions: ReturnType<typeof rowToTransaction>[],
  currency: string
) {
  if (intent.intent === "unsupported") {
    return {
      answer: "I can answer transaction questions first. Try asking about spending, income, categories, accounts, dates, or merchants.",
      total: 0,
      count: 0,
      average: null,
      visibleTransactions: [],
      categoryBreakdown: [],
      insights: [],
    };
  }

  const matching = filterTransactions(transactions, intent);
  const total = matching.reduce((sum, transaction) => {
    return sum + transactionAmountForMetric(transaction);
  }, 0);
  const count = matching.length;
  const average = count > 0 ? total / count : null;
  const filterText = describeFilters(intent);

  const categoryBreakdown = categoryTotals(matching).slice(0, intent.limit ?? 5);

  if (intent.metric === "monthly_insights") {
    const insights = monthlyInsights(transactions, intent, currency);
    return {
      answer: insights.answer,
      total: insights.total,
      count: insights.count,
      average: null,
      visibleTransactions: [],
      categoryBreakdown: insights.topCategories,
      insights: insights.items,
    };
  }

  if (intent.metric === "category_breakdown") {
    const top = categoryBreakdown[0];
    const shown = categoryBreakdown.length;
    const noun = shown === 1 ? "category" : "categories";
    const dateText =
      intent.dateFrom && intent.dateTo
        ? ` from ${intent.dateFrom} to ${intent.dateTo}`
        : intent.dateFrom
          ? ` from ${intent.dateFrom}`
          : intent.dateTo
            ? ` up to ${intent.dateTo}`
            : "";
    const typeText = intent.type === "income" ? "income" : "expense";
    return {
      answer:
        top && shown === 1
          ? `${top.categoryName} is your biggest ${typeText} category${dateText}, at ${formatMoney(top.amount, currency)} across ${top.count} transactions.`
          : shown > 0
            ? `Your top ${shown} ${typeText} ${noun}${dateText} are ${categoryBreakdown
                .map((category) => `${category.categoryName} (${formatMoney(category.amount, currency)})`)
                .join(", ")}.`
            : `I did not find any ${filterText}.`,
      total,
      count,
      average,
      visibleTransactions: [],
      categoryBreakdown,
      insights: [],
    };
  }

  if (intent.metric === "count") {
    return {
      answer: `I found ${count} ${filterText}.`,
      total,
      count,
      average,
      visibleTransactions: matching.slice(0, intent.limit ?? 5),
      categoryBreakdown: [],
      insights: [],
    };
  }

  if (intent.metric === "average") {
    return {
      answer:
        count > 0
          ? `Your average for ${filterText} is ${formatMoney(average ?? 0, currency)} across ${count} transactions.`
          : `I did not find any ${filterText}.`,
      total,
      count,
      average,
      visibleTransactions: matching.slice(0, intent.limit ?? 5),
      categoryBreakdown: [],
      insights: [],
    };
  }

  if (intent.metric === "list") {
    const shown = Math.min(matching.length, intent.limit ?? 5);
    return {
      answer:
        count > 0
          ? `I found ${count} ${filterText}. Showing ${shown} most recent.`
          : `I did not find any ${filterText}.`,
      total,
      count,
      average,
      visibleTransactions: matching.slice(0, intent.limit ?? 5),
      categoryBreakdown: [],
      insights: [],
    };
  }

  return {
    answer:
      count > 0
        ? `You ${intent.type === "income" ? "received" : "spent"} ${formatMoney(total, currency)} for ${filterText} across ${count} transactions.`
        : `I did not find any ${filterText}.`,
    total,
    count,
    average,
    visibleTransactions: matching.slice(0, intent.limit ?? 5),
    categoryBreakdown: [],
    insights: [],
  };
}

type InsightItem = {
  title: string;
  value: string;
  detail: string;
  direction: "up" | "down" | "flat";
};

function categoryTotals(transactions: Transaction[]) {
  const totals = new Map<
    string,
    {
      categoryId: string;
      categoryName: string;
      amount: number;
      count: number;
    }
  >();

  for (const transaction of transactions) {
    const categoryId = transaction.categoryId;
    const current = totals.get(categoryId) ?? {
      categoryId,
      categoryName: transaction.categoryName ?? "Unknown",
      amount: 0,
      count: 0,
    };
    current.amount += transactionAmountForMetric(transaction);
    current.count += 1;
    totals.set(categoryId, current);
  }

  return [...totals.values()].sort(
    (a, b) => b.amount - a.amount || a.categoryName.localeCompare(b.categoryName)
  );
}

function parseIsoDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function defaultInsightRange(): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { dateFrom: isoDate(start), dateTo: isoDate(now) };
}

function comparisonRange(dateFrom: string, dateTo: string) {
  const currentStart = parseIsoDate(dateFrom);
  const currentEnd = parseIsoDate(dateTo);
  const previousStart = addMonths(currentStart, -1);
  const previousEnd = addMonths(currentEnd, -1);
  return { dateFrom: isoDate(previousStart), dateTo: isoDate(previousEnd) };
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

function formatPercent(value: number | null): string {
  if (value == null) return "new";
  return `${Math.abs(value).toFixed(0)}%`;
}

function expenseTransactionsForRange(
  transactions: Transaction[],
  dateFrom: string,
  dateTo: string
) {
  return transactions.filter(
    (transaction) =>
      transaction.type === "expense" &&
      transaction.date >= dateFrom &&
      transaction.date <= dateTo
  );
}

function monthlyInsights(
  transactions: Transaction[],
  intent: AssistantQueryIntent,
  currency: string
) {
  const range =
    intent.dateFrom && intent.dateTo
      ? { dateFrom: intent.dateFrom, dateTo: intent.dateTo }
      : defaultInsightRange();
  const previousRange = comparisonRange(range.dateFrom, range.dateTo);
  const currentTransactions = expenseTransactionsForRange(
    transactions,
    range.dateFrom,
    range.dateTo
  );
  const previousTransactions = expenseTransactionsForRange(
    transactions,
    previousRange.dateFrom,
    previousRange.dateTo
  );
  const currentTotal = currentTransactions.reduce(
    (sum, transaction) => sum + transactionAmountForMetric(transaction),
    0
  );
  const previousTotal = previousTransactions.reduce(
    (sum, transaction) => sum + transactionAmountForMetric(transaction),
    0
  );
  const totalDelta = currentTotal - previousTotal;
  const totalPercent = percentChange(currentTotal, previousTotal);
  const topCategories = categoryTotals(currentTransactions).slice(0, 5);
  const previousByCategory = new Map(
    categoryTotals(previousTransactions).map((category) => [category.categoryId, category])
  );
  const categoryChanges = categoryTotals(currentTransactions)
    .map((category) => {
      const previous = previousByCategory.get(category.categoryId);
      const previousAmount = previous?.amount ?? 0;
      return {
        ...category,
        previousAmount,
        delta: category.amount - previousAmount,
        percent: percentChange(category.amount, previousAmount),
      };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const biggestChange = categoryChanges[0] ?? null;
  const biggestSpike =
    categoryChanges.find((category) => category.delta > 0 && (category.percent == null || category.percent >= 25)) ??
    null;

  const items: InsightItem[] = [
    {
      title: "Total spending",
      value: formatMoney(currentTotal, currency),
      detail:
        totalDelta === 0
          ? "Same as the previous comparable period."
          : `${formatMoney(Math.abs(totalDelta), currency)} ${totalDelta > 0 ? "higher" : "lower"} than ${previousRange.dateFrom} to ${previousRange.dateTo}${totalPercent == null ? "" : ` (${formatPercent(totalPercent)})`}.`,
      direction: totalDelta > 0 ? "up" : totalDelta < 0 ? "down" : "flat",
    },
  ];

  if (topCategories[0]) {
    items.push({
      title: "Top category",
      value: topCategories[0].categoryName,
      detail: `${formatMoney(topCategories[0].amount, currency)} across ${topCategories[0].count} transactions.`,
      direction: "flat",
    });
  }

  if (biggestChange) {
    items.push({
      title: biggestChange.delta >= 0 ? "Biggest increase" : "Biggest drop",
      value: biggestChange.categoryName,
      detail: `${formatMoney(Math.abs(biggestChange.delta), currency)} ${biggestChange.delta >= 0 ? "up" : "down"} vs previous period (${formatPercent(biggestChange.percent)}).`,
      direction: biggestChange.delta > 0 ? "up" : biggestChange.delta < 0 ? "down" : "flat",
    });
  }

  if (biggestSpike && biggestSpike.categoryId !== biggestChange?.categoryId) {
    items.push({
      title: "Notable spike",
      value: biggestSpike.categoryName,
      detail: `${formatMoney(biggestSpike.amount, currency)} this period, ${formatPercent(biggestSpike.percent)} higher than before.`,
      direction: "up",
    });
  }

  return {
    answer: `Here are your spending insights for ${range.dateFrom} to ${range.dateTo}, compared with ${previousRange.dateFrom} to ${previousRange.dateTo}.`,
    total: currentTotal,
    count: currentTransactions.length,
    topCategories,
    items,
  };
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (!question) {
      return NextResponse.json({ error: "Ask a transaction question first." }, { status: 400 });
    }

    const { categories, accounts, currency } = await loadMetadata(userId);
    const openAiIntent = await parseIntentWithOpenAI(question, categories, accounts);
    const fallbackIntent = fallbackParseAssistantIntent(question, categories, accounts);
    const intent = openAiIntent ?? fallbackIntent;
    const rows = await loadTransactions(userId);
    const transactions = rows.map(rowToTransaction);
    const result = answerForIntent(question, intent, transactions, currency);

    return NextResponse.json({
      answer: result.answer,
      intent,
      total: result.total,
      count: result.count,
      average: result.average,
      transactions: result.visibleTransactions,
      categoryBreakdown: result.categoryBreakdown,
      insights: result.insights,
      filters: {
        type: intent.type,
        categoryName: intent.categoryName,
        accountName: intent.accountName,
        search: intent.search,
        excludeCategoryNames: intent.excludeCategoryNames,
        dateFrom: intent.dateFrom,
        dateTo: intent.dateTo,
      },
      source: openAiIntent ? "openai" : "fallback",
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Assistant could not answer that yet." }, { status: 500 });
  }
}
