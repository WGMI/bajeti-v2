import type { CategoryType } from "@/lib/budget-types";
import {
  extractSmsCounterpartyLabel,
  normalizeSmsCounterpartyKey,
  parseSMS,
} from "@/lib/sms-parser";

/** Resolve normalized counterparty key and display label from a stored transaction (client- or server-safe). */
export function effectiveCounterpartyFromTransaction(
  notes: string,
  type: CategoryType,
  smsCounterpartyKey: string | null | undefined,
  smsCounterparty: string | null | undefined
): { key: string; label: string } | null {
  if (smsCounterpartyKey) {
    const label =
      smsCounterparty?.trim() ||
      smsCounterpartyKey.replace(/\b\w/g, (c) => c.toUpperCase());
    return { key: smsCounterpartyKey, label };
  }

  // Prefer extraction using the stored transaction type — parser keyword rules can disagree
  // (e.g. body suggests "received" but the tx is filed as expense), which used to yield no payee.
  const byStoredType = extractSmsCounterpartyLabel(notes, type);
  if (byStoredType) {
    const key = normalizeSmsCounterpartyKey(byStoredType);
    if (key) return { key, label: byStoredType };
  }

  const parsed = parseSMS(notes);
  if (parsed.counterpartyKey && parsed.type !== "neither") {
    return {
      key: parsed.counterpartyKey,
      label: parsed.counterparty ?? parsed.counterpartyKey,
    };
  }

  const trimmed = notes.trim();
  if (trimmed.length >= 2) {
    const line = trimmed.split(/\n/)[0].trim();
    const key = normalizeSmsCounterpartyKey(line);
    if (key) return { key, label: line.slice(0, 200) };
  }

  return null;
}
