"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useBudget } from "@/lib/budget-store";
import type { CategoryType, Transaction } from "@/lib/budget-types";
import { candidateCounterpartyRuleKeys } from "@/lib/sms-parser";

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
  categories: { id: string; type: string }[],
  defaultAccountId: string
) {
  if (editingTransaction) {
    const isPairedTransfer =
      editingTransaction.type === "transfer" && editingTransaction.transferGroupId;
    let fromAccountId = editingTransaction.accountId;
    let toAccountId = editingTransaction.counterAccountId ?? "";
    if (isPairedTransfer && editingTransaction.transferLeg === "in") {
      fromAccountId = editingTransaction.counterAccountId ?? fromAccountId;
      toAccountId = editingTransaction.accountId;
    }
    const charges = editingTransaction.transactionCharges ?? 0;
    return {
      amount: String(Math.abs(editingTransaction.amount)),
      transactionCharges: charges > 0 ? String(charges) : "",
      showTransactionCharges: charges > 0,
      categoryId: editingTransaction.categoryId,
      type: editingTransaction.type,
      date: editingTransaction.date.slice(0, 10),
      notes: editingTransaction.notes,
      accountId: editingTransaction.accountId,
      fromAccountId,
      toAccountId,
    };
  }
  const firstOfType = typeLock
    ? categories.find((c) => c.type === typeLock)?.id ?? ""
    : "";
  return {
    amount: "",
    transactionCharges: "",
    showTransactionCharges: false,
    categoryId: firstOfType,
    type: typeLock ?? "expense",
    date: new Date().toISOString().slice(0, 10),
    notes: "",
    accountId: defaultAccountId,
    fromAccountId: defaultAccountId,
    toAccountId: "",
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
  const {
    accounts,
    categories,
    transactions,
    addTransaction,
    updateTransaction,
    getCategoryById,
    getDefaultAccount,
    refetch,
  } = useBudget();
  const defaultAccount = getDefaultAccount();
  const isEdit = !!editingTransaction;
  const typeLock = initialType ?? editingTransaction?.type ?? null;

  const initial = getInitialValues(
    editingTransaction,
    typeLock,
    categories,
    defaultAccount?.id ?? ""
  );
  const [amount, setAmount] = useState(initial.amount);
  const [transactionCharges, setTransactionCharges] = useState(initial.transactionCharges);
  const [showTransactionCharges, setShowTransactionCharges] = useState(
    initial.showTransactionCharges
  );
  const [categoryId, setCategoryId] = useState(initial.categoryId);
  const [type, setType] = useState<CategoryType>(initial.type);
  const [date, setDate] = useState(initial.date);
  const [notes, setNotes] = useState(initial.notes);
  const [accountId, setAccountId] = useState(initial.accountId);
  const [fromAccountId, setFromAccountId] = useState(initial.fromAccountId);
  const [toAccountId, setToAccountId] = useState(initial.toAccountId);
  const isTransferForm = (isEdit ? type : typeLock) === "transfer";
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState("");

  const selectedCategory = categoryId ? getCategoryById(categoryId) : null;
  const effectiveType = isEdit ? type : (selectedCategory?.type ?? typeLock ?? type);
  const relevantCategories = categories.filter((c) => c.type === effectiveType);
  const normalizedCategoryQuery = categoryQuery.trim().toLowerCase();
  const filteredCategories = normalizedCategoryQuery
    ? relevantCategories.filter((c) => c.name.toLowerCase().includes(normalizedCategoryQuery))
    : relevantCategories;

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

    let previewData: {
      status: string;
      reason?: string | null;
      parsed?: {
        message: string;
        type: CategoryType | "neither";
        amount: number;
        currency: string | null;
        date: string;
        charges: number;
        transactionRef: string | null;
        counterparty: string | null;
        counterpartyKey: string | null;
      };
      preview?: {
        amount: number;
        date: string;
        type: CategoryType;
      } | null;
      smsIdempotencyKey?: string | null;
    };

    try {
      const res = await fetch("/api/sms/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ message: trimmed }),
      });
      if (!res.ok) {
        setSmsParseFeedback("Could not parse this SMS. Please try again.");
        return;
      }
      previewData = await res.json();
    } catch {
      setSmsParseFeedback("Could not parse this SMS. Please try again.");
      return;
    }

    const result = previewData.parsed;
    const preview = previewData.preview;
    if (previewData.status === "ignored" || !result || !preview) {
      setSmsParseFeedback(
        previewData.reason ??
          "This SMS did not look like an income, expense, or transfer transaction."
      );
      setSmsIdempotencyKey(null);
      return;
    }

    setNotes(result.message);
    setAmount(String(preview.amount));
    setDate(preview.date);
    setSmsIdempotencyKey(previewData.smsIdempotencyKey ?? null);
    if (result.charges > 0) {
      setShowTransactionCharges(true);
      setTransactionCharges(String(result.charges));
    }
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
        } catch {}
      }

      const firstOfType = categories.find((c) => c.type === result.type)?.id ?? null;
      const matchedCategory = matchedCategoryId
        ? categories.find((c) => c.id === matchedCategoryId)
        : null;
      const categoryFromSms = matchedCategoryId ?? firstOfType;
      if (categoryFromSms) {
        setCategoryId(categoryFromSms);
        const nextType = matchedCategory?.type ?? (isEdit ? result.type : null);
        if (nextType) setType(nextType);
      }
    } else {
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
    const chargesNum =
      !isTransferForm && showTransactionCharges
        ? parseFloat(transactionCharges)
        : 0;
    if (
      !isTransferForm &&
      showTransactionCharges &&
      (Number.isNaN(chargesNum) || chargesNum < 0)
    ) {
      setSubmitError("Enter a valid transaction charges amount.");
      return;
    }
    const category = getCategoryById(categoryId);
    if (!category) return;
    const txType = isEdit ? type : category.type;
    setSubmitError(null);
    setSubmitMessage(null);
    setSubmitting(true);
    try {
      if (isTransferForm) {
        if (!fromAccountId || !toAccountId || fromAccountId === toAccountId) {
          setSubmitError("Choose two different accounts for the transfer.");
          return;
        }
      }

      if (isEdit && editingTransaction) {
        const updated = await updateTransaction(editingTransaction.id, {
          amount: num,
          categoryId,
          date,
          notes,
          type: txType,
          transactionCharges: isTransferForm ? 0 : showTransactionCharges ? chargesNum : 0,
          ...(isTransferForm
            ? { fromAccountId, toAccountId }
            : { accountId: accountId || defaultAccount?.id }),
        });
        onUpdated?.(updated);
        if (updated.transferGroupId) {
          await refetch();
        }
      } else {
        const created = await addTransaction({
          amount: num,
          categoryId,
          date,
          notes,
          type: txType,
          idempotencyKey: smsIdempotencyKey ?? undefined,
          transactionCharges: isTransferForm ? 0 : showTransactionCharges ? chargesNum : 0,
          ...(isTransferForm
            ? { fromAccountId, toAccountId }
            : { accountId: accountId || defaultAccount?.id }),
        });
        if (created.status === "duplicate") {
          setSubmitMessage(
            created.message ?? "Duplicate SMS ignored: this transaction is already saved."
          );
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
          ...(accountId || defaultAccount?.id
            ? { accountId: accountId || defaultAccount?.id }
            : {}),
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
      {isTransferForm ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="from-account">From account</Label>
            <Select value={fromAccountId} onValueChange={setFromAccountId}>
              <SelectTrigger id="from-account">
                {accounts.find((a) => a.id === fromAccountId)?.name ?? "Select account"}
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                    {a.isDefault ? " (default)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="to-account">To account</Label>
            <Select value={toAccountId} onValueChange={setToAccountId}>
              <SelectTrigger id="to-account">
                {accounts.find((a) => a.id === toAccountId)?.name ?? "Select account"}
              </SelectTrigger>
              <SelectContent>
                {accounts
                  .filter((a) => a.id !== fromAccountId)
                  .map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                      {a.isDefault ? " (default)" : ""}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="account">Account</Label>
          <Select value={accountId} onValueChange={setAccountId}>
            <SelectTrigger id="account">
              {accounts.find((a) => a.id === accountId)?.name ?? "Wallet"}
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                  {a.isDefault ? " (default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
      {!isTransferForm && (
        <div className="space-y-3 rounded-md border bg-muted/20 px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="transaction-charges-switch" className="cursor-pointer">
              Transaction charges
            </Label>
            <Switch
              id="transaction-charges-switch"
              checked={showTransactionCharges}
              onCheckedChange={(checked) => {
                setShowTransactionCharges(checked);
                if (!checked) setTransactionCharges("");
              }}
            />
          </div>
          {showTransactionCharges && (
            <div className="space-y-2">
              <Label htmlFor="transaction-charges">Charges amount</Label>
              <Input
                id="transaction-charges"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={transactionCharges}
                onChange={(e) => setTransactionCharges(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Fees such as M-PESA transaction costs, stored separately from the principal amount.
              </p>
            </div>
          )}
        </div>
      )}
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
        <Button
          id="category"
          type="button"
          variant="outline"
          className="w-full justify-between"
          onClick={() => {
            setCategoryQuery("");
            setCategoryPickerOpen(true);
          }}
        >
          <span className="truncate">
            {categoryId
              ? getCategoryById(categoryId)?.name ?? "Select category"
              : "Select category"}
          </span>
          <span className="text-xs text-muted-foreground">Choose</span>
        </Button>
        <Dialog open={categoryPickerOpen} onOpenChange={setCategoryPickerOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Select category</DialogTitle>
              <DialogDescription>
                Pick a {effectiveType} category for this transaction.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="category-search">Search categories</Label>
              <Input
                id="category-search"
                placeholder="Type category name..."
                value={categoryQuery}
                onChange={(e) => setCategoryQuery(e.target.value)}
              />
            </div>
            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {filteredCategories.length > 0 ? (
                filteredCategories.map((c) => (
                  <Button
                    key={c.id}
                    type="button"
                    variant={c.id === categoryId ? "default" : "outline"}
                    className="w-full justify-start"
                    onClick={() => {
                      setCategoryId(c.id);
                      setCategoryPickerOpen(false);
                    }}
                  >
                    {c.name}
                  </Button>
                ))
              ) : normalizedCategoryQuery ? (
                <p className="text-sm text-muted-foreground">
                  No {effectiveType} category matches "{categoryQuery}".
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No categories found for {effectiveType}. Create one first.
                </p>
              )}
            </div>
          </DialogContent>
        </Dialog>
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
