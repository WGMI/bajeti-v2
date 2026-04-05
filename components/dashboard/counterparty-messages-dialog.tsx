"use client";

import { useCallback, useEffect, useState, type ComponentProps } from "react";
import { MessageSquareText, Loader2 } from "lucide-react";
import type { CategoryType } from "@/lib/budget-types";
import { useSettings } from "@/lib/settings-store";
import { formatCurrencyWithSign } from "@/lib/format-currency";
import { formatDateWithPreference } from "@/lib/format-date";
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

export function CounterpartyMessagesButton({
  counterpartyKey,
  transactionType,
  dialogTitle,
  variant = "outline",
  size = "sm",
  className,
}: {
  counterpartyKey: string;
  transactionType: CategoryType;
  /** Shown in the dialog title (e.g. display label for the payee). */
  dialogTitle: string;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  className?: string;
}) {
  const { currency, dateFormat } = useSettings();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);

  const load = useCallback(async () => {
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
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to load messages");
      }
      const data = await res.json() as { messages?: MessageRow[] };
      setMessages(data.messages ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load messages");
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [counterpartyKey, transactionType]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        onClick={() => setOpen(true)}
      >
        <MessageSquareText className="h-4 w-4 shrink-0" aria-hidden />
        Messages
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Sample SMS — {dialogTitle}</DialogTitle>
            <DialogDescription>
              Up to five recent transaction notes that match this payee or payer — type:{" "}
              {transactionType}.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[min(50vh,24rem)] space-y-3 overflow-y-auto pr-1">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
                Loading…
              </div>
            ) : error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No matching SMS text found. Messages must still be stored in the transaction notes.
              </p>
            ) : (
              messages.map((m) => (
                <div key={m.id} className="rounded-md border border-border/60 bg-muted/30 p-3 space-y-1.5">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                    <span className="font-medium tabular-nums text-foreground">
                      {formatCurrencyWithSign(m.amount, currency)}
                    </span>
                    <span>{formatDateWithPreference(m.date, dateFormat)}</span>
                  </div>
                  <pre className="whitespace-pre-wrap break-words font-sans text-xs text-foreground leading-relaxed">
                    {m.body}
                  </pre>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
