"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBudget } from "@/lib/budget-store";
import { useSettings } from "@/lib/settings-store";
import { formatCurrency } from "@/lib/format-currency";
import { getCurrentMonthSummary } from "@/lib/budget-utils";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

const INCOME_COLOR = "var(--success)";
const EXPENSE_COLOR = "var(--destructive)";

export function EarningSummaryCard() {
  const { transactions } = useBudget();
  const { currency } = useSettings();
  const summary = getCurrentMonthSummary(transactions);
  const { income, expenses, balance } = summary;

  const pieData = [
    { name: "Income", value: income, fill: INCOME_COLOR },
    { name: "Expenses", value: expenses, fill: EXPENSE_COLOR },
  ].filter((d) => d.value > 0);

  return (
    <Card className="shadow-sm overflow-hidden">
      <CardHeader className="py-3 px-4 sm:px-5">
        <CardTitle className="text-base font-medium">Current month overview</CardTitle>
      </CardHeader>
      <CardContent className="p-0 px-4 pb-4 sm:px-5 flex gap-0">
        <div className="w-1/2 min-h-[140px] flex items-center justify-center pr-2">
          {pieData.length > 0 ? (
            <div className="w-full h-[140px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius="45%"
                    outerRadius="90%"
                    paddingAngle={2}
                    dataKey="value"
                    stroke="none"
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value, currency)}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="w-full h-[140px] rounded-full border-2 border-dashed border-muted flex items-center justify-center text-muted-foreground text-sm">
              No data
            </div>
          )}
        </div>
        <div className="w-1/2 pl-2 flex flex-col justify-center gap-2 min-h-[140px]">
          <div>
            <p className="text-xs text-muted-foreground">Net balance</p>
            <p
              className={`text-2xl font-bold sm:text-3xl ${
                balance >= 0 ? "text-success" : "text-destructive"
              }`}
            >
              {formatCurrency(balance, currency)}
            </p>
          </div>
          <div className="flex flex-col gap-0.5 text-sm">
            <span className="text-success">Income: {formatCurrency(income, currency)}</span>
            <span className="text-destructive">Expenses: {formatCurrency(expenses, currency)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
