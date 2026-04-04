"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useBudget } from "@/lib/budget-store";
import { useSettings } from "@/lib/settings-store";
import { formatCurrency } from "@/lib/format-currency";
import {
  compareIsoDateStringsDesc,
  formatDateWithPreference,
} from "@/lib/format-date";
import {
  getMonthTotals,
  getMonthKey,
  getCurrentMonthKey,
} from "@/lib/budget-utils";
import type { Transaction } from "@/lib/budget-types";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { LayoutGrid, List } from "lucide-react";
import { TransactionDetailDialog } from "@/components/dashboard/transaction-detail-dialog";
import { TransactionFormDialog } from "@/components/dashboard/transaction-form-dialog";

function formatMonthKey(key: string) {
  const [y, m] = key.split("-");
  return new Date(
    parseInt(y, 10),
    parseInt(m, 10) - 1,
    1
  ).toLocaleDateString("default", { month: "long", year: "numeric" });
}

function getMonthDateRange(key: string): { dateFrom: string; dateTo: string } {
  const [y, m] = key.split("-");
  const year = parseInt(y, 10);
  const month = parseInt(m, 10);
  const dateFrom = `${y}-${m.padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const dateTo = `${y}-${m.padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { dateFrom, dateTo };
}

type ViewMode = "list" | "grid";

export default function MonthlyPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTx, setDetailTx] = useState<Transaction | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
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
      map[key].sort((a, b) => compareIsoDateStringsDesc(a.date, b.date));
    }
    return map;
  }, [transactions]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Monthly view</h1>
          <p className="text-muted-foreground">
            Income, expenses, and net balance by month.
          </p>
        </div>
        {sortedMonths.length > 0 && (
          <div className="flex rounded-lg border border-border p-1 bg-muted/30">
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="sm"
              className="gap-1.5"
              onClick={() => setViewMode("list")}
            >
              <List className="h-4 w-4" />
              List
            </Button>
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="sm"
              className="gap-1.5"
              onClick={() => setViewMode("grid")}
            >
              <LayoutGrid className="h-4 w-4" />
              Grid
            </Button>
          </div>
        )}
      </div>

      {sortedMonths.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No transactions yet. Add transactions from the dashboard.
          </CardContent>
        </Card>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {sortedMonths.map((key) => {
            const totals = byMonth[key];
            const isCurrent = key === getCurrentMonthKey();
            const { dateFrom, dateTo } = getMonthDateRange(key);
            const href = `/dashboard/transactions?dateFrom=${dateFrom}&dateTo=${dateTo}`;
            const pieData = [
              { name: "Expense", value: totals.expenses || 0.01 },
              { name: "Income", value: totals.income || 0.01 },
            ];
            const totalPie = totals.income + totals.expenses;
            return (
              <Link key={key} href={href} className="block">
                <Card className="overflow-hidden transition-colors hover:bg-muted/30 cursor-pointer h-full flex flex-col">
                  <CardHeader className="pb-1 pt-4">
                    <CardTitle className="text-sm font-medium">
                      {formatMonthKey(key)}
                      {isCurrent && (
                        <span className="text-xs font-normal text-muted-foreground ml-1">
                          (current)
                        </span>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col flex-1 pt-0 pb-4">
                    <div className="flex-1 min-h-[100px] w-full my-2">
                      <ResponsiveContainer width="100%" height={100} minHeight={100}>
                        <PieChart margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                          <Pie
                            data={pieData}
                            dataKey="value"
                            stroke="none"
                            innerRadius="25%"
                            outerRadius="95%"
                            paddingAngle={totalPie > 0 ? 2 : 0}
                            isAnimationActive={false}
                          >
                            <Cell fill="var(--destructive)" />
                            <Cell fill="var(--success)" />
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex flex-col gap-1 text-sm">
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Income</span>
                        <span className="font-medium text-success">
                          {formatCurrency(totals.income, currency)}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Expenses</span>
                        <span className="font-medium">
                          {formatCurrency(totals.expenses, currency)}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="space-y-6">
          {sortedMonths.map((key) => {
            const totals = byMonth[key];
            const list = txByMonth[key] ?? [];
            const isCurrent = key === getCurrentMonthKey();
            const { dateFrom, dateTo } = getMonthDateRange(key);
            const href = `/dashboard/transactions?dateFrom=${dateFrom}&dateTo=${dateTo}`;
            const pieData = [
              { name: "Expense", value: totals.expenses || 0.01 },
              { name: "Income", value: totals.income || 0.01 },
            ];
            const totalPie = totals.income + totals.expenses;
            return (
              <Link key={key} href={href} className="block">
                <Card className="overflow-hidden transition-colors hover:bg-muted/30 cursor-pointer">
                  <div className="flex min-h-[140px]">
                    <div
                      className="w-24 flex-shrink-0 self-stretch rounded-l-lg overflow-hidden bg-muted/20 flex items-center justify-center"
                      style={{ minHeight: 140 }}
                    >
                      <div className="h-full w-full" style={{ minHeight: 140 }}>
                        <ResponsiveContainer width="100%" height="100%" minHeight={140}>
                          <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                            <Pie
                              data={pieData}
                              dataKey="value"
                              stroke="none"
                              innerRadius="25%"
                              outerRadius="95%"
                              paddingAngle={totalPie > 0 ? 2 : 0}
                              isAnimationActive={false}
                            >
                              <Cell fill="var(--destructive)" />
                              <Cell fill="var(--success)" />
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
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
                      <CardContent className="space-y-4 pt-0">
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
                              {list.slice(0, 3).map((tx) => {
                                const cat = getCategoryById(tx.categoryId);
                                const isIncome = tx.type === "income";
                                return (
                                  <li
                                    key={tx.id}
                                    role="button"
                                    tabIndex={0}
                                    className="flex items-center justify-between text-sm border-b border-border/50 pb-2 last:border-0 cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1 transition-colors"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setDetailTx(tx);
                                      setDetailOpen(true);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setDetailTx(tx);
                                        setDetailOpen(true);
                                      }
                                    }}
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
                                      {isIncome ? "+" : "−"}{" "}
                                      {formatCurrency(Math.abs(tx.amount), currency)}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                            {list.length > 3 && (
                              <p className="text-xs text-muted-foreground mt-2">
                                + {list.length - 3} more — click to view all
                              </p>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <TransactionDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        transaction={detailTx}
        onEdit={(tx) => {
          setDetailOpen(false);
          setDetailTx(null);
          setEditingTx(tx);
          setEditOpen(true);
        }}
      />
      <TransactionFormDialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) setEditingTx(null);
        }}
        editingTransaction={editingTx}
      />
    </div>
  );
}
