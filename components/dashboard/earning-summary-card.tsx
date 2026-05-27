"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBudget } from "@/lib/budget-store";
import { useSettings } from "@/lib/settings-store";
import { formatCurrency } from "@/lib/format-currency";
import { getCurrentMonthSummary } from "@/lib/budget-utils";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

const INCOME_COLOR = "var(--success)";
const EXPENSE_COLOR = "var(--destructive)";
const EMPTY_COLOR = "rgba(0, 0, 0, 0.08)";

function getAllTimeSummary(
  transactions: { type: string; amount: number }[]
): { income: number; expenses: number } {
  let income = 0;
  let expenses = 0;
  for (const tx of transactions) {
    const abs = Math.abs(tx.amount);
    if (tx.type === "income") income += abs;
    else expenses += abs;
  }
  return { income, expenses };
}

const EMPTY_PIE_DATA = [{ name: "No data", value: 1, fill: EMPTY_COLOR }];

function getCurrentMonthDateRange(): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const monthString = String(month).padStart(2, "0");
  const dateFrom = `${year}-${monthString}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const dateTo = `${year}-${monthString}-${String(lastDay).padStart(2, "0")}`;
  return { dateFrom, dateTo };
}

function PieSection({
  title,
  data,
  income,
  expenses,
  currency,
  href,
}: {
  title: string;
  data: { name: string; value: number; fill: string }[];
  income: number;
  expenses: number;
  currency: string;
  href: string;
}) {
  const chartData = data.length > 0 ? data : EMPTY_PIE_DATA;
  return (
    <Link
      href={href}
      className="flex flex-1 min-w-0 flex-col items-center rounded-md p-1 transition-colors hover:bg-muted/40"
    >
      <p className="text-xs text-muted-foreground mb-1">{title}</p>
      <div className="w-full h-[140px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius="45%"
              outerRadius="90%"
              paddingAngle={data.length > 0 ? 2 : 0}
              dataKey="value"
              stroke="none"
            >
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.fill} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number) =>
                data.length > 0 ? formatCurrency(value, currency) : ""
              }
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-col gap-0.5 text-sm mt-2 text-center">
        <span className="text-success">Income: {formatCurrency(income, currency)}</span>
        <span className="text-destructive">Expenses: {formatCurrency(expenses, currency)}</span>
      </div>
    </Link>
  );
}

export function EarningSummaryCard() {
  const { transactions } = useBudget();
  const { currency } = useSettings();
  const monthSummary = getCurrentMonthSummary(transactions);
  const allTimeSummary = getAllTimeSummary(transactions);
  const { dateFrom, dateTo } = getCurrentMonthDateRange();
  const thisMonthHref = `/dashboard/transactions?dateFrom=${dateFrom}&dateTo=${dateTo}`;

  const monthPieData = [
    { name: "Income", value: monthSummary.income, fill: INCOME_COLOR },
    { name: "Expenses", value: monthSummary.expenses, fill: EXPENSE_COLOR },
  ].filter((d) => d.value > 0);

  const allTimePieData = [
    { name: "Income", value: allTimeSummary.income, fill: INCOME_COLOR },
    { name: "Expenses", value: allTimeSummary.expenses, fill: EXPENSE_COLOR },
  ].filter((d) => d.value > 0);

  return (
    <Card className="shadow-sm overflow-hidden">
      <CardHeader className="py-3 px-4 sm:px-5">
        <CardTitle className="text-base font-medium">Income vs expenses</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 sm:px-5 flex gap-4">
        <PieSection
          title="This month"
          data={monthPieData}
          income={monthSummary.income}
          expenses={monthSummary.expenses}
          currency={currency}
          href={thisMonthHref}
        />
        <PieSection
          title="All time"
          data={allTimePieData}
          income={allTimeSummary.income}
          expenses={allTimeSummary.expenses}
          currency={currency}
          href="/dashboard/transactions"
        />
      </CardContent>
    </Card>
  );
}
