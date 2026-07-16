"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Mic, MicOff, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { useBudget } from "@/lib/budget-store";
import type { CategoryType } from "@/lib/budget-types";
import type { VoiceTransactionParseResult } from "@/lib/voice-transaction-parser";

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<{
    isFinal?: boolean;
    0?: { transcript?: string };
  }>;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

function typeLabel(type: CategoryType | undefined) {
  if (type === "income") return "Income";
  if (type === "transfer") return "Transfer";
  return "Expense";
}

export function GlobalVoiceTransactionDialog() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const open = searchParams.get("add") === "voice";
  const {
    accounts,
    categories,
    addTransaction,
    getDefaultAccount,
    refetch,
  } = useBudget();

  const [transcript, setTranscript] = useState("");
  const [previewResult, setPreviewResult] = useState<VoiceTransactionParseResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const preview = previewResult?.preview ?? null;
  const [type, setType] = useState<CategoryType>("expense");
  const [amount, setAmount] = useState("");
  const [transactionCharges, setTransactionCharges] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [accountId, setAccountId] = useState("");
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");

  const speechSupported = useMemo(() => !!getSpeechRecognition(), []);
  const defaultAccount = getDefaultAccount();
  const relevantCategories = categories.filter((category) => category.type === type);

  const close = () => {
    recognitionRef.current?.stop();
    setListening(false);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.delete("add");
    const q = params.toString();
    router.replace(q ? `${pathname}?${q}` : pathname);
  };

  useEffect(() => {
    if (!open) {
      setTranscript("");
      setPreviewResult(null);
      setError(null);
      return;
    }
    setDate(new Date().toISOString().slice(0, 10));
    setAccountId(defaultAccount?.id ?? "");
    setFromAccountId(defaultAccount?.id ?? "");
  }, [defaultAccount?.id, open]);

  useEffect(() => {
    if (!preview) return;
    const nextType = preview.type ?? "expense";
    setType(nextType);
    setAmount(preview.amount != null ? String(preview.amount) : "");
    setTransactionCharges(
      preview.transactionCharges && preview.transactionCharges > 0
        ? String(preview.transactionCharges)
        : ""
    );
    setCategoryId(preview.categoryId ?? "");
    setDate(preview.date ?? new Date().toISOString().slice(0, 10));
    setNotes(preview.notes ?? transcript);
    setAccountId(preview.accountId ?? defaultAccount?.id ?? "");
    setFromAccountId(preview.fromAccountId ?? defaultAccount?.id ?? "");
    setToAccountId(preview.toAccountId ?? "");
  }, [defaultAccount?.id, preview, transcript]);

  useEffect(() => {
    if (!categoryId || relevantCategories.some((category) => category.id === categoryId)) return;
    setCategoryId(relevantCategories[0]?.id ?? "");
  }, [categoryId, relevantCategories]);

  const previewTranscript = async () => {
    const clean = transcript.trim();
    if (!clean) {
      setError("Say or type a transaction first.");
      return;
    }
    setPreviewing(true);
    setError(null);
    setPreviewResult(null);
    try {
      const res = await fetch("/api/voice/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ transcript: clean, timestamp: Date.now() }),
      });
      const data = (await res.json().catch(() => null)) as
        | VoiceTransactionParseResult
        | { error?: string }
        | null;
      if (!res.ok) {
        throw new Error((data && "error" in data && data.error) || "Could not preview transaction");
      }
      setPreviewResult(data as VoiceTransactionParseResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not preview transaction");
    } finally {
      setPreviewing(false);
    }
  };

  const toggleListening = () => {
    const Recognition = getSpeechRecognition();
    if (!Recognition) {
      setError("Voice input is not supported in this browser. You can type the sentence instead.");
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-KE";
    recognition.onresult = (event) => {
      const parts: string[] = [];
      for (let i = 0; i < event.results.length; i += 1) {
        parts.push(event.results[i][0]?.transcript ?? "");
      }
      setTranscript(parts.join(" ").trim());
    };
    recognition.onerror = () => {
      setError("Voice capture failed. Try again or type the transaction.");
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  };

  const save = async () => {
    const numericAmount = parseFloat(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError("Enter a valid amount.");
      return;
    }
    if (!categoryId) {
      setError("Choose a category.");
      return;
    }
    if (type === "transfer" && (!fromAccountId || !toAccountId || fromAccountId === toAccountId)) {
      setError("Choose two different accounts for the transfer.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const created = await addTransaction({
        amount: numericAmount,
        categoryId,
        date,
        notes,
        type,
        transactionCharges:
          type === "transfer" ? 0 : transactionCharges ? parseFloat(transactionCharges) : 0,
        ...(type === "transfer"
          ? { fromAccountId, toAccountId }
          : { accountId: accountId || defaultAccount?.id }),
      });
      if (created.transferGroupId) await refetch();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save transaction");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? close() : undefined)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Voice transaction
          </DialogTitle>
          <DialogDescription>
            Say a transaction naturally. Bajeti will make a draft for you to review before saving.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="voice-transcript">What happened?</Label>
            <textarea
              id="voice-transcript"
              className="flex min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="e.g. Spent 850 bob on lunch at Java today"
              value={transcript}
              onChange={(event) => setTranscript(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={toggleListening}>
                {listening ? (
                  <>
                    <MicOff className="mr-2 h-4 w-4" />
                    Stop listening
                  </>
                ) : (
                  <>
                    <Mic className="mr-2 h-4 w-4" />
                    Speak
                  </>
                )}
              </Button>
              <Button type="button" onClick={previewTranscript} disabled={previewing}>
                {previewing ? "Previewing…" : "Preview transaction"}
              </Button>
            </div>
            {!speechSupported && (
              <p className="text-xs text-muted-foreground">
                This browser does not expose speech recognition, but typed voice-style entry still works.
              </p>
            )}
          </div>

          {previewResult && (
            <div className="space-y-4 rounded-lg border bg-muted/20 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium">
                  {previewResult.status === "ready" ? "Draft ready" : "Review needed"}
                </span>
                <span className="text-muted-foreground">
                  Confidence {Math.round(previewResult.confidence * 100)}%
                </span>
              </div>
              {previewResult.explanation && (
                <p className="text-xs text-muted-foreground">{previewResult.explanation}</p>
              )}
              {previewResult.missingFields.length > 0 && (
                <p className="text-xs text-destructive">
                  Check: {previewResult.missingFields.join(", ")}
                </p>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="voice-type">Type</Label>
                  <Select value={type} onValueChange={(value) => setType(value as CategoryType)}>
                    <SelectTrigger id="voice-type">{typeLabel(type)}</SelectTrigger>
                    <SelectContent>
                      <SelectItem value="expense">Expense</SelectItem>
                      <SelectItem value="income">Income</SelectItem>
                      <SelectItem value="transfer">Transfer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="voice-amount">Amount</Label>
                  <Input
                    id="voice-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                </div>
                {type === "transfer" ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="voice-from-account">From account</Label>
                      <Select value={fromAccountId} onValueChange={setFromAccountId}>
                        <SelectTrigger id="voice-from-account">
                          {accounts.find((account) => account.id === fromAccountId)?.name ??
                            "Select account"}
                        </SelectTrigger>
                        <SelectContent>
                          {accounts.map((account) => (
                            <SelectItem key={account.id} value={account.id}>
                              {account.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="voice-to-account">To account</Label>
                      <Select value={toAccountId} onValueChange={setToAccountId}>
                        <SelectTrigger id="voice-to-account">
                          {accounts.find((account) => account.id === toAccountId)?.name ??
                            "Select account"}
                        </SelectTrigger>
                        <SelectContent>
                          {accounts
                            .filter((account) => account.id !== fromAccountId)
                            .map((account) => (
                              <SelectItem key={account.id} value={account.id}>
                                {account.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="voice-account">Account</Label>
                    <Select value={accountId} onValueChange={setAccountId}>
                      <SelectTrigger id="voice-account">
                        {accounts.find((account) => account.id === accountId)?.name ?? "Wallet"}
                      </SelectTrigger>
                      <SelectContent>
                        {accounts.map((account) => (
                          <SelectItem key={account.id} value={account.id}>
                            {account.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="voice-category">Category</Label>
                  <Select value={categoryId} onValueChange={setCategoryId}>
                    <SelectTrigger id="voice-category">
                      {categories.find((category) => category.id === categoryId)?.name ??
                        "Select category"}
                    </SelectTrigger>
                    <SelectContent>
                      {relevantCategories.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="voice-date">Date</Label>
                  <Input
                    id="voice-date"
                    type="date"
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                  />
                </div>
                {type !== "transfer" && (
                  <div className="space-y-2">
                    <Label htmlFor="voice-charges">Charges</Label>
                    <Input
                      id="voice-charges"
                      type="number"
                      min="0"
                      step="0.01"
                      value={transactionCharges}
                      onChange={(event) => setTransactionCharges(event.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="voice-notes">Notes</Label>
                <Input
                  id="voice-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </div>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={save} disabled={!previewResult || saving}>
            {saving ? "Saving…" : "Save transaction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
