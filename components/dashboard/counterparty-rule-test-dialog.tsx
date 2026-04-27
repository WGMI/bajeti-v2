"use client";

import { useCallback, useEffect, useMemo, useState, type ComponentProps } from "react";
import { FlaskConical, Loader2 } from "lucide-react";
import type { CategoryType } from "@/lib/budget-types";
import { formatCurrencyWithSign } from "@/lib/format-currency";
import { formatDateWithPreference } from "@/lib/format-date";
import { parseSms } from "@/lib/sms-parser";
import { useSettings } from "@/lib/settings-store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type MessageRow = { id: string; date: string; amount: number; body: string };

const API = "/api";

function buildSampleAmount(counterpartyKey: string, transactionType: CategoryType): number {
  const seed = counterpartyKey
    .split("")
    .reduce((sum, char, idx) => sum + char.charCodeAt(0) * (idx + 1), 0);
  const base = 500 + (seed % 9500);
  const cents = (seed % 100) / 100;
  const amount = Math.round((base + cents) * 100) / 100;
  return transactionType === "income" ? amount : -amount;
}

function buildSampleSms(
  counterpartyLabel: string,
  transactionType: CategoryType,
  amountText: string,
  dateText: string
): string {
  if (transactionType === "income") {
    return `Confirmed. You have received ${amountText} from ${counterpartyLabel} on ${dateText}.`;
  }
  return `Confirmed. You have paid ${amountText} to ${counterpartyLabel} on ${dateText}.`;
}

