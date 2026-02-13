"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import { useBudget } from "@/lib/budget-store";
import { useSettings } from "@/lib/settings-store";
import { formatCurrency } from "@/lib/format-currency";
import { getExpenseByCategory } from "@/lib/budget-utils";
import { getCurrentMonthKey } from "@/lib/budget-utils";

const PIE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--muted-foreground)",
  "var(--primary)",
];

export function ActivityGraphCard() {
  const { transactions, getCategoryById } = useBudget();
  const { currency } = useSettings();
  const currentMonth = getCurrentMonthKey();
  const thisMonthTx = transactions.filter((t) => t.type === "expense" && getMonthKey(t.date) === currentMonth);
  const categoryNames: Record<string, string> = {};
  transactions.forEach((t) => {
    const cat = getCategoryById(t.categoryId);
    if (cat) categoryNames[t.categoryId] = cat.name;
  });
  const data = getExpenseByCategory(thisMonthTx, categoryNames);

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

  const total = data.reduce((s, d) => s + d.value, 0);
  const chartData = data.map((d, i) => ({
    ...d,
    fill: PIE_COLORS[i % PIE_COLORS.length],
  }));

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">Expense by category</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius="40%"
                outerRadius="80%"
                paddingAngle={2}
                dataKey="value"
                nameKey="name"
                stroke="none"
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number) =>
                  `${formatCurrency(value, currency)} (${total > 0 ? ((value / total) * 100).toFixed(0) : 0}%)`
                }
              />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function getMonthKey(date: string) {
  return date.slice(0, 7);
}
