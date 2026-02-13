"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useBudget } from "@/lib/budget-store";
import { useSettings } from "@/lib/settings-store";
import { formatCurrency } from "@/lib/format-currency";
import { formatDateWithPreference } from "@/lib/format-date";
import {
  getMonthTotals,
  getMonthKey,
  getCurrentMonthKey,
} from "@/lib/budget-utils";
import type { Transaction } from "@/lib/budget-types";

function formatMonthKey(key: string) {
  const [y, m] = key.split("-");
  return new Date(
    parseInt(y, 10),
    parseInt(m, 10) - 1,
    1
  ).toLocaleDateString("default", { month: "long", year: "numeric" });
}

export default function MonthlyPage() {
  const { transactions, getCategoryById, loading, error, refetch } = useBudget();
  const { currency, dateFormat } = useSettings();
  const byMonth = useMemo(() => getMonthTotals(transactions), [transactions]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
        <p className="text-destructive font-medium">{error}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const sortedMonths = useMemo(() => {
    return Object.keys(byMonth).sort((a, b) => b.localeCompare(a));
  }, [byMonth]);

  const txByMonth = useMemo(() => {
    const map: Record<string, Transaction[]> = {};
    for (const tx of transactions) {
      const key = getMonthKey(tx.date);
      if (!map[key]) map[key] = [];
      map[key].push(tx);
    }
    for (const key of Object.keys(map)) {
      map[key].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
    }
    return map;
  }, [transactions]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Monthly view</h1>
        <p className="text-muted-foreground">
          Income, expenses, and net balance by month.
        </p>
      </div>

      {sortedMonths.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No transactions yet. Add transactions from the dashboard.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {sortedMonths.map((key) => {
            const totals = byMonth[key];
            const list = txByMonth[key] ?? [];
            const isCurrent = key === getCurrentMonthKey();
            return (
              <Card key={key}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-medium flex items-center justify-between">
                    <span>{formatMonthKey(key)}</span>
                    {isCurrent && (
                      <span className="text-xs font-normal text-muted-foreground">
                        Current month
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-4 rounded-lg border bg-muted/30 p-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Income</p>
                      <p className="font-semibold text-success">
                        {formatCurrency(totals.income, currency)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Expenses</p>
                      <p className="font-semibold">
                        {formatCurrency(totals.expenses, currency)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Net balance</p>
                      <p
                        className={`font-semibold ${
                          totals.balance >= 0 ? "text-success" : "text-destructive"
                        }`}
                      >
                        {formatCurrency(totals.balance, currency)}
                      </p>
                    </div>
                  </div>
                  {list.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-2">
                        Transactions ({list.length})
                      </p>
                      <ul className="space-y-2">
                        {list.slice(0, 10).map((tx) => {
                          const cat = getCategoryById(tx.categoryId);
                          const isIncome = tx.type === "income";
                          return (
                            <li
                              key={tx.id}
                              className="flex items-center justify-between text-sm border-b border-border/50 pb-2 last:border-0"
                            >
                              <span className="text-muted-foreground">
                                {formatDateWithPreference(tx.date, dateFormat)}
                              </span>
                              <span className="truncate max-w-[140px]">
                                {cat?.name ?? "—"} {tx.notes ? `· ${tx.notes}` : ""}
                              </span>
                              <span
                                className={
                                  isIncome ? "text-success font-medium" : ""
                                }
                              >
                                {isIncome ? "+" : "−"} {formatCurrency(Math.abs(tx.amount), currency)}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                      {list.length > 10 && (
                        <p className="text-xs text-muted-foreground mt-2">
                          + {list.length - 10} more
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
