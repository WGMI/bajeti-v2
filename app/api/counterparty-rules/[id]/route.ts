import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { effectiveCounterpartyFromTransaction } from "@/lib/counterparty-helpers";
import {
  candidateCounterpartyRuleKeys,
  normalizeSmsCounterpartyKey,
  splitScopedCounterpartyKey,
} from "@/lib/sms-parser";
import type { CategoryType } from "@/lib/budget-types";

type TxRow = {
  id: string;
  notes: string | null;
  type: string;
  sms_counterparty: string | null;
  sms_counterparty_key: string | null;
};

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    const rows = await sql`
      DELETE FROM counterparty_category_rules
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id
    `;
    if (!rows?.length) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/counterparty-rules/[id]]", e);
    return NextResponse.json({ error: "Failed to delete rule" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    const body = await request.json();
    const counterpartyKeyRaw = body.counterpartyKey;
    const categoryId = body.categoryId;
    const transactionType = body.transactionType;
    const counterpartyLabel =
      typeof body.counterpartyLabel === "string" ? body.counterpartyLabel.trim() : "";

    if (
      typeof counterpartyKeyRaw !== "string" ||
      typeof categoryId !== "string" ||
      !categoryId ||
      (transactionType !== "income" &&
        transactionType !== "expense" &&
        transactionType !== "transfer")
    ) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const requestedKey = counterpartyKeyRaw.trim();
    const keyParts = splitScopedCounterpartyKey(requestedKey);
    const baseKey = normalizeSmsCounterpartyKey(keyParts.baseKey);
    if (!baseKey) {
      return NextResponse.json({ error: "Invalid counterparty key" }, { status: 400 });
    }
    const counterpartyKey = keyParts.accountReference
      ? `${baseKey}|account:${keyParts.accountReference}`
      : baseKey;

    const existingRows = await sql`
      SELECT id
      FROM counterparty_category_rules
      WHERE id = ${id} AND user_id = ${userId}
      LIMIT 1
    `;
    if (!existingRows[0]) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }

    const catRows = await sql`
      SELECT id, type::text AS type
      FROM categories
      WHERE id = ${categoryId} AND user_id = ${userId}
      LIMIT 1
    `;
    const cat = catRows[0] as { id: string; type: string } | undefined;
    if (!cat || cat.type !== transactionType) {
      return NextResponse.json(
        { error: "Category not found or type does not match transaction type" },
        { status: 400 }
      );
    }

    await sql`
      UPDATE counterparty_category_rules
      SET
        counterparty_key = ${counterpartyKey},
        transaction_type = ${transactionType}::category_type,
        category_id = ${categoryId}
      WHERE id = ${id} AND user_id = ${userId}
    `;

    const allRows = (await sql`
      SELECT id, notes, type::text AS type, sms_counterparty, sms_counterparty_key
      FROM transactions
      WHERE user_id = ${userId} AND type = ${transactionType}::category_type
    `) as TxRow[];

    const labelForRow =
      counterpartyLabel || baseKey.replace(/\b\w/g, (c: string) => c.toUpperCase());
    const matchingIds: string[] = [];
    for (const row of allRows) {
      const eff = effectiveCounterpartyFromTransaction(
        row.notes ?? "",
        row.type as CategoryType,
        row.sms_counterparty_key,
        row.sms_counterparty
      );
      const candidateKeys = eff
        ? candidateCounterpartyRuleKeys(eff.key, row.notes ?? "")
        : candidateCounterpartyRuleKeys(baseKey, row.notes ?? "");
      if (candidateKeys.includes(counterpartyKey)) matchingIds.push(row.id);
    }

    if (matchingIds.length > 0) {
      await sql`
        UPDATE transactions
        SET
          category_id = ${categoryId},
          sms_counterparty = COALESCE(sms_counterparty, ${labelForRow}),
          sms_counterparty_key = COALESCE(sms_counterparty_key, ${counterpartyKey})
        WHERE user_id = ${userId}
          AND id IN (
            SELECT (jsonb_array_elements_text(${JSON.stringify(matchingIds)}::jsonb))::uuid
          )
      `;
    }

    return NextResponse.json({ updatedCount: matchingIds.length });
  } catch (e) {
    console.error("[PATCH /api/counterparty-rules/[id]]", e);
    return NextResponse.json({ error: "Failed to update rule" }, { status: 500 });
  }
}
