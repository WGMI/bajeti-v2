import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { parseSMS } from "@/lib/sms-parser";
import { getSmsTransactionDateSource } from "@/lib/user-sms-settings";
import { DEFAULT_CATEGORIES } from "@/lib/budget-types";
import { createHash } from "crypto";
import { buildSmsIdempotencyKey } from "@/lib/sms-idempotency";
import { normalizeTransactionDateFromDb } from "@/lib/format-date";

type CategoryRow = { id: string; name: string; type: string };
type TransactionRow = {
  id: string;
  amount: string;
  category_id: string;
  date: string;
  notes: string | null;
  type: string;
};

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

    // Skip creating a transaction for invalid parse results and inform client why.
    let skipReason: string | null = null;
    if (parsed.type === "neither") {
      skipReason = "Message did not match an income or expense transaction";
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
        parsed: {
          message: parsed.message,
          type: parsed.type,
          amount: parsed.amount,
          date: parsed.date,
          fee: parsed.fee,
          transactionRef: parsed.transactionRef,
        },
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

    const category = categoryRows.find((c) => c.type === parsed.type);
    if (!category) {
      return NextResponse.json(
        {
          error: `No ${parsed.type} category found for user`,
          status: "ignored",
          transactionCreated: false,
          reason: `No category found for parsed type: ${parsed.type}`,
          parsed: {
            message: parsed.message,
            type: parsed.type,
            amount: parsed.amount,
            date: parsed.date,
            fee: parsed.fee,
            transactionRef: parsed.transactionRef,
          },
        },
        { status: 400 }
      );
    }

    const rawMessageHash = sha256(normalizeForHash(parsed.message));
    const smsIdempotencyKey = sha256(
      buildSmsIdempotencyKey({
        type: parsed.type as "income" | "expense",
        amount: parsed.amount,
        date: parsed.date,
        transactionRef: parsed.transactionRef,
      })
    );
    console.log("[POST /api/sms] dedupe key computed", {
      userId,
      parsedType: parsed.type,
      parsedAmount: parsed.amount,
      parsedDate: parsed.date,
      transactionRef: parsed.transactionRef,
      smsIdempotencyKey,
      rawMessageHash,
    });
    const existingRows = await sql`
      SELECT id, amount, category_id, date::text AS date, notes, type
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
        parsed: {
          message: parsed.message,
          type: parsed.type,
          amount: parsed.amount,
          date: parsed.date,
          fee: parsed.fee,
          transactionRef: parsed.transactionRef,
        },
        transaction: {
          id: existing.id,
          amount: Number(existing.amount),
          categoryId: existing.category_id,
          date: normalizeTransactionDateFromDb(existing.date),
          notes: existing.notes ?? "",
          type: existing.type as "income" | "expense",
        },
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
        sms_raw_hash
      )
      VALUES (
        ${userId},
        ${parsed.amount},
        ${category.id},
        ${parsed.date},
        ${parsed.message},
        ${parsed.type}::category_type,
        ${smsIdempotencyKey},
        ${rawMessageHash}
      )
      ON CONFLICT DO NOTHING
      RETURNING id, amount, category_id, date::text AS date, notes, type
    `;
    const row = rows[0] as TransactionRow | undefined;
    if (!row) {
      console.log("[POST /api/sms] duplicate detected by unique index", {
        userId,
        smsIdempotencyKey,
      });
      const existingRowsAfterConflict = await sql`
        SELECT id, amount, category_id, date::text AS date, notes, type
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
        parsed: {
          message: parsed.message,
          type: parsed.type,
          amount: parsed.amount,
          date: parsed.date,
          fee: parsed.fee,
          transactionRef: parsed.transactionRef,
        },
        transaction: {
          id: existingAfterConflict.id,
          amount: Number(existingAfterConflict.amount),
          categoryId: existingAfterConflict.category_id,
          date: normalizeTransactionDateFromDb(existingAfterConflict.date),
          notes: existingAfterConflict.notes ?? "",
          type: existingAfterConflict.type as "income" | "expense",
        },
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
      parsed: {
        message: parsed.message,
        type: parsed.type,
        amount: parsed.amount,
        date: parsed.date,
        fee: parsed.fee,
        transactionRef: parsed.transactionRef,
      },
      transaction: {
        id: row.id,
        amount: Number(row.amount),
        categoryId: row.category_id,
        date: normalizeTransactionDateFromDb(row.date),
        notes: row.notes ?? "",
        type: row.type as "income" | "expense",
      },
    });
  } catch (e) {
    console.error("[POST /api/sms]", e);
    return NextResponse.json(
      { error: "Failed to process SMS" },
      { status: 500 }
    );
  }
}
