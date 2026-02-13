"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CategoryType } from "@/lib/budget-types";
import { TransactionFormDialog } from "./transaction-form-dialog";

export function GlobalAddTransactionDialog() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const addParam = searchParams.get("add");
  const isAddTransaction =
    addParam === "income" || addParam === "expense";
  const initialType: CategoryType | null = isAddTransaction ? addParam : null;

  const open = isAddTransaction;

  const onOpenChange = (open: boolean) => {
    if (!open) {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.delete("add");
      const q = params.toString();
      router.replace(q ? `${pathname}?${q}` : pathname);
    }
  };

  return (
    <TransactionFormDialog
      open={open}
      onOpenChange={onOpenChange}
      editingTransaction={null}
      initialType={initialType}
    />
  );
}
