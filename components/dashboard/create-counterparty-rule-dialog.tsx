"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { useBudget } from "@/lib/budget-store";
import type { Transaction } from "@/lib/budget-types";
import { effectiveCounterpartyFromTransaction } from "@/lib/effective-counterparty-from-transaction";
import {
  extractSmsAccountReference,
  makeScopedCounterpartyKey,
  normalizeSmsCounterpartyKey,
} from "@/lib/sms-parser";

const API = "/api";

export function CreateCounterpartyRuleDialog({
  transaction,
  open,
  onOpenChange,
}: {
  transaction: Transaction | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { categories, refetch } = useBudget();
  const [keyDraft, setKeyDraft] = useState("");
  const [scope, setScope] = useState<"all" | "account">("all");
  const [accountRefDraft, setAccountRefDraft] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !transaction) return;
    const eff = effectiveCounterpartyFromTransaction(
      transaction.notes,
      transaction.type,
      transaction.smsCounterpartyKey,
      transaction.smsCounterparty
    );
    // Prefill with readable label; server normalizes on save.
    setKeyDraft(eff?.label ?? eff?.key ?? "");
    const detectedAccountRef = extractSmsAccountReference(transaction.notes);
    setScope(detectedAccountRef ? "account" : "all");
    setAccountRefDraft(detectedAccountRef ?? "");
    setCategoryId(transaction.categoryId);
    setError(null);
  }, [open, transaction]);

  const txType = transaction?.type;
  const typeCats = txType ? categories.filter((c) => c.type === txType) : [];

  const handleSave = async () => {
    if (!transaction || !txType) return;
    const key = normalizeSmsCounterpartyKey(keyDraft.trim());
    const accountRef = accountRefDraft.trim();
    if (scope === "account" && accountRef.length < 3) {
      setError("Enter an account reference with at least 3 characters.");
      return;
    }
    if (!key) {
      setError(
        "Enter a payee or payer name (letters or words — phone numbers are stripped when matching)."
      );
      return;
    }
    if (!categoryId || !typeCats.some((c) => c.id === categoryId)) {
      setError("Choose a category.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const trimmed = keyDraft.trim();
      const counterpartyLabel =
        trimmed.length > 0 ? trimmed : key.replace(/\b\w/g, (c) => c.toUpperCase());
      const ruleKey = scope === "account" ? makeScopedCounterpartyKey(key, accountRef) : key;
      const res = await fetch(`${API}/counterparty-rules`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          counterpartyKey: ruleKey,
          counterpartyLabel,
          transactionType: txType,
          categoryId,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to save rule");
      }
      await refetch();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save rule");
    } finally {
      setSaving(false);
    }
  };

  if (!transaction) return null;

  const typeLabel =
    transaction.type === "income"
      ? "income"
      : transaction.type === "expense"
        ? "expense"
        : "transfer";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create SMS category rule</DialogTitle>
          <p className="text-sm text-muted-foreground font-normal pt-1">
            Future imports and matching past {typeLabel} transactions for this payee or payer will
            use the category you choose.
          </p>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-2">
            <Label htmlFor="rule-counterparty">Payee / payer match</Label>
            <Input
              id="rule-counterparty"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="Name as it appears in SMS (e.g. merchant or sender)"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Text is normalized the same way as SMS parsing (lowercase, spacing). Must be at least
              2 characters after normalization.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="rule-scope">Scope</Label>
            <Select value={scope} onValueChange={(value) => setScope(value as "all" | "account")}>
              <SelectTrigger id="rule-scope">
                <span className="truncate">
                  {scope === "all" ? "All counterparty transactions" : "This account only"}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All counterparty transactions</SelectItem>
                <SelectItem value="account">This account only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {scope === "account" ? (
            <div className="space-y-2">
              <Label htmlFor="rule-account-ref">Account reference</Label>
              <Input
                id="rule-account-ref"
                value={accountRefDraft}
                onChange={(e) => setAccountRefDraft(e.target.value)}
                placeholder="e.g. 2049842670"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Rule will only match this counterparty when SMS contains this account reference.
              </p>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="rule-category">Category</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="rule-category">
                <span className="truncate">
                  {typeCats.find((c) => c.id === categoryId)?.name ?? "Choose category"}
                </span>
              </SelectTrigger>
              <SelectContent>
                {typeCats.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter className="gap-2 sm:justify-between flex-col sm:flex-row sm:space-x-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground sm:mr-auto"
            disabled={saving}
            onClick={() => router.push("/dashboard/rules")}
          >
            All rules
          </Button>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleSave()} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                "Save rule"
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
