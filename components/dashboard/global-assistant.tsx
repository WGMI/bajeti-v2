"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import { Bot, Loader2, MessageCircle, Mic, MicOff, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSettings } from "@/lib/settings-store";
import { formatCurrencyWithSign } from "@/lib/format-currency";
import { formatDateWithPreference } from "@/lib/format-date";
import type { Transaction } from "@/lib/budget-types";
import { cn } from "@/lib/utils";

type AssistantSpeechRecognitionConstructor = new () => AssistantSpeechRecognitionLike;

interface AssistantSpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: AssistantSpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface AssistantSpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{
    isFinal?: boolean;
    0?: { transcript?: string };
  }>;
}

declare global {
  interface Window {
    SpeechRecognition?: AssistantSpeechRecognitionConstructor;
    webkitSpeechRecognition?: AssistantSpeechRecognitionConstructor;
  }
}

type AssistantResponse = {
  answer: string;
  total: number;
  count: number;
  average: number | null;
  transactions: Transaction[];
  categoryBreakdown?: AssistantCategorySummary[];
  insights?: AssistantInsight[];
  source: "openai" | "fallback";
};

type AssistantCategorySummary = {
  categoryId: string;
  categoryName: string;
  amount: number;
  count: number;
};

type AssistantInsight = {
  title: string;
  value: string;
  detail: string;
  direction: "up" | "down" | "flat";
};

type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  transactions?: Transaction[];
  categoryBreakdown?: AssistantCategorySummary[];
  insights?: AssistantInsight[];
  source?: "openai" | "fallback";
};

function getSpeechRecognition(): AssistantSpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

function collapseRepeatedTranscript(input: string): string {
  const words = input.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  const output: string[] = [];
  for (const word of words) {
    output.push(word);
    for (let size = Math.min(8, Math.floor(output.length / 2)); size >= 1; size -= 1) {
      const tail = output.slice(-size).join(" ").toLowerCase();
      const previous = output.slice(-size * 2, -size).join(" ").toLowerCase();
      if (tail === previous) {
        output.splice(output.length - size, size);
        break;
      }
    }
  }
  return output.join(" ");
}

const SUGGESTIONS = [
  "What changed this month?",
  "Any unusual spending spikes?",
  "What are my top expenses this month?",
];

