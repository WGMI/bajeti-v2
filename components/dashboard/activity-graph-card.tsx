"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBudget } from "@/lib/budget-store";
import { useEffectiveCurrency } from "@/lib/use-effective-currency";
import { formatCurrency } from "@/lib/format-currency";
import { getCurrentMonthKey, getExpenseByCategory, getMonthKey } from "@/lib/budget-utils";

export function ActivityGraphCard() {
  const { transactions, getCategoryById } = useBudget();
  const currency = useEffectiveCurrency();
  const currentMonth = getCurrentMonthKey();
  const thisMonthTx = transactions.filter((t) => t.type === "expense" && getMonthKey(t.date) === currentMonth);
  const categoryNames: Record<string, string> = {};
  thisMonthTx.forEach((t) => {
    const cat = getCategoryById(t.categoryId);
    if (cat) categoryNames[t.categoryId] = cat.name;
  });
  const data = getExpenseByCategory(thisMonthTx, categoryNames).sort((a, b) => b.value - a.value);

  if (data.length === 0) {
    return (
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">Expense by category</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground py-8 text-center">
            No expenses this month yet.
          </p>
        </CardContent>
      </Card>
    );
  }

  const maxExpense = data[0].value;

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">Expense by category</CardTitle>
      </CardHeader>
      <CardContent>
        <ul aria-label="Monthly expenses by category" className="space-y-3">
          {data.map(({ name, value }) => (
            <li key={name} className="space-y-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                <span className="min-w-0 break-words">{name}</span>
                <span className="tabular-nums text-muted-foreground">{formatCurrency(value, currency)}</span>
              </div>
              <div aria-hidden="true" className="h-3 rounded-sm bg-muted">
                <div
                  className="h-full rounded-sm bg-primary"
                  style={{ width: `${maxExpense > 0 ? (value / maxExpense) * 100 : 0}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
