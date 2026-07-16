import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { listAccountsForUser, rowToAccount } from "@/lib/accounts";
import { DEFAULT_CATEGORIES, type Category, type CategoryType } from "@/lib/budget-types";
import { parseVoiceTransaction } from "@/lib/voice-transaction-parser";

type CategoryRow = {
  id: string;
  name: string;
  type: string;
  is_default: boolean;
};

function rowToCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    type: row.type as CategoryType,
    isDefault: row.is_default,
  };
}

async function listCategoriesForUser(userId: string): Promise<Category[]> {
  let rows = (await sql`
    SELECT id, name, type, is_default
    FROM categories
    WHERE user_id = ${userId}
    ORDER BY type, name
  `) as CategoryRow[];

  if (rows.length === 0) {
    for (const category of DEFAULT_CATEGORIES) {
      await sql`
        INSERT INTO categories (user_id, name, type, is_default)
        VALUES (${userId}, ${category.name}, ${category.type}, ${category.isDefault ?? false})
      `;
    }
    rows = (await sql`
      SELECT id, name, type, is_default
      FROM categories
      WHERE user_id = ${userId}
      ORDER BY type, name
    `) as CategoryRow[];
  }

  return rows.map(rowToCategory);
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      transcript?: unknown;
      timestamp?: unknown;
    };
    const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
    if (!transcript) {
      return NextResponse.json({ error: "Transcript is required" }, { status: 400 });
    }
    if (transcript.length > 1000) {
      return NextResponse.json({ error: "Transcript is too long" }, { status: 400 });
    }

    const [categoryRows, accountRows] = await Promise.all([
      listCategoriesForUser(userId),
      listAccountsForUser(userId),
    ]);
    const accounts = accountRows.map((row) => ({
      ...rowToAccount(row),
      balance: Number(row.balance ?? 0),
      totalIn: Number(row.total_in ?? 0),
      totalOut: Number(row.total_out ?? 0),
    }));

    const result = parseVoiceTransaction({
      transcript,
      categories: categoryRows,
      accounts,
      timestamp: typeof body.timestamp === "number" ? body.timestamp : null,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[POST /api/voice/preview]", error);
    return NextResponse.json({ error: "Failed to preview voice transaction" }, { status: 500 });
  }
}
