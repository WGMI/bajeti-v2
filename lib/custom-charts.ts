import type { CategoryType, Transaction } from "./budget-types";
import { calendarDateFromIso } from "./format-date";
import { expenseOutflow } from "./transaction-amount";

export const measures = {
  spending: { label: "Spending", description: "Expense amounts plus their fees." },
  income: { label: "Income", description: "Income amounts before fees." },
  net: { label: "Net cash flow", description: "Income minus expenses and fees. Internal transfer principal is excluded." },
  fees: { label: "Fees", description: "Transaction fees, including fees on transfers." },
  count: { label: "Transaction count", description: "Ledger entries. Each recorded transfer leg counts separately." },
  average: { label: "Average transaction amount", description: "Average principal amount per ledger entry, before fees." },
} as const;

export const dimensions = {
  none: "None", category: "Category", account: "Account", counterparty: "Counterparty",
  type: "Transaction type", day: "Day", week: "Week", month: "Month", quarter: "Quarter", year: "Year",
} as const;

export const transactionTypes = { expense: "Expense", income: "Income", transfer: "Transfer" } as const;

export type Measure = keyof typeof measures;
export type Dimension = keyof typeof dimensions;
export type Display = "auto" | "bar" | "line" | "table";
export type Period = "all" | "rolling" | "custom";

export interface ChartConfig {
  title: string;
  measure: Measure;
  comparison: Measure | "";
  group: Dimension;
  split: Dimension;
  display: Display;
  period: Period;
  months: string;
  from: string;
  to: string;
  accounts: string[];
  categories: string[];
  counterparties: string[];
  types: CategoryType[];
  search: string;
  min: string;
  max: string;
  currency?: string;
}

export const defaultChart: ChartConfig = {
  title: "", measure: "spending", comparison: "", group: "none", split: "none", display: "auto",
  period: "all", months: "6", from: "", to: "", accounts: [], categories: [], counterparties: [],
  types: [], search: "", min: "", max: "",
};

export function chartFromTransactionFilters(params: URLSearchParams): ChartConfig {
  const from = params.get("dateFrom") ?? "";
  const to = params.get("dateTo") ?? "";
  const type = params.get("type");
  const account = params.get("accountId");
  const category = params.get("categoryId");
  return {
    ...defaultChart,
    period: from || to ? "custom" : "all", from, to,
    types: type === "income" || type === "expense" || type === "transfer" ? [type] : [],
    measure: type === "income" ? "income" : type === "transfer" ? "count" : "spending",
    accounts: account ? [account] : [], categories: category ? [category] : [], search: params.get("search") ?? "",
  };
}

export function resolveChartRange(config: ChartConfig, today: string) {
  if (config.period === "all") return { from: "", to: "" };
  if (config.period === "custom") return { from: config.from, to: config.to };
  const date = calendarDateFromIso(today)!;
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - Number(config.months));
  const endOfMonth = new Date(date.getTime());
  endOfMonth.setUTCMonth(date.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(day, endOfMonth.getUTCDate()));
  return { from: date.toISOString().slice(0, 10), to: today };
}

export function chartValidation(config: ChartConfig): string | null {
  const { period, months, from, to, min, max } = config;
  if (period === "rolling" && (!/^\d+$/.test(months) || Number(months) < 1 || Number(months) > 1200)) {
    return "Enter a rolling range of 1 to 1,200 months.";
  }
  if (period === "custom") {
    if ([from, to].some((date) => date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !calendarDateFromIso(date)))) {
      return "Enter a valid date.";
    }
    if (from && to && from > to) return "The end date must be on or after the start date.";
  }
  if ([min, max].some((amount) => amount !== "" && (!Number.isFinite(Number(amount)) || Number(amount) < 0))) {
    return "Enter nonnegative amounts.";
  }
  if (min && max && Number(min) > Number(max)) return "The maximum amount must be at least the minimum.";
  return null;
}

export function counterpartyOf(transaction: Transaction) {
  const label = transaction.smsCounterparty?.trim() || transaction.smsCounterpartyKey || "No counterparty";
  return { key: transaction.smsCounterpartyKey || transaction.smsCounterparty?.trim().toLowerCase() || "", label };
}

