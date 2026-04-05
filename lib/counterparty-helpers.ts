import { sql } from "@/lib/db";
import type { CategoryType } from "@/lib/budget-types";
import { parseSMS } from "@/lib/sms-parser";

type CategoryRow = { id: string; name: string; type: string };

export async function resolveCategoryForSmsIngestion(
  userId: string,
  parsed: { type: string; counterpartyKey: string | null },
  categoryRows: CategoryRow[]
): Promise<CategoryRow | undefined> {
  const fallback = categoryRows.find((c) => c.type === parsed.type);
  if (!parsed.counterpartyKey || parsed.type === "neither") {
    return fallback;
  }
  const ruleRows = await sql`
    SELECT r.category_id
    FROM counterparty_category_rules r
    INNER JOIN categories c ON c.id = r.category_id AND c.user_id = ${userId}
    WHERE r.user_id = ${userId}
      AND r.counterparty_key = ${parsed.counterpartyKey}
      AND r.transaction_type = ${parsed.type}::category_type
    LIMIT 1
  `;
  const categoryId = (ruleRows[0] as { category_id: string } | undefined)?.category_id;
  if (!categoryId) return fallback;
  return categoryRows.find((c) => c.id === categoryId) ?? fallback;
}

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
  const parsed = parseSMS(notes);
  if (parsed.type !== type || !parsed.counterpartyKey) return null;
  return {
    key: parsed.counterpartyKey,
    label: parsed.counterparty ?? parsed.counterpartyKey,
  };
}
