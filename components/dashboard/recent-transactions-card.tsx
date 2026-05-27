"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TransactionRow } from "@/components/dashboard/transaction-row";
import { SortButton } from "@/components/dashboard/sort-button";
import { Pencil, Trash2, ArrowRight, Loader2 } from "lucide-react";
import { useBudget } from "@/lib/budget-store";
import { useSettings } from "@/lib/settings-store";
import { formatCurrencyWithSign } from "@/lib/format-currency";
import {
  compareIsoDateStringsDesc,
  formatDateWithPreference,
} from "@/lib/format-date";
import type { Transaction } from "@/lib/budget-types";
import {
  compareNumber,
  compareText,
  nextSortState,
  type SortState,
  withSortDirection,
} from "@/lib/sort-utils";
import { TransactionFormDialog } from "./transaction-form-dialog";
import { TransactionDetailDialog } from "./transaction-detail-dialog";

type TransactionSortColumn = "category" | "notes" | "date" | "type" | "amount";

export function RecentTransactionsCard() {
  const { transactions, getCategoryById, deleteTransaction } = useBudget();
  const { currency, dateFormat } = useSettings();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTx, setDetailTx] = useState<Transaction | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState<TransactionSortColumn>>({
    column: "date",
    direction: "desc",
  });

  const recent = useMemo(() => {
    const latest = [...transactions]
      .sort((a, b) => compareIsoDateStringsDesc(a.date, b.date))
      .slice(0, 5);

    return latest.sort((a, b) => {
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
  }, [transactions, getCategoryById, sort]);

  const handleSort = (column: TransactionSortColumn) => {
    setSort((current) => nextSortState(current, column));
  };

  const openDetail = (tx: Transaction) => {
    setConfirmingDeleteId(null);
    setDetailTx(tx);
    setDetailOpen(true);
  };
  const openEdit = (tx: Transaction) => {
    setConfirmingDeleteId(null);
    setEditingTx(tx);
    setDialogOpen(true);
  };
  const handleClose = () => {
    setDialogOpen(false);
    setEditingTx(null);
  };
  const handleDetailEdit = (tx: Transaction) => {
    setDetailOpen(false);
    setDetailTx(null);
    setEditingTx(tx);
    setDialogOpen(true);
  };

  return (
    <>
      <Card className="min-w-0 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-border/50 p-4 pb-4 sm:p-6 sm:pb-4">
          <CardTitle className="text-base font-medium">Recent Transactions</CardTitle>
          {transactions.length > 0 ? (
            <Link href="/dashboard/transactions" className="shrink-0">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1 text-muted-foreground hover:text-foreground"
              >
                View all
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          ) : null}
        </CardHeader>
        <CardContent className="px-4 sm:px-6">
          {recent.length === 0 ? (
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
                {recent.map((tx) => {
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
                                    await deleteTransaction(tx.id);
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
        </CardContent>
      </Card>

      <TransactionDetailDialog
        open={detailOpen}
        onOpenChange={setDetailOpen}
        transaction={detailTx}
        onEdit={handleDetailEdit}
      />
      <TransactionFormDialog
        open={dialogOpen}
        onOpenChange={handleClose}
        editingTransaction={editingTx}
      />
    </>
  );
}
