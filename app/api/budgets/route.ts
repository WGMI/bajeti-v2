import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { getBajetiScope, requireBajetiPermission } from "@/lib/bajeti-scope";
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
    const scope = await getBajetiScope(userId, request);
    const month = searchParams.get("month");
    const monthCond = month && isValidBudgetMonth(month) ? sql`month = ${month}` : sql`true`;
    const rows = await sql`
      SELECT id, type, month, amount, category_id
      FROM budget_plans
      WHERE ${
        scope.groupId
          ? sql`group_id = ${scope.groupId}`
          : sql`user_id = ${userId} AND group_id IS NULL`
      } AND ${monthCond}
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
    const scope = await requireBajetiPermission(userId, request, "create_budgets");
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
        INSERT INTO budget_plans (user_id, group_id, type, month, amount, category_id)
        VALUES (${userId}, ${scope.groupId}, ${type}, ${month}, ${amount}, ${null})
        ON CONFLICT ${
          scope.groupId
            ? sql`(group_id, month) WHERE type = 'overall' AND group_id IS NOT NULL`
            : sql`(user_id, month) WHERE type = 'overall' AND group_id IS NULL`
        }
        DO UPDATE SET amount = EXCLUDED.amount
        RETURNING id, type, month, amount, category_id
      `;
      return NextResponse.json(rowToBudgetPlan(rows[0] as BudgetPlanRow));
    }

    const categoryRows = await sql`
      SELECT id
      FROM categories
      WHERE id = ${categoryId}
        AND ${
          scope.groupId
            ? sql`group_id = ${scope.groupId}`
            : sql`user_id = ${userId} AND group_id IS NULL`
        }
        AND type = 'expense'::category_type
      LIMIT 1
    `;
    if (!categoryRows.length) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    const rows = await sql`
      INSERT INTO budget_plans (user_id, group_id, type, month, amount, category_id)
      VALUES (${userId}, ${scope.groupId}, ${type}, ${month}, ${amount}, ${categoryId})
      ON CONFLICT ${
        scope.groupId
          ? sql`(group_id, month, category_id) WHERE type = 'category' AND group_id IS NOT NULL`
          : sql`(user_id, month, category_id) WHERE type = 'category' AND group_id IS NULL`
      }
      DO UPDATE SET amount = EXCLUDED.amount
      RETURNING id, type, month, amount, category_id
    `;
    return NextResponse.json(rowToBudgetPlan(rows[0] as BudgetPlanRow));
  } catch (e) {
    console.error(e);
    if (e instanceof Error && e.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Failed to save budget" }, { status: 500 });
  }
}
