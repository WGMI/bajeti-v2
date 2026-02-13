import type { Transaction } from "./budget-types";

export function getMonthKey(date: string) {
  return date.slice(0, 7);
}

export function getCurrentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

export function getMonthTotals(transactions: Transaction[]) {
  const byMonth: Record<
    string,
    { income: number; expenses: number; balance: number }
  > = {};
  for (const tx of transactions) {
    const key = getMonthKey(tx.date);
    if (!byMonth[key]) byMonth[key] = { income: 0, expenses: 0, balance: 0 };
    if (tx.type === "income") {
      byMonth[key].income += Math.abs(tx.amount);
      byMonth[key].balance += Math.abs(tx.amount);
    } else {
      byMonth[key].expenses += Math.abs(tx.amount);
      byMonth[key].balance -= Math.abs(tx.amount);
    }
  }
  return byMonth;
}

export function getCurrentMonthSummary(transactions: Transaction[]) {
  const key = getCurrentMonthKey();
  const byMonth = getMonthTotals(transactions);
  return byMonth[key] ?? { income: 0, expenses: 0, balance: 0 };
}

export function getExpenseByCategory(
  transactions: Transaction[],
  categoryNames: Record<string, string>
) {
  const map: Record<string, number> = {};
  for (const tx of transactions) {
    if (tx.type !== "expense") continue;
    const abs = Math.abs(tx.amount);
    const name = categoryNames[tx.categoryId] ?? "Other";
    map[name] = (map[name] ?? 0) + abs;
  }
  return Object.entries(map).map(([name, value]) => ({ name, value }));
}

export function getSpendingOverTime(
  transactions: Transaction[],
  monthsBack = 6
) {
  const end = new Date();
  const result: { month: string; income: number; expenses: number }[] = [];
  const monthKeys: string[] = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
    monthKeys.push(d.toISOString().slice(0, 7));
  }
  const byMonth = getMonthTotals(transactions);
  for (const key of monthKeys) {
    const t = byMonth[key] ?? { income: 0, expenses: 0, balance: 0 };
    const [y, m] = key.split("-");
    const label = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1).toLocaleString("default", {
      month: "short",
      year: "2-digit",
    });
    result.push({ month: label, income: t.income, expenses: t.expenses });
  }
  return result;
}
