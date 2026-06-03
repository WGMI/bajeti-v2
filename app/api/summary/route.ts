import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";

type SummaryRow = {
  income: string | number | null;
  expenses: string | number | null;
  transactions_count: string | number | null;
};

type TrendRow = {
  month: string;
  income: string | number | null;
  expenses: string | number | null;
};

type CategoryExpenseRow = {
  category_id: string;
  category_name: string;
  amount: string | number | null;
};

function asNumber(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isValidMonth(month: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

function monthBounds(month: string): { startDate: string; endDateExclusive: string } {
  const [year, monthPart] = month.split("-").map((v) => Number(v));
  const start = new Date(Date.UTC(year, monthPart - 1, 1));
  const end = new Date(Date.UTC(year, monthPart, 1));
  return {
    startDate: start.toISOString().slice(0, 10),
    endDateExclusive: end.toISOString().slice(0, 10),
  };
}

function getCurrentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const monthParam = searchParams.get("month");
    const trendMonthsParam = searchParams.get("trendMonths");

    const month = monthParam ?? getCurrentMonth();
    if (!isValidMonth(month)) {
      return NextResponse.json({ error: "Invalid month. Use YYYY-MM." }, { status: 400 });
    }

    const trendMonthsRaw = trendMonthsParam ? Number.parseInt(trendMonthsParam, 10) : 6;
    const trendMonths = Number.isFinite(trendMonthsRaw)
      ? Math.max(1, Math.min(trendMonthsRaw, 24))
      : 6;

    const { startDate, endDateExclusive } = monthBounds(month);
    const trendStartMonth = (() => {
      const [year, monthPart] = month.split("-").map((v) => Number(v));
      const d = new Date(Date.UTC(year, monthPart - trendMonths, 1));
      return d.toISOString().slice(0, 7);
    })();

    const currentRows = (await sql`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'income' THEN ABS(amount) ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN ABS(amount) + COALESCE(transaction_charges, 0) ELSE 0 END), 0) AS expenses,
        COUNT(*) AS transactions_count
      FROM transactions
      WHERE user_id = ${userId}
        AND date >= ${startDate}::date
        AND date < ${endDateExclusive}::date
    `) as SummaryRow[];

    const allTimeRows = (await sql`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'income' THEN ABS(amount) ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN ABS(amount) + COALESCE(transaction_charges, 0) ELSE 0 END), 0) AS expenses,
        COUNT(*) AS transactions_count
      FROM transactions
      WHERE user_id = ${userId}
    `) as SummaryRow[];

    const trendRows = (await sql`
      WITH months AS (
        SELECT generate_series(
          ${trendStartMonth + "-01"}::date,
          ${month + "-01"}::date,
          interval '1 month'
        )::date AS month_start
      )
      SELECT
        TO_CHAR(m.month_start, 'YYYY-MM') AS month,
        COALESCE(SUM(CASE WHEN t.type = 'income' THEN ABS(t.amount) ELSE 0 END), 0) AS income,
        COALESCE(SUM(CASE WHEN t.type = 'expense' THEN ABS(t.amount) + COALESCE(t.transaction_charges, 0) ELSE 0 END), 0) AS expenses
      FROM months m
      LEFT JOIN transactions t
        ON t.user_id = ${userId}
       AND t.date >= m.month_start
       AND t.date < (m.month_start + interval '1 month')
      GROUP BY m.month_start
      ORDER BY m.month_start ASC
    `) as TrendRow[];

    const expenseByCategoryRows = (await sql`
      SELECT
        c.id AS category_id,
        c.name AS category_name,
        COALESCE(SUM(ABS(t.amount) + COALESCE(t.transaction_charges, 0)), 0) AS amount
      FROM transactions t
      INNER JOIN categories c
        ON c.id = t.category_id
       AND c.user_id = ${userId}
      WHERE t.user_id = ${userId}
        AND t.type = 'expense'
        AND t.date >= ${startDate}::date
        AND t.date < ${endDateExclusive}::date
      GROUP BY c.id, c.name
      ORDER BY amount DESC, c.name ASC
    `) as CategoryExpenseRow[];

    const current = currentRows[0] ?? { income: 0, expenses: 0, transactions_count: 0 };
    const allTime = allTimeRows[0] ?? { income: 0, expenses: 0, transactions_count: 0 };

    const currentIncome = asNumber(current.income);
    const currentExpenses = asNumber(current.expenses);
    const allIncome = asNumber(allTime.income);
    const allExpenses = asNumber(allTime.expenses);

    return NextResponse.json({
      period: { month, startDate, endDateExclusive },
      currentMonth: {
        income: currentIncome,
        expenses: currentExpenses,
        balance: currentIncome - currentExpenses,
        transactionsCount: asNumber(current.transactions_count),
      },
      allTime: {
        income: allIncome,
        expenses: allExpenses,
        balance: allIncome - allExpenses,
        transactionsCount: asNumber(allTime.transactions_count),
      },
      trend: trendRows.map((row) => ({
        month: row.month,
        income: asNumber(row.income),
        expenses: asNumber(row.expenses),
        balance: asNumber(row.income) - asNumber(row.expenses),
      })),
      expenseByCategory: expenseByCategoryRows.map((row) => ({
        categoryId: row.category_id,
        categoryName: row.category_name,
        amount: asNumber(row.amount),
      })),
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to fetch summary" }, { status: 500 });
  }
}
