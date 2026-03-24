import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { parseSMS } from "@/lib/sms-parser";
import { DEFAULT_CATEGORIES } from "@/lib/budget-types";

type CategoryRow = { id: string; name: string; type: string };
type TransactionRow = {
  id: string;
  amount: string;
  category_id: string;
  date: string;
  notes: string | null;
  type: string;
};

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

    const parsed = parseSMS(messageRaw.trim(), {
      timestamp: typeof timestamp === "number" ? timestamp : null,
      includeFeeInExpense: Boolean(includeFeeInExpense),
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
          },
        },
        { status: 400 }
      );
    }

    const rows = await sql`
      INSERT INTO transactions (user_id, amount, category_id, date, notes, type)
      VALUES (${userId}, ${parsed.amount}, ${category.id}, ${parsed.date}, ${parsed.message}, ${parsed.type}::category_type)
      RETURNING id, amount, category_id, date, notes, type
    `;
    const row = rows[0] as TransactionRow | undefined;
    if (!row) {
      return NextResponse.json(
        { error: "Failed to create transaction", parsed },
        { status: 500 }
      );
    }

    return NextResponse.json({
      status: "created",
      transactionCreated: true,
      parsed: {
        message: parsed.message,
        type: parsed.type,
        amount: parsed.amount,
        date: parsed.date,
        fee: parsed.fee,
      },
      transaction: {
        id: row.id,
        amount: Number(row.amount),
        categoryId: row.category_id,
        date: row.date,
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
