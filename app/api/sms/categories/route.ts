import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { DEFAULT_CATEGORIES } from "@/lib/budget-types";

type CategoryRow = { id: string; name: string; type: string; is_default: boolean };

function rowToCategory(row: CategoryRow) {
  return {
    id: row.id,
    name: row.name,
    type: row.type as "income" | "expense",
    isDefault: row.is_default,
  };
}

/**
 * GET /api/sms/categories
 *
 * Returns all user categories for SMS preview/edit flows.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let rows = await sql`
      SELECT id, name, type, is_default
      FROM categories
      WHERE user_id = ${userId}
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
        WHERE user_id = ${userId}
        ORDER BY type, name
      `;
    }

    return NextResponse.json((rows as CategoryRow[]).map(rowToCategory));
  } catch (e) {
    console.error("[GET /api/sms/categories]", e);
    return NextResponse.json({ error: "Failed to fetch categories" }, { status: 500 });
  }
}
