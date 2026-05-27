import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { parseSMS, smsParseResultForApi } from "@/lib/sms-parser";
import { candidateCounterpartyRuleKeys } from "@/lib/sms-parser";
import { getSmsTransactionDateSource } from "@/lib/user-sms-settings";
import { DEFAULT_CATEGORIES } from "@/lib/budget-types";
import { resolveCategoryForSmsIngestion } from "@/lib/counterparty-helpers";
import { createHash } from "crypto";
import { buildSmsIdempotencyKey } from "@/lib/sms-idempotency";
import { parseAmountForStorage } from "@/lib/transaction-amount";
import { normalizeTransactionDateFromDb } from "@/lib/format-date";
import { normalizeStoredAmount } from "@/lib/transaction-amount";
import type { CategoryType } from "@/lib/budget-types";

type CategoryRow = { id: string; name: string; type: string };
type TransactionRow = {
  id: string;
  amount: string;
  category_id: string;
  date: string;
  notes: string | null;
  type: string;
  sms_counterparty: string | null;
  sms_counterparty_key: string | null;
};

async function resolveEffectiveTransactionType(
  userId: string,
  parsed: ReturnType<typeof parseSMS>
): Promise<CategoryType | "neither"> {
  const baseType = parsed.type as CategoryType | "neither";
  if (baseType === "neither" || !parsed.counterpartyKey) return baseType;
  const candidateKeys = candidateCounterpartyRuleKeys(parsed.counterpartyKey, parsed.message ?? "");
  if (candidateKeys.length === 0) return baseType;
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
  return ruleRows.length > 0 ? "transfer" : baseType;
}

