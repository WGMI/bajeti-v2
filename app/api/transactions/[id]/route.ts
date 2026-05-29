import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { rowToTransaction, type TransactionRow } from "@/lib/transaction-api";
import { parseAmountForStorage } from "@/lib/transaction-amount";
import { resolveAccountId } from "@/lib/accounts";
import {
  deleteTransferGroup,
  findTransferGroupMate,
  updateTransferPair,
} from "@/lib/transfers";

async function fetchTransactionById(userId: string, id: string): Promise<TransactionRow | null> {
  const rows = await sql`
    SELECT
      t.id, t.amount, t.account_id, t.category_id, t.date::text AS date, t.notes, t.type,
      t.sms_counterparty, t.sms_counterparty_key,
      t.transfer_group_id, t.transfer_leg::text AS transfer_leg,
      c.name AS category_name,
      ac.name AS account_name,
      mate.account_id AS counter_account_id,
      mate_ac.name AS counter_account_name
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN accounts ac ON ac.id = t.account_id
    LEFT JOIN transactions mate ON mate.user_id = t.user_id
      AND mate.transfer_group_id = t.transfer_group_id
      AND mate.id <> t.id
    LEFT JOIN accounts mate_ac ON mate_ac.id = mate.account_id
    WHERE t.user_id = ${userId} AND t.id = ${id}
    LIMIT 1
  `;
  return (rows[0] as TransactionRow | undefined) ?? null;
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
    const { amount, categoryId, date, notes, type, accountId, fromAccountId, toAccountId } = body;
    if (
      amount == null ||
      !categoryId ||
      !date ||
      !type ||
      !["income", "expense", "transfer"].includes(type)
    ) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const existing = await fetchTransactionById(userId, id);
    if (!existing) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    if (type === "transfer" && existing.transfer_group_id) {
      if (!fromAccountId || !toAccountId) {
        return NextResponse.json(
          { error: "Paired transfers require fromAccountId and toAccountId" },
          { status: 400 }
        );
      }
      try {
        const pair = await updateTransferPair({
          userId,
          transferGroupId: existing.transfer_group_id,
          amount,
          categoryId,
          date,
          notes: notes ?? "",
          fromAccountId,
          toAccountId,
        });
        const outLeg = pair.find((r) => r.transfer_leg === "out") ?? pair[0];
        return NextResponse.json(rowToTransaction(outLeg));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to update transfer";
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }

    if (type === "transfer" && !existing.transfer_group_id) {
      return NextResponse.json(
        { error: "Legacy transfer rows must be recreated with from/to accounts" },
        { status: 400 }
      );
    }

    const numAmount = parseAmountForStorage(amount);
    if (numAmount == null) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }
    const resolvedAccountId = await resolveAccountId(userId, accountId ?? existing.account_id);

    await sql`
      UPDATE transactions
      SET
        amount = ${numAmount},
        category_id = ${categoryId},
        account_id = ${resolvedAccountId},
        date = ${date},
        notes = ${notes ?? ""},
        type = (${type})::category_type
      WHERE id = ${id} AND user_id = ${userId}
    `;

    const row = await fetchTransactionById(userId, id);
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
    const existing = await sql`
      SELECT id, transfer_group_id
      FROM transactions
      WHERE id = ${id} AND user_id = ${userId}
      LIMIT 1
    `;
    const row = existing[0] as { id: string; transfer_group_id: string | null } | undefined;
    if (!row) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    if (row.transfer_group_id) {
      const mate = await findTransferGroupMate(userId, row.id, row.transfer_group_id);
      await deleteTransferGroup(userId, row.transfer_group_id);
      return NextResponse.json({
        ok: true,
        deletedIds: mate ? [row.id, mate.id] : [row.id],
      });
    }

    await sql`
      DELETE FROM transactions
      WHERE id = ${id} AND user_id = ${userId}
    `;
    return NextResponse.json({ ok: true, deletedIds: [row.id] });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to delete transaction" }, { status: 500 });
  }
}
