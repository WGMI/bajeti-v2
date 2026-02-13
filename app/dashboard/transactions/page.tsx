"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Pencil, Trash2, Loader2 } from "lucide-react";
import { useBudget } from "@/lib/budget-store";
import { useSettings } from "@/lib/settings-store";
import { formatCurrencyWithSign } from "@/lib/format-currency";
import { formatDateWithPreference } from "@/lib/format-date";
import type { CategoryType, Transaction } from "@/lib/budget-types";
import { TransactionFormDialog } from "@/components/dashboard/transaction-form-dialog";

const PAGE_SIZE = 20;
const API = "/api";

type TransactionsResponse = {
  transactions: Transaction[];
  nextCursor: string | null;
};

async function fetchTransactionsPage(limit: number, cursor: string | null): Promise<TransactionsResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`${API}/transactions?${params}`, { credentials: "same-origin" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Failed to load");
  }
  return res.json();
}

export default function TransactionsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { getCategoryById, addTransaction, updateTransaction, deleteTransaction } = useBudget();
  const { currency, dateFormat } = useSettings();
  const [list, setList] = useState<Transaction[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [addType, setAddType] = useState<CategoryType | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const add = searchParams.get("add");
    if (add === "income" || add === "expense") {
      setEditingTx(null);
      setAddType(add);
      setDialogOpen(true);
    }
  }, [searchParams]);

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTransactionsPage(PAGE_SIZE, null);
      setList(data.transactions);
      setNextCursor(data.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load transactions");
      setList([]);
      setNextCursor(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await fetchTransactionsPage(PAGE_SIZE, nextCursor);
      setList((prev) => [...prev, ...data.transactions]);
      setNextCursor(data.nextCursor);
    } catch {
      setNextCursor(null);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore]);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "200px", threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  const openEdit = (tx: Transaction) => {
    setConfirmingDeleteId(null);
    setEditingTx(tx);
    setAddType(null);
    setDialogOpen(true);
  };
  const handleClose = () => {
    setDialogOpen(false);
    setEditingTx(null);
    setAddType(null);
    if (searchParams.get("add")) {
      router.replace("/dashboard/transactions");
    }
  };

  const handleAdded = useCallback((tx: Transaction) => {
    setList((prev) => [tx, ...prev]);
  }, []);

  const handleUpdated = useCallback((tx: Transaction) => {
    setList((prev) => prev.map((t) => (t.id === tx.id ? tx : t)));
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteTransaction(id);
      setList((prev) => prev.filter((t) => t.id !== id));
    },
    [deleteTransaction]
  );

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
        <Button variant="outline" size="sm" className="mt-2" onClick={() => loadFirstPage()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-4">
            <CardTitle className="text-base font-medium">All Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            {list.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No transactions yet. Use the + button to create one.
              </p>
            ) : (
              <ul className="space-y-4">
                {list.map((tx) => {
                  const category = getCategoryById(tx.categoryId);
                  const isIncome = tx.type === "income";
                  return (
                    <li
                      key={tx.id}
                      className="flex flex-wrap items-center gap-2 gap-y-3 border-b border-border/50 pb-4 last:border-0 last:pb-0 sm:flex-nowrap sm:gap-4"
                    >
                      <div
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                          isIncome
                            ? "bg-success/15 text-success"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        <span className="text-sm font-medium">
                          {category?.name?.slice(0, 1) ?? "?"}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1 basis-0 sm:basis-auto">
                        <p className="font-medium truncate">{category?.name ?? "Unknown"}</p>
                        <p className="text-sm text-muted-foreground truncate">
                          {tx.notes || tx.date}
                        </p>
                      </div>
                      <div className="w-full shrink-0 text-right text-sm text-muted-foreground sm:w-auto sm:flex-1">
                        {formatDateWithPreference(tx.date, dateFormat)}
                      </div>
                      <Badge
                        variant="secondary"
                        className={cn(
                          "shrink-0 text-xs",
                          isIncome
                            ? "bg-success/15 text-success border-success/30"
                            : "bg-muted"
                        )}
                      >
                        {tx.type === "income" ? "Income" : "Expense"}
                      </Badge>
                      <span
                        className={cn(
                          "shrink-0 font-semibold",
                          isIncome ? "text-success" : "text-foreground"
                        )}
                      >
                        {formatCurrencyWithSign(tx.amount, currency)}
                      </span>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(tx)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {confirmingDeleteId === tx.id && !deletingId ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8"
                              onClick={() => setConfirmingDeleteId(null)}
                            >
                              Cancel
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 min-w-[7rem] gap-2 text-destructive hover:text-destructive"
                              onClick={async () => {
                                setDeletingId(tx.id);
                                try {
                                  await handleDelete(tx.id);
                                  setConfirmingDeleteId(null);
                                } finally {
                                  setDeletingId(null);
                                }
                              }}
                            >
                              Are you sure?
                            </Button>
                          </>
                        ) : deletingId === tx.id ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 min-w-[7rem] gap-2 text-destructive hover:text-destructive"
                            disabled
                          >
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Deleting…
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setConfirmingDeleteId(tx.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {list.length > 0 && (
              <div ref={sentinelRef} className="flex justify-center py-4">
                {loadingMore && (
                  <p className="text-sm text-muted-foreground">Loading more…</p>
                )}
                {!loadingMore && nextCursor && (
                  <p className="text-sm text-muted-foreground">Scroll for more</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <TransactionFormDialog
        open={dialogOpen}
        onOpenChange={handleClose}
        editingTransaction={editingTx}
        initialType={addType}
        onAdded={handleAdded}
        onUpdated={handleUpdated}
      />
    </>
  );
}
