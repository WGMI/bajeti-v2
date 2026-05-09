"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Tag, Loader2 } from "lucide-react";
import { useBudget } from "@/lib/budget-store";
import type { CategoryType } from "@/lib/budget-types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SortButton } from "@/components/dashboard/sort-button";
import {
  compareNumber,
  compareText,
  nextSortState,
  type SortState,
  withSortDirection,
} from "@/lib/sort-utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { CounterpartyMessagesButton } from "@/components/dashboard/counterparty-messages-dialog";

type Suggestion = {
  counterpartyKey: string;
  label: string;
  transactionType: CategoryType;
  count: number;
};

type SuggestionSortColumn = "name" | "type" | "count";

const API = "/api";

function getTypeLabel(type: CategoryType): string {
  return type === "income" ? "Income" : type === "expense" ? "Expense" : "Transfer";
}

export function CounterpartyMapSuggestions({
  refreshKey = 0,
  onMapped,
}: {
  /** Increment to reload suggestions from the server. */
  refreshKey?: number;
  /** Optional callback after a mapping is applied (e.g. refresh sibling panels). */
  onMapped?: () => void;
}) {
  const { categories, refetch } = useBudget();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [windowDays, setWindowDays] = useState(90);
  const [minOccurrences, setMinOccurrences] = useState(3);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryChoice, setCategoryChoice] = useState<Record<string, string>>({});
  const [applyingKey, setApplyingKey] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState<SuggestionSortColumn>>({
    column: "count",
    direction: "desc",
  });

  const sortedSuggestions = useMemo(() => {
    return [...suggestions].sort((a, b) => {
      const comparison =
        sort.column === "name"
          ? compareText(a.label, b.label)
          : sort.column === "type"
            ? compareText(getTypeLabel(a.transactionType), getTypeLabel(b.transactionType))
            : compareNumber(a.count, b.count);

      return withSortDirection(comparison, sort.direction);
    });
  }, [suggestions, sort]);

  const handleSort = (column: SuggestionSortColumn) => {
    setSort((current) => nextSortState(current, column));
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/counterparty-suggestions`, { credentials: "same-origin" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to load suggestions");
      }
      const data = await res.json() as {
        windowDays?: number;
        minOccurrences?: number;
        suggestions?: Suggestion[];
      };
      if (typeof data.windowDays === "number") setWindowDays(data.windowDays);
      if (typeof data.minOccurrences === "number") setMinOccurrences(data.minOccurrences);
      setSuggestions(data.suggestions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load suggestions");
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    if (suggestions.length === 0) return;
    setCategoryChoice((prev) => {
      const next = { ...prev };
      for (const s of suggestions) {
        if (next[s.counterpartyKey]) continue;
        const first = categories.find((c) => c.type === s.transactionType)?.id;
        if (first) next[s.counterpartyKey] = first;
      }
      return next;
    });
  }, [suggestions, categories]);

  const apply = async (s: Suggestion) => {
    const categoryId = categoryChoice[s.counterpartyKey];
    if (!categoryId) return;
    setApplyingKey(s.counterpartyKey);
    setError(null);
    try {
      const res = await fetch(`${API}/counterparty-rules`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          counterpartyKey: s.counterpartyKey,
          counterpartyLabel: s.label,
          transactionType: s.transactionType,
          categoryId,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to save mapping");
      }
      setSuggestions((prev) => prev.filter((x) => x.counterpartyKey !== s.counterpartyKey));
      await refetch();
      onMapped?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply mapping");
    } finally {
      setApplyingKey(null);
    }
  };

  if (loading) {
    return (
      <Card className="shadow-sm border-border">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Loading recurring payees and payers…
        </CardContent>
      </Card>
    );
  }

  if (error && suggestions.length === 0) {
    return (
      <Card className="shadow-sm border-destructive/30">
        <CardContent className="py-6">
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (suggestions.length === 0) {
    return (
      <Card className="shadow-sm border-border">
        <CardHeader className="space-y-1 p-4 pb-2 sm:p-6 sm:pb-3">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-muted-foreground" aria-hidden />
            <CardTitle className="text-base font-medium">Recurring payees &amp; payers</CardTitle>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            No recurring SMS payees or payers detected in the last {windowDays} days (need at
            least {minOccurrences} matching transactions). Import more M-PESA messages or check
            back after new activity.
          </p>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm border-border">
      <CardHeader className="space-y-1 p-4 pb-2 sm:p-6 sm:pb-3">
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-muted-foreground" aria-hidden />
          <CardTitle className="text-base font-medium">Recurring payees &amp; payers</CardTitle>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          From your SMS transactions in the last {windowDays} days (appeared at least{" "}
          {minOccurrences} times). Map a name to a category — matching past transactions are
          updated too, and new SMS from that payee will use this category.
        </p>
        {error ? (
          <p className="text-xs text-destructive pt-1" role="alert">
            {error}
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0 sm:p-6 sm:pt-0">
        <div className="flex flex-wrap gap-1">
          <SortButton
            column="name"
            label="Name"
            activeColumn={sort.column}
            direction={sort.direction}
            onSort={handleSort}
          />
          <SortButton
            column="type"
            label="Type"
            activeColumn={sort.column}
            direction={sort.direction}
            onSort={handleSort}
          />
          <SortButton
            column="count"
            label="Count"
            activeColumn={sort.column}
            direction={sort.direction}
            onSort={handleSort}
          />
        </div>
        {sortedSuggestions.map((s) => {
          const typeLabel = getTypeLabel(s.transactionType);
          const cats = categories.filter((c) => c.type === s.transactionType);
          const catId = categoryChoice[s.counterpartyKey] ?? "";
          return (
            <div
              key={`${s.transactionType}:${s.counterpartyKey}`}
              className="rounded-lg border border-border/60 bg-muted/20 p-3 sm:p-4 space-y-3"
            >
              <p className="text-sm text-foreground">
                <span className="font-medium">{s.label}</span>
                <span className="text-muted-foreground">
                  {" "}
                  — {s.count}× in the last {windowDays} days ({typeLabel}). Map to a category?
                </span>
              </p>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
                <div className="space-y-1.5 flex-1 min-w-0 sm:min-w-[200px]">
                  <Label className="text-xs text-muted-foreground">Category</Label>
                  <Select
                    value={catId}
                    onValueChange={(id) =>
                      setCategoryChoice((prev) => ({ ...prev, [s.counterpartyKey]: id }))
                    }
                  >
                    <SelectTrigger className="h-9 w-full">
                      <span className="truncate">
                        {cats.find((c) => c.id === catId)?.name ?? "Choose category"}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {cats.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:shrink-0 sm:justify-end">
                  <CounterpartyMessagesButton
                    counterpartyKey={s.counterpartyKey}
                    transactionType={s.transactionType}
                    dialogTitle={s.label}
                    className="h-9 w-full sm:w-auto inline-flex"
                  />
                  <Button
                    className="h-9 w-full sm:w-auto shrink-0 inline-flex items-center justify-center gap-2"
                    disabled={!catId || applyingKey !== null}
                    onClick={() => void apply(s)}
                  >
                    {applyingKey === s.counterpartyKey ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
                        Applying…
                      </>
                    ) : (
                      "Apply to all"
                    )}
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
