import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import {
  ensureDefaultCategoriesForScope,
  getBajetiScope,
  requireBajetiPermission,
} from "@/lib/bajeti-scope";
import { DEFAULT_CATEGORIES } from "@/lib/budget-types";
import type { CategoryType } from "@/lib/budget-types";

type CategoryRow = { id: string; name: string; type: string; is_default: boolean };

function rowToCategory(row: CategoryRow) {
  return {
    id: row.id,
    name: row.name,
    type: row.type as CategoryType,
    isDefault: row.is_default,
  };
}

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const scope = await getBajetiScope(userId, request);
    await ensureDefaultCategoriesForScope(userId, scope.groupId);
    let rows = await sql`
      SELECT id, name, type, is_default
      FROM categories
      WHERE ${
        scope.groupId
          ? sql`group_id = ${scope.groupId}`
          : sql`user_id = ${userId} AND group_id IS NULL`
      }
      ORDER BY type, name
    `;
    if (rows.length === 0) {
      for (const c of DEFAULT_CATEGORIES) {
        await sql`
          INSERT INTO categories (user_id, name, type, is_default)
          VALUES (${userId}, ${c.name}, ${c.type}, ${c.isDefault ?? false})
        `;
      }
      rows = await sql`
        SELECT id, name, type, is_default
        FROM categories
        WHERE ${
          scope.groupId
            ? sql`group_id = ${scope.groupId}`
            : sql`user_id = ${userId} AND group_id IS NULL`
        }
        ORDER BY type, name
      `;
    }
    return NextResponse.json((rows as CategoryRow[]).map(rowToCategory));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to fetch categories" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const scope = await requireBajetiPermission(userId, request, "manage_categories");
    const body = await request.json();
    const { name, type, isDefault = false } = body;
    if (!name || !type || !["income", "expense", "transfer"].includes(type)) {
      return NextResponse.json({ error: "Invalid name or type" }, { status: 400 });
    }
    const rows = await sql`
      INSERT INTO categories (user_id, group_id, name, type, is_default)
      VALUES (${userId}, ${scope.groupId}, ${name.trim()}, ${type}::category_type, ${isDefault})
      RETURNING id, name, type, is_default
    `;
    const row = rows[0] as CategoryRow | undefined;
    if (!row) return NextResponse.json({ error: "Insert failed" }, { status: 500 });
    return NextResponse.json(rowToCategory(row));
  } catch (e) {
    console.error(e);
    if (e instanceof Error && e.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Failed to create category" }, { status: 500 });
  }
}
