import type { BudgetPlan } from "./budget-types";

export type BudgetPlanRow = {
  id: string;
  type: BudgetPlan["type"];
  month: string;
  amount: string | number;
  category_id: string | null;
};

export function rowToBudgetPlan(row: BudgetPlanRow): BudgetPlan {
  return {
    id: row.id,
    type: row.type,
    month: row.month,
    amount: Number(row.amount),
    categoryId: row.category_id ?? undefined,
  };
}

export function isValidBudgetMonth(month: unknown): month is string {
  return typeof month === "string" && /^\d{4}-\d{2}$/.test(month);
}
