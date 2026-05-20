import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { rowToTransaction, type TransactionRow } from "@/lib/transaction-api";

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
    const { amount, categoryId, date, notes, type } = body;
    if (
      amount == null ||
      !categoryId ||
      !date ||
      !type ||
      !["income", "expense", "transfer"].includes(type)
    ) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    const numAmount = Number(amount);
    if (Number.isNaN(numAmount)) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }
    const rows = await sql`
      UPDATE transactions
      SET amount = ${numAmount}, category_id = ${categoryId}, date = ${date}, notes = ${notes ?? ""}, type = (${type})::category_type
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id, amount, category_id, date::text AS date, notes, type,
        sms_counterparty, sms_counterparty_key,
        (SELECT c.name FROM categories c WHERE c.id = category_id AND c.user_id = ${userId}) AS category_name
    `;
    const row = rows[0] as TransactionRow | undefined;
    if (!row) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }
    return NextResponse.json(rowToTransaction(row));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to update transaction" }, { status: 500 });
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
    const rows = await sql`
      DELETE FROM transactions
      WHERE id = ${id} AND user_id = ${userId}
      RETURNING id
    `;
    if (!rows?.length) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to delete transaction" }, { status: 500 });
  }
}
