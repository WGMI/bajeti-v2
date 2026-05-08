"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type TransactionRowProps = {
  categoryInitial: string;
  categoryName: string;
  subtitle: string;
  dateLabel: string;
  type: "income" | "expense" | "transfer";
  amountFormatted: string;
  actions: ReactNode;
  onOpen: () => void;
};

export function TransactionRow({
  categoryInitial,
  categoryName,
  subtitle,
  dateLabel,
  type,
  amountFormatted,
  actions,
  onOpen,
}: TransactionRowProps) {
  const isIncome = type === "income";
  const isTransfer = type === "transfer";
  const avatar = (
    <div
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
        isIncome
          ? "bg-success/15 text-success"
          : isTransfer
            ? "bg-blue-500/10 text-blue-600"
            : "bg-muted text-muted-foreground"
      )}
    >
      <span className="text-sm font-medium">{categoryInitial}</span>
    </div>
  );

  const typeBadge = (
    <Badge
      variant="secondary"
      className={cn(
        "w-fit text-xs",
        isIncome
          ? "bg-success/15 text-success border-success/30"
          : isTransfer
            ? "bg-blue-500/10 text-blue-700 border-blue-500/30"
            : "bg-muted"
      )}
    >
      {isIncome ? "Income" : isTransfer ? "Transfer" : "Expense"}
    </Badge>
  );

  const amountEl = (
    <span
      className={cn(
        "block font-semibold text-right tabular-nums [overflow-wrap:anywhere]",
        isIncome ? "text-success" : isTransfer ? "text-blue-700" : "text-foreground"
      )}
    >
      {amountFormatted}
    </span>
  );

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className={cn(
        "min-w-0 max-w-full cursor-pointer rounded-r border-b border-border/50 border-l-[3px] pb-4 pl-3 pr-1 transition-colors last:border-b-0 last:pb-0 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        isIncome ? "border-l-green-500" : isTransfer ? "border-l-blue-500" : "border-l-red-500"
      )}
    >
      {/* Stacked layout: avoids horizontal squeeze from amount + long currency strings */}
      <div className="flex min-w-0 flex-col gap-3 md:hidden">
        <div className="flex min-w-0 items-start gap-3">
          {avatar}
          <div className="min-w-0 flex-1 overflow-hidden">
            <p className="truncate font-medium">{categoryName}</p>
            <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground tabular-nums">{dateLabel}</span>
              {typeBadge}
            </div>
          </div>
        </div>
        <div className="min-w-0">{amountEl}</div>
        <div
          className="flex min-w-0 flex-wrap justify-end gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          {actions}
        </div>
      </div>

      <div className="hidden min-w-0 md:grid md:grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,7rem)_5.5rem_minmax(0,6.5rem)_auto] md:items-center md:gap-x-4">
        {avatar}
        <div className="min-w-0">
          <p className="truncate font-medium">{categoryName}</p>
          <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="min-w-0 truncate text-right text-sm text-muted-foreground tabular-nums">
          {dateLabel}
        </div>
        <div className="min-w-0 self-center">{typeBadge}</div>
        <div className="min-w-0 self-center">{amountEl}</div>
        <div
          className="flex min-w-0 flex-wrap justify-end gap-1 self-center"
          onClick={(e) => e.stopPropagation()}
        >
          {actions}
        </div>
      </div>
    </li>
  );
}
