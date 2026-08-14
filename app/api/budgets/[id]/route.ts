import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { requireBajetiPermission } from "@/lib/bajeti-scope";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    const scope = await requireBajetiPermission(userId, _request, "create_budgets");
    const rows = await sql`
      DELETE FROM budget_plans
      WHERE id = ${id} AND ${
        scope.groupId
          ? sql`group_id = ${scope.groupId}`
          : sql`user_id = ${userId} AND group_id IS NULL`
      }
      RETURNING id
    `;
    if (!rows.length) {
      return NextResponse.json({ error: "Budget not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    if (e instanceof Error && e.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Failed to delete budget" }, { status: 500 });
  }
}
