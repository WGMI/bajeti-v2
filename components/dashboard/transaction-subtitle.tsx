"use client";

import { Wallet } from "lucide-react";
import type { Transaction } from "@/lib/budget-types";
import { cn } from "@/lib/utils";

type TransactionSubtitleProps = {
  transaction: Transaction;
  /** Shown after account when not a transfer (e.g. notes or formatted date). */
  secondary?: string;
  showAddedBy?: boolean;
};

function AccountLabel({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1 overflow-hidden", className)}>
      <Wallet className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="truncate">{name}</span>
    </span>
  );
}

function memberLabel(userId: string | null | undefined) {
  return userId || "Unknown member";
}

export function TransactionSubtitle({
  transaction,
  secondary,
  showAddedBy = false,
}: TransactionSubtitleProps) {
  const accountLabel = transaction.accountName ?? "Account";
  const addedBy = showAddedBy
    ? `Added by ${memberLabel(transaction.addedByName ?? transaction.addedByUserId ?? transaction.userId)}`
    : null;

  if (transaction.type === "transfer" && transaction.counterAccountName) {
    return (
      <span className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5">
        <AccountLabel name={accountLabel} className="max-w-[min(100%,9rem)] shrink-0" />
        <span className="shrink-0 text-muted-foreground" aria-hidden>
          →
        </span>
        <AccountLabel
          name={transaction.counterAccountName}
          className="max-w-[min(100%,9rem)] shrink-0"
        />
        {addedBy ? (
          <span className="min-w-0 truncate text-muted-foreground">· {addedBy}</span>
        ) : null}
      </span>
    );
  }

  const tail = [secondary ?? (transaction.notes || transaction.date), addedBy]
    .filter(Boolean)
    .join(" · ");
  if (!transaction.accountName && !tail) return null;

  return (
    <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
      {transaction.accountName ? (
        <AccountLabel
          name={transaction.accountName}
          className="max-w-[min(100%,11rem)] shrink-0"
        />
      ) : null}
      {transaction.accountName && tail ? (
        <span className="min-w-0 flex-1 truncate text-muted-foreground">· {tail}</span>
      ) : tail ? (
        <span className="min-w-0 truncate">{tail}</span>
      ) : null}
    </span>
  );
}