export function filterChartTransactions(transactions: Transaction[], config: ChartConfig, today: string) {
  const { from, to } = resolveChartRange(config, today);
  const search = config.search.trim().toLocaleLowerCase();
  const inList = (items: string[], value: string) => !items.length || items.includes(value);
  return transactions.filter((tx) => (
    (!from || tx.date >= from) && (!to || tx.date <= to) &&
    inList(config.accounts, tx.accountId) && inList(config.categories, tx.categoryId) &&
    inList(config.types, tx.type) && inList(config.counterparties, counterpartyOf(tx).key) &&
    (config.min === "" || Math.abs(tx.amount) >= Number(config.min)) &&
    (config.max === "" || Math.abs(tx.amount) <= Number(config.max)) &&
    (!search || [tx.notes, tx.smsMessage, tx.categoryName, tx.accountName, tx.smsCounterparty]
      .some((value) => value?.toLocaleLowerCase().includes(search)))
  ));
}

export function isTimeDimension(dimension: Dimension) {
  return dimension === "day" || dimension === "week" || dimension === "month" || dimension === "quarter" || dimension === "year";
}

function dimensionValue(tx: Transaction, dimension: Dimension, sundayStart: boolean) {
  switch (dimension) {
    case "category": return { key: tx.categoryId, label: tx.categoryName || "Unknown category" };
    case "account": return { key: tx.accountId, label: tx.accountName || "Unknown account" };
    case "counterparty": return counterpartyOf(tx);
    case "type": return { key: tx.type, label: transactionTypes[tx.type] };
    case "year": return { key: tx.date.slice(0, 4), label: tx.date.slice(0, 4) };
    case "quarter": {
      const year = tx.date.slice(0, 4);
      const quarter = Math.ceil(Number(tx.date.slice(5, 7)) / 3);
      return { key: `${year}-${quarter}`, label: `Q${quarter} ${year}` };
    }
    case "month": return { key: tx.date.slice(0, 7), label: tx.date.slice(0, 7) };
    case "week": {
      const date = calendarDateFromIso(tx.date);
      if (!date) return { key: tx.date, label: tx.date };
      date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + (sundayStart ? 0 : 6)) % 7);
      const weekStart = date.toISOString().slice(0, 10);
      return { key: weekStart, label: `Week of ${weekStart}` };
    }
    case "day": return { key: tx.date, label: tx.date };
    case "none": return { key: "", label: "Total" };
  }
}

function measureValue(tx: Transaction, measure: Measure): number | null {
  const amount = Math.abs(tx.amount);
  const fees = tx.transactionCharges ?? 0;
  switch (measure) {
    case "spending": return tx.type === "expense" ? expenseOutflow(amount, fees) : null;
    case "income": return tx.type === "income" ? amount : null;
    case "net": return tx.type === "transfer" && fees === 0 ? null :
      (tx.type === "income" ? amount : tx.type === "expense" ? -amount : 0) - fees;
    case "fees": return fees > 0 ? fees : null;
    case "count": return 1;
    case "average": return amount;
  }
}

interface ChartCell {
  value: number;
  transactions: Transaction[];
}

export interface ChartRow {
  key: string;
  label: string;
  cells: Map<string, ChartCell>;
}

export function buildChart(transactions: Transaction[], config: ChartConfig, sundayStart = false) {
  const rows = new Map<string, ChartRow>();
  const series = new Map<string, string>();
  const totals = new Map<Measure, ChartCell>();
  const selectedMeasures = config.comparison ? [config.measure, config.comparison] : [config.measure];
  const add = <K,>(cells: Map<K, ChartCell>, key: K, value: number, tx: Transaction) => {
    const cell = cells.get(key) ?? { value: 0, transactions: [] };
    cell.value += value;
    cell.transactions.push(tx);
    cells.set(key, cell);
  };

  for (const tx of transactions) {
    const group = dimensionValue(tx, config.group, sundayStart);
    const split = dimensionValue(tx, config.split, sundayStart);
    const row = rows.get(group.key) ?? { ...group, cells: new Map<string, ChartCell>() };
    for (const measure of selectedMeasures) {
      const value = measureValue(tx, measure);
      if (value === null) continue;
      const key = JSON.stringify([measure, split.key]);
      series.set(key, config.split === "none" ? measures[measure].label :
        config.comparison ? `${split.label} · ${measures[measure].label}` : split.label);
      add(row.cells, key, value, tx);
      add(totals, measure, value, tx);
      rows.set(row.key, row);
    }
  }

  for (const row of rows.values()) {
    for (const [key, cell] of row.cells) {
      if (JSON.parse(key)[0] === "average") cell.value /= cell.transactions.length;
    }
  }
  const average = totals.get("average");
  if (average) average.value /= average.transactions.length;

  return {
    rows: [...rows.values()].sort((a, b) => isTimeDimension(config.group) ? a.key.localeCompare(b.key) : a.label.localeCompare(b.label)),
    series: [...series].map(([key, label]) => ({ key, label, measure: JSON.parse(key)[0] as Measure })).sort((a, b) => a.label.localeCompare(b.label)),
    totals,
  };
}
