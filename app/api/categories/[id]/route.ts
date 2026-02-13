import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";

type CategoryRow = { id: string; name: string; type: string; is_default: boolean };

function rowToCategory(row: CategoryRow) {
  return {
    id: row.id,
    name: row.name,
    type: row.type as "income" | "expense",
    isDefault: row.is_default,
  };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    const body = await request.json();
    const { name, type } = body;
    if (!name || !type || !["income", "expense"].includes(type)) {
      return NextResponse.json({ error: "Invalid name or type" }, { status: 400 });
    }
    const rows = await sql`
      UPDATE categories
      SET name = ${name.trim()}, type = (${type})::category_type
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id, name, type, is_default
    `;
    const row = rows[0] as CategoryRow | undefined;
    if (!row) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }
    return NextResponse.json(rowToCategory(row));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to update category" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    const categoryRows = await sql`
      SELECT id, type FROM categories
      WHERE id = ${id} AND user_id = ${userId}
    `;
    const category = categoryRows[0];
    if (!category) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    const transactionCountRows = await sql`
      SELECT COUNT(*)::int AS count FROM transactions WHERE category_id = ${id}
    `;
    const transactionCount = transactionCountRows[0]?.count ?? 0;

    let body: { reassignToCategoryId?: string; deleteTransactions?: boolean } = {};
    try {
      const raw = await request.text();
      if (raw?.trim()) body = JSON.parse(raw);
    } catch {
      // no body or invalid JSON
    }

    const { reassignToCategoryId, deleteTransactions } = body;

    if (transactionCount > 0) {
      if (deleteTransactions === true) {
        await sql`DELETE FROM transactions WHERE category_id = ${id}`;
      } else if (reassignToCategoryId) {
        const targetRows = await sql`
          SELECT id FROM categories
          WHERE id = ${reassignToCategoryId} AND user_id = ${userId} AND type = (${category.type})::category_type AND id <> ${id}
        `;
        if (!targetRows.length) {
          return NextResponse.json(
            { error: "Invalid category to reassign to" },
            { status: 400 }
          );
        }
        await sql`
          UPDATE transactions SET category_id = ${reassignToCategoryId} WHERE category_id = ${id}
        `;
      } else {
        return NextResponse.json(
          { error: "Category has transactions", transactionCount },
          { status: 409 }
        );
      }
    }

    await sql`
      DELETE FROM categories
      WHERE id = ${id} AND user_id = ${userId}
    `;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to delete category" }, { status: 500 });
  }
}
