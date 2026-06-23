import { randomUUID } from "crypto";
import { sql } from "@/lib/db";
import { extractTransferReferenceTokens } from "@/lib/sms-parser";

type CandidateRow = {
  id: string;
  sms_message: string | null;
  transfer_group_id: string | null;
};

function intersects(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const bSet = new Set(b);
  return a.some((token) => bSet.has(token));
}

type TransferGroupLegRow = {
  id: string;
  transfer_leg: string | null;
};

/**
 * When an SMS would create a new transfer pair, look for an existing complete
 * transfer group (out + in legs) that shares reference tokens — e.g. Equity
 * "MPESA Ref. UF1L66EON5" and M-PESA "UF1L66EON5 Confirmed".
 */
export async function findExistingTransferGroupOutLeg(input: {
  userId: string;
  notes: string;
  amount: number;
  date: string;
}): Promise<string | null> {
  const refs = extractTransferReferenceTokens(input.notes);
  if (refs.length === 0) return null;

  const candidates = (await sql`
    SELECT id, sms_message, transfer_group_id
    FROM transactions
    WHERE user_id = ${input.userId}
      AND date = ${input.date}::date
      AND ABS(amount) = ABS(${input.amount})
    ORDER BY (transfer_group_id IS NOT NULL) DESC, id DESC
    LIMIT 30
  `) as CandidateRow[];

  for (const candidate of candidates) {
    if (!candidate.transfer_group_id) continue;
    if (!intersects(refs, extractTransferReferenceTokens(candidate.sms_message ?? ""))) {
      continue;
    }

    const legs = (await sql`
      SELECT id, transfer_leg::text AS transfer_leg
      FROM transactions
      WHERE user_id = ${input.userId}
        AND transfer_group_id = ${candidate.transfer_group_id}
    `) as TransferGroupLegRow[];

    const outLeg = legs.find((leg) => leg.transfer_leg === "out");
    const inLeg = legs.find((leg) => leg.transfer_leg === "in");
    if (outLeg && inLeg) {
      return outLeg.id;
    }
  }

  return null;
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
    SELECT id, sms_message, transfer_group_id
    FROM transactions
    WHERE user_id = ${input.userId}
      AND id <> ${input.transactionId}
      AND date = ${input.date}::date
      AND ABS(amount) = ABS(${input.amount})
    ORDER BY id DESC
    LIMIT 30
  `) as CandidateRow[];

  const matched = candidates.find((row) =>
    intersects(refs, extractTransferReferenceTokens(row.sms_message ?? ""))
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
