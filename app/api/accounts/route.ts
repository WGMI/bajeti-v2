import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { listAccountsForUser, rowToAccount } from "@/lib/accounts";
import { getBajetiScope, requireBajetiPermission } from "@/lib/bajeti-scope";

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const scope = await getBajetiScope(userId, request);
    const rows = await listAccountsForUser(userId, scope.groupId);
    return NextResponse.json(
      rows.map((row) => ({
        ...rowToAccount(row),
        balance: Number(row.balance ?? 0),
        totalIn: Number(row.total_in ?? 0),
        totalOut: Number(row.total_out ?? 0),
      }))
    );
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to fetch accounts" }, { status: 500 });
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
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "Invalid name" }, { status: 400 });
    }
    if (name.toLowerCase() === "wallet") {
      return NextResponse.json({ error: "Wallet is reserved for the default account" }, { status: 400 });
    }
    const rows = await sql`
      INSERT INTO accounts (user_id, group_id, name, is_default)
      VALUES (${userId}, ${scope.groupId}, ${name}, false)
      RETURNING id, name, is_default
    `;
    const row = rows[0] as { id: string; name: string; is_default: boolean } | undefined;
    if (!row) {
      return NextResponse.json({ error: "Insert failed" }, { status: 500 });
    }
    return NextResponse.json({ ...rowToAccount(row), balance: 0 });
  } catch (e) {
    console.error(e);
    if (e instanceof Error && e.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const message = e instanceof Error && e.message.includes("unique") ? "Account name already exists" : "Failed to create account";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
