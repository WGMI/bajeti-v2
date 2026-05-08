import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { parseSMS, smsParseResultForApi } from "@/lib/sms-parser";
import { candidateCounterpartyRuleKeys } from "@/lib/sms-parser";
import { getSmsTransactionDateSource } from "@/lib/user-sms-settings";
import { DEFAULT_CATEGORIES } from "@/lib/budget-types";
import { resolveCategoryForSmsIngestion } from "@/lib/counterparty-helpers";
import type { CategoryType } from "@/lib/budget-types";

type CategoryRow = { id: string; name: string; type: string };

type PreviewTransaction = {
  amount: number;
  categoryId: string | null;
  date: string;
  notes: string;
  type: CategoryType;
  smsCounterparty: string | null;
  smsCounterpartyKey: string | null;
};

async function resolveEffectiveTransactionType(
  userId: string,
  parsed: ReturnType<typeof parseSMS>
): Promise<CategoryType | "neither"> {
  if (parsed.type === "neither" || !parsed.counterpartyKey) return parsed.type;
  const candidateKeys = candidateCounterpartyRuleKeys(parsed.counterpartyKey, parsed.message ?? "");
  if (candidateKeys.length === 0) return parsed.type;
  const ruleRows = await sql`
    SELECT 1
    FROM counterparty_category_rules
    WHERE user_id = ${userId}
      AND transaction_type = ${"transfer"}::category_type
      AND counterparty_key IN (
        SELECT jsonb_array_elements_text(${JSON.stringify(candidateKeys)}::jsonb)
      )
    LIMIT 1
  `;
  return ruleRows.length > 0 ? "transfer" : parsed.type;
}

/**
 * POST /api/sms/preview
 *
 * Parses an SMS and returns a proposed transaction payload without inserting it.
 * Clients can use this to prefill a transaction form and allow edits before save.
 *
 * Body: { message: string, timestamp?: number, includeFeeInExpense?: boolean }
 */
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      message: messageRaw,
      timestamp = null,
      includeFeeInExpense = false,
    } = body;

    if (typeof messageRaw !== "string" || !messageRaw.trim()) {
      return NextResponse.json(
        { error: "Invalid payload: message must be a non-empty string" },
        { status: 400 }
      );
    }

    const transactionDateSource = await getSmsTransactionDateSource(userId);
    const parsed = parseSMS(messageRaw.trim(), {
      timestamp: typeof timestamp === "number" ? timestamp : null,
      includeFeeInExpense: Boolean(includeFeeInExpense),
      transactionDateSource,
    });
    const parsedForApi = smsParseResultForApi(parsed);
    const effectiveType = await resolveEffectiveTransactionType(userId, parsed);

    let skipReason: string | null = null;
    if (effectiveType === "neither") {
      skipReason = "Message did not match an income, expense, or transfer transaction";
    } else if (parsed.amount <= 0) {
      skipReason = "Parsed transaction amount is missing or invalid";
    } else if (!parsed.date) {
      skipReason = "Parsed transaction date is missing or invalid";
    }

    if (skipReason) {
      return NextResponse.json({
        status: "ignored",
        reason: skipReason,
        parsed: parsedForApi,
        preview: null,
      });
    }

    let categoryRows = await sql`
      SELECT id, name, type
      FROM categories
      WHERE user_id = ${userId}
      ORDER BY type, name
    ` as CategoryRow[];

    if (categoryRows.length === 0) {
      for (const c of DEFAULT_CATEGORIES) {
        await sql`
          INSERT INTO categories (user_id, name, type, is_default)
          VALUES (${userId}, ${c.name}, ${c.type}, ${c.isDefault ?? false})
        `;
      }
      categoryRows = await sql`
        SELECT id, name, type
        FROM categories
        WHERE user_id = ${userId}
        ORDER BY type, name
      ` as CategoryRow[];
    }

    const category = await resolveCategoryForSmsIngestion(
      userId,
      { ...parsed, type: effectiveType },
      categoryRows
    );
    const transactionType =
      effectiveType === "income" || effectiveType === "expense" || effectiveType === "transfer"
      ? effectiveType
      : null;
    if (!transactionType) {
      return NextResponse.json({
        status: "ignored",
        reason: "Message did not match an income, expense, or transfer transaction",
        parsed: parsedForApi,
        preview: null,
      });
    }
    const preview: PreviewTransaction = {
      amount: parsed.amount,
      categoryId: category?.id ?? null,
      date: parsed.date,
      notes: parsed.message,
      type: transactionType,
      smsCounterparty: parsed.counterparty,
      smsCounterpartyKey: parsed.counterpartyKey,
    };

    return NextResponse.json({
      status: category ? "ready" : "needs_category",
      reason: category ? null : `No category found for parsed type: ${parsed.type}`,
      parsed: parsedForApi,
      preview,
    });
  } catch (e) {
    console.error("[POST /api/sms/preview]", e);
    return NextResponse.json(
      { error: "Failed to preview SMS transaction" },
      { status: 500 }
    );
  }
}
