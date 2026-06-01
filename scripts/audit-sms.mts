/**
 * One-off SMS audit: compare raw messages vs production transactions + rules.
 * Usage: npx tsx scripts/audit-sms.mts
 */
import { readFileSync } from "fs";
import { createHash } from "crypto";
import {
  parseSMS,
  candidateCounterpartyRuleKeys,
} from "../lib/sms-parser.ts";
import { buildSmsIdempotencyKey } from "../lib/sms-idempotency.ts";

const SMS_PATH = "c:/Users/Imo/Downloads/sms20260530.txt";
const TX_PATH =
  "c:/Users/Imo/Downloads/blue-shadow-45160604_production_neondb_2026-05-30_12-56-58.xlsx";
const RULES_PATH = "c:/Users/Imo/Downloads/counterparty_category_rules.xlsx";

type Rule = {
  counterparty_key: string;
  transaction_type: string;
  category_id: string;
};

type Tx = {
  amount: number;
  category_id: string;
  date: string;
  notes: string;
  type: string;
  sms_idempotency_key: string;
  sms_counterparty_key: string;
  transfer_group_id: string;
};

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function resolveEffectiveType(
  parsed: ReturnType<typeof parseSMS>,
  rules: Rule[]
): string {
  const base = parsed.type;
  if (base === "neither" || !parsed.counterpartyKey) return base;
  const keys = candidateCounterpartyRuleKeys(
    parsed.counterpartyKey,
    parsed.message
  );
  const hasTransferRule = rules.some(
    (r) =>
      r.transaction_type === "transfer" &&
      keys.includes(r.counterparty_key)
  );
  return hasTransferRule ? "transfer" : base;
}

function resolveExpectedCategory(
  effectiveType: string,
  parsed: ReturnType<typeof parseSMS>,
  rules: Rule[]
): string | null {
  if (effectiveType === "neither") return null;
  const keys = parsed.counterpartyKey
    ? candidateCounterpartyRuleKeys(parsed.counterpartyKey, parsed.message)
    : [];
  const scoped = keys[0];
  const match =
    rules.find(
      (r) =>
        r.transaction_type === effectiveType &&
        r.counterparty_key === scoped
    ) ??
    rules.find(
      (r) =>
        r.transaction_type === effectiveType &&
        keys.includes(r.counterparty_key)
    );
  return match?.category_id ?? null;
}

function parseSmsFile(text: string): { id: string; ts: number; body: string }[] {
  const out: { id: string; ts: number; body: string }[] = [];
  const lineRe = /^\s*msg id=(\d+) ts=(\d+) body=(.*)$/;
  for (const line of text.split(/\r?\n/)) {
    const m = lineRe.exec(line);
    if (!m) continue;
    out.push({ id: m[1], ts: Number(m[2]), body: m[3] });
  }
  return out;
}

async function loadExcel<T>(path: string, sheet = 0): Promise<T[]> {
  const mod = await import("xlsx");
  const XLSX = (mod as { default?: typeof mod }).default ?? mod;
  const wb = XLSX.readFile(path);
  const name = wb.SheetNames[sheet] ?? wb.SheetNames[0];
  return XLSX.utils.sheet_to_json<T>(wb.Sheets[name], { defval: "" });
}

