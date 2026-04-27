import { sql } from "@/lib/db";
import { candidateCounterpartyRuleKeys } from "./sms-parser";

export { effectiveCounterpartyFromTransaction } from "./effective-counterparty-from-transaction";

type CategoryRow = { id: string; name: string; type: string };

export async function resolveCategoryForSmsIngestion(
  userId: string,
  parsed: { type: string; counterpartyKey: string | null; message?: string },
  categoryRows: CategoryRow[]
): Promise<CategoryRow | undefined> {
  const categoriesForType = categoryRows.filter((c) => c.type === parsed.type);
  const otherCategory = categoriesForType.find((c) =>
    c.name.toLowerCase().includes("other")
  );
  const fallback = otherCategory ?? categoriesForType[0];
  if (!parsed.counterpartyKey || parsed.type === "neither") {
    return fallback;
  }
  const candidateKeys = candidateCounterpartyRuleKeys(parsed.counterpartyKey, parsed.message ?? "");
  if (candidateKeys.length === 0) return fallback;
  const ruleRows = await sql`
    SELECT r.category_id
    FROM counterparty_category_rules r
    INNER JOIN categories c ON c.id = r.category_id AND c.user_id = ${userId}
    WHERE r.user_id = ${userId}
      AND r.counterparty_key IN (
        SELECT jsonb_array_elements_text(${JSON.stringify(candidateKeys)}::jsonb)
      )
      AND r.transaction_type = ${parsed.type}::category_type
    ORDER BY CASE
      WHEN r.counterparty_key = ${candidateKeys[0]} THEN 0
      ELSE 1
    END
    LIMIT 1
  `;
  const categoryId = (ruleRows[0] as { category_id: string } | undefined)?.category_id;
  if (!categoryId) return fallback;
  return categoryRows.find((c) => c.id === categoryId) ?? fallback;
}
