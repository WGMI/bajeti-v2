"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { useBudget } from "@/lib/budget-store";
import type { CategoryType } from "@/lib/budget-types";
import {
  makeScopedCounterpartyKey,
  splitScopedCounterpartyKey,
} from "@/lib/sms-parser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { CounterpartyMessagesButton } from "@/components/dashboard/counterparty-messages-dialog";
import { CounterpartyRuleTestButton } from "@/components/dashboard/counterparty-rule-test-dialog";

type RuleRow = {
  id: string;
  counterpartyKey: string;
  transactionType: CategoryType;
  categoryId: string;
  categoryName: string;
};

const API = "/api";

function formatKeyLabel(key: string): string {
  return key.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function CounterpartySavedRules({
  refreshKey = 0,
  onRulesChanged,
}: {
  refreshKey?: number;
  /** Notify parent so other panels (e.g. suggestions) can reload. */
  onRulesChanged?: () => void;
}) {
  const { categories, refetch } = useBudget();
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryEdits, setCategoryEdits] = useState<Record<string, string>>({});
  const [counterpartyEdits, setCounterpartyEdits] = useState<Record<string, string>>({});
  const [scopeEdits, setScopeEdits] = useState<Record<string, "all" | "account">>({});
  const [accountRefEdits, setAccountRefEdits] = useState<Record<string, string>>({});
  const [typeEdits, setTypeEdits] = useState<Record<string, CategoryType>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredRules = normalizedSearch
    ? rules.filter((rule) => {
        const typeLabel =
          rule.transactionType === "income"
            ? "income"
            : rule.transactionType === "expense"
              ? "expense"
              : "transfer";
        return (
          rule.counterpartyKey.toLowerCase().includes(normalizedSearch) ||
          rule.categoryName.toLowerCase().includes(normalizedSearch) ||
          typeLabel.includes(normalizedSearch)
        );
      })
    : rules;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/counterparty-rules`, { credentials: "same-origin" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to load rules");
      }
      const data = await res.json() as { rules?: RuleRow[] };
      const list = data.rules ?? [];
      setRules(list);
      setCategoryEdits(
        Object.fromEntries(list.map((r) => [r.id, r.categoryId])) as Record<string, string>
      );
      setCounterpartyEdits(
        Object.fromEntries(
          list.map((r) => [r.id, splitScopedCounterpartyKey(r.counterpartyKey).baseKey])
        ) as Record<string, string>
      );
      setScopeEdits(
        Object.fromEntries(
          list.map((r) => [
            r.id,
            splitScopedCounterpartyKey(r.counterpartyKey).accountReference ? "account" : "all",
          ])
        ) as Record<string, "all" | "account">
      );
      setAccountRefEdits(
        Object.fromEntries(
          list.map((r) => [r.id, splitScopedCounterpartyKey(r.counterpartyKey).accountReference ?? ""])
        ) as Record<string, string>
      );
      setTypeEdits(
        Object.fromEntries(list.map((r) => [r.id, r.transactionType])) as Record<string, CategoryType>
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load rules");
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const saveRule = async (rule: RuleRow) => {
    const categoryId = categoryEdits[rule.id];
    const keyBase = (counterpartyEdits[rule.id] ?? splitScopedCounterpartyKey(rule.counterpartyKey).baseKey)
      .trim();
    const scopeValue =
      scopeEdits[rule.id] ??
      (splitScopedCounterpartyKey(rule.counterpartyKey).accountReference ? "account" : "all");
    const accountRefValue = (accountRefEdits[rule.id] ?? "").trim();
    if (scopeValue === "account" && accountRefValue.length < 3) {
      setError("Account reference must be at least 3 characters.");
      return;
    }
    const counterpartyKey =
      scopeValue === "account"
        ? makeScopedCounterpartyKey(keyBase, accountRefValue)
        : keyBase;
    const transactionType = typeEdits[rule.id] ?? rule.transactionType;
    const categoryChanged = categoryId !== rule.categoryId;
    const keyChanged = counterpartyKey !== rule.counterpartyKey;
    const typeChanged = transactionType !== rule.transactionType;
    if (!categoryId || (!categoryChanged && !keyChanged && !typeChanged)) return;
    setSavingId(rule.id);
    setError(null);
    try {
      const usePatch = keyChanged || typeChanged;
      const res = await fetch(
        usePatch ? `${API}/counterparty-rules/${rule.id}` : `${API}/counterparty-rules`,
        {
          method: usePatch ? "PATCH" : "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            counterpartyKey,
            counterpartyLabel: formatKeyLabel(counterpartyKey),
            transactionType,
            categoryId,
          }),
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to update rule");
      }
      await refetch();
      await load();
      onRulesChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update rule");
    } finally {
      setSavingId(null);
    }
  };

  const deleteRule = async (rule: RuleRow) => {
    setDeletingId(rule.id);
    setError(null);
    try {
      const res = await fetch(`${API}/counterparty-rules/${rule.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to delete rule");
      }
      await refetch();
      await load();
      onRulesChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete rule");
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <Card className="shadow-sm border-border">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Loading saved rules…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm border-border">
      <CardHeader className="space-y-1 p-4 pb-2 sm:p-6 sm:pb-3">
        <CardTitle className="text-base font-medium">Saved mappings</CardTitle>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Payees and payers you have already linked to a category. New SMS from these names
          use the category shown here. Updating the category reapplies to all matching
          transactions; deleting a rule stops auto-categorization (it does not change past
          transactions).
        </p>
        {error ? (
          <p className="text-xs text-destructive pt-1" role="alert">
            {error}
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
        {rules.length > 0 ? (
          <div className="pb-3">
            <Label htmlFor="saved-rules-search" className="sr-only">
              Search saved rules
            </Label>
            <Input
              id="saved-rules-search"
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search by name, category, or type"
              className="h-9"
            />
          </div>
        ) : null}
        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No saved rules yet. Add some from the Suggested rules tab, or they appear after you
            map a recurring payee.
          </p>
        ) : filteredRules.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No saved rules match your search.
          </p>
        ) : (
          <ul className="space-y-3">
            {filteredRules.map((rule) => {
              const split = splitScopedCounterpartyKey(rule.counterpartyKey);
              const typeValue = typeEdits[rule.id] ?? rule.transactionType;
              const typeLabel =
                typeValue === "income"
                  ? "Income"
                  : typeValue === "expense"
                    ? "Expense"
                    : "Transfer";
              const cats = categories.filter((c) => c.type === typeValue);
              const catId = categoryEdits[rule.id] ?? rule.categoryId;
              const keyValue = counterpartyEdits[rule.id] ?? split.baseKey;
              const scopeValue = scopeEdits[rule.id] ?? (split.accountReference ? "account" : "all");
              const accountRefValue = accountRefEdits[rule.id] ?? split.accountReference ?? "";
              const composedKey =
                scopeValue === "account" && accountRefValue.trim().length >= 3
                  ? makeScopedCounterpartyKey(keyValue.trim(), accountRefValue.trim())
                  : keyValue.trim();
              const dirty =
                catId !== rule.categoryId ||
                composedKey !== rule.counterpartyKey ||
                typeValue !== rule.transactionType;
              return (
                <li
                  key={rule.id}
                  className="rounded-lg border border-border/60 bg-muted/20 p-3 sm:p-4 space-y-3"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium text-sm truncate" title={rule.counterpartyKey}>
                      {formatKeyLabel(keyValue || rule.counterpartyKey)}
                    </p>
                    <p className="text-xs text-muted-foreground">{typeLabel}</p>
                  </div>
                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:gap-2">
                    <div className="space-y-1.5 min-w-0 flex-1 sm:min-w-[220px]">
                      <Label className="text-xs text-muted-foreground">Counterparty key</Label>
                      <Input
                        value={keyValue}
                        onChange={(event) =>
                          setCounterpartyEdits((prev) => ({ ...prev, [rule.id]: event.target.value }))
                        }
                        className="h-9 w-full"
                      />
                    </div>
                    <div className="space-y-1.5 min-w-0 w-full sm:w-[210px]">
                      <Label className="text-xs text-muted-foreground">Scope</Label>
                      <Select
                        value={
                          scopeValue
                        }
                        onValueChange={(value) =>
                          setScopeEdits((prev) => ({ ...prev, [rule.id]: value as "all" | "account" }))
                        }
                      >
                        <SelectTrigger className="h-9 w-full">
                          <span className="truncate">
                            {(scopeEdits[rule.id] ??
                              scopeValue) === "account"
                              ? "This account only"
                              : "All counterparty"}
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All counterparty</SelectItem>
                          <SelectItem value="account">This account only</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {scopeValue === "account" ? (
                      <div className="space-y-1.5 min-w-0 w-full sm:w-[180px]">
                        <Label className="text-xs text-muted-foreground">Account ref</Label>
                        <Input
                          value={accountRefValue}
                          onChange={(event) =>
                            setAccountRefEdits((prev) => ({ ...prev, [rule.id]: event.target.value }))
                          }
                          className="h-9 w-full"
                        />
                      </div>
                    ) : null}
                    <div className="space-y-1.5 min-w-0 w-full sm:w-[150px]">
                      <Label className="text-xs text-muted-foreground">Type</Label>
                      <Select
                        value={typeValue}
                        onValueChange={(value) =>
                          setTypeEdits((prev) => ({ ...prev, [rule.id]: value as CategoryType }))
                        }
                      >
                        <SelectTrigger className="h-9 w-full">
                          <span className="truncate capitalize">{typeValue}</span>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="expense">Expense</SelectItem>
                          <SelectItem value="income">Income</SelectItem>
                          <SelectItem value="transfer">Transfer</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5 min-w-0 flex-1 sm:min-w-[200px] sm:max-w-xs">
                        <Label className="text-xs text-muted-foreground">Category</Label>
                        <Select
                          value={catId}
                          onValueChange={(id) =>
                            setCategoryEdits((prev) => ({ ...prev, [rule.id]: id }))
                          }
                        >
                          <SelectTrigger className="h-9 w-full">
                            <span className="truncate">
                              {cats.find((c) => c.id === catId)?.name ?? "Choose"}
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
                      <div className="flex flex-wrap gap-2 shrink-0">
                        <CounterpartyMessagesButton
                          counterpartyKey={keyValue.trim()}
                          transactionType={typeValue}
                          dialogTitle={formatKeyLabel(keyValue || rule.counterpartyKey)}
                          className="h-9"
                        />
                        <CounterpartyRuleTestButton
                          counterpartyKey={keyValue.trim()}
                          counterpartyLabel={formatKeyLabel(keyValue || rule.counterpartyKey)}
                          transactionType={typeValue}
                          categoryName={cats.find((c) => c.id === catId)?.name ?? rule.categoryName}
                          className="h-9"
                        />
                        <Button
                          size="sm"
                          className="h-9"
                          disabled={
                            !dirty || savingId !== null || deletingId !== null || !catId
                          }
                          onClick={() => void saveRule(rule)}
                        >
                          {savingId === rule.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          ) : (
                            "Save"
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9 text-destructive hover:text-destructive"
                          disabled={savingId !== null || deletingId !== null}
                          onClick={() => void deleteRule(rule)}
                        >
                          {deletingId === rule.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          ) : (
                            <Trash2 className="h-4 w-4" aria-hidden />
                          )}
                        </Button>
                      </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
