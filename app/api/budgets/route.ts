import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import {
  isValidBudgetMonth,
  rowToBudgetPlan,
  type BudgetPlanRow,
} from "@/lib/budget-plan-api";

function parseAmount(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get("month");
    const monthCond = month && isValidBudgetMonth(month) ? sql`month = ${month}` : sql`true`;
    const rows = await sql`
      SELECT id, type, month, amount, category_id
      FROM budget_plans
      WHERE user_id = ${userId} AND ${monthCond}
      ORDER BY month DESC, type DESC, category_id NULLS FIRST
    `;
    return NextResponse.json((rows as BudgetPlanRow[]).map(rowToBudgetPlan));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to fetch budgets" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await request.json();
    const type = body.type;
    const month = body.month;
    const amount = parseAmount(body.amount);
    const categoryId = typeof body.categoryId === "string" ? body.categoryId : null;

    if ((type !== "overall" && type !== "category") || !isValidBudgetMonth(month) || amount == null) {
      return NextResponse.json({ error: "Invalid budget payload" }, { status: 400 });
    }
    if (type === "overall" && categoryId) {
      return NextResponse.json({ error: "Overall budgets cannot include a category" }, { status: 400 });
    }
    if (type === "category" && !categoryId) {
      return NextResponse.json({ error: "Category budgets require a category" }, { status: 400 });
    }

    if (type === "overall") {
      const rows = await sql`
        INSERT INTO budget_plans (user_id, type, month, amount, category_id)
        VALUES (${userId}, ${type}, ${month}, ${amount}, ${null})
        ON CONFLICT (user_id, month) WHERE type = 'overall'
        DO UPDATE SET amount = EXCLUDED.amount
        RETURNING id, type, month, amount, category_id
      `;
      return NextResponse.json(rowToBudgetPlan(rows[0] as BudgetPlanRow));
    }

    const categoryRows = await sql`
      SELECT id
      FROM categories
      WHERE id = ${categoryId} AND user_id = ${userId} AND type = 'expense'::category_type
      LIMIT 1
    `;
    if (!categoryRows.length) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    const rows = await sql`
      INSERT INTO budget_plans (user_id, type, month, amount, category_id)
      VALUES (${userId}, ${type}, ${month}, ${amount}, ${categoryId})
      ON CONFLICT (user_id, month, category_id) WHERE type = 'category'
      DO UPDATE SET amount = EXCLUDED.amount
      RETURNING id, type, month, amount, category_id
    `;
    return NextResponse.json(rowToBudgetPlan(rows[0] as BudgetPlanRow));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to save budget" }, { status: 500 });
  }
}
