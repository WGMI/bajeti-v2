import { randomUUID } from "crypto";
import { sql } from "@/lib/db";
import { extractTransferReferenceTokens } from "@/lib/sms-parser";

type CandidateRow = {
  id: string;
  notes: string | null;
  transfer_group_id: string | null;
};

function intersects(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const bSet = new Set(b);
  return a.some((token) => bSet.has(token));
}

export async function groupTransferLegIfMatched(input: {
  userId: string;
  transactionId: string;
  notes: string;
  amount: number;
  date: string;
  transferCategoryId: string;
}): Promise<string | null> {
  const refs = extractTransferReferenceTokens(input.notes);
  if (refs.length === 0) return null;

  const candidates = (await sql`
    SELECT id, notes, transfer_group_id
    FROM transactions
    WHERE user_id = ${input.userId}
      AND id <> ${input.transactionId}
      AND date = ${input.date}::date
      AND ABS(amount) = ABS(${input.amount})
    ORDER BY id DESC
    LIMIT 30
  `) as CandidateRow[];

  const matched = candidates.find((row) =>
    intersects(refs, extractTransferReferenceTokens(row.notes ?? ""))
  );
  if (!matched) return null;

  const groupId = matched.transfer_group_id ?? randomUUID();
  const olderId = matched.id < input.transactionId ? matched.id : input.transactionId;
  const newerId = matched.id < input.transactionId ? input.transactionId : matched.id;
  await sql`
    UPDATE transactions
    SET
      type = ${"transfer"}::category_type,
      category_id = ${input.transferCategoryId},
      transfer_group_id = ${groupId},
      transfer_leg = CASE
        WHEN id = ${olderId} THEN 'out'::transfer_leg
        WHEN id = ${newerId} THEN 'in'::transfer_leg
        ELSE transfer_leg
      END
    WHERE user_id = ${input.userId}
      AND id IN (
        SELECT (jsonb_array_elements_text(${JSON.stringify([input.transactionId, matched.id])}::jsonb))::uuid
      )
  `;
  return groupId;
}
