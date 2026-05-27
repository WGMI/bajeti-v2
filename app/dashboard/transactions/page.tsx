"use client";

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, Loader2, Filter, Search, X } from "lucide-react";
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
): { categoryId: string; name: string; value: number; fill: string; type: CategoryType }[] {
  const map = new Map<string, { name: string; value: number }>();
  for (const tx of txs) {
    if (tx.type !== type) continue;
    const cat = getCategoryById(tx.categoryId);
    const name = cat?.name ?? "Unknown";
    const current = map.get(tx.categoryId);
    map.set(tx.categoryId, {
      name,
      value: (current?.value ?? 0) + Math.abs(tx.amount),
    });
  }
  return Array.from(map.entries())
    .filter(([, entry]) => entry.value > 0)
    .sort((a, b) => b[1].value - a[1].value)
    .map(([categoryId, entry], i) => ({
      categoryId,
      name: entry.name,
      value: entry.value,
      fill: CATEGORY_CHART_COLORS[i % CATEGORY_CHART_COLORS.length],
      type,
    }));
}

type TransactionFilters = {
  type: TypeFilter;
  dateFrom: string;
  dateTo: string;
  search: string;
};

function transactionFilterParams(filters: TransactionFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.type !== "all") params.set("type", filters.type);
  if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) params.set("dateTo", filters.dateTo);
  if (filters.search.trim()) params.set("search", filters.search.trim());
  return params;
}

