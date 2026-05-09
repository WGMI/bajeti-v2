"use client";

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, Loader2, Filter, Search } from "lucide-react";
import { TransactionRow } from "@/components/dashboard/transaction-row";
import { SortButton } from "@/components/dashboard/sort-button";
import { useBudget } from "@/lib/budget-store";
import { useSettings } from "@/lib/settings-store";
import { formatCurrency } from "@/lib/format-currency";
import { formatCurrencyWithSign } from "@/lib/format-currency";
import { formatDateWithPreference } from "@/lib/format-date";
import type { Category, CategoryType, Transaction } from "@/lib/budget-types";
import {
  compareNumber,
  compareText,
  nextSortState,
  type SortState,
  withSortDirection,
} from "@/lib/sort-utils";
import { TransactionFormDialog } from "@/components/dashboard/transaction-form-dialog";
import { TransactionDetailDialog } from "@/components/dashboard/transaction-detail-dialog";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
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
const CATEGORY_CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;
const EMPTY_SLICE_COLOR = "rgba(0, 0, 0, 0.08)";

type TransactionsResponse = {
  transactions: Transaction[];
  nextCursor: string | null;
  totalIncome?: number;
  totalExpense?: number;
};

type TypeFilter = "all" | "income" | "expense" | "transfer";
type TransactionSortColumn = "category" | "notes" | "date" | "type" | "amount";

