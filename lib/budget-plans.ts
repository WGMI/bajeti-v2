import type { BudgetPlan, Category, Transaction } from "./budget-types";
import { getCurrentMonthKey, getMonthKey } from "./budget-utils";

export const BUDGET_THRESHOLDS = [50, 75, 90, 100] as const;

export interface BudgetUsage {
  plan: BudgetPlan;
  label: string;
  budget: number;
  spent: number;
  remaining: number;
  percentUsed: number;
  status: "healthy" | "watch" | "danger" | "over";
}

export interface BudgetReportLine extends BudgetUsage {
  saved: number;
  overspent: number;
}

export function createBudgetId(type: BudgetPlan["type"], month: string, categoryId?: string) {
  return [type, month, categoryId ?? "all"].join(":");
}

export function getMonthExpenseTransactions(transactions: Transaction[], month = getCurrentMonthKey()) {
  return transactions.filter((tx) => tx.type === "expense" && getMonthKey(tx.date) === month);
}

export function getCategoryExpenseTotal(
  transactions: Transaction[],
  categoryId: string,
  month = getCurrentMonthKey()
) {
  return getMonthExpenseTransactions(transactions, month)
    .filter((tx) => tx.categoryId === categoryId)
    .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
}

export function getOverallExpenseTotal(transactions: Transaction[], month = getCurrentMonthKey()) {
  return getMonthExpenseTransactions(transactions, month).reduce(
    (sum, tx) => sum + Math.abs(tx.amount),
    0
  );
}

export function getBudgetStatus(percentUsed: number): BudgetUsage["status"] {
  if (percentUsed >= 100) return "over";
  if (percentUsed >= 90) return "danger";
  if (percentUsed >= 75) return "watch";
  return "healthy";
}

export function getBudgetUsages(
  plans: BudgetPlan[],
  transactions: Transaction[],
  categories: Category[],
  month = getCurrentMonthKey()
): BudgetUsage[] {
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  return plans
    .filter((plan) => plan.month === month && plan.amount > 0)
    .map((plan) => {
      const spent =
        plan.type === "overall"
          ? getOverallExpenseTotal(transactions, month)
          : plan.categoryId
            ? getCategoryExpenseTotal(transactions, plan.categoryId, month)
            : 0;
      const percentUsed = plan.amount > 0 ? (spent / plan.amount) * 100 : 0;
      const label =
        plan.type === "overall"
          ? "Monthly budget"
          : categoryNames.get(plan.categoryId ?? "") ?? "Deleted category";
      return {
        plan,
        label,
        budget: plan.amount,
        spent,
        remaining: plan.amount - spent,
        percentUsed,
        status: getBudgetStatus(percentUsed),
      };
    });
}

export function getOverallBudgetUsage(
  plans: BudgetPlan[],
  transactions: Transaction[],
  categories: Category[],
  month = getCurrentMonthKey()
) {
  return getBudgetUsages(plans, transactions, categories, month).find(
    (usage) => usage.plan.type === "overall"
  );
}

export function getCategoryBudgetUsages(
  plans: BudgetPlan[],
  transactions: Transaction[],
  categories: Category[],
  month = getCurrentMonthKey()
) {
  return getBudgetUsages(plans, transactions, categories, month)
    .filter((usage) => usage.plan.type === "category")
    .sort((a, b) => b.percentUsed - a.percentUsed);
}

export function getBudgetReport(
  plans: BudgetPlan[],
  transactions: Transaction[],
  categories: Category[],
  month: string
) {
  const usages = getBudgetUsages(plans, transactions, categories, month);
  const categoryLines = usages
    .filter((usage) => usage.plan.type === "category")
    .map<BudgetReportLine>((usage) => ({
      ...usage,
      saved: Math.max(usage.remaining, 0),
      overspent: Math.max(Math.abs(Math.min(usage.remaining, 0)), 0),
    }))
    .sort((a, b) => b.percentUsed - a.percentUsed);
  const overall = usages.find((usage) => usage.plan.type === "overall");
  const totalBudget = overall?.budget ?? categoryLines.reduce((sum, line) => sum + line.budget, 0);
  const totalSpent = overall?.spent ?? categoryLines.reduce((sum, line) => sum + line.spent, 0);
  return {
    categoryLines,
    totalBudget,
    totalSpent,
    variance: totalBudget - totalSpent,
  };
}

export function getReachedThreshold(percentUsed: number) {
  return [...BUDGET_THRESHOLDS].reverse().find((threshold) => percentUsed >= threshold) ?? null;
}