function transactionJson(row: TransactionRow) {
  return {
    id: row.id,
    amount: normalizeStoredAmount(Number(row.amount)),
    categoryId: row.category_id,
    date: normalizeTransactionDateFromDb(row.date),
    notes: row.notes ?? "",
    type: row.type as CategoryType,
    smsCounterparty: row.sms_counterparty,
    smsCounterpartyKey: row.sms_counterparty_key,
  };
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function normalizeForHash(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * POST /api/sms
 *
 * Receives a money-related SMS message from the mobile app (or any authenticated
 * client), parses it, and optionally creates a transaction.
 *
 * Body: { message: string, timestamp?: number, includeFeeInExpense?: boolean }
 *
 * Auth: Clerk session (Bearer token or cookie). Same as other API routes.
 *
 * Returns: { parsed: SmsParseResult, transaction?: Transaction }
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

    const effectiveType = await resolveEffectiveTransactionType(userId, parsed);

    // Skip creating a transaction for invalid parse results and inform client why.
    let skipReason: string | null = null;
    if (effectiveType === "neither") {
      skipReason = "Message did not match an income, expense, or transfer transaction";
    } else if (effectiveType === "transfer") {
      // Stopgap: prevent transfer-classified SMS from creating DB transactions.
      skipReason = "Transfer messages are temporarily ignored";
    } else if (parsed.amount <= 0) {
      skipReason = "Parsed transaction amount is missing or invalid";
    } else if (!parsed.date) {
      skipReason = "Parsed transaction date is missing or invalid";
    }

    if (skipReason) {
      return NextResponse.json({
        status: "ignored",
        transactionCreated: false,
        reason: skipReason,
        parsed: smsParseResultForApi(parsed),
      });
    }
    const transactionType = effectiveType as CategoryType;
    const storedAmount = parseAmountForStorage(parsed.amount);
    if (storedAmount == null) {
      return NextResponse.json({
        status: "ignored",
        transactionCreated: false,
        reason: "Parsed transaction amount is missing or invalid",
        parsed: smsParseResultForApi(parsed),
      });
    }

    // Ensure user has categories, then get first category of the parsed type
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
    if (!category) {
      return NextResponse.json(
        {
          error: `No ${effectiveType} category found for user`,
          status: "ignored",
          transactionCreated: false,
          reason: `No category found for parsed type: ${effectiveType}`,
          parsed: smsParseResultForApi(parsed),
        },
        { status: 400 }
      );
    }

    const rawMessageHash = sha256(normalizeForHash(parsed.message));
    const smsIdempotencyKey = sha256(
      buildSmsIdempotencyKey({
        type: transactionType,
        amount: parsed.amount,
        date: parsed.date,
        transactionRef: parsed.transactionRef,
      })
    );
    console.log("[POST /api/sms] dedupe key computed", {
      userId,
      parsedType: parsed.type,
      effectiveType: transactionType,
      parsedAmount: parsed.amount,
      parsedDate: parsed.date,
      transactionRef: parsed.transactionRef,
      smsIdempotencyKey,
      rawMessageHash,
    });
    const existingRows = await sql`
      SELECT id, amount, category_id, date::text AS date, notes, type,
        sms_counterparty, sms_counterparty_key
      FROM transactions
      WHERE user_id = ${userId} AND sms_idempotency_key = ${smsIdempotencyKey}
      LIMIT 1
    `;
    const existing = existingRows[0] as TransactionRow | undefined;
    if (existing) {
      console.log("[POST /api/sms] duplicate found by pre-check", {
        userId,
        smsIdempotencyKey,
        existingTransactionId: existing.id,
      });
      return NextResponse.json({
        status: "duplicate",
        transactionCreated: false,
        reason: "SMS already processed",
        parsed: smsParseResultForApi(parsed),
        transaction: transactionJson(existing),
      });
    }

    const rows = await sql`
      INSERT INTO transactions (
        user_id,
        amount,
        category_id,
        date,
        notes,
        type,
        sms_idempotency_key,
        sms_raw_hash,
        sms_counterparty,
        sms_counterparty_key
      )
      VALUES (
        ${userId},
        ${storedAmount},
        ${category.id},
        ${parsed.date},
        ${parsed.message},
        ${transactionType}::category_type,
        ${smsIdempotencyKey},
        ${rawMessageHash},
        ${parsed.counterparty},
        ${parsed.counterpartyKey}
      )
      ON CONFLICT DO NOTHING
      RETURNING id, amount, category_id, date::text AS date, notes, type,
        sms_counterparty, sms_counterparty_key
    `;
    const row = rows[0] as TransactionRow | undefined;
    if (!row) {
      console.log("[POST /api/sms] duplicate detected by unique index", {
        userId,
        smsIdempotencyKey,
      });
      const existingRowsAfterConflict = await sql`
        SELECT id, amount, category_id, date::text AS date, notes, type,
          sms_counterparty, sms_counterparty_key
        FROM transactions
        WHERE user_id = ${userId} AND sms_idempotency_key = ${smsIdempotencyKey}
        LIMIT 1
      `;
      const existingAfterConflict = existingRowsAfterConflict[0] as TransactionRow | undefined;
      if (!existingAfterConflict) {
        console.warn("[POST /api/sms] dedupe conflict but no existing row found", {
          userId,
          smsIdempotencyKey,
        });
        return NextResponse.json(
          { error: "Failed to create transaction", parsed },
          { status: 500 }
        );
      }
      console.log("[POST /api/sms] returning existing transaction for duplicate SMS", {
        userId,
        smsIdempotencyKey,
        existingTransactionId: existingAfterConflict.id,
      });
      return NextResponse.json({
        status: "duplicate",
        transactionCreated: false,
        reason: "SMS already processed",
        parsed: smsParseResultForApi(parsed),
        transaction: transactionJson(existingAfterConflict),
      });
    }
    console.log("[POST /api/sms] transaction inserted (not duplicate)", {
      userId,
      smsIdempotencyKey,
      transactionId: row.id,
    });

    return NextResponse.json({
      status: "created",
      transactionCreated: true,
      parsed: smsParseResultForApi(parsed),
      transaction: transactionJson(row),
    });
  } catch (e) {
    console.error("[POST /api/sms]", e);
    return NextResponse.json(
      { error: "Failed to process SMS" },
      { status: 500 }
    );
  }
}