function aggregateByCategory(
  txs: Transaction[],
  type: CategoryType,
  getCategoryById: (id: string) => Category | undefined
): { name: string; value: number; fill: string }[] {
  const map = new Map<string, number>();
  for (const tx of txs) {
    if (tx.type !== type) continue;
    const cat = getCategoryById(tx.categoryId);
    const name = cat?.name ?? "Unknown";
    map.set(name, (map.get(name) ?? 0) + Math.abs(tx.amount));
  }
  return Array.from(map.entries())
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], i) => ({
      name,
      value,
      fill: CATEGORY_CHART_COLORS[i % CATEGORY_CHART_COLORS.length],
    }));
}

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
  const [sort, setSort] = useState<SortState<TransactionSortColumn>>({
    column: "date",
    direction: "desc",
  });
  const sentinelRef = useRef<HTMLDivElement>(null);
  const showCategoryCharts = Boolean(dateFrom && dateTo);
  const [fullTotalIncome, setFullTotalIncome] = useState(0);
  const [fullTotalExpense, setFullTotalExpense] = useState(0);

  const incomeSegments = useMemo(
    () => aggregateByCategory(list, "income", getCategoryById),
    [list, getCategoryById]
  );
  const expenseSegments = useMemo(
    () => aggregateByCategory(list, "expense", getCategoryById),
    [list, getCategoryById]
  );

  const hasActiveFilters =
    typeFilter !== "all" || dateFrom !== "" || dateTo !== "" || searchQuery !== "";

  const sortedList = useMemo(() => {
    return [...list].sort((a, b) => {
      const aCategory = getCategoryById(a.categoryId)?.name ?? "";
      const bCategory = getCategoryById(b.categoryId)?.name ?? "";
      const comparison =
        sort.column === "category"
          ? compareText(aCategory, bCategory)
          : sort.column === "notes"
            ? compareText(a.notes, b.notes)
            : sort.column === "date"
              ? compareText(a.date, b.date)
              : sort.column === "type"
                ? compareText(a.type, b.type)
                : compareNumber(a.amount, b.amount);

      return withSortDirection(comparison, sort.direction);
    });
  }, [list, getCategoryById, sort]);

  const handleSort = (column: TransactionSortColumn) => {
    setSort((current) => nextSortState(current, column));
  };

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    const currentFilters = { type: typeFilter, dateFrom, dateTo, search: searchQuery };
    try {
      const data = await fetchTransactionsPage(PAGE_SIZE, null, currentFilters);
      setList(data.transactions);
      setNextCursor(data.nextCursor);
      setFullTotalIncome(data.totalIncome ?? 0);
      setFullTotalExpense(data.totalExpense ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load transactions");
      setList([]);
      setNextCursor(null);
      setFullTotalIncome(0);
      setFullTotalExpense(0);
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
      setFullTotalIncome(data.totalIncome ?? 0);
      setFullTotalExpense(data.totalExpense ?? 0);
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
          {showCategoryCharts && (
            <div className="grid grid-cols-1 gap-6 border-b border-border/50 px-4 pt-4 pb-3 sm:grid-cols-2 sm:px-6">
              {(["Income", "Expense"] as const).map((label, idx) => {
                const segments = idx === 0 ? incomeSegments : expenseSegments;
                const chartData =
                  segments.length > 0
                    ? segments
                    : [{ name: "No data", value: 1, fill: EMPTY_SLICE_COLOR }];
                const title = idx === 0 ? "Income by category" : "Expenses by category";
                return (
                  <div key={label} className="flex min-w-0 flex-col">
                    <p className="mb-2 text-center text-xs font-medium text-muted-foreground">
                      {title}
                    </p>
                    <div className="h-[180px] w-full min-w-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={chartData}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius="42%"
                            outerRadius="78%"
                            paddingAngle={segments.length > 1 ? 2 : 0}
                            stroke="none"
                            isAnimationActive={false}
                          >
                            {chartData.map((entry, i) => (
                              <Cell key={`${entry.name}-${i}`} fill={entry.fill} />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value: number) =>
                              segments.length > 0 ? formatCurrency(value, currency) : ""
                            }
                            labelFormatter={(name) => (segments.length > 0 ? String(name) : "")}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="mt-2 text-center text-sm font-semibold">
                      {formatCurrency(idx === 0 ? fullTotalIncome : fullTotalExpense, currency)}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
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
                    <span>
                      {typeFilter === "all"
                        ? "All"
                        : typeFilter === "income"
                          ? "Income"
                          : typeFilter === "expense"
                            ? "Expense"
                            : "Transfer"}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="income">Income</SelectItem>
                    <SelectItem value="expense">Expense</SelectItem>
                    <SelectItem value="transfer">Transfer</SelectItem>
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
              <div className="min-w-0">
                <div className="mb-3 flex min-w-0 flex-wrap gap-1 md:grid md:grid-cols-[2.5rem_minmax(0,0.6fr)_minmax(0,7rem)_5.5rem_minmax(0,7rem)_auto] md:gap-x-4 md:border-l-[3px] md:border-transparent md:pl-3 md:pr-1">
                  <div className="hidden md:block" />
                  <SortButton
                    column="category"
                    label="Category"
                    activeColumn={sort.column}
                    direction={sort.direction}
                    onSort={handleSort}
                    className="md:w-full md:px-0"
                  />
                  <SortButton
                    column="date"
                    label="Date"
                    activeColumn={sort.column}
                    direction={sort.direction}
                    onSort={handleSort}
                    className="md:w-full md:px-0"
                  />
                  <SortButton
                    column="type"
                    label="Type"
                    activeColumn={sort.column}
                    direction={sort.direction}
                    onSort={handleSort}
                    className="md:w-full md:px-0"
                  />
                  <SortButton
                    column="amount"
                    label="Amount"
                    activeColumn={sort.column}
                    direction={sort.direction}
                    onSort={handleSort}
                    className="md:w-full md:justify-end md:px-0"
                  />
                  <SortButton
                    column="notes"
                    label="Notes"
                    activeColumn={sort.column}
                    direction={sort.direction}
                    onSort={handleSort}
                    className="md:hidden"
                  />
                </div>
                <ul className="min-w-0 space-y-4">
                  {sortedList.map((tx) => {
                    const category = getCategoryById(tx.categoryId);
                    return (
                      <TransactionRow
                        key={tx.id}
                        categoryInitial={category?.name?.slice(0, 1) ?? "?"}
                        categoryName={category?.name ?? "Unknown"}
                        subtitle={tx.notes || tx.date}
                        dateLabel={formatDateWithPreference(tx.date, dateFormat)}
                        type={tx.type}
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
              </div>
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
