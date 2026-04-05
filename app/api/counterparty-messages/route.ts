import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { effectiveCounterpartyFromTransaction } from "@/lib/counterparty-helpers";
import { normalizeSmsCounterpartyKey } from "@/lib/sms-parser";
import { normalizeTransactionDateFromDb } from "@/lib/format-date";
import type { CategoryType } from "@/lib/budget-types";

const MAX_SCAN = 400;
const MAX_RETURN = 5;

/**
 * GET /api/counterparty-messages?counterpartyKey=...&transactionType=income|expense
 * Returns a few recent transaction notes (SMS bodies) that match the counterparty key.
 */
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const rawKey = searchParams.get("counterpartyKey");
  const txType = searchParams.get("transactionType");

  if (typeof rawKey !== "string" || !rawKey.trim()) {
    return NextResponse.json({ error: "counterpartyKey required" }, { status: 400 });
  }
  if (txType !== "income" && txType !== "expense") {
    return NextResponse.json({ error: "transactionType must be income or expense" }, { status: 400 });
  }

  const counterpartyKey = normalizeSmsCounterpartyKey(rawKey.trim());
  if (!counterpartyKey) {
    return NextResponse.json({ error: "Invalid counterpartyKey" }, { status: 400 });
  }

  try {
    const rows = (await sql`
      SELECT
        id,
        notes,
        date::text AS date,
        amount::text AS amount,
        sms_counterparty,
        sms_counterparty_key
      FROM transactions
      WHERE user_id = ${userId} AND type = ${txType}::category_type
      ORDER BY date DESC, id DESC
      LIMIT ${MAX_SCAN}
    `) as {
      id: string;
      notes: string | null;
      date: string;
      amount: string;
      sms_counterparty: string | null;
      sms_counterparty_key: string | null;
    }[];

    const messages: { id: string; date: string; amount: number; body: string }[] = [];
    for (const row of rows) {
      const eff = effectiveCounterpartyFromTransaction(
        row.notes ?? "",
        txType as CategoryType,
        row.sms_counterparty_key,
        row.sms_counterparty
      );
      if (eff?.key !== counterpartyKey) continue;
      const body = (row.notes ?? "").trim();
      if (!body) continue;
      messages.push({
        id: row.id,
        date: normalizeTransactionDateFromDb(row.date),
        amount: Number(row.amount),
        body,
      });
      if (messages.length >= MAX_RETURN) break;
    }

    return NextResponse.json({ messages });
  } catch (e) {
    console.error("[GET /api/counterparty-messages]", e);
    return NextResponse.json({ error: "Failed to load messages" }, { status: 500 });
  }
}
