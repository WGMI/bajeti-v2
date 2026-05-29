import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { ensureDefaultAccount, rowToAccount } from "@/lib/accounts";

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
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "Invalid name" }, { status: 400 });
    }
    const existing = await sql`
      SELECT is_default FROM accounts
      WHERE id = ${id} AND user_id = ${userId}
      LIMIT 1
    `;
    const existingRow = existing[0] as { is_default: boolean } | undefined;
    if (!existingRow) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    if (existingRow.is_default && name.toLowerCase() !== "wallet") {
      return NextResponse.json({ error: "The default Wallet account cannot be renamed" }, { status: 400 });
    }

    const rows = await sql`
      UPDATE accounts
      SET name = ${name}
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id, name, is_default
    `;
    const row = rows[0] as { id: string; name: string; is_default: boolean } | undefined;
    if (!row) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    return NextResponse.json(rowToAccount(row));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to update account" }, { status: 500 });
  }
}

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
    const target = await sql`
      SELECT is_default FROM accounts
      WHERE id = ${id} AND user_id = ${userId}
      LIMIT 1
    `;
    const targetRow = target[0] as { is_default: boolean } | undefined;
    if (!targetRow) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    if (targetRow.is_default) {
      return NextResponse.json({ error: "Cannot delete the default Wallet account" }, { status: 400 });
    }

    const walletId = await ensureDefaultAccount(userId);
    await sql`
      UPDATE transactions
      SET account_id = ${walletId}
      WHERE user_id = ${userId} AND account_id = ${id}
    `;
    await sql`
      DELETE FROM accounts
      WHERE id = ${id} AND user_id = ${userId}
    `;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to delete account" }, { status: 500 });
  }
}