export function CounterpartyRuleTestButton({
  counterpartyKey,
  counterpartyLabel,
  transactionType,
  categoryName,
  size = "sm",
  variant = "outline",
  className,
}: {
  counterpartyKey: string;
  counterpartyLabel: string;
  transactionType: CategoryType;
  categoryName: string;
  size?: ComponentProps<typeof Button>["size"];
  variant?: ComponentProps<typeof Button>["variant"];
  className?: string;
}) {
  const { currency, dateFormat } = useSettings();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matchedMessage, setMatchedMessage] = useState<MessageRow | null>(null);
  const [smsDraft, setSmsDraft] = useState("");
  const [hasCustomSms, setHasCustomSms] = useState(false);

  const loadMatchedMessage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        counterpartyKey,
        transactionType,
      });
      const res = await fetch(`${API}/counterparty-messages?${qs}`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Failed to load matching SMS");
      }
      const data = (await res.json()) as { messages?: MessageRow[] };
      setMatchedMessage(data.messages?.[0] ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load matching SMS");
      setMatchedMessage(null);
    } finally {
      setLoading(false);
    }
  }, [counterpartyKey, transactionType]);

  useEffect(() => {
    if (!open) return;
    void loadMatchedMessage();
  }, [loadMatchedMessage, open]);

  const fallbackSample = useMemo(() => {
    const amount = buildSampleAmount(counterpartyKey, transactionType);
    const rawAmount = Math.abs(amount);
    const isoDate = new Date().toISOString().slice(0, 10);
    const dateText = formatDateWithPreference(isoDate, dateFormat);
    const signedAmountText = formatCurrencyWithSign(amount, currency);
    const amountText = formatCurrencyWithSign(rawAmount, currency).replace(/^[+-]\s?/, "");
    const sms = buildSampleSms(counterpartyLabel, transactionType, amountText, dateText);
    return {
      sms,
      result: {
        amount,
        type: transactionType,
        category: categoryName,
        counterpartyKey,
        matchedRule: `${counterpartyLabel} -> ${categoryName}`,
        date: dateText,
        notes: sms,
      },
      signedAmountText,
    };
  }, [categoryName, counterpartyKey, counterpartyLabel, currency, dateFormat, transactionType]);

  const sourceSample = useMemo(() => {
    if (!matchedMessage) return fallbackSample;
    return {
      sms: matchedMessage.body,
      result: {
        amount: matchedMessage.amount,
        type: transactionType,
        category: categoryName,
        counterpartyKey,
        matchedRule: `${counterpartyLabel} -> ${categoryName}`,
        date: formatDateWithPreference(matchedMessage.date, dateFormat),
        notes: matchedMessage.body,
      },
      signedAmountText: formatCurrencyWithSign(matchedMessage.amount, currency),
    };
  }, [
    categoryName,
    counterpartyKey,
    counterpartyLabel,
    currency,
    dateFormat,
    fallbackSample,
    matchedMessage,
    transactionType,
  ]);

  useEffect(() => {
    if (!open || hasCustomSms) return;
    setSmsDraft(sourceSample.sms);
  }, [hasCustomSms, open, sourceSample.sms]);

  const parsed = useMemo(
    () =>
      parseSms(smsDraft, {
        transactionDateSource: "message",
      }),
    [smsDraft]
  );
  const typePass = parsed.type === transactionType;
  const keyPass = parsed.counterpartyKey === counterpartyKey;
  const isPassing = typePass && keyPass;
  const previewAmount = parsed.amount
    ? parsed.type === "expense"
      ? -Math.abs(parsed.amount)
      : Math.abs(parsed.amount)
    : 0;
  const previewSignedAmountText = parsed.amount
    ? formatCurrencyWithSign(previewAmount, currency)
    : "—";
  const previewDateText = parsed.date ? formatDateWithPreference(parsed.date, dateFormat) : "—";

  return (
    <>
      <Button
        type="button"
        size={size}
        variant={variant}
        className={className}
        onClick={() => {
          setHasCustomSms(false);
          setSmsDraft(sourceSample.sms);
          setOpen(true);
        }}
      >
        <FlaskConical className="h-4 w-4 shrink-0" aria-hidden />
        Test
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Rule test - {counterpartyLabel}</DialogTitle>
            <DialogDescription>
              Uses one matching SMS from your transactions when available, otherwise uses a
              generated sample.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
                Looking up matching SMS...
              </div>
            ) : null}
            {error ? (
              <p className="text-xs text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Test SMS</p>
              <textarea
                value={smsDraft}
                onChange={(event) => {
                  setHasCustomSms(true);
                  setSmsDraft(event.target.value);
                }}
                rows={5}
                className="flex min-h-[110px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="Edit this SMS text to test different scenarios"
              />
              <p className="text-[11px] text-muted-foreground">
                {matchedMessage
                  ? "Loaded from a matching transaction note. Edit to test more scenarios."
                  : "No matching transaction note found, using generated sample. Edit to test more scenarios."}
              </p>
            </div>
            <div className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-2">
              <p
                className={`text-xs font-semibold ${
                  isPassing ? "text-emerald-600" : "text-amber-600"
                }`}
              >
                {isPassing ? "PASS: SMS matches this rule" : "FAIL: SMS does not match this rule"}
              </p>
              {!isPassing ? (
                <div className="text-[11px] text-muted-foreground space-y-0.5">
                  <p>Type check: {typePass ? "pass" : `fail (got ${parsed.type})`}</p>
                  <p>
                    Counterparty key check:{" "}
                    {keyPass ? "pass" : `fail (got ${parsed.counterpartyKey ?? "none"})`}
                  </p>
                </div>
              ) : null}
              <p className="text-xs font-medium text-muted-foreground">Resulting transaction</p>
              <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Amount</dt>
                <dd className="font-medium">{previewSignedAmountText}</dd>
                <dt className="text-muted-foreground">Type</dt>
                <dd className="capitalize">{parsed.type}</dd>
                <dt className="text-muted-foreground">Category</dt>
                <dd>{isPassing ? categoryName : "No category (rule not matched)"}</dd>
                <dt className="text-muted-foreground">Matched key</dt>
                <dd>{parsed.counterpartyKey ?? "—"}</dd>
                <dt className="text-muted-foreground">Expected key</dt>
                <dd>{counterpartyKey}</dd>
                <dt className="text-muted-foreground">Date</dt>
                <dd>{previewDateText}</dd>
              </dl>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
