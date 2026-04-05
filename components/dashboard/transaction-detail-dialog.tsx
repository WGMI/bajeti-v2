"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2, Loader2, Tags } from "lucide-react";
import { useBudget } from "@/lib/budget-store";
import { useSettings } from "@/lib/settings-store";
import { formatCurrencyWithSign } from "@/lib/format-currency";
import { formatDateWithPreference } from "@/lib/format-date";
import type { Transaction } from "@/lib/budget-types";
import { cn } from "@/lib/utils";
import { CreateCounterpartyRuleDialog } from "@/components/dashboard/create-counterparty-rule-dialog";

export interface TransactionDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: Transaction | null;
  /** Called when user clicks Update — parent should open edit form and may close this dialog */
  onEdit?: (transaction: Transaction) => void;
  /** Called after transaction is deleted (e.g. to remove from local list). Dialog closes after delete. */
  onDeleted?: (id: string) => void;
}

export function TransactionDetailDialog({
  open,
  onOpenChange,
  transaction,
  onEdit,
  onDeleted,
}: TransactionDetailDialogProps) {
  const { getCategoryById, deleteTransaction } = useBudget();
  const { currency, dateFormat } = useSettings();
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);

  const category = transaction ? getCategoryById(transaction.categoryId) : null;
  const isIncome = transaction?.type === "income";

  const handleClose = () => {
    setRuleDialogOpen(false);
    onOpenChange(false);
    setConfirmDelete(false);
  };

  const handleDetailOpenChange = (next: boolean) => {
    if (!next) setRuleDialogOpen(false);
    onOpenChange(next);
    if (!next) setConfirmDelete(false);
  };

  const handleEdit = () => {
    if (transaction) {
      onEdit?.(transaction);
      handleClose();
    }
  };

  const handleDelete = async () => {
    if (!transaction) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await deleteTransaction(transaction.id);
      onDeleted?.(transaction.id);
      handleClose();
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  if (!transaction) return null;

  return (
    <>
    <Dialog open={open} onOpenChange={handleDetailOpenChange}>
      <DialogContent
        className={cn(
          "sm:max-w-md",
          isIncome ? "border-l-4 border-l-green-500" : "border-l-4 border-l-destructive"
        )}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-medium",
                isIncome ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
              )}
            >
              {category?.name?.slice(0, 1) ?? "?"}
            </span>
            Transaction details
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-sm text-muted-foreground">Amount</span>
            <span
              className={cn(
                "text-xl font-semibold",
                isIncome ? "text-success" : "text-foreground"
              )}
            >
              {formatCurrencyWithSign(transaction.amount, currency)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">Category</span>
            <span className="font-medium">{category?.name ?? "Unknown"}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">Type</span>
            <Badge
              variant="secondary"
              className={cn(
                "text-xs",
                isIncome
                  ? "bg-success/15 text-success border-success/30"
                  : "bg-muted"
              )}
            >
              {transaction.type === "income" ? "Income" : "Expense"}
            </Badge>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-muted-foreground">Date</span>
            <span className="font-medium">
              {formatDateWithPreference(transaction.date, dateFormat)}
            </span>
          </div>
          {transaction.notes && (
            <div className="flex flex-col gap-1">
              <span className="text-sm text-muted-foreground">Notes</span>
              <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                {transaction.notes}
              </p>
            </div>
          )}
        </div>
        <DialogFooter className="flex-col gap-3 sm:flex-row sm:justify-between sm:items-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full sm:w-auto border-dashed gap-2"
            onClick={() => setRuleDialogOpen(true)}
          >
            <Tags className="h-4 w-4 shrink-0" />
            Create SMS rule
          </Button>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
          <div className="flex gap-2">
            {confirmDelete ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleting}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="text-white"
                  size="sm"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Delete"
                  )}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="destructive"
                className="text-white"
                size="sm"
                onClick={handleDelete}
                disabled={deleting}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            )}
          </div>
          <Button type="button" size="sm" onClick={handleEdit}>
            <Pencil className="h-4 w-4" />
            Update
          </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <CreateCounterpartyRuleDialog
      transaction={transaction}
      open={ruleDialogOpen}
      onOpenChange={setRuleDialogOpen}
    />
    </>
  );
}