async function main() {
  const log = console.log;
  console.log = () => {};
  const smsText = readFileSync(SMS_PATH, "utf8");
  const messages = parseSmsFile(smsText);
  const rules = await loadExcel<Rule>(RULES_PATH);
  const txs = await loadExcel<Tx>(TX_PATH);

  const txByKey = new Map<string, Tx>();
  const txByRef = new Map<string, Tx[]>();
  for (const tx of txs) {
    txByKey.set(tx.sms_idempotency_key, tx);
    const refMatch = tx.notes.match(/^([A-Z0-9]{8,16})\s/i);
    if (refMatch) {
      const ref = refMatch[1].toUpperCase();
      const list = txByRef.get(ref) ?? [];
      list.push(tx);
      txByRef.set(ref, list);
    }
  }

  const missingTx: unknown[] = [];
  const unexpectedTx: unknown[] = [];
  const wrongCategory: unknown[] = [];
  const wrongType: unknown[] = [];
  const parseIgnored: unknown[] = [];
  const amountMismatch: unknown[] = [];
  const duplicateRefs: unknown[] = [];

  for (const msg of messages) {
    const parsed = parseSMS(msg.body, {
      timestamp: msg.ts,
      transactionDateSource: "received_at",
    });
    const effectiveType = resolveEffectiveType(parsed, rules);
    const shouldCreate =
      effectiveType !== "neither" && parsed.amount > 0 && parsed.date;

    if (!shouldCreate) {
      parseIgnored.push({
        msgId: msg.id,
        reason: effectiveType === "neither" ? "neither" : !parsed.amount ? "no amount" : "no date",
        preview: msg.body.slice(0, 80),
      });
      continue;
    }

    const idemKey = sha256(
      buildSmsIdempotencyKey({
        type: effectiveType as "income" | "expense" | "transfer",
        amount: parsed.amount,
        date: parsed.date,
        transactionRef: parsed.transactionRef,
      })
    );

    const tx = txByKey.get(idemKey);
    const expectedCat = resolveExpectedCategory(effectiveType, parsed, rules);

    if (!tx) {
      // fallback: match by ref
      const byRef = parsed.transactionRef
        ? txByRef.get(parsed.transactionRef.toUpperCase())
        : undefined;
      missingTx.push({
        msgId: msg.id,
        ref: parsed.transactionRef,
        effectiveType,
        amount: parsed.amount,
        date: parsed.date,
        counterpartyKey: parsed.counterpartyKey,
        idemKey: idemKey.slice(0, 16),
        byRefCount: byRef?.length ?? 0,
        bodyStart: msg.body.slice(0, 100),
      });
      continue;
    }

    if (tx.type !== effectiveType) {
      wrongType.push({
        msgId: msg.id,
        ref: parsed.transactionRef,
        expected: effectiveType,
        actual: tx.type,
        counterpartyKey: parsed.counterpartyKey,
      });
    }

    if (expectedCat && tx.category_id !== expectedCat) {
      wrongCategory.push({
        msgId: msg.id,
        ref: parsed.transactionRef,
        counterpartyKey: parsed.counterpartyKey,
        expectedCat,
        actualCat: tx.category_id,
        amount: parsed.amount,
      });
    }

    const stored = Number(tx.amount);
    if (Math.abs(stored - parsed.amount) > 0.01) {
      amountMismatch.push({
        msgId: msg.id,
        ref: parsed.transactionRef,
        parsed: parsed.amount,
        stored,
      });
    }
  }

  // Transactions without matching SMS
  const matchedKeys = new Set<string>();
  for (const msg of messages) {
    const parsed = parseSMS(msg.body, { timestamp: msg.ts, transactionDateSource: "received_at" });
    const effectiveType = resolveEffectiveType(parsed, rules);
    if (effectiveType === "neither" || !parsed.amount || !parsed.date) continue;
    const idemKey = sha256(
      buildSmsIdempotencyKey({
        type: effectiveType as "income" | "expense" | "transfer",
        amount: parsed.amount,
        date: parsed.date,
        transactionRef: parsed.transactionRef,
      })
    );
    if (txByKey.has(idemKey)) matchedKeys.add(idemKey);
  }

  const orphanTx = txs.filter((t) => !matchedKeys.has(t.sms_idempotency_key));

  // Duplicate refs in DB
  for (const [ref, list] of txByRef) {
    if (list.length > 1) {
      duplicateRefs.push({
        ref,
        count: list.length,
        amounts: list.map((t) => t.amount),
        types: list.map((t) => t.type),
      });
    }
  }

  console.log = log;
  console.log(JSON.stringify({
    summary: {
      smsMessages: messages.length,
      parseIgnored: parseIgnored.length,
      dbTransactions: txs.length,
      missingTx: missingTx.length,
      wrongCategory: wrongCategory.length,
      wrongType: wrongType.length,
      amountMismatch: amountMismatch.length,
      orphanTx: orphanTx.length,
      duplicateRefGroups: duplicateRefs.length,
    },
    missingTx,
    wrongCategory,
    wrongType,
    amountMismatch,
    orphanTx: orphanTx.map((t) => ({
      amount: t.amount,
      type: t.type,
      date: t.date,
      counterparty: t.sms_counterparty_key,
      notesStart: String(t.notes).slice(0, 90),
    })),
    duplicateRefs: duplicateRefs.filter((d: { count: number }) => d.count > 1).slice(0, 30),
    parseIgnoredSample: parseIgnored.slice(0, 15),
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
