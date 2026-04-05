import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";

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
    const rows = await sql`
      DELETE FROM counterparty_category_rules
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id
    `;
    if (!rows?.length) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/counterparty-rules/[id]]", e);
    return NextResponse.json({ error: "Failed to delete rule" }, { status: 500 });
  }
}
