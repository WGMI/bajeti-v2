"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TransactionRow } from "@/components/dashboard/transaction-row";
import { Pencil, Trash2, ArrowRight, Loader2 } from "lucide-react";
import { useBudget } from "@/lib/budget-store";
import { useSettings } from "@/lib/settings-store";
import { formatCurrencyWithSign } from "@/lib/format-currency";
import {
  compareIsoDateStringsDesc,
  formatDateWithPreference,
} from "@/lib/format-date";
import type { Transaction } from "@/lib/budget-types";
import { TransactionFormDialog } from "./transaction-form-dialog";
import { TransactionDetailDialog } from "./transaction-detail-dialog";

export function RecentTransactionsCard() {
  const { transactions, getCategoryById, deleteTransaction } = useBudget();
  const { currency, dateFormat } = useSettings();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTx, setDetailTx] = useState<Transaction | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const sorted = [...transactions].sort((a, b) =>
    compareIsoDateStringsDesc(a.date, b.date)
  );
  const recent = sorted.slice(0, 5);

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
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 p-4 pb-4 sm:p-6 sm:pb-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <CardTitle className="text-base font-medium">Recent Transactions</CardTitle>
            {transactions.length > 0 && (
              <Link href="/dashboard/transactions">
                <Button variant="ghost" size="sm" className="h-8 gap-1 text-muted-foreground hover:text-foreground">
                  View all
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            )}
          </div>
        </CardHeader>
        <CardContent className="px-4 sm:px-6">
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No transactions yet. Use the + button to create one.
            </p>
          ) : (
            <ul className="min-w-0 space-y-4">
              {recent.map((tx) => {
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
