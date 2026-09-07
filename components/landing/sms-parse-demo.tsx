"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, Check, Loader2, Wifi } from "lucide-react";
import { parseSMS, type SmsParseResult } from "@/lib/sms-parser";
import { cn } from "@/lib/utils";

type Sample = { label: string; message: string };

const SAMPLES: Sample[] = [
  {
    label: "Café",
    message:
      "TJ4L68HQ9G Confirmed. Ksh450.00 paid to JAVA HOUSE WESTLANDS. on 12/3/26 at 1:45 PM. Transaction cost, Ksh 22.00. Amount you can transact within the day is Ksh 49,528.00.",
  },
  {
    label: "Bill payment",
    message:
      "RJ8M2ZXQ4T Confirmed. Ksh3,200.00 sent to KPLC PREPAID for account 01234567890 on 5/3/26 at 8:02 AM. Transaction cost, Ksh 24.00. Amount you can transact within the day is Ksh 46,304.00.",
  },
  {
    label: "Salary",
    message:
      "SK2N9YHT7L Confirmed. You have received Ksh45,000.00 from ACME LOGISTICS LTD on 1/3/26 at 9:00 AM. New M-PESA balance is Ksh45,120.00.",
  },
];

// A small illustrative stand-in for Bajeti's real counterparty-rules engine —
// just enough to show a category landing on the parsed transaction below.
const CATEGORY_RULES: Array<{ match: RegExp; category: string; color: string }> = [
  { match: /java|naivas|carrefour|quickmart|caf[eé]|restaurant/i, category: "Food", color: "bg-chart-1/15 text-chart-1" },
  { match: /kplc|water|zuku|safaricom|dstv|starlink|electric/i, category: "Bills", color: "bg-chart-2/15 text-chart-2" },
  { match: /uber|bolt|matatu|shuttle|fuel|petrol/i, category: "Transport", color: "bg-chart-5/15 text-chart-5" },
];

function guessCategory(parsed: SmsParseResult): { name: string; color: string } {
  if (parsed.type === "income") {
    return { name: "Salary", color: "bg-success/15 text-success" };
  }
  const rule = CATEGORY_RULES.find((r) => r.match.test(parsed.counterparty ?? ""));
  return rule
    ? { name: rule.category, color: rule.color }
    : { name: "Other", color: "bg-muted text-muted-foreground" };
}

