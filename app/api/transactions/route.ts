import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { normalizeTransactionDateFromDb } from "@/lib/format-date";
import { createHash } from "crypto";
import type { CategoryType } from "@/lib/budget-types";

type TransactionRow = {
  id: string;
  amount: string;
  category_id: string;
  category_name: string | null;
  date: string;
  notes: string | null;
  type: string;
  sms_counterparty: string | null;
  sms_counterparty_key: string | null;
};

const categoryNameSubquery = (userId: string) => sql`
  (SELECT c.name FROM categories c WHERE c.id = category_id AND c.user_id = ${userId}) AS category_name
`;

type TotalsRow = {
  total_income: string | null;
  total_expense: string | null;
};

function rowToTransaction(row: TransactionRow) {
  return {
    id: row.id,
    amount: Number(row.amount),
    categoryId: row.category_id,
    categoryName: row.category_name ?? "Unknown",
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
    const typeFilter = searchParams.get("type"); // "income" | "expense" | "transfer" or omit
    const dateFrom = searchParams.get("dateFrom"); // YYYY-MM-DD
    const dateTo = searchParams.get("dateTo"); // YYYY-MM-DD
    const search = searchParams.get("search")?.trim() || null;
    const usePagination = cursor != null || limitParam != null;
    const validType =
      typeFilter === "income" || typeFilter === "expense" || typeFilter === "transfer"
        ? typeFilter
        : null;

    const typeCond = validType ? sql`type = ${validType}::category_type` : sql`true`;
    const tTypeCond = validType ? sql`t.type = ${validType}::category_type` : sql`true`;
    const dateFromCond = dateFrom ? sql`date >= ${dateFrom}::date` : sql`true`;
    const dateToCond = dateTo ? sql`date <= ${dateTo}::date` : sql`true`;
    const tDateFromCond = dateFrom ? sql`t.date >= ${dateFrom}::date` : sql`true`;
    const tDateToCond = dateTo ? sql`t.date <= ${dateTo}::date` : sql`true`;
    const searchPattern = search ? `%${search}%` : null;
    const searchCond = searchPattern
      ? sql`(t.notes ILIKE ${searchPattern} OR c.name ILIKE ${searchPattern})`
      : sql`true`;

    let rows: TransactionRow[];
    let totalsRow: TotalsRow[] = [];
    if (searchPattern) {
      totalsRow = await sql`
        SELECT
          COALESCE(SUM(CASE WHEN t.type = 'income' THEN ABS(t.amount) ELSE 0 END), 0)::text AS total_income,
          COALESCE(SUM(CASE WHEN t.type = 'expense' THEN ABS(t.amount) ELSE 0 END), 0)::text AS total_expense
        FROM transactions t
        INNER JOIN categories c ON c.id = t.category_id AND c.user_id = ${userId}
        WHERE t.user_id = ${userId}
          AND ${tTypeCond} AND ${tDateFromCond} AND ${tDateToCond} AND ${searchCond}
      ` as TotalsRow[];
      const cursorCond = cursor
        ? (() => {
            const parts = cursor.split("|");
            const cursorDate = parts[0];
            const cursorId = parts[1];
            if (!cursorDate || !cursorId) return null;
            return sql`AND (t.date < ${cursorDate}::date OR (t.date = ${cursorDate}::date AND t.id < ${cursorId}))`;
          })()
        : sql``;
      if (cursor && !cursorCond) {
        return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
      }
      if (usePagination && cursor) {
        rows = await sql`
          SELECT t.id, t.amount, t.category_id, t.date::text AS date, t.notes, t.type,
            t.sms_counterparty, t.sms_counterparty_key,
            c.name AS category_name
          FROM transactions t
          INNER JOIN categories c ON c.id = t.category_id AND c.user_id = ${userId}
          WHERE t.user_id = ${userId}
            AND ${tTypeCond} AND ${tDateFromCond} AND ${tDateToCond} AND ${searchCond}
            ${cursorCond}
          ORDER BY t.date DESC, t.id DESC
          LIMIT ${limit}
        ` as TransactionRow[];
      } else if (usePagination) {
        rows = await sql`
          SELECT t.id, t.amount, t.category_id, t.date::text AS date, t.notes, t.type,
            t.sms_counterparty, t.sms_counterparty_key,
            c.name AS category_name
          FROM transactions t
          INNER JOIN categories c ON c.id = t.category_id AND c.user_id = ${userId}
          WHERE t.user_id = ${userId}
            AND ${tTypeCond} AND ${tDateFromCond} AND ${tDateToCond} AND ${searchCond}
          ORDER BY t.date DESC, t.id DESC
          LIMIT ${limit}
        ` as TransactionRow[];
      } else {
        rows = await sql`
          SELECT t.id, t.amount, t.category_id, t.date::text AS date, t.notes, t.type,
            t.sms_counterparty, t.sms_counterparty_key,
            c.name AS category_name
          FROM transactions t
          INNER JOIN categories c ON c.id = t.category_id AND c.user_id = ${userId}
          WHERE t.user_id = ${userId}
            AND ${tTypeCond} AND ${tDateFromCond} AND ${tDateToCond} AND ${searchCond}
          ORDER BY t.date DESC, t.id DESC
        ` as TransactionRow[];
      }
    } else {
      totalsRow = await sql`
        SELECT
          COALESCE(SUM(CASE WHEN type = 'income' THEN ABS(amount) ELSE 0 END), 0)::text AS total_income,
          COALESCE(SUM(CASE WHEN type = 'expense' THEN ABS(amount) ELSE 0 END), 0)::text AS total_expense
        FROM transactions
        WHERE user_id = ${userId}
          AND ${typeCond} AND ${dateFromCond} AND ${dateToCond}
      ` as TotalsRow[];
      if (usePagination) {
        if (cursor) {
          const parts = cursor.split("|");
          const cursorDate = parts[0];
          const cursorId = parts[1];
          if (!cursorDate || !cursorId) {
            return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
          }
          rows = await sql`
            SELECT t.id, t.amount, t.category_id, t.date::text AS date, t.notes, t.type,
              t.sms_counterparty, t.sms_counterparty_key,
              c.name AS category_name
            FROM transactions t
            LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = ${userId}
            WHERE t.user_id = ${userId}
              AND ${tTypeCond} AND ${tDateFromCond} AND ${tDateToCond}
              AND (t.date < ${cursorDate}::date OR (t.date = ${cursorDate}::date AND t.id < ${cursorId}))
            ORDER BY t.date DESC, t.id DESC
            LIMIT ${limit}
          ` as TransactionRow[];
        } else {
          rows = await sql`
            SELECT t.id, t.amount, t.category_id, t.date::text AS date, t.notes, t.type,
              t.sms_counterparty, t.sms_counterparty_key,
              c.name AS category_name
            FROM transactions t
            LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = ${userId}
            WHERE t.user_id = ${userId}
              AND ${tTypeCond} AND ${tDateFromCond} AND ${tDateToCond}
            ORDER BY t.date DESC, t.id DESC
            LIMIT ${limit}
          ` as TransactionRow[];
        }
      } else {
        rows = await sql`
          SELECT t.id, t.amount, t.category_id, t.date::text AS date, t.notes, t.type,
            t.sms_counterparty, t.sms_counterparty_key,
            c.name AS category_name
          FROM transactions t
          LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = ${userId}
          WHERE t.user_id = ${userId}
            AND ${tTypeCond} AND ${tDateFromCond} AND ${tDateToCond}
          ORDER BY t.date DESC, t.id DESC
        ` as TransactionRow[];
      }
    }

    const transactions = (rows as TransactionRow[]).map(rowToTransaction);
    const last = transactions[transactions.length - 1];
    const nextCursor =
      usePagination && transactions.length === limit && last
        ? `${last.date}|${last.id}`
        : null;

    const totals = totalsRow[0];
    const totalIncome = Number(totals?.total_income ?? 0);
    const totalExpense = Number(totals?.total_expense ?? 0);

    return NextResponse.json({ transactions, nextCursor, totalIncome, totalExpense });
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
    const { amount, categoryId, date, notes = "", type, idempotencyKey } = body;
    if (
      amount == null ||
      !categoryId ||
      !date ||
      !type ||
      !["income", "expense", "transfer"].includes(type)
    ) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    const numAmount = Number(amount);
    if (Number.isNaN(numAmount)) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }
    const normalizedIdempotencyKey =
      typeof idempotencyKey === "string" && idempotencyKey.trim().length > 0
        ? idempotencyKey.trim().slice(0, 255)
        : null;
    const hashedIdempotencyKey = normalizedIdempotencyKey ? sha256(normalizedIdempotencyKey) : null;
    if (normalizedIdempotencyKey) {
      console.log("[POST /api/transactions] idempotency key provided", {
        userId,
        idempotencyKey: normalizedIdempotencyKey,
        hashedIdempotencyKey,
      });
      const existingRows = await sql`
        SELECT t.id, t.amount, t.category_id, t.date::text AS date, t.notes, t.type,
          t.sms_counterparty, t.sms_counterparty_key,
          c.name AS category_name
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = ${userId}
        WHERE t.user_id = ${userId}
          AND (
            t.sms_idempotency_key = ${hashedIdempotencyKey}
            OR t.sms_idempotency_key = ${normalizedIdempotencyKey}
          )
        LIMIT 1
      `;
      const existing = existingRows[0] as TransactionRow | undefined;
      if (existing) {
        console.log("[POST /api/transactions] duplicate found by pre-check", {
          userId,
          idempotencyKey: normalizedIdempotencyKey,
          hashedIdempotencyKey,
          existingTransactionId: existing.id,
        });
        return NextResponse.json(rowToTransaction(existing));
      }
    }
    const rows = await sql`
      INSERT INTO transactions (user_id, amount, category_id, date, notes, type, sms_idempotency_key)
      VALUES (
        ${userId},
        ${numAmount},
        ${categoryId},
        ${date},
        ${notes},
        ${type}::category_type,
        ${hashedIdempotencyKey}
      )
      ON CONFLICT DO NOTHING
      RETURNING id, amount, category_id, date::text AS date, notes, type,
        sms_counterparty, sms_counterparty_key,
        ${categoryNameSubquery(userId)}
    `;
    const row = rows[0] as TransactionRow | undefined;
    if (!row) {
      if (!normalizedIdempotencyKey) {
        return NextResponse.json({ error: "Insert failed" }, { status: 500 });
      }
      console.log("[POST /api/transactions] duplicate detected by idempotency key", {
        userId,
        idempotencyKey: normalizedIdempotencyKey,
        hashedIdempotencyKey,
      });
      const existingRows = await sql`
        SELECT t.id, t.amount, t.category_id, t.date::text AS date, t.notes, t.type,
          t.sms_counterparty, t.sms_counterparty_key,
          c.name AS category_name
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = ${userId}
        WHERE t.user_id = ${userId}
          AND (
            t.sms_idempotency_key = ${hashedIdempotencyKey}
            OR t.sms_idempotency_key = ${normalizedIdempotencyKey}
          )
        LIMIT 1
      `;
      const existing = existingRows[0] as TransactionRow | undefined;
      if (!existing) {
        return NextResponse.json({ error: "Insert failed" }, { status: 500 });
      }
      return NextResponse.json(rowToTransaction(existing));
    }
    if (normalizedIdempotencyKey) {
      console.log("[POST /api/transactions] inserted with idempotency key", {
        userId,
        idempotencyKey: normalizedIdempotencyKey,
        hashedIdempotencyKey,
        transactionId: row.id,
      });
    }
    return NextResponse.json(rowToTransaction(row));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to create transaction" }, { status: 500 });
  }
}
