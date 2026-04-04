"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, Loader2, Filter, Search } from "lucide-react";
import { TransactionRow } from "@/components/dashboard/transaction-row";
import { useBudget } from "@/lib/budget-store";
import { useSettings } from "@/lib/settings-store";
import { formatCurrencyWithSign } from "@/lib/format-currency";
import { formatDateWithPreference } from "@/lib/format-date";
import type { CategoryType, Transaction } from "@/lib/budget-types";
import { TransactionFormDialog } from "@/components/dashboard/transaction-form-dialog";
import { TransactionDetailDialog } from "@/components/dashboard/transaction-detail-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PAGE_SIZE = 20;
const API = "/api";

type TransactionsResponse = {
  transactions: Transaction[];
  nextCursor: string | null;
};

type TypeFilter = "all" | "income" | "expense";

async function fetchTransactionsPage(
  limit: number,
  cursor: string | null,
  filters: { type: TypeFilter; dateFrom: string; dateTo: string; search: string }
): Promise<TransactionsResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  if (filters.type !== "all") params.set("type", filters.type);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  if (filters.search.trim()) params.set("search", filters.search.trim());
  const res = await fetch(`${API}/transactions?${params}`, { credentials: "same-origin" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Failed to load");
  }
  return res.json();
}

function TransactionsPageContent() {
  const searchParams = useSearchParams();
  const { getCategoryById, deleteTransaction } = useBudget();
  const { currency, dateFormat } = useSettings();
  const [list, setList] = useState<Transaction[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [addType, setAddType] = useState<CategoryType | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTx, setDetailTx] = useState<Transaction | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [dateFrom, setDateFrom] = useState(() => searchParams.get("dateFrom") ?? "");
  const [dateTo, setDateTo] = useState(() => searchParams.get("dateTo") ?? "");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState(""); // local value for controlled input; applied on blur/enter
  const sentinelRef = useRef<HTMLDivElement>(null);

  const hasActiveFilters =
    typeFilter !== "all" || dateFrom !== "" || dateTo !== "" || searchQuery !== "";

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    const currentFilters = { type: typeFilter, dateFrom, dateTo, search: searchQuery };
    try {
      const data = await fetchTransactionsPage(PAGE_SIZE, null, currentFilters);
      setList(data.transactions);
      setNextCursor(data.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load transactions");
      setList([]);
      setNextCursor(null);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, dateFrom, dateTo, searchQuery]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const currentFilters = { type: typeFilter, dateFrom, dateTo, search: searchQuery };
    try {
      const data = await fetchTransactionsPage(PAGE_SIZE, nextCursor, currentFilters);
      setList((prev) => [...prev, ...data.transactions]);
      setNextCursor(data.nextCursor);
    } catch {
      setNextCursor(null);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, typeFilter, dateFrom, dateTo, searchQuery]);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  useEffect(() => {
    const from = searchParams.get("dateFrom") ?? "";
    const to = searchParams.get("dateTo") ?? "";
    setDateFrom(from);
    setDateTo(to);
  }, [searchParams]);

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

  const openDetail = (tx: Transaction) => {
    setConfirmingDeleteId(null);
    setDetailTx(tx);
    setDetailOpen(true);
  };
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
  };
  const handleDetailEdit = (tx: Transaction) => {
    setDetailOpen(false);
    setDetailTx(null);
    setEditingTx(tx);
    setAddType(null);
    setDialogOpen(true);
  };

  const handleAdded = useCallback((tx: Transaction) => {
    setList((prev) => (prev.some((t) => t.id === tx.id) ? prev : [tx, ...prev]));
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

  const clearFilters = () => {
    setTypeFilter("all");
    setDateFrom("");
    setDateTo("");
    setSearchQuery("");
    setSearchInput("");
  };

  const applySearch = () => {
    setSearchQuery(searchInput);
  };

  return (
    <>
      <div className="min-w-0 space-y-6">
        <Card className="min-w-0 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between p-4 pb-4 sm:p-6 sm:pb-4">
            <CardTitle className="text-base font-medium">All Transactions</CardTitle>
          </CardHeader>
          <div className="flex flex-col gap-4 border-b border-border/50 px-4 pb-4 sm:flex-row sm:flex-wrap sm:items-end sm:px-6">
            <div className="flex items-center gap-2 text-muted-foreground sm:shrink-0">
              <Filter className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium">Filters</span>
            </div>
            <div className="grid flex-1 grid-cols-1 gap-4 min-w-0 sm:flex sm:flex-wrap sm:items-end">
              <div className="space-y-1.5 sm:min-w-[180px] sm:flex-1">
                <Label className="text-xs text-muted-foreground">Search notes & category</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search…"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && applySearch()}
                    onBlur={applySearch}
                    className="h-9 w-full pl-8 pr-4"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Type</Label>
                <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
                  <SelectTrigger className="h-9 w-full sm:w-[130px]">
                    <span>{typeFilter === "all" ? "All" : typeFilter === "income" ? "Income" : "Expense"}</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="income">Income</SelectItem>
                    <SelectItem value="expense">Expense</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:flex sm:items-end">
                <div className="space-y-1.5 min-w-0">
                  <Label className="text-xs text-muted-foreground">From date</Label>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="h-9 w-full min-w-0 sm:w-[140px]"
                  />
                </div>
                <div className="space-y-1.5 min-w-0">
                  <Label className="text-xs text-muted-foreground">To date</Label>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="h-9 w-full min-w-0 sm:w-[140px]"
                  />
                </div>
              </div>
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" className="h-9 w-full sm:w-auto" onClick={clearFilters}>
                  Clear filters
                </Button>
              )}
            </div>
          </div>
          <CardContent className="px-4 sm:px-6">
            {list.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No transactions yet. Use the + button to create one.
              </p>
            ) : (
              <ul className="min-w-0 space-y-4">
                {list.map((tx) => {
                  const category = getCategoryById(tx.categoryId);
                  const isIncome = tx.type === "income";
                  return (
                    <TransactionRow
                      key={tx.id}
                      categoryInitial={category?.name?.slice(0, 1) ?? "?"}
                      categoryName={category?.name ?? "Unknown"}
                      subtitle={tx.notes || tx.date}
                      dateLabel={formatDateWithPreference(tx.date, dateFormat)}
                      isIncome={isIncome}
                      amountFormatted={formatCurrencyWithSign(tx.amount, currency)}
                      onOpen={() => openDetail(tx)}
                      actions={
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 touch-manipulation"
                            onClick={() => openEdit(tx)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {confirmingDeleteId === tx.id && !deletingId ? (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 touch-manipulation"
                                onClick={() => setConfirmingDeleteId(null)}
                              >
                                Cancel
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 min-w-0 shrink gap-2 text-destructive hover:text-destructive sm:min-w-[7rem] touch-manipulation"
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
                              className="h-8 min-w-0 gap-2 text-destructive hover:text-destructive sm:min-w-[7rem] touch-manipulation"
                              disabled
                            >
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Deleting…
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive touch-manipulation"
                              onClick={() => setConfirmingDeleteId(tx.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </>
                      }
                    />
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

      <TransactionDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        transaction={detailTx}
        onEdit={handleDetailEdit}
        onDeleted={(id) => {
          setList((prev) => prev.filter((t) => t.id !== id));
          setDetailOpen(false);
          setDetailTx(null);
        }}
      />
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

export default function TransactionsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[200px]">
          <p className="text-muted-foreground">Loading…</p>
        </div>
      }
    >
      <TransactionsPageContent />
    </Suspense>
  );
}
