"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useBudget } from "@/lib/budget-store";
import { useEffectiveCurrency } from "@/lib/use-effective-currency";
import { formatCurrency } from "@/lib/format-currency";
import type { PendingSmsSummary } from "@/lib/sms-inbox-types";

export function PendingBalanceCard() {
  const { selectedGroupId, transactions } = useBudget();
  const currency = useEffectiveCurrency();
  const [data, setData] = useState<{ saved: number; pending: PendingSmsSummary } | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (selectedGroupId) return;
    let active = true;
    async function refresh() {
      try {
        const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
        const inbox = await fetch(`/api/sms/inbox?summary=1&month=${month}`, { cache: "no-store" });
        if (!inbox.ok) throw new Error();
        const pending = (await inbox.json()).summary;
        const saved = pending.savedBalance;
        if (active) { setData({ saved, pending }); setUnavailable(false); }
      } catch { if (active) setUnavailable(true); }
    }
    void refresh();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 30000);
    window.addEventListener("focus", refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [selectedGroupId, transactions]);
  if (selectedGroupId) return null;
  return <div className="rounded-xl border bg-card p-5">
    <p className="text-sm text-muted-foreground">This month’s balance</p>
    <p className="text-2xl font-semibold">{data ? formatCurrency(data.saved, currency) : "—"}</p>
    <Link href="/dashboard/messages" className="mt-1 block text-xs text-muted-foreground hover:underline">
      {unavailable ? "Pending SMS preview unavailable · Open messages" : data ? `Preview: ${formatCurrency(data.saved + data.pending.balance, currency)} · includes ${data.pending.count} unsynced messages${data.pending.needsReview ? ` · ${data.pending.needsReview} need review` : ""}` : "Loading SMS preview…"}
    </Link>
    {data?.pending.lastUploadedAt && <p className="mt-1 text-xs text-muted-foreground">Phone last uploaded {new Date(data.pending.lastUploadedAt).toLocaleString()}</p>}
  </div>;
}