async function fetchTransactions(
  filters: TransactionFilters,
  options?: { limit?: number; cursor?: string | null }
): Promise<TransactionsResponse> {
  const params = transactionFilterParams(filters);
  if (options?.limit != null) params.set("limit", String(options.limit));
  if (options?.cursor) params.set("cursor", options.cursor);
  const res = await fetch(`${API}/transactions?${params}`, { credentials: "same-origin" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Failed to load");
  }
  return res.json();
}

async function fetchTransactionsPage(
  limit: number,
  cursor: string | null,
  filters: TransactionFilters
): Promise<TransactionsResponse> {
  return fetchTransactions(filters, { limit, cursor: cursor ?? undefined });
}

/** All rows for current filters (no limit); used so client-side sort is complete. */
async function fetchAllTransactions(filters: TransactionFilters): Promise<TransactionsResponse> {
  return fetchTransactions(filters);
}

function TransactionsPageContent() {
  const searchParams = useSearchParams();
  const { getCategoryById, deleteTransaction } = useBudget();
  const { currency, dateFormat } = useSettings();
  const [list, setList] = useState<Transaction[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingAllForSort, setLoadingAllForSort] = useState(false);
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
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
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
  const selectedSegment = useMemo(
    () => [...incomeSegments, ...expenseSegments].find((segment) => segment.categoryId === selectedCategoryId),
    [incomeSegments, expenseSegments, selectedCategoryId]
  );

  const hasActiveFilters =
    typeFilter !== "all" ||
    dateFrom !== "" ||
    dateTo !== "" ||
    searchQuery !== "" ||
    selectedCategoryId != null;
  const activeFilterCount =
    Number(typeFilter !== "all") +
    Number(dateFrom !== "") +
    Number(dateTo !== "") +
    Number(searchQuery !== "") +
    Number(selectedCategoryId != null);

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
  const visibleList = useMemo(
    () =>
      selectedCategoryId
        ? sortedList.filter((tx) => tx.categoryId === selectedCategoryId)
        : sortedList,
    [sortedList, selectedCategoryId]
  );
  const canAutoLoadMore =
    sort.column === "date" && sort.direction === "desc" && selectedCategoryId == null;

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
    if (!canAutoLoadMore || !nextCursor || loadingMore) return;
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
  }, [canAutoLoadMore, nextCursor, loadingMore, typeFilter, dateFrom, dateTo, searchQuery]);

  const loadAllForSort = useCallback(async () => {
    if (!nextCursor || loadingAllForSort) return;
    setLoadingAllForSort(true);
    const currentFilters = { type: typeFilter, dateFrom, dateTo, search: searchQuery };
    try {
      const data = await fetchAllTransactions(currentFilters);
      setList(data.transactions);
      setNextCursor(null);
      setFullTotalIncome(data.totalIncome ?? 0);
      setFullTotalExpense(data.totalExpense ?? 0);
    } catch {
      setError("Failed to load all transactions for sorting");
    } finally {
      setLoadingAllForSort(false);
    }
  }, [nextCursor, loadingAllForSort, typeFilter, dateFrom, dateTo, searchQuery]);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  // Custom sort only applies to loaded rows; fetch the full filtered set once.
  useEffect(() => {
    if (canAutoLoadMore || loading || !nextCursor) return;
    void loadAllForSort();
  }, [canAutoLoadMore, loading, nextCursor, loadAllForSort]);

  useEffect(() => {
    const from = searchParams.get("dateFrom") ?? "";
    const to = searchParams.get("dateTo") ?? "";
    setDateFrom(from);
    setDateTo(to);
  }, [searchParams]);

  useEffect(() => {
    if (!selectedCategoryId) return;
    const stillExists = list.some((tx) => tx.categoryId === selectedCategoryId);
    if (!stillExists) setSelectedCategoryId(null);
  }, [list, selectedCategoryId]);

  useEffect(() => {
    if (!canAutoLoadMore) return;
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
  }, [canAutoLoadMore, loadMore]);

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
    setSelectedCategoryId(null);
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
                    : [
                        {
                          categoryId: "none",
                          type: idx === 0 ? "income" : "expense",
                          name: "No data",
                          value: 1,
                          fill: EMPTY_SLICE_COLOR,
                        },
                      ];
                const title = idx === 0 ? "Income by category" : "Expenses by category";
                const segmentType: CategoryType = idx === 0 ? "income" : "expense";
                const isSelectedChart = selectedSegment?.type === segmentType;
                return (
                  <div key={label} className="flex min-w-0 flex-col">
                    <p className="mb-2 text-center text-xs font-medium text-muted-foreground">
                      {title}
                    </p>
                    <div className="relative h-[180px] w-full min-w-0">
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
                            onClick={(_, index) => {
                              const selected = segments[index];
                              if (!selected) return;
                              setTypeFilter(segmentType);
                              setSelectedCategoryId(selected.categoryId);
                            }}
                          >
                            {chartData.map((entry, i) => (
                              <Cell
                                key={`${entry.name}-${i}`}
                                fill={entry.fill}
                                className={segments.length > 0 ? "cursor-pointer" : undefined}
                                opacity={
                                  selectedCategoryId && entry.categoryId !== selectedCategoryId
                                    ? 0.45
                                    : 1
                                }
                              />
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
                      {isSelectedChart && selectedSegment && (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="absolute right-2 top-2 z-10 h-7 max-w-[80%] gap-1 rounded-full px-2 text-xs"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setSelectedCategoryId(null);
                          }}
                        >
                          <span className="truncate">{selectedSegment.name}</span>
                          <X className="h-3 w-3 shrink-0" />
                        </Button>
                      )}
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
                <Button
                  variant="outline"
                  className="h-9 w-full border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive sm:w-auto"
                  onClick={clearFilters}
                >
                  Clear filters ({activeFilterCount})
                </Button>
              )}
            </div>
          </div>
          <CardContent className="px-4 sm:px-6">
            {visibleList.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                {selectedCategoryId
                  ? "No transactions found for the selected chart segment."
                  : "No transactions yet. Use the + button to create one."}
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
                  {visibleList.map((tx) => {
                    const category = getCategoryById(tx.categoryId);
                    return (
                      <TransactionRow
                        key={tx.id}
                        categoryInitial={category?.name?.slice(0, 1) ?? "?"}
                        categoryName={category?.name ?? "Unknown"}
                        subtitle={tx.notes || tx.date}
                        dateLabel={formatDateWithPreference(tx.date, dateFormat)}
                        type={tx.type}
                        amountFormatted={formatCurrencyWithSign(tx.amount, currency, tx.type)}
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
            {visibleList.length > 0 && !canAutoLoadMore && loadingAllForSort && (
              <p className="pb-2 text-center text-sm text-muted-foreground">
                Loading all matching transactions for sorting…
              </p>
            )}
            {visibleList.length > 0 && (
              <div ref={sentinelRef} className="flex justify-center py-4">
                {(loadingMore || loadingAllForSort) && (
                  <p className="text-sm text-muted-foreground">
                    {loadingAllForSort ? "Loading all for sort…" : "Loading more…"}
                  </p>
                )}
                {!loadingMore && !loadingAllForSort && nextCursor && canAutoLoadMore && (
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
