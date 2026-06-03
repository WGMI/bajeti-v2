import { sql } from "@/lib/db";
import { candidateCounterpartyRuleKeys } from "./sms-parser";

export { effectiveCounterpartyFromTransaction } from "./effective-counterparty-from-transaction";

type CategoryRow = { id: string; name: string; type: string };

export type SmsCounterpartyRuleResolution = {
  category: CategoryRow | undefined;
  /** Null on rule means default Wallet when type is transfer. */
  transferToAccountId: string | null;
};

export async function resolveCategoryForSmsIngestion(
  userId: string,
  parsed: { type: string; counterpartyKey: string | null; message?: string },
  categoryRows: CategoryRow[]
): Promise<SmsCounterpartyRuleResolution> {
  const categoriesForType = categoryRows.filter((c) => c.type === parsed.type);
  const otherCategory = categoriesForType.find((c) =>
    c.name.toLowerCase().includes("other")
  );
  const fallback = otherCategory ?? categoriesForType[0];
  if (!parsed.counterpartyKey || parsed.type === "neither") {
    return { category: fallback, transferToAccountId: null };
  }
  const candidateKeys = candidateCounterpartyRuleKeys(parsed.counterpartyKey, parsed.message ?? "");
  if (candidateKeys.length === 0) {
    return { category: fallback, transferToAccountId: null };
  }
  const ruleRows = await sql`
    SELECT r.category_id, r.transfer_to_account_id
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
  const rule = ruleRows[0] as
    | { category_id: string; transfer_to_account_id: string | null }
    | undefined;
  if (!rule?.category_id) {
    return { category: fallback, transferToAccountId: null };
  }
  const category = categoryRows.find((c) => c.id === rule.category_id) ?? fallback;
  const transferToAccountId =
    parsed.type === "transfer" ? rule.transfer_to_account_id : null;
  return { category, transferToAccountId };
}
