"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Loader2,
  Search,
  Trash2,
  WalletCards,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useBudget } from "@/lib/budget-store";
import { useEffectiveCurrency } from "@/lib/use-effective-currency";
import { formatCurrency } from "@/lib/format-currency";
import {
  getBudgetUsages,
  getCategoryBudgetUsages,
  getOverallBudgetUsage,
} from "@/lib/budget-plans";
import { getCurrentMonthKey } from "@/lib/budget-utils";
import { cn } from "@/lib/utils";

function getProgressColor(percentUsed: number) {
  if (percentUsed >= 100) return "var(--destructive)";
  if (percentUsed >= 90) return "var(--chart-4)";
  if (percentUsed >= 75) return "var(--chart-2)";
  return "var(--primary)";
}

export default function BudgetsPage() {
  const { selectedGroupId } = useBudget();
  return <BudgetEditor key={selectedGroupId ?? "personal"} />;
}

function BudgetEditor() {
  const {
    budgetPlans,
    categories,
    transactions,
    upsertBudgetPlan,
    deleteBudgetPlan,
    loading,
    error,
    refetch,
  } = useBudget();
  const currency = useEffectiveCurrency();
  const [month, setMonth] = useState(getCurrentMonthKey());
  const [overallDraft, setOverallDraft] = useState<string | null>(null);
  const [categoryAmounts, setCategoryAmounts] = useState<Record<string, string>>({});
  const [categorySearch, setCategorySearch] = useState("");
  const [savingAction, setSavingAction] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const expenseCategories = useMemo(
    () => categories.filter((category) => category.type === "expense"),
    [categories]
  );
  const filteredExpenseCategories = useMemo(() => {
    const query = categorySearch.trim().toLowerCase();
    if (!query) return expenseCategories;
    return expenseCategories.filter((category) =>
      category.name.toLowerCase().includes(query)
    );
  }, [categorySearch, expenseCategories]);
  const overallUsage = useMemo(
    () => getOverallBudgetUsage(budgetPlans, transactions, categories, month),
    [budgetPlans, categories, month, transactions]
  );
  const categoryUsages = useMemo(
    () => getCategoryBudgetUsages(budgetPlans, transactions, categories, month),
    [budgetPlans, categories, month, transactions]
  );
  const allUsages = useMemo(
    () => getBudgetUsages(budgetPlans, transactions, categories, month),
    [budgetPlans, categories, month, transactions]
  );
  const planByCategory = useMemo(() => {
    const map = new Map(budgetPlans
      .filter((plan) => plan.type === "category" && plan.month === month)
      .map((plan) => [plan.categoryId, plan]));
    return map;
  }, [budgetPlans, month]);
  const overallPlan = budgetPlans.find((plan) => plan.type === "overall" && plan.month === month);
  const overallAmount = overallDraft ?? overallPlan?.amount.toString() ?? "";

  const runBudgetAction = async (action: string, mutate: () => Promise<void>) => {
    setSavingAction(action);
    setSaveError(null);
    try {
      await mutate();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not update the budget");
    } finally {
      setSavingAction(null);
    }
  };

  const saveOverall = async (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(overallAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    await runBudgetAction("overall", async () => {
      await upsertBudgetPlan({ type: "overall", month, amount });
      setOverallDraft(null);
    });
  };

  const saveCategory = async (event: FormEvent, categoryId: string) => {
    event.preventDefault();
    const amount = Number(categoryAmounts[categoryId]);
    if (!Number.isFinite(amount) || amount <= 0) return;
    await runBudgetAction(`category:${categoryId}`, async () => {
      await upsertBudgetPlan({ type: "category", month, categoryId, amount });
      clearCategoryDraft(categoryId);
    });
  };

  const clearCategoryDraft = (categoryId: string) => {
    setCategoryAmounts((current) => {
      const next = { ...current };
      delete next[categoryId];
      return next;
    });
  };

  const removeBudget = (id: string, categoryId?: string) =>
    runBudgetAction(`remove:${id}`, async () => {
      await deleteBudgetPlan(id);
      if (categoryId) clearCategoryDraft(categoryId);
      else setOverallDraft(null);
    });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <p className="text-muted-foreground">Loading...</p>
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Budgets</h1>
          <p className="text-muted-foreground">
            Track an overall budget and category budgets for each month.
          </p>
        </div>
        <label className="flex w-full items-center gap-2 rounded-lg border bg-card px-3 py-2 sm:w-auto">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <Input
            type="month"
            value={month}
            disabled={savingAction !== null}
            aria-label="Budget month"
            onChange={(event) => {
              setMonth(event.target.value);
              setOverallDraft(null);
              setCategoryAmounts({});
              setSaveError(null);
            }}
            className="h-8 border-0 p-0 shadow-none focus-visible:ring-0"
          />
        </label>
      </div>

      {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-medium">
              <WalletCards className="h-5 w-5 text-primary" />
              Overall budget
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={saveOverall} className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="number"
                required
                min="0.01"
                step="0.01"
                value={overallAmount}
                disabled={savingAction !== null}
                onChange={(event) => setOverallDraft(event.target.value)}
                placeholder="Monthly amount"
                aria-label="Overall budget amount"
              />
              <Button type="submit" className="sm:w-32" disabled={savingAction !== null || !month || overallDraft === null}>
                {savingAction === "overall" && <Loader2 className="h-4 w-4 animate-spin" />}
                {savingAction === "overall" ? "Saving" : overallPlan ? "Save changes" : "Save"}
              </Button>
            </form>

            {overallUsage ? (
              <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Spent</p>
                    <p className="font-semibold tabular-nums">
                      {formatCurrency(overallUsage.spent, currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Budget</p>
                    <p className="font-semibold tabular-nums">
                      {formatCurrency(overallUsage.budget, currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Remaining</p>
                    <p
                      className={cn(
                        "font-semibold tabular-nums",
                        overallUsage.remaining < 0 ? "text-destructive" : "text-success"
                      )}
                    >
                      {formatCurrency(overallUsage.remaining, currency)}
                    </p>
                  </div>
                </div>
                <Progress
                  value={overallUsage.percentUsed}
                  className="h-3"
                  indicatorStyle={{ backgroundColor: getProgressColor(overallUsage.percentUsed) }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  disabled={savingAction !== null}
                  onClick={() => removeBudget(overallUsage.plan.id)}
                >
                  {savingAction === `remove:${overallUsage.plan.id}` ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  {savingAction === `remove:${overallUsage.plan.id}` ? "Removing" : "Remove"}
                </Button>
              </div>
            ) : (
              <p className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                Add a monthly cap such as 50,000 to compare all spending against one limit.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium">Active budget progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {allUsages.length === 0 ? (
              <p className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
                Saved budgets for this month will appear here with live spend and remaining amount.
              </p>
            ) : (
              allUsages.map((usage) => (
                <div key={usage.plan.id} className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      {usage.percentUsed >= 100 && (
                        <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
                      )}
                      <p className="truncate text-sm font-medium">{usage.label}</p>
                    </div>
                    <span className="shrink-0 text-sm font-medium tabular-nums">
                      {Math.round(usage.percentUsed)}%
                    </span>
                  </div>
                  <Progress
                    value={usage.percentUsed}
                    className="h-2"
                    indicatorStyle={{ backgroundColor: getProgressColor(usage.percentUsed) }}
                  />
                  <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                    <span>{formatCurrency(usage.spent, currency)} spent</span>
                    <span className={usage.remaining < 0 ? "text-destructive" : undefined}>
                      {formatCurrency(usage.remaining, currency)} remaining
                    </span>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="flex flex-col gap-3 pb-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="text-base font-medium">Category budgets</CardTitle>
            <p className="text-sm text-muted-foreground">
              {filteredExpenseCategories.length} of {expenseCategories.length} categories
            </p>
          </div>
          <div className="relative w-full lg:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={categorySearch}
              onChange={(event) => setCategorySearch(event.target.value)}
              placeholder="Search categories"
              className="pr-10 pl-9"
              aria-label="Search category budgets"
            />
            {categorySearch && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
                onClick={() => setCategorySearch("")}
                aria-label="Clear category search"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {expenseCategories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Create expense categories before setting category budgets.
            </p>
          ) : filteredExpenseCategories.length === 0 ? (
            <p className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
              No category budgets match <span className="font-medium">{categorySearch.trim()}</span>.
            </p>
          ) : (
            <div className="divide-y rounded-lg border">
              {filteredExpenseCategories.map((category) => {
                const plan = planByCategory.get(category.id);
                const usage = categoryUsages.find((item) => item.plan.id === plan?.id);
                const draft = categoryAmounts[category.id];
                return (
                  <div key={category.id} className="grid gap-3 p-3 lg:grid-cols-[1fr_1fr_auto] lg:items-center">
                    <div className="min-w-0">
                      <p className="font-medium">{category.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {plan
                          ? `${formatCurrency(plan.amount, currency)} budget`
                          : "No category budget set"}
                      </p>
                    </div>
                    <div className="min-w-0 space-y-1">
                      {usage ? (
                        <>
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>{formatCurrency(usage.spent, currency)} spent</span>
                            <span>{Math.round(usage.percentUsed)}% used</span>
                          </div>
                          <Progress
                            value={usage.percentUsed}
                            className="h-2"
                            indicatorStyle={{ backgroundColor: getProgressColor(usage.percentUsed) }}
                          />
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground">Set an amount to start tracking.</p>
                      )}
                    </div>
                    <form onSubmit={(event) => saveCategory(event, category.id)} className="flex gap-2">
                      <Input
                        type="number"
                        required
                        min="0.01"
                        step="0.01"
                        value={draft ?? plan?.amount.toString() ?? ""}
                        disabled={savingAction !== null}
                        onChange={(event) =>
                          setCategoryAmounts((current) => ({
                            ...current,
                            [category.id]: event.target.value,
                          }))
                        }
                        placeholder="Amount"
                        aria-label={`${category.name} budget amount`}
                        className="w-full lg:w-32"
                      />
                      <Button
                        type="submit"
                        disabled={savingAction !== null || !month || draft === undefined}
                      >
                        {savingAction === `category:${category.id}` && (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        )}
                        {savingAction === `category:${category.id}` ? "Saving" : plan ? "Save changes" : "Save"}
                      </Button>
                      {plan && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          disabled={savingAction !== null}
                          onClick={() => removeBudget(plan.id, category.id)}
                          aria-label={`Remove ${category.name} budget`}
                        >
                          {savingAction === `remove:${plan.id}` ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                    </form>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
