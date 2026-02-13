"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Pencil, Trash2, ArrowRight, Loader2 } from "lucide-react";
import { useBudget } from "@/lib/budget-store";
import { useSettings } from "@/lib/settings-store";
import { formatCurrencyWithSign } from "@/lib/format-currency";
import { formatDateWithPreference } from "@/lib/format-date";
import type { Transaction } from "@/lib/budget-types";
import { TransactionFormDialog } from "./transaction-form-dialog";

export function RecentTransactionsCard() {
  const { transactions, getCategoryById, deleteTransaction } = useBudget();
  const { currency, dateFormat } = useSettings();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const sorted = [...transactions].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  const recent = sorted.slice(0, 5);

  const openEdit = (tx: Transaction) => {
    setConfirmingDeleteId(null);
    setEditingTx(tx);
    setDialogOpen(true);
  };
  const handleClose = () => {
    setDialogOpen(false);
    setEditingTx(null);
  };

  return (
    <>
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <div className="flex items-center gap-2">
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
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No transactions yet. Use the + button to create one.
            </p>
          ) : (
            <ul className="space-y-4">
              {recent.map((tx) => {
                const category = getCategoryById(tx.categoryId);
                const isIncome = tx.type === "income";
                return (
                  <li
                    key={tx.id}
                    className={cn(
                      "grid grid-cols-[2.5rem_minmax(0,1fr)_7rem_5.5rem_6.5rem_auto] gap-x-4 items-center border-b border-border/50 border-l-[3px] pb-4 last:border-b-0 last:pb-0 pl-3",
                      isIncome ? "border-l-green-500" : "border-l-red-500"
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                        isIncome ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
                      )}
                    >
                      <span className="text-sm font-medium">
                        {category?.name?.slice(0, 1) ?? "?"}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium truncate">{category?.name ?? "Unknown"}</p>
                      <p className="text-sm text-muted-foreground truncate">
                        {tx.notes || tx.date}
                      </p>
                    </div>
                    <div className="text-right text-sm text-muted-foreground">
                      {formatDateWithPreference(tx.date, dateFormat)}
                    </div>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "w-fit text-xs",
                        isIncome ? "bg-success/15 text-success border-success/30" : "bg-muted"
                      )}
                    >
                      {tx.type === "income" ? "Income" : "Expense"}
                    </Badge>
                    <span
                      className={cn(
                        "font-semibold text-right",
                        isIncome ? "text-success" : "text-foreground"
                      )}
                    >
                      {formatCurrencyWithSign(tx.amount, currency)}
                    </span>
                    <div className="flex justify-end gap-1">
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
        </CardContent>
      </Card>

      <TransactionFormDialog
        open={dialogOpen}
        onOpenChange={handleClose}
        editingTransaction={editingTx}
      />
    </>
  );
}
