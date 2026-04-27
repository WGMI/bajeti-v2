import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { effectiveCounterpartyFromTransaction } from "@/lib/counterparty-helpers";
import { normalizeTransactionDateFromDb } from "@/lib/format-date";
import {
  candidateCounterpartyRuleKeys,
  normalizeSmsCounterpartyKey,
  splitScopedCounterpartyKey,
} from "@/lib/sms-parser";
import type { CategoryType } from "@/lib/budget-types";

type TxRow = {
  id: string;
  amount: string;
  category_id: string;
  date: string;
  notes: string | null;
  type: string;
  sms_counterparty: string | null;
  sms_counterparty_key: string | null;
};

function rowToTransaction(row: TxRow) {
  return {
    id: row.id,
    amount: Number(row.amount),
    categoryId: row.category_id,
    date: normalizeTransactionDateFromDb(row.date),
    notes: row.notes ?? "",
    type: row.type as CategoryType,
    smsCounterparty: row.sms_counterparty,
    smsCounterpartyKey: row.sms_counterparty_key,
  };
}

/**
 * GET /api/counterparty-rules — list saved payee/payer → category mappings.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const rows = (await sql`
      SELECT
        r.id,
        r.counterparty_key,
        r.transaction_type::text AS transaction_type,
        r.category_id,
        c.name AS category_name
      FROM counterparty_category_rules r
      INNER JOIN categories c ON c.id = r.category_id AND c.user_id = ${userId}
      WHERE r.user_id = ${userId}
      ORDER BY r.transaction_type, c.name, r.counterparty_key
    `) as {
      id: string;
      counterparty_key: string;
      transaction_type: string;
      category_id: string;
      category_name: string;
    }[];

    return NextResponse.json({
      rules: rows.map((row) => ({
        id: row.id,
        counterpartyKey: row.counterparty_key,
        transactionType: row.transaction_type as CategoryType,
        categoryId: row.category_id,
        categoryName: row.category_name,
      })),
    });
  } catch (e) {
    console.error("[GET /api/counterparty-rules]", e);
    return NextResponse.json(
      { error: "Failed to load rules" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/counterparty-rules
 * Saves a payee/payer → category mapping and updates all matching transactions for this user.
 *
 * Body: { counterpartyKey, counterpartyLabel?, transactionType, categoryId }
 */
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
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
      (transactionType !== "income" && transactionType !== "expense")
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
      INSERT INTO counterparty_category_rules (
        user_id,
        counterparty_key,
        transaction_type,
        category_id
      )
      VALUES (
        ${userId},
        ${counterpartyKey},
        ${transactionType}::category_type,
        ${categoryId}
      )
      ON CONFLICT (user_id, counterparty_key, transaction_type)
      DO UPDATE SET category_id = EXCLUDED.category_id
    `;

    const allRows = (await sql`
      SELECT id, amount, category_id, date::text AS date, notes, type::text AS type,
        sms_counterparty, sms_counterparty_key
      FROM transactions
      WHERE user_id = ${userId} AND type = ${transactionType}::category_type
    `) as TxRow[];

    const labelForRow =
      counterpartyLabel || baseKey.replace(/\b\w/g, (c) => c.toUpperCase());

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

    let updatedRows: TxRow[] = [];
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
      updatedRows = (await sql`
        SELECT id, amount, category_id, date::text AS date, notes, type::text AS type,
          sms_counterparty, sms_counterparty_key
        FROM transactions
        WHERE user_id = ${userId} AND id IN (
          SELECT (jsonb_array_elements_text(${JSON.stringify(matchingIds)}::jsonb))::uuid
        )
      `) as TxRow[];
    }

    return NextResponse.json({
      updatedCount: matchingIds.length,
      transactions: updatedRows.map(rowToTransaction),
    });
  } catch (e) {
    console.error("[POST /api/counterparty-rules]", e);
    return NextResponse.json(
      { error: "Failed to save mapping" },
      { status: 500 }
    );
  }
}