function formatKes(amount: number) {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// Timing for one loop: type -> hold -> press -> parse -> show result -> clear -> next sample.
const MS_PER_CHAR = 14;
const HOLD_MS = 650;
const PRESS_MS = 260;
const PARSE_MS = 550;
const RESULT_MS = 2500;
const CLEAR_MS = 380;

type Stage = "typing" | "holding" | "pressing" | "parsing" | "result" | "clearing";

export function SmsParseDemo() {
  const [sampleIndex, setSampleIndex] = useState(0);
  const [stage, setStage] = useState<Stage>("typing");
  const [typedLength, setTypedLength] = useState(0);
  const [result, setResult] = useState<SmsParseResult | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  const message = SAMPLES[sampleIndex].message;

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const onChange = () => setReducedMotion(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // Type the message in, char by char (or instantly if the visitor prefers reduced motion).
  useEffect(() => {
    if (stage !== "typing") return;
    if (reducedMotion) {
      setTypedLength(message.length);
      setStage("holding");
      return;
    }
    setTypedLength(0);
    const id = window.setInterval(() => {
      setTypedLength((n) => {
        const next = n + 2;
        if (next >= message.length) {
          window.clearInterval(id);
          setStage("holding");
          return message.length;
        }
        return next;
      });
    }, MS_PER_CHAR);
    return () => window.clearInterval(id);
  }, [stage, message, reducedMotion]);

  useEffect(() => {
    if (stage !== "pressing") return;
    const id = window.setTimeout(() => setStage("parsing"), PRESS_MS);
    return () => window.clearTimeout(id);
  }, [stage]);

  useEffect(() => {
    if (stage !== "parsing") return;
    const id = window.setTimeout(() => {
      setResult(parseSMS(message));
      setStage("result");
    }, PARSE_MS);
    return () => window.clearTimeout(id);
  }, [stage, message]);

  useEffect(() => {
    if (stage !== "result") return;
    const id = window.setTimeout(() => setStage("clearing"), RESULT_MS);
    return () => window.clearTimeout(id);
  }, [stage]);

  useEffect(() => {
    if (stage !== "clearing") return;
    const id = window.setTimeout(() => {
      setResult(null);
      setSampleIndex((i) => (i + 1) % SAMPLES.length);
      setStage("typing");
    }, CLEAR_MS);
    return () => window.clearTimeout(id);
  }, [stage]);

  // The button "presses itself" once the message has finished typing.
  useEffect(() => {
    if (stage !== "holding") return;
    const id = window.setTimeout(() => setStage("pressing"), HOLD_MS);
    return () => window.clearTimeout(id);
  }, [stage]);

  const category = useMemo(() => (result ? guessCategory(result) : null), [result]);
  const showResult = stage === "result" || stage === "clearing";
  const isReading = stage === "parsing";
  const isPressed = stage === "pressing" || stage === "parsing";

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="rounded-[2.5rem] border border-primary/10 bg-neutral-900 p-3 shadow-xl">
        <div className="relative h-[340px] overflow-hidden rounded-[2rem] bg-background p-4">
          {/* Messages view */}
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between px-1 pb-3 text-[11px] text-muted-foreground">
              <span>Messages</span>
              <span className="flex items-center gap-1">
                <Wifi className="h-3 w-3" /> M-PESA
              </span>
            </div>

            <div className="min-h-[110px] rounded-2xl bg-muted/60 p-3 font-mono text-[11px] leading-relaxed text-foreground/90">
              {message.slice(0, typedLength)}
              {(stage === "typing" || stage === "holding") && (
                <span className="ml-0.5 inline-block h-3 w-1.5 translate-y-0.5 animate-pulse bg-foreground/60 align-middle" />
              )}
            </div>

            <button
              type="button"
              tabIndex={-1}
              aria-hidden="true"
              className={cn(
                "mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-all duration-150",
                isPressed && "scale-[0.97] opacity-80"
              )}
            >
              {isReading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading message…
                </>
              ) : (
                <>
                  Parse this message <ArrowDown className="h-3.5 w-3.5" />
                </>
              )}
            </button>

            <div className="mt-4 flex flex-1 items-end justify-center gap-1.5 pb-1">
              {SAMPLES.map((sample, i) => (
                <span
                  key={sample.label}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-300",
                    i === sampleIndex ? "w-5 bg-primary" : "w-1.5 bg-border"
                  )}
                />
              ))}
            </div>
          </div>

          {/* Result view — slides up and takes over the screen */}
          <div
            className={cn(
              "absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background p-6 text-center transition-transform duration-500 ease-out",
              showResult ? "translate-y-0" : "translate-y-full"
            )}
          >
            {result && category && (
              <>
                <div
                  className={cn(
                    "flex h-14 w-14 items-center justify-center rounded-full",
                    category.color
                  )}
                >
                  <Check className="h-6 w-6" />
                </div>
                <p className="text-sm text-muted-foreground">
                  Added to <span className="font-medium text-foreground">{category.name}</span>
                </p>
                <p
                  className={cn(
                    "text-3xl font-bold tabular-nums",
                    result.type === "income" ? "text-success" : "text-foreground"
                  )}
                >
                  {result.type === "income" ? "+" : "−"} {formatKes(result.amount)}
                </p>
                <p className="max-w-[220px] truncate text-sm font-medium text-muted-foreground">
                  {result.counterparty ?? "Transaction"}
                </p>
                {result.charges > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    + {formatKes(result.charges)} transaction fee, tracked separately
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        This is Bajeti&apos;s real SMS parser, running live in your browser — not a mockup.
        On your phone, it happens automatically in the background.
      </p>
    </div>
  );
}
