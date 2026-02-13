"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { useBudget } from "@/lib/budget-store";
import { useSettings } from "@/lib/settings-store";
import { formatCurrency } from "@/lib/format-currency";
import { getSpendingOverTime } from "@/lib/budget-utils";

const INCOME_COLOR = "var(--success)";
const EXPENSE_COLOR = "var(--destructive)";

export function PaymentStatisticsCard() {
  const { transactions } = useBudget();
  const { currency } = useSettings();
  const data = getSpendingOverTime(transactions);

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">
          Spending over time
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 5, right: 5, left: -10, bottom: 0 }}
            >
              <XAxis
                dataKey="month"
                tick={{ fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => formatCurrency(v, currency, { compact: true })}
              />
              <Tooltip
                content={({ active, payload }) =>
                  active && payload?.length ? (
                    <div className="rounded-lg border bg-card px-3 py-2 text-sm shadow">
                      <div className="font-medium mb-1">{payload[0]?.payload?.month}</div>
                      <div className="text-success">Income: {formatCurrency(Number(payload[0]?.payload?.income ?? 0), currency)}</div>
                      <div className="text-destructive">Expenses: {formatCurrency(Number(payload[0]?.payload?.expenses ?? 0), currency)}</div>
                    </div>
                  ) : null
                }
              />
              <Bar
                dataKey="income"
                name="Income"
                fill={INCOME_COLOR}
                radius={[4, 4, 0, 0]}
              />
              <Bar
                dataKey="expenses"
                name="Expenses"
                fill={EXPENSE_COLOR}
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
