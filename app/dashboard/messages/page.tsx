"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NewRuleButton } from "@/components/dashboard/new-rule-button";
import { useBudget } from "@/lib/budget-store";
import { formatCurrency } from "@/lib/format-currency";
import type { InboxMessage, PendingSmsSummary } from "@/lib/sms-inbox-types";

function MessageReview({ item, busy, onAction }: {
  item: InboxMessage; busy: boolean;
  onAction: (ids: string[], action: string, edits?: object) => Promise<void>;
}) {
  const { categories } = useBudget();
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(String(item.preview?.amount ?? ""));
  const [charges, setCharges] = useState(String(item.preview?.transactionCharges ?? 0));
  const [date, setDate] = useState(item.preview?.date ?? "");
  const [categoryId, setCategoryId] = useState(item.preview?.categoryId ?? "");
  const p = item.preview;
  return <article className="rounded-xl border bg-card p-4 space-y-3">
    <div className="flex flex-wrap justify-between gap-2">
      <div><p className="font-medium">{item.sender}</p><p className="text-xs text-muted-foreground">{new Date(item.timestamp).toLocaleString()}</p></div>
      <div className="text-right"><p className="font-medium">{p ? `${p.type} · ${formatCurrency(p.amount, p.currency ?? "KES")}` : "Needs review"}</p><p className="text-xs text-muted-foreground">{item.previewStatus.replaceAll("_", " ")}</p></div>
    </div>
    <details><summary className="cursor-pointer text-sm">View message</summary><p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{item.message}</p></details>
    {item.reason && <p className="text-sm text-muted-foreground">{item.reason}</p>}
    {editing && p && <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Amount<Input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <label className="text-sm">Fees<Input type="number" min="0" step="0.01" value={charges} onChange={e => setCharges(e.target.value)} /></label>
      <label className="text-sm">Date<Input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      <label className="text-sm">Category<select className="block w-full rounded-md border bg-background p-2" value={categoryId} onChange={e => setCategoryId(e.target.value)}><option value="">Choose category</option>{categories.filter(c => c.type === p.type).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    </div>}
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy || (!p && item.previewStatus !== "duplicate")} onClick={() => onAction([item.id], "sync", editing ? { amount, transactionCharges: charges, date, categoryId } : undefined)}>{item.previewStatus === "duplicate" ? "Mark as synced" : editing ? "Save & sync" : "Sync"}</Button>
      {p && <Button variant="outline" disabled={busy} onClick={() => setEditing(!editing)}>{editing ? "Cancel edit" : "Edit"}</Button>}
      {p && <NewRuleButton disabled={busy} draft={{ ...p, categoryId, smsMessage: item.message, accountId: item.accountId ?? "" }} />}
      <Button variant="ghost" disabled={busy} onClick={() => onAction([item.id], "dismiss")}>Dismiss</Button>
    </div>
  </article>;
}

export default function MessagesPage() {
  const { selectedGroupId, refetch } = useBudget();
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [summary, setSummary] = useState<PendingSmsSummary | null>(null);
  const [sender, setSender] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sms/inbox", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load messages");
      setMessages(data.messages); setSummary(data.summary); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load messages"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void load();
    const refresh = () => { if (!busyRef.current && document.visibilityState === "visible") void load(); };
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    window.addEventListener("bajeti-rules-changed", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); window.removeEventListener("bajeti-rules-changed", refresh); };
  }, [load]);
  async function act(ids: string[], action: string, edits?: object) {
    busyRef.current = true; setBusy(true); setError(null); setNotice("");
    try {
      let done = 0; const failures: string[] = [];
      for (let i = 0; i < ids.length; i += 100) {
        const res = await fetch("/api/sms/inbox/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: ids.slice(i, i + 100), action, edits }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not process messages");
        for (const result of data.results) {
          if (result.status === "failed") failures.push(result.error); else done++;
        }
      }
      setNotice(`${done} message(s) ${action === "sync" ? "synced" : "dismissed"}.`);
      setSelected([]);
      await Promise.all([load(), refetch()]);
      if (failures.length) setError(`${failures.length} failed: ${failures[0]}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not process messages"); await load(); }
    finally { busyRef.current = false; setBusy(false); }
  }
  const filtered = messages.filter(m => !sender || m.sender === sender);
  const ready = filtered.filter(m => m.previewStatus === "ready");
  if (selectedGroupId) return <p className="p-6 text-muted-foreground">Switch to your personal workspace to review SMS messages.</p>;
  return <div className="mx-auto max-w-4xl space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">Messages</h1><p className="text-sm text-muted-foreground">SMS from watched senders on your phone. Syncing saves a transaction.</p></div><Button variant="outline" disabled={busy} onClick={() => void load()}>Refresh</Button></div>
    <p className="text-xs text-muted-foreground">Last phone upload: {summary?.lastUploadedAt ? new Date(summary.lastUploadedAt).toLocaleString() : "No uploads yet. Open Bajeti on your phone with SMS permission and select watched senders."}</p>
    {error && <p role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="sender">Sender</label><select id="sender" className="rounded-md border bg-background p-2 text-sm" value={sender} onChange={e => { setSender(e.target.value); setSelected([]); }}><option value="">All senders</option>{[...new Set(messages.map(m => m.sender))].map(s => <option key={s}>{s}</option>)}</select>
      <span className="text-sm text-muted-foreground">{filtered.length} pending</span>
      <Button disabled={busy || !ready.length} onClick={() => act(ready.map(m => m.id), "sync")}>Sync all ready ({ready.length})</Button>
      <Button variant="outline" disabled={busy || !selected.length} onClick={() => act(selected, "sync")}>Sync selected ({selected.length})</Button>
      <Button variant="ghost" disabled={busy || !selected.length} onClick={() => act(selected, "dismiss")}>Dismiss selected</Button>
    </div>
    {loading ? <p>Loading messages…</p> : !filtered.length ? <div className="rounded-xl border p-8 text-center text-muted-foreground">No pending messages. New messages appear after your phone uploads them.</div> : filtered.map(item => <div key={item.id} className="flex items-start gap-3"><input className="mt-5" type="checkbox" aria-label={`Select message from ${item.sender}`} disabled={busy} checked={selected.includes(item.id)} onChange={e => setSelected(prev => e.target.checked ? [...prev, item.id] : prev.filter(id => id !== item.id))} /><div className="min-w-0 flex-1"><MessageReview item={item} busy={busy} onAction={act} /></div></div>)}
  </div>;
}
