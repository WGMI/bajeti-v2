"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Bell, Plus, WalletCards } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useBudget } from "@/lib/budget-store";
import { useSettings } from "@/lib/settings-store";
import { formatCurrency } from "@/lib/format-currency";
import {
  getCategoryBudgetUsages,
  getOverallBudgetUsage,
  getReachedThreshold,
} from "@/lib/budget-plans";
import { getCurrentMonthKey } from "@/lib/budget-utils";
import { cn } from "@/lib/utils";

const NOTIFICATION_STORAGE_KEY = "bajeti:budget-notifications";

function getProgressColor(percentUsed: number) {
  if (percentUsed >= 100) return "var(--destructive)";
  if (percentUsed >= 90) return "var(--chart-4)";
  if (percentUsed >= 75) return "var(--chart-2)";
  return "var(--primary)";
}

function readSentNotifications() {
  try {
    const raw = window.localStorage.getItem(NOTIFICATION_STORAGE_KEY);
    return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set<string>();
  }
}

function writeSentNotifications(sent: Set<string>) {
  window.localStorage.setItem(NOTIFICATION_STORAGE_KEY, JSON.stringify([...sent]));
}

export function BudgetDashboardCard() {
  const { budgetPlans, categories, transactions } = useBudget();
  const { currency } = useSettings();
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >(
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "unsupported"
  );
  const month = getCurrentMonthKey();

  const overall = useMemo(
    () => getOverallBudgetUsage(budgetPlans, transactions, categories, month),
    [budgetPlans, categories, month, transactions]
  );
  const categoryUsages = useMemo(
    () => getCategoryBudgetUsages(budgetPlans, transactions, categories, month),
    [budgetPlans, categories, month, transactions]
  );
  const notificationUsages = useMemo(
    () => [overall, ...categoryUsages].filter(Boolean),
    [categoryUsages, overall]
  );

  useEffect(() => {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const sent = readSentNotifications();
    let changed = false;
    for (const usage of notificationUsages) {
      if (!usage) continue;
      const threshold = getReachedThreshold(usage.percentUsed);
      if (!threshold) continue;
      const key = `${usage.plan.id}:${threshold}:${Math.floor(usage.spent)}`;
      if (sent.has(key)) continue;
      new Notification(`You've used ${threshold}% of your ${usage.label} budget.`, {
        body: `${formatCurrency(Math.max(usage.remaining, 0), currency)} remaining`,
      });
      sent.add(key);
      changed = true;
    }
    if (changed) writeSentNotifications(sent);
  }, [currency, notificationUsages]);

  const requestNotifications = async () => {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  };

  if (!overall && categoryUsages.length === 0) {
    return (
      <Card className="shadow-sm">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <WalletCards className="h-5 w-5 text-primary" />
              <p className="font-medium">Budgets</p>
            </div>
            <p className="text-sm text-muted-foreground">
              Set an overall monthly budget or category budgets to track spending progress.
            </p>
          </div>
          <Button asChild className="gap-2 sm:self-center">
            <Link href="/dashboard/budgets">
              <Plus className="h-4 w-4" />
              Add budget
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-base font-medium">Monthly budget</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {notificationPermission !== "granted" && notificationPermission !== "unsupported" && (
            <Button variant="outline" size="sm" className="gap-2" onClick={requestNotifications}>
              <Bell className="h-4 w-4" />
              Enable alerts
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/budgets">Manage</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="space-y-4">
          {overall ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Spent</p>
                  <p className="text-lg font-semibold tabular-nums">
                    {formatCurrency(overall.spent, currency)}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Budget</p>
                  <p className="text-lg font-semibold tabular-nums">
                    {formatCurrency(overall.budget, currency)}
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Used</span>
                  <span className="font-medium tabular-nums">{Math.round(overall.percentUsed)}%</span>
                </div>
                <Progress
                  value={overall.percentUsed}
                  className="h-3"
                  indicatorStyle={{ backgroundColor: getProgressColor(overall.percentUsed) }}
                />
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs uppercase text-muted-foreground">Remaining</p>
                <p
                  className={cn(
                    "text-2xl font-semibold tabular-nums",
                    overall.remaining < 0 ? "text-destructive" : "text-success"
                  )}
                >
                  {formatCurrency(Math.abs(overall.remaining), currency)}
                </p>
                {overall.remaining < 0 && (
                  <p className="text-xs text-destructive">Over budget</p>
                )}
              </div>
            </>
          ) : (
            <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
              Add an overall budget to see monthly spend, limit, progress, and remaining amount.
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Category ranking</p>
            <span className="text-xs text-muted-foreground">{categoryUsages.length} tracked</span>
          </div>
          {categoryUsages.length === 0 ? (
            <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
              Add category budgets to see where the damage is happening.
            </div>
          ) : (
            <div className="space-y-3">
              {categoryUsages.slice(0, 5).map((usage) => (
                <div key={usage.plan.id} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <div className="flex min-w-0 items-center gap-2">
                      {usage.percentUsed >= 100 && (
                        <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
                      )}
                      <span className="truncate">{usage.label}</span>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 font-medium tabular-nums",
                        usage.percentUsed >= 100 ? "text-destructive" : "text-muted-foreground"
                      )}
                    >
                      {Math.round(usage.percentUsed)}% used
                    </span>
                  </div>
                  <Progress
                    value={usage.percentUsed}
                    className="h-2"
                    indicatorStyle={{ backgroundColor: getProgressColor(usage.percentUsed) }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
