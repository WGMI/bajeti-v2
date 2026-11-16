"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CreateCounterpartyRuleDialog } from "./create-counterparty-rule-dialog";
import type { Transaction } from "@/lib/budget-types";

export function NewRuleButton({ draft, disabled }: { draft: Partial<Transaction>; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const transaction: Transaction = { id: "draft", amount: 0, date: "", notes: "", accountId: "", categoryId: "", type: "expense", ...draft };
  return <>
    <Button type="button" variant="outline" disabled={disabled} onClick={() => setOpen(true)}>New rule</Button>
    <CreateCounterpartyRuleDialog transaction={transaction} open={open} onOpenChange={setOpen} />
  </>;
}
