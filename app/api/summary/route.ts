import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { decryptNumber, decryptOptionalNumber } from "@/lib/text-encryption";

type Summary = {
  income: number;
  expensePrincipal: number;
  transactionCharges: number;
  expenses: number;
  transactionsCount: number;
};

type SummaryTransactionRow = {
  date: string;
  type: string;
  amount_encrypted: string | null;
  transaction_charges: string | null;
  transaction_charges_encrypted: string | null;
  category_id: string;
  category_name: string | null;
};

function isValidMonth(month: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

function monthBounds(month: string): { startDate: string; endDateExclusive: string } {
  const [year, monthPart] = month.split("-").map((value) => Number(value));
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

function emptySummary(): Summary {
  return {
    income: 0,
    expensePrincipal: 0,
    transactionCharges: 0,
    expenses: 0,
    transactionsCount: 0,
  };
}

function addTransaction(summary: Summary, type: string, amount: number, charges: number) {
  summary.transactionsCount += 1;
  if (type === "income") {
    summary.income += amount;
  } else if (type === "expense") {
    summary.expensePrincipal += amount;
    summary.transactionCharges += charges;
    summary.expenses += amount + charges;
  }
}

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get("month") ?? getCurrentMonth();
    if (!isValidMonth(month)) {
      return NextResponse.json({ error: "Invalid month. Use YYYY-MM." }, { status: 400 });
    }

    const trendMonthsRaw = Number.parseInt(searchParams.get("trendMonths") ?? "6", 10);
    const trendMonths = Number.isFinite(trendMonthsRaw)
      ? Math.max(1, Math.min(trendMonthsRaw, 24))
      : 6;
    const { startDate, endDateExclusive } = monthBounds(month);
    const [year, monthPart] = month.split("-").map(Number);
    const trendMonthsList = Array.from({ length: trendMonths + 1 }, (_, index) => {
      const date = new Date(Date.UTC(year, monthPart - trendMonths + index, 1));
      return date.toISOString().slice(0, 7);
    });

    const rows = (await sql`
      SELECT
        t.date::text AS date,
        t.type::text AS type,
        t.amount_encrypted,
        t.transaction_charges,
        t.transaction_charges_encrypted,
        t.category_id,
        COALESCE(c.name, 'Unknown') AS category_name
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = ${userId}
      WHERE t.user_id = ${userId}
    `) as SummaryTransactionRow[];

    const current = emptySummary();
    const allTime = emptySummary();
    const trend = new Map(trendMonthsList.map((trendMonth) => [trendMonth, emptySummary()]));
    const expenseByCategory = new Map<
      string,
      {
        categoryId: string;
        categoryName: string;
        principal: number;
        transactionCharges: number;
        amount: number;
      }
    >();

    for (const row of rows) {
      const amount = Math.abs(
        decryptNumber(row.amount_encrypted, null, { userId, field: "amount" })
      );
      const charges = Math.max(
        0,
        decryptOptionalNumber(
          row.transaction_charges_encrypted,
          row.transaction_charges,
          { userId, field: "transaction_charges" }
        ) ?? 0
      );
      addTransaction(allTime, row.type, amount, charges);

      const rowMonth = row.date.slice(0, 7);
      const trendSummary = trend.get(rowMonth);
      if (trendSummary) addTransaction(trendSummary, row.type, amount, charges);
      if (row.date < startDate || row.date >= endDateExclusive) continue;

      addTransaction(current, row.type, amount, charges);
      if (row.type === "expense") {
        const category = expenseByCategory.get(row.category_id) ?? {
          categoryId: row.category_id,
          categoryName: row.category_name ?? "Unknown",
          principal: 0,
          transactionCharges: 0,
          amount: 0,
        };
        category.principal += amount;
        category.transactionCharges += charges;
        category.amount += amount + charges;
        expenseByCategory.set(row.category_id, category);
      }
    }

    const withBalance = (summary: Summary) => ({
      ...summary,
      balance: summary.income - summary.expenses,
    });

    return NextResponse.json({
      period: { month, startDate, endDateExclusive },
      currentMonth: withBalance(current),
      allTime: withBalance(allTime),
      trend: trendMonthsList.map((trendMonth) => ({
        month: trendMonth,
        ...withBalance(trend.get(trendMonth) ?? emptySummary()),
      })),
      expenseByCategory: [...expenseByCategory.values()].sort(
        (a, b) => b.amount - a.amount || a.categoryName.localeCompare(b.categoryName)
      ),
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to fetch summary" }, { status: 500 });
  }
}
