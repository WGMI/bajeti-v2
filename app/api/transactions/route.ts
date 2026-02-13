import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";

type TransactionRow = {
  id: string;
  amount: string;
  category_id: string;
  date: string;
  notes: string | null;
  type: string;
};

function rowToTransaction(row: TransactionRow) {
  return {
    id: row.id,
    amount: Number(row.amount),
    categoryId: row.category_id,
    date: row.date,
    notes: row.notes ?? "",
    type: row.type as "income" | "expense",
  };
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get("limit");
    const limit = Math.min(
      Math.max(1, limitParam ? parseInt(limitParam, 10) : DEFAULT_LIMIT),
      MAX_LIMIT
    );
    const cursor = searchParams.get("cursor");
    const usePagination = cursor != null || limitParam != null;

    let rows: TransactionRow[];
    if (usePagination) {
      if (cursor) {
        const parts = cursor.split("|");
        const cursorDate = parts[0];
        const cursorId = parts[1];
        if (!cursorDate || !cursorId) {
          return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
        }
        rows = await sql`
          SELECT id, amount, category_id, date, notes, type
          FROM transactions
          WHERE user_id = ${userId}
            AND (date < ${cursorDate}::date OR (date = ${cursorDate}::date AND id < ${cursorId}))
          ORDER BY date DESC, id DESC
          LIMIT ${limit}
        ` as TransactionRow[];
      } else {
        rows = await sql`
          SELECT id, amount, category_id, date, notes, type
          FROM transactions
          WHERE user_id = ${userId}
          ORDER BY date DESC, id DESC
          LIMIT ${limit}
        ` as TransactionRow[];
      }
    } else {
      rows = await sql`
        SELECT id, amount, category_id, date, notes, type
        FROM transactions
        WHERE user_id = ${userId}
        ORDER BY date DESC, id DESC
      ` as TransactionRow[];
    }

    const transactions = (rows as TransactionRow[]).map(rowToTransaction);
    const last = transactions[transactions.length - 1];
    const nextCursor =
      usePagination && transactions.length === limit && last
        ? `${last.date}|${last.id}`
        : null;

    return NextResponse.json({ transactions, nextCursor });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to fetch transactions" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await request.json();
    const { amount, categoryId, date, notes = "", type } = body;
    if (
      amount == null ||
      !categoryId ||
      !date ||
      !type ||
      !["income", "expense"].includes(type)
    ) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    const numAmount = Number(amount);
    if (Number.isNaN(numAmount)) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }
    const rows = await sql`
      INSERT INTO transactions (user_id, amount, category_id, date, notes, type)
      VALUES (${userId}, ${numAmount}, ${categoryId}, ${date}, ${notes}, ${type}::category_type)
      RETURNING id, amount, category_id, date, notes, type
    `;
    const row = rows[0] as TransactionRow | undefined;
    if (!row) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
    return NextResponse.json(rowToTransaction(row));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to create transaction" }, { status: 500 });
  }
}
