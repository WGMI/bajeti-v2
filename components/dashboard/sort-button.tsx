"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SortDirection } from "@/lib/sort-utils";

type SortButtonProps<T extends string> = {
  column: T;
  label: string;
  activeColumn: T;
  direction: SortDirection;
  onSort: (column: T) => void;
  className?: string;
};

export function SortButton<T extends string>({
  column,
  label,
  activeColumn,
  direction,
  onSort,
  className,
}: SortButtonProps<T>) {
  const isActive = activeColumn === column;
  const Icon = isActive ? (direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn(
        "h-7 min-w-0 justify-start gap-1 px-2 text-xs font-medium text-muted-foreground hover:text-foreground",
        isActive && "text-foreground",
        className
      )}
      aria-sort={isActive ? (direction === "asc" ? "ascending" : "descending") : "none"}
      onClick={() => onSort(column)}
    >
      <span className="truncate">{label}</span>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
    </Button>
  );
}
