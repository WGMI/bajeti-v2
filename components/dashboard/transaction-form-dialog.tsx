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
import { parseSMS } from "@/lib/sms-parser";
import { candidateCounterpartyRuleKeys } from "@/lib/sms-parser";
import { buildSmsIdempotencyKey } from "@/lib/sms-idempotency";
import { useSettings } from "@/lib/settings-store";

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
      type: editingTransaction.type,
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
    type: typeLock ?? "expense",
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
  const { categories, transactions, addTransaction, updateTransaction, getCategoryById, refetch } = useBudget();
  const { smsTransactionDateSource } = useSettings();
  const isEdit = !!editingTransaction;
  const typeLock = initialType ?? editingTransaction?.type ?? null;

  const initial = getInitialValues(editingTransaction, typeLock, categories);
  const [amount, setAmount] = useState(initial.amount);
  const [categoryId, setCategoryId] = useState(initial.categoryId);
  const [type, setType] = useState<CategoryType>(initial.type);
  const [date, setDate] = useState(initial.date);
  const [notes, setNotes] = useState(initial.notes);

  const selectedCategory = categoryId ? getCategoryById(categoryId) : null;
  const effectiveType = isEdit ? type : (selectedCategory?.type ?? typeLock ?? type);
  const relevantCategories = categories.filter((c) => c.type === effectiveType);

  const [showPasteSms, setShowPasteSms] = useState(false);
  const [smsText, setSmsText] = useState("");
  const [smsParseFeedback, setSmsParseFeedback] = useState<string | null>(null);
  const [smsIdempotencyKey, setSmsIdempotencyKey] = useState<string | null>(null);

  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkImportSummary, setBulkImportSummary] = useState<{
    created: number;
    duplicates: number;
    ignored: number;
    failed: number;
  } | null>(null);
  const [bulkImportFailureLines, setBulkImportFailureLines] = useState<string[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);

  function splitSmsMessages(input: string): string[] {
    const normalized = input.replace(/\r\n/g, "\n").trim();
    if (!normalized) return [];

    // Preferred format: one SMS per block, separated by blank lines.
    const blankBlocks = normalized
      .split(/\n\s*\n/g)
      .map((s) => s.trim())
      .filter(Boolean);
    if (blankBlocks.length > 1) return blankBlocks;

    // Fallback: try splitting by "UC... confirmed" style blocks.
    const confirmedBlocks = normalized.match(
      /[A-Z0-9]{8,16}\s+confirmed\b[\s\S]*?(?=(?:[A-Z0-9]{8,16}\s+confirmed\b)|$)/gi
    );
    if (confirmedBlocks && confirmedBlocks.length > 1) {
      return confirmedBlocks.map((s) => s.trim()).filter(Boolean);
    }

    return [normalized];
  }

  const handleParseSms = async () => {
    const trimmed = smsText.trim();
    if (!trimmed) return;
    setSmsParseFeedback(null);
    console.log("[SMS dialog] typeLock (user's choice):", typeLock);
    const result = parseSMS(trimmed, {
      transactionDateSource: smsTransactionDateSource,
    });
    console.log("[SMS dialog] parsed result.type:", result.type);

    if (result.type === "neither") {
      setSmsParseFeedback("This SMS did not look like an income, expense, or transfer transaction.");
      return;
    }
    if (result.amount <= 0) {
      setSmsParseFeedback("The SMS was recognized, but the amount is missing or invalid.");
      setSmsIdempotencyKey(null);
      return;
    }
    if (!result.date) {
      setSmsParseFeedback("The SMS was recognized, but the date is missing or invalid.");
      setSmsIdempotencyKey(null);
      return;
    }

    setNotes(result.message);
    if (result.amount > 0) setAmount(String(result.amount));
    if (result.date) setDate(result.date);
    setSmsIdempotencyKey(
      buildSmsIdempotencyKey({
        type: result.type,
        amount: result.amount,
        date: result.date,
        transactionRef: result.transactionRef,
      })
    );
    // Set category from SMS type, but prefer an explicit counterparty rule match when present.
    if (result.type === "income" || result.type === "expense" || result.type === "transfer") {
      let matchedCategoryId: string | null = null;
      if (result.counterpartyKey) {
        try {
          const rulesRes = await fetch("/api/counterparty-rules", {
            credentials: "same-origin",
          });
          if (rulesRes.ok) {
            const rulesData = (await rulesRes.json()) as {
              rules?: Array<{
                counterpartyKey: string;
                transactionType: CategoryType;
                categoryId: string;
              }>;
            };
            const candidateKeys = candidateCounterpartyRuleKeys(
              result.counterpartyKey,
              result.message
            );
            const match =
              (rulesData.rules ?? []).find(
                (r) =>
                  r.transactionType === "transfer" &&
                  candidateKeys.includes(r.counterpartyKey)
              ) ??
              (rulesData.rules ?? []).find(
                (r) =>
                  r.transactionType === result.type &&
                  candidateKeys.includes(r.counterpartyKey)
              );
            matchedCategoryId = match?.categoryId ?? null;
          }
        } catch (e) {
          console.warn("[SMS dialog] failed to fetch counterparty rules", e);
        }
      }

      const firstOfType = categories.find((c) => c.type === result.type)?.id ?? null;
      const matchedCategory = matchedCategoryId
        ? categories.find((c) => c.id === matchedCategoryId)
        : null;
      const categoryFromSms = matchedCategoryId ?? firstOfType;
      console.log(
        "[SMS dialog] setting category from SMS.",
        "result.type:",
        result.type,
        "counterpartyKey:",
        result.counterpartyKey,
        "matchedCategoryId:",
        matchedCategoryId,
        "firstOfType:",
        firstOfType
      );
      if (categoryFromSms) {
        setCategoryId(categoryFromSms);
        const nextType = matchedCategory?.type ?? (isEdit ? result.type : null);
        if (nextType) setType(nextType);
      } else {
        console.warn(
          "[SMS dialog] no category found for type:",
          result.type,
          "– ensure there is at least one",
          result.type,
          "category."
        );
      }
    } else {
      console.log("[SMS dialog] parsed type is neither; not changing category.");
      setSmsIdempotencyKey(null);
    }
    setShowPasteSms(false);
    setSmsText("");
    setSmsParseFeedback(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseFloat(amount);
    if (Number.isNaN(num) || num <= 0) return;
    const category = getCategoryById(categoryId);
    if (!category) return;
    const txType = isEdit ? type : category.type;
    setSubmitError(null);
    setSubmitMessage(null);
    setSubmitting(true);
    try {
      if (isEdit && editingTransaction) {
        const updated = await updateTransaction(editingTransaction.id, {
          amount: txType === "expense" ? -num : num,
          categoryId,
          date,
          notes,
          type: txType,
        });
        onUpdated?.(updated);
      } else {
        const created = await addTransaction({
          amount: txType === "expense" ? -num : num,
          categoryId,
          date,
          notes,
          type: txType,
          idempotencyKey: smsIdempotencyKey ?? undefined,
        });
        const alreadyExists = transactions.some((t) => t.id === created.id);
        if (alreadyExists) {
          setSubmitMessage("Duplicate SMS ignored: this transaction is already saved.");
          return;
        }
        onAdded?.(created);
      }
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  type SmsBulkItemStatus = "created" | "duplicate" | "ignored" | "failed";
  type SmsBulkItemResult = {
    index: number;
    status: SmsBulkItemStatus;
    reason?: string;
    transaction?: { id?: string } | null;
  };
  type SmsBulkResponse = {
    summary?: {
      created: number;
      duplicates: number;
      ignored: number;
      failed: number;
    };
    results?: SmsBulkItemResult[];
    error?: string;
  };

  const handleBulkImportSms = async () => {
    if (bulkImporting) return;
    const messages = splitSmsMessages(smsText);
    if (messages.length === 0) return;

    setBulkImporting(true);
    setBulkImportSummary(null);
    setBulkImportFailureLines([]);
    setSubmitError(null);
    setSubmitMessage(null);
    setSmsParseFeedback(null);

    try {
      const res = await fetch("/api/sms/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages,
          // Keep existing behavior: the single-SMS flow doesn't include fee-in-expense.
          includeFeeInExpense: false,
        }),
      });

      const data = (await res.json().catch(() => null)) as SmsBulkResponse | null;
      if (!res.ok) {
        const msg =
          (data && typeof data.error === "string" && data.error) || "Bulk SMS import failed";
        throw new Error(msg);
      }

      const summary = data?.summary;
      const results = Array.isArray(data?.results) ? data.results : [];

      if (summary) setBulkImportSummary(summary);

      const failureLines = results
        .filter((r) => r.status === "failed" || r.status === "ignored" || r.status === "duplicate")
        .slice(0, 10)
        .map((r) => {
          const idx = typeof r.index === "number" ? r.index + 1 : "?";
          if (r.status === "duplicate") {
            const txId = r.transaction?.id ? String(r.transaction.id) : "";
            return `#${idx}: duplicate${txId ? ` (tx ${txId})` : ""}`;
          }
          return `#${idx}: ${r.reason ?? "SMS ignored/failed"}`;
        });

      setBulkImportFailureLines(failureLines);

      // Refresh the list to reflect newly created transactions.
      await refetch();

      // Clear the manual fields so "Add transaction" doesn't accidentally submit.
      setAmount("");
      setNotes("");
      setSmsIdempotencyKey(null);
      setSmsText("");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Bulk import failed");
    } finally {
      setBulkImporting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {!isEdit && (
        <div className="space-y-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowPasteSms((v) => !v)}
          >
            {showPasteSms ? "Hide paste SMS" : "Paste SMS"}
          </Button>
          {showPasteSms && (
            <div className="space-y-2">
              <Label htmlFor="smsPaste">SMS message</Label>
              <textarea
                id="smsPaste"
                className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="Paste the full SMS message here..."
                value={smsText}
                onChange={(e) => setSmsText(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                For bulk import, separate multiple SMS messages with a blank line.
              </p>
              <Button type="button" size="sm" onClick={handleParseSms}>
                Use from SMS
              </Button>
              <Button
                type="button"
                size="sm"
                className="ml-2"
                onClick={handleBulkImportSms}
                disabled={bulkImporting}
              >
                {bulkImporting ? "Importing…" : "Import all SMS"}
              </Button>
              {smsParseFeedback && (
                <p className="text-sm text-destructive">{smsParseFeedback}</p>
              )}

              {bulkImportSummary && (
                <div className="space-y-1">
                  <p className="text-sm">
                    Imported: <span className="font-medium">{bulkImportSummary.created}</span>{" "}
                    created, <span className="font-medium">{bulkImportSummary.duplicates}</span>{" "}
                    duplicates, <span className="font-medium">{bulkImportSummary.ignored}</span>{" "}
                    ignored, <span className="font-medium">{bulkImportSummary.failed}</span>{" "}
                    failed.
                  </p>
                  {bulkImportFailureLines.length > 0 && (
                    <div className="space-y-0.5">
                      {bulkImportFailureLines.map((line, idx) => (
                        <p key={idx} className="text-xs text-destructive">
                          {line}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
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
      {isEdit && (
        <div className="space-y-2">
          <Label htmlFor="transaction-type">Type</Label>
          <Select
            value={type}
            onValueChange={(value) => {
              const nextType = value as CategoryType;
              setType(nextType);
              const currentCategory = getCategoryById(categoryId);
              if (!currentCategory || currentCategory.type !== nextType) {
                const firstOfType = categories.find((c) => c.type === nextType)?.id ?? "";
                setCategoryId(firstOfType);
              }
            }}
          >
            <SelectTrigger id="transaction-type">
              {type === "income" ? "Income" : type === "expense" ? "Expense" : "Transfer"}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="income">Income</SelectItem>
              <SelectItem value="expense">Expense</SelectItem>
              <SelectItem value="transfer">Transfer</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
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
      {submitMessage && (
        <p className="text-sm text-muted-foreground">{submitMessage}</p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant={typeLock === "expense" ? "destructive" : "default"}
          className={typeLock === "expense" ? "text-white" : undefined}
          disabled={submitting}
        >
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
      <DialogContent
        className={`sm:max-w-md ${
          typeLock === "expense"
            ? "border-l-4 border-l-destructive"
            : typeLock === "transfer"
              ? "border-l-4 border-l-blue-500"
              : ""
        }`}
      >
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? "Edit transaction"
              : `Add ${
                  typeLock === "income"
                    ? "income"
                    : typeLock === "expense"
                      ? "expense"
                      : typeLock === "transfer"
                        ? "transfer"
                        : "transaction"
                }`}
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
