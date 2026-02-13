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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useBudget } from "@/lib/budget-store";
import type { CategoryType, Transaction } from "@/lib/budget-types";

interface TransactionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingTransaction?: Transaction | null;
  /** When adding, preselect type so only relevant categories are shown */
  initialType?: CategoryType | null;
  /** Called after a new transaction is created (e.g. to prepend to a local list) */
  onAdded?: (transaction: Transaction) => void;
  /** Called after a transaction is updated (e.g. to update item in a local list) */
  onUpdated?: (transaction: Transaction) => void;
}

function getInitialValues(
  editingTransaction: Transaction | null | undefined,
  typeLock: CategoryType | null,
  categories: { id: string; type: string }[]
) {
  if (editingTransaction) {
    return {
      amount: String(Math.abs(editingTransaction.amount)),
      categoryId: editingTransaction.categoryId,
      date: editingTransaction.date.slice(0, 10),
      notes: editingTransaction.notes,
    };
  }
  const firstOfType = typeLock
    ? categories.find((c) => c.type === typeLock)?.id ?? ""
    : "";
  return {
    amount: "",
    categoryId: firstOfType,
    date: new Date().toISOString().slice(0, 10),
    notes: "",
  };
}

function TransactionFormFields({
  editingTransaction,
  initialType,
  onClose,
  onAdded,
  onUpdated,
}: {
  editingTransaction: Transaction | null | undefined;
  initialType: CategoryType | null;
  onClose: () => void;
  onAdded?: (transaction: Transaction) => void;
  onUpdated?: (transaction: Transaction) => void;
}) {
  const { categories, addTransaction, updateTransaction, getCategoryById } =
    useBudget();
  const isEdit = !!editingTransaction;
  const typeLock = initialType ?? editingTransaction?.type ?? null;
  const relevantCategories = typeLock
    ? categories.filter((c) => c.type === typeLock)
    : categories;

  const initial = getInitialValues(editingTransaction, typeLock, categories);
  const [amount, setAmount] = useState(initial.amount);
  const [categoryId, setCategoryId] = useState(initial.categoryId);
  const [date, setDate] = useState(initial.date);
  const [notes, setNotes] = useState(initial.notes);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseFloat(amount);
    if (Number.isNaN(num) || num <= 0) return;
    const category = getCategoryById(categoryId);
    if (!category) return;
    const type = category.type;
    setSubmitError(null);
    setSubmitting(true);
    try {
      if (isEdit && editingTransaction) {
        const updated = await updateTransaction(editingTransaction.id, {
          amount: type === "expense" ? -num : num,
          categoryId,
          date,
          notes,
          type,
        });
        onUpdated?.(updated);
      } else {
        const created = await addTransaction({
          amount: type === "expense" ? -num : num,
          categoryId,
          date,
          notes,
          type,
        });
        onAdded?.(created);
      }
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="amount">Amount</Label>
        <Input
          id="amount"
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="category">Category</Label>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger id="category">
            {categoryId
              ? getCategoryById(categoryId)?.name ?? "Select category"
              : "Select category"}
          </SelectTrigger>
          <SelectContent>
            {relevantCategories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="date">Date</Label>
        <Input
          id="date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Input
          id="notes"
          placeholder="e.g. Groceries at store"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      {submitError && (
        <p className="text-sm text-destructive">{submitError}</p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : isEdit ? "Save changes" : "Add transaction"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function TransactionFormDialog({
  open,
  onOpenChange,
  editingTransaction,
  initialType,
  onAdded,
  onUpdated,
}: TransactionFormDialogProps) {
  const typeLock = initialType ?? editingTransaction?.type ?? null;
  const isEdit = !!editingTransaction;

  const handleClose = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? "Edit transaction"
              : `Add ${typeLock === "income" ? "income" : typeLock === "expense" ? "expense" : "transaction"}`}
          </DialogTitle>
        </DialogHeader>
        {open && (
          <TransactionFormFields
            key={editingTransaction?.id ?? "new"}
            editingTransaction={editingTransaction}
            initialType={initialType ?? null}
            onClose={handleClose}
            onAdded={onAdded}
            onUpdated={onUpdated}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
