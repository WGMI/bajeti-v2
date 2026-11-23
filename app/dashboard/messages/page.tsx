"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NewRuleButton } from "@/components/dashboard/new-rule-button";
import { useBudget } from "@/lib/budget-store";
import { formatCurrency } from "@/lib/format-currency";
import type { CategoryType } from "@/lib/budget-types";
import type { InboxMessage, InboxPreview, PendingSmsSummary } from "@/lib/sms-inbox-types";
import type { SmsImportEdits } from "@/lib/sms-import-service";

type MessageAction = (ids: string[], action: "sync" | "dismiss", edits?: SmsImportEdits) => Promise<string | null>;
const selectClass = "block h-9 w-full rounded-md border bg-background px-2 text-sm";

function PreviewForm({ item, preview, busy, onClose, onAction }: {
  item: InboxMessage;
  preview: InboxPreview;
  busy: boolean;
  onClose: () => void;
  onAction: MessageAction;
}) {
  const { accounts, categories, getDefaultAccount } = useBudget();
  const defaultAccountId = getDefaultAccount()?.id ?? "";
  const senderAccountId = accounts.find(account => account.id === item.accountId)?.id ?? defaultAccountId;
  const [type, setType] = useState(preview.type);
  const [amount, setAmount] = useState(String(preview.amount));
  const [charges, setCharges] = useState(String(preview.transactionCharges ?? 0));
  const [date, setDate] = useState(preview.date);
  const [categoryId, setCategoryId] = useState(preview.categoryId ?? "");
  const [fromAccountId, setFromAccountId] = useState(senderAccountId);
  const suggestedDestination = accounts.find(account => account.id === preview.transferToAccountId)?.id ?? defaultAccountId;
  const [toAccountId, setToAccountId] = useState(suggestedDestination !== senderAccountId ? suggestedDestination : "");
  const [notes, setNotes] = useState(preview.notes);
  const [error, setError] = useState<string | null>(null);
  const isTransfer = type === "transfer";
  const transferReady = Boolean(fromAccountId && toAccountId && fromAccountId !== toAccountId);
  const matchingCategories = categories.filter(category => category.type === type);

  return <form className="space-y-4" onSubmit={async event => {
    event.preventDefault();
    const failure = await onAction([item.id], "sync", {
      type, amount: Number(amount), transactionCharges: isTransfer ? 0 : Number(charges), date, categoryId, notes,
      ...(isTransfer ? { fromAccountId, toAccountId } : {}),
    });
    if (failure) setError(failure);
    else onClose();
  }}>
    <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-sm">Type
        <select className={selectClass} value={type} onChange={event => {
          const nextType = event.target.value as CategoryType;
          setType(nextType);
          setCategoryId(nextType === preview.type ? preview.categoryId ?? "" : "");
        }}>
          <option value="expense">Expense</option>
          <option value="income">Income</option>
          <option value="transfer">Transfer</option>
        </select>
      </label>
      <label className="space-y-1 text-sm">Amount ({preview.currency ?? "KES"})
        <Input required type="number" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} />
      </label>
      <label className="space-y-1 text-sm">Date
        <Input required type="date" value={date} onChange={event => setDate(event.target.value)} />
      </label>
      <label className="space-y-1 text-sm">Category
        <select required className={selectClass} value={categoryId} onChange={event => setCategoryId(event.target.value)}>
          <option value="">Choose a category</option>
          {matchingCategories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
      </label>
      {isTransfer ? <>
        <label className="space-y-1 text-sm">From account
          <select required className={selectClass} value={fromAccountId} onChange={event => setFromAccountId(event.target.value)}>
            <option value="">Choose an account</option>
            {accounts.filter(account => account.id !== toAccountId).map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">To account
          <select required className={selectClass} value={toAccountId} onChange={event => setToAccountId(event.target.value)}>
            <option value="">Choose an account</option>
            {accounts.filter(account => account.id !== fromAccountId).map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
        </label>
        {!transferReady && <p className="text-sm text-muted-foreground sm:col-span-2">Choose two different accounts for the transfer.</p>}
      </> : <label className="space-y-1 text-sm">Transaction fees
        <Input type="number" min="0" step="0.01" value={charges} onChange={event => setCharges(event.target.value)} />
      </label>}
      <label className="space-y-1 text-sm sm:col-span-2">Notes
        <textarea rows={2} className="block w-full rounded-md border bg-background p-2" value={notes} onChange={event => setNotes(event.target.value)} />
      </label>
    </fieldset>
    <div className="space-y-1">
      <h3 className="text-sm font-medium">Original SMS</h3>
      <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 text-sm">{item.message}</p>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <DialogFooter className="gap-2">
      <NewRuleButton disabled={busy} draft={{ ...preview, type, categoryId, notes, accountId: isTransfer ? fromAccountId : senderAccountId, counterAccountId: isTransfer ? toAccountId : null, smsMessage: item.message }} />
      <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
      <Button type="submit" disabled={busy || !matchingCategories.some(category => category.id === categoryId) || (isTransfer && !transferReady)}>
        {busy ? "Saving…" : "Save & sync"}
      </Button>
    </DialogFooter>
  </form>;
}

function MessageReview({ item, busy, onAction }: {
  item: InboxMessage; busy: boolean;
  onAction: MessageAction;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const p = item.preview;
  return <article className="rounded-xl border bg-card p-4 space-y-3">
    <div className="flex flex-wrap justify-between gap-2">
      <p className="text-xs text-muted-foreground">{new Date(item.timestamp).toLocaleString()}</p>
      <div className="text-right"><p className="font-medium">{p ? `${p.type} · ${formatCurrency(p.amount, p.currency ?? "KES")}` : "Needs review"}</p><p className="text-xs text-muted-foreground">{item.previewStatus.replaceAll("_", " ")}</p></div>
    </div>
    <details><summary className="cursor-pointer text-sm">View message</summary><p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{item.message}</p></details>
    {item.reason && <p className="text-sm text-muted-foreground">{item.reason}</p>}
    <div className="flex flex-wrap gap-2">
      {p && <Dialog open={previewOpen} onOpenChange={open => { if (!busy) setPreviewOpen(open); }}>
        <DialogTrigger asChild><Button disabled={busy}>Preview transaction</Button></DialogTrigger>
        <DialogContent showClose={!busy}>
          <DialogHeader>
            <DialogTitle>Review transaction</DialogTitle>
            <DialogDescription>Review the details parsed from the SMS from {item.sender} before saving.</DialogDescription>
          </DialogHeader>
          {previewOpen && <PreviewForm item={item} preview={p} busy={busy} onAction={onAction} onClose={() => setPreviewOpen(false)} />}
        </DialogContent>
      </Dialog>}
      <Button variant="ghost" disabled={busy} onClick={() => onAction([item.id], "dismiss")}>Dismiss</Button>
    </div>
  </article>;
}

export default function MessagesPage() {
  const { selectedGroupId, refetch } = useBudget();
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [summary, setSummary] = useState<PendingSmsSummary | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const loadVersion = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      const res = await fetch("/api/sms/inbox", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load messages");
      if (version !== loadVersion.current) return;
      const pendingMessages = (data.messages as InboxMessage[]).filter(message => message.status === "pending");
      const pendingIds = new Set(pendingMessages.map(message => message.id));
      setMessages(pendingMessages); setSummary(data.summary); setError(null);
      setSelected(prev => prev.filter(id => pendingIds.has(id)));
    } catch (e) {
      if (version === loadVersion.current) setError(e instanceof Error ? e.message : "Could not load messages");
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const requestVersion = loadVersion;
    void load();
    const refresh = () => { if (!busyRef.current && document.visibilityState === "visible") void load(); };
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    window.addEventListener("bajeti-rules-changed", refresh);
    return () => {
      requestVersion.current++;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("bajeti-rules-changed", refresh);
    };
  }, [load]);
  const act: MessageAction = async (ids, action, edits) => {
    if (busyRef.current) return "Another message action is in progress";
    loadVersion.current++;
    busyRef.current = true; setBusy(true); setError(null); setNotice("");
    let done = 0;
    const failures: string[] = [];
    try {
      for (let i = 0; i < ids.length; i += 100) {
        const res = await fetch("/api/sms/inbox/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: ids.slice(i, i + 100), action, edits }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not process messages");
        const removed = new Set<string>();
        for (const result of data.results as { id: string; status: string; error?: string }[]) {
          if (result.status === "failed") failures.push(result.error ?? "Could not process message");
          if (result.status === "synced" || result.status === "dismissed") removed.add(result.id);
        }
        done += removed.size;
        setMessages(current => current.filter(message => !removed.has(message.id)));
        setSelected(current => current.filter(id => !removed.has(id)));
      }
    } catch (e) {
      failures.push(e instanceof Error ? e.message : "Could not process messages");
    } finally {
      await Promise.allSettled([load(), ...(action === "sync" ? [refetch()] : [])]);
      busyRef.current = false;
      setBusy(false);
    }
    if (done) setNotice(`${done} ${done === 1 ? "message" : "messages"} ${action === "sync" ? "synced" : "dismissed"}.`);
    const failure = failures.length > 1 ? `${failures.length} failed. ${failures[0]}` : failures[0] ?? null;
    if (failure) setError(failure);
    return failure;
  };
  const messagesBySender = new Map<string, InboxMessage[]>();
  for (const message of messages) {
    const group = messagesBySender.get(message.sender);
    if (group) group.push(message);
    else messagesBySender.set(message.sender, [message]);
  }
  const ready = messages.filter(m => m.previewStatus === "ready");
  const selectedReady = ready.filter(message => selected.includes(message.id));
  if (selectedGroupId) return <p className="p-6 text-muted-foreground">Switch to your personal workspace to review SMS messages.</p>;
  return <div className="mx-auto max-w-4xl space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">Messages</h1><p className="text-sm text-muted-foreground">SMS from watched senders on your phone. Syncing saves a transaction.</p></div><Button variant="outline" disabled={busy} onClick={() => void load()}>Refresh</Button></div>
    <p className="text-xs text-muted-foreground">Last phone upload: {summary?.lastUploadedAt ? new Date(summary.lastUploadedAt).toLocaleString() : "No uploads yet. Open Bajeti on your phone with SMS permission and select watched senders."}</p>
    {error && <p role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">{messages.length} pending</span>
      <Button disabled={busy || !ready.length} onClick={() => act(ready.map(m => m.id), "sync")}>Sync all ready ({ready.length})</Button>
      <Button variant="outline" disabled={busy || !selectedReady.length} onClick={() => act(selectedReady.map(m => m.id), "sync")}>Sync selected ready ({selectedReady.length})</Button>
      <Button variant="ghost" disabled={busy || !selected.length} onClick={() => act(selected, "dismiss")}>Dismiss selected</Button>
    </div>
    {loading ? <p>Loading messages…</p> : !messages.length ? (
      <div className="rounded-xl border p-8 text-center text-muted-foreground">No pending messages. New messages appear after your phone uploads them.</div>
    ) : Array.from(messagesBySender, ([sender, items]) => {
      const senderReady = items.filter(message => message.previewStatus === "ready");
      return (
        <section key={sender} className="space-y-3 rounded-xl border p-4">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="break-words text-base font-semibold">{sender}</h2>
              <p className="text-sm text-muted-foreground">{items.length} pending</p>
            </div>
            {senderReady.length > 0 && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => act(senderReady.map(message => message.id), "sync")}>
                Sync ready ({senderReady.length})
              </Button>
            )}
          </header>
          {items.map(item => (
            <div key={item.id} className="flex items-start gap-3">
              <input
                className="mt-5"
                type="checkbox"
                aria-label={`Select message from ${sender} on ${new Date(item.timestamp).toLocaleString()}`}
                disabled={busy}
                checked={selected.includes(item.id)}
                onChange={e => {
                  const checked = e.target.checked;
                  setSelected(prev => checked ? [...prev, item.id] : prev.filter(id => id !== item.id));
                }}
              />
              <div className="min-w-0 flex-1"><MessageReview item={item} busy={busy} onAction={act} /></div>
            </div>
          ))}
        </section>
      );
    })}
  </div>;
}