export function GlobalAssistant() {
  const { currency, dateFormat } = useSettings();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<AssistantMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text: "Ask me about your transactions.",
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<AssistantSpeechRecognitionLike | null>(null);
  const finalTranscriptRef = useRef("");
  const speechSupported = useMemo(() => !!getSpeechRecognition(), []);

  const ask = async (question: string) => {
    const clean = question.trim();
    if (!clean || loading) return;
    const userMessage: AssistantMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: clean,
    };
    setMessages((current) => [...current, userMessage]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/assistant/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ question: clean }),
      });
      const data = (await res.json().catch(() => null)) as
        | AssistantResponse
        | { error?: string }
        | null;
      if (!res.ok) {
        throw new Error((data && "error" in data && data.error) || "Could not answer that yet.");
      }
      const result = data as AssistantResponse;
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: result.answer,
          transactions: result.transactions,
          categoryBreakdown: result.categoryBreakdown,
          insights: result.insights,
          source: result.source,
        },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: error instanceof Error ? error.message : "Could not answer that yet.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const toggleListening = () => {
    const Recognition = getSpeechRecognition();
    if (!Recognition) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: "Voice input is not available in this browser.",
        },
      ]);
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
      const interimParts: string[] = [];
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const phrase = event.results[i][0]?.transcript?.trim();
        if (!phrase) continue;
        if (event.results[i].isFinal) {
          const finalSoFar = finalTranscriptRef.current.toLowerCase();
          if (!finalSoFar.endsWith(phrase.toLowerCase())) {
            finalTranscriptRef.current = `${finalTranscriptRef.current} ${phrase}`.trim();
          }
        } else {
          interimParts.push(phrase);
        }
      }
      setInput(
        collapseRepeatedTranscript(
          `${finalTranscriptRef.current} ${interimParts.join(" ")}`.trim()
        )
      );
    };
    recognition.onerror = () => {
      setListening(false);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: "Voice capture failed. Try again or type your question.",
        },
      ]);
    };
    recognition.onend = () => {
      setListening(false);
      finalTranscriptRef.current = "";
    };
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void ask(input);
  };

  return (
    <>
      <Button
        size="lg"
        className="fixed bottom-[max(1.5rem,calc(0.75rem+env(safe-area-inset-bottom,0px)))] left-[max(1.5rem,calc(0.75rem+env(safe-area-inset-left,0px)))] z-50 h-14 w-14 rounded-full border border-primary/20 bg-background/85 text-foreground shadow-lg backdrop-blur-md hover:bg-background md:bottom-8 md:left-8"
        aria-label="Open assistant"
        onClick={() => setOpen(true)}
      >
        <MessageCircle className="h-6 w-6" />
      </Button>

      {open && (
        <div className="fixed inset-x-3 bottom-[max(5.5rem,calc(4.75rem+env(safe-area-inset-bottom,0px)))] z-50 mx-auto flex max-h-[min(78dvh,680px)] max-w-[28rem] flex-col overflow-hidden rounded-lg border bg-background shadow-2xl sm:left-6 sm:right-auto sm:mx-0 md:bottom-24 md:left-8">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Bot className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">Bajeti assistant</p>
                <p className="truncate text-xs text-muted-foreground">Transactions first</p>
              </div>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={() => {
                recognitionRef.current?.stop();
                setOpen(false);
              }}
              aria-label="Close assistant"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "max-w-[92%] rounded-lg px-3 py-2 text-sm",
                  message.role === "user"
                    ? "ml-auto bg-primary text-primary-foreground"
                    : "mr-auto bg-muted"
                )}
              >
                <p>{message.text}</p>
                {message.insights && message.insights.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {message.insights.map((insight) => (
                      <div
                        key={`${insight.title}-${insight.value}`}
                        className="rounded-md border border-border/60 bg-background/70 px-2 py-1.5"
                      >
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <span className="truncate text-xs font-medium text-muted-foreground">
                            {insight.title}
                          </span>
                          <span
                            className={cn(
                              "shrink-0 text-xs font-semibold",
                              insight.direction === "up"
                                ? "text-destructive"
                                : insight.direction === "down"
                                  ? "text-success"
                                  : "text-muted-foreground"
                            )}
                          >
                            {insight.direction === "up"
                              ? "Higher"
                              : insight.direction === "down"
                                ? "Lower"
                                : "Stable"}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate font-medium">{insight.value}</p>
                        <p className="text-xs text-muted-foreground">{insight.detail}</p>
                      </div>
                    ))}
                  </div>
                )}
                {message.categoryBreakdown && message.categoryBreakdown.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {message.categoryBreakdown.map((category, index) => (
                      <div
                        key={category.categoryId}
                        className="rounded-md border border-border/60 bg-background/70 px-2 py-1.5"
                      >
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <span className="truncate font-medium">
                            {index + 1}. {category.categoryName}
                          </span>
                          <span className="shrink-0 text-xs font-semibold">
                            {new Intl.NumberFormat(undefined, {
                              style: "currency",
                              currency,
                              minimumFractionDigits: 0,
                              maximumFractionDigits: 2,
                            }).format(category.amount)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {category.count} {category.count === 1 ? "transaction" : "transactions"}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                {message.transactions && message.transactions.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {message.transactions.map((transaction) => (
                      <div
                        key={transaction.id}
                        className="rounded-md border border-border/60 bg-background/70 px-2 py-1.5"
                      >
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <span className="truncate font-medium">
                            {transaction.categoryName ?? "Transaction"}
                          </span>
                          <span className="shrink-0 text-xs font-semibold">
                            {formatCurrencyWithSign(
                              transaction.amount,
                              currency,
                              transaction.type
                            )}
                          </span>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {formatDateWithPreference(transaction.date, dateFormat)}
                          {transaction.notes ? ` · ${transaction.notes}` : ""}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                {message.source === "fallback" && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Answered with basic parsing.
                  </p>
                )}
              </div>
            ))}
            {loading && (
              <div className="mr-auto flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Thinking
              </div>
            )}
          </div>

          <div className="border-t p-3">
            {messages.length === 1 && (
              <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
                {SUGGESTIONS.map((suggestion) => (
                  <Button
                    key={suggestion}
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 shrink-0 text-xs"
                    onClick={() => void ask(suggestion)}
                  >
                    {suggestion}
                  </Button>
                ))}
              </div>
            )}
            <form onSubmit={submit} className="flex items-center gap-2">
              <Button
                type="button"
                size="icon"
                variant={listening ? "default" : "outline"}
                className="h-10 w-10 shrink-0"
                onClick={toggleListening}
                aria-label={listening ? "Stop voice input" : "Start voice input"}
              >
                {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </Button>
              <Input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={speechSupported ? "Ask or speak..." : "Ask a question..."}
                className="h-10 min-w-0"
              />
              <Button
                type="submit"
                size="icon"
                className="h-10 w-10 shrink-0"
                disabled={loading || !input.trim()}
                aria-label="Send question"
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
