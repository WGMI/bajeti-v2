import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { rowToTransaction, type TransactionRow } from "@/lib/transaction-api";
import { syncGroupMemberProfiles } from "@/lib/group-member-profiles";
import { parseAmountForStorage, parseChargesForStorage } from "@/lib/transaction-amount";
import { requireBajetiPermission } from "@/lib/bajeti-scope";
import { resolveAccountId } from "@/lib/accounts";
import {
  deleteCloudinaryAttachments,
  getAttachmentsForTransactions,
  parseAttachmentInputs,
  reconcileTransactionAttachments,
} from "@/lib/transaction-attachments";
import {
  decryptOptionalText,
  encryptNumber,
  encryptOptionalText,
  encryptText,
} from "@/lib/text-encryption";
import {
  deleteTransferGroup,
  findTransferGroupMate,
  updateTransferPair,
} from "@/lib/transfers";

async function hydrateAddedByNames(rows: TransactionRow[], groupId: string | null) {
  if (!groupId || rows.length === 0) return rows;
  const labels = await syncGroupMemberProfiles(
    groupId,
    rows.map((row) => row.added_by_user_id ?? row.user_id)
  );
  return rows.map((row) => {
    const userId = row.added_by_user_id ?? row.user_id ?? "";
    return {
      ...row,
      added_by_name: labels.get(userId)?.label ?? row.added_by_name ?? userId,
    };
  });
}

async function fetchTransactionById(
  userId: string,
  groupId: string | null,
  id: string
): Promise<TransactionRow | null> {
  const rows = await sql`
    SELECT
      t.id, t.user_id, t.group_id, t.added_by_user_id, t.paid_by_user_id,
      t.approved_by_user_id, t.approval_status::text AS approval_status,
      t.amount_encrypted,
      t.transaction_charges, t.transaction_charges_encrypted,
      t.currency, t.original_amount, t.original_amount_encrypted, t.original_currency,
      t.fx_rate, t.fx_rate_encrypted, t.fx_rate_date::text AS fx_rate_date, t.fx_source,
      t.account_id, t.category_id, t.date::text AS date, t.notes, t.sms_message, t.type,
      t.sms_counterparty, t.sms_counterparty_key,
      t.transfer_group_id, t.transfer_leg::text AS transfer_leg,
      c.name AS category_name,
      ac.name AS account_name,
      COALESCE(NULLIF(added_member.display_name, ''), NULLIF(added_member.email, '')) AS added_by_name,
      mate.account_id AS counter_account_id,
      mate_ac.name AS counter_account_name,
      COALESCE(att.attachments, '[]'::jsonb) AS attachments
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN accounts ac ON ac.id = t.account_id
    LEFT JOIN group_members added_member ON added_member.group_id = t.group_id
      AND added_member.user_id = COALESCE(t.added_by_user_id, t.user_id)
    LEFT JOIN transactions mate ON mate.user_id = t.user_id
      AND mate.transfer_group_id = t.transfer_group_id
      AND mate.id <> t.id
    LEFT JOIN accounts mate_ac ON mate_ac.id = mate.account_id
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', ta.id,
          'public_id', ta.public_id,
          'secure_url', ta.secure_url,
          'resource_type', ta.resource_type,
          'format', ta.format,
          'original_filename', ta.original_filename,
          'bytes', ta.bytes,
          'created_at', ta.created_at::text
        )
        ORDER BY ta.created_at DESC
      ) AS attachments
      FROM transaction_attachments ta
      WHERE ta.transaction_id = t.id
    ) att ON true
    WHERE t.id = ${id} AND ${
      groupId
        ? sql`t.group_id = ${groupId}`
        : sql`t.user_id = ${userId} AND t.group_id IS NULL`
    }
    LIMIT 1
  `;
  return (await hydrateAddedByNames(rows as TransactionRow[], groupId))[0] ?? null;
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
    const scope = await requireBajetiPermission(userId, request, "edit_transactions");
    const body = await request.json();
    const {
      amount,
      categoryId,
      date,
      notes,
      smsMessage,
      type,
      accountId,
      fromAccountId,
      toAccountId,
      transactionCharges,
    } = body;
    const attachments = parseAttachmentInputs(body.attachments);
    if (body.attachments != null && (!attachments || attachments.length !== body.attachments.length)) {
      return NextResponse.json({ error: "Invalid attachments" }, { status: 400 });
    }
    if (
      amount == null ||
      !categoryId ||
      !date ||
      !type ||
      !["income", "expense", "transfer"].includes(type)
    ) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const existing = await fetchTransactionById(userId, scope.groupId, id);
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
          groupId: scope.groupId,
          transferGroupId: existing.transfer_group_id,
          amount,
          categoryId,
          date,
          notes: notes ?? "",
          smsMessage:
            typeof smsMessage === "string" && smsMessage.trim()
              ? smsMessage.trim()
              : decryptOptionalText(existing.sms_message, {
                  userId: scope.groupId ?? userId,
                  field: "sms_message",
                }),
          fromAccountId,
          toAccountId,
        });
        const outLeg = pair.find((r) => r.transfer_leg === "out") ?? pair[0];
        await reconcileTransactionAttachments({
          transactionId: outLeg.id,
          groupId: scope.groupId,
          userId,
          attachments,
        });
        const row = await fetchTransactionById(userId, scope.groupId, outLeg.id);
        return NextResponse.json(rowToTransaction(row ?? outLeg));
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
    const numCharges =
      type === "transfer" ? 0 : parseChargesForStorage(transactionCharges);
    if (numCharges == null) {
      return NextResponse.json({ error: "Invalid transaction charges" }, { status: 400 });
    }
    const encryptionSubjectId = scope.groupId ?? userId;
    const resolvedAccountId = await resolveAccountId(
      userId,
      accountId ?? existing.account_id,
      scope.groupId
    );

    await sql`
      UPDATE transactions
      SET
        amount_encrypted = ${encryptNumber(numAmount, {
          userId: encryptionSubjectId,
          field: "amount",
        })},
        transaction_charges = NULL,
        transaction_charges_encrypted = ${encryptNumber(numCharges, {
          userId: encryptionSubjectId,
          field: "transaction_charges",
        })},
        category_id = ${categoryId},
        account_id = ${resolvedAccountId},
        date = ${date},
        notes = ${encryptText(notes ?? "", { userId: encryptionSubjectId, field: "notes" })},
        sms_message = ${
          typeof smsMessage === "string"
            ? encryptOptionalText(smsMessage.trim() || null, {
                userId: encryptionSubjectId,
                field: "sms_message",
              })
            : existing.sms_message
        },
        type = (${type})::category_type
      WHERE id = ${id} AND ${
        scope.groupId
          ? sql`group_id = ${scope.groupId}`
          : sql`user_id = ${userId} AND group_id IS NULL`
      }
    `;

    await reconcileTransactionAttachments({
      transactionId: id,
      groupId: scope.groupId,
      userId,
      attachments,
    });

    const row = await fetchTransactionById(userId, scope.groupId, id);
    if (!row) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }
    return NextResponse.json(rowToTransaction(row));
  } catch (e) {
    console.error(e);
    if (e instanceof Error && e.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
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
    const scope = await requireBajetiPermission(userId, _request, "edit_transactions");
    const existing = await sql`
      SELECT id, transfer_group_id
      FROM transactions
      WHERE id = ${id} AND ${
        scope.groupId
          ? sql`group_id = ${scope.groupId}`
          : sql`user_id = ${userId} AND group_id IS NULL`
      }
      LIMIT 1
    `;
    const row = existing[0] as { id: string; transfer_group_id: string | null } | undefined;
    if (!row) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }

    if (row.transfer_group_id) {
      const mate = await findTransferGroupMate(userId, scope.groupId, row.id, row.transfer_group_id);
      const deletedIds = mate ? [row.id, mate.id] : [row.id];
      const attachments = await getAttachmentsForTransactions(deletedIds);
      await deleteTransferGroup(userId, scope.groupId, row.transfer_group_id);
      await deleteCloudinaryAttachments(attachments);
      return NextResponse.json({
        ok: true,
        deletedIds,
      });
    }

    const attachments = await getAttachmentsForTransactions([row.id]);
    await sql`
      DELETE FROM transactions
      WHERE id = ${id} AND ${
        scope.groupId
          ? sql`group_id = ${scope.groupId}`
          : sql`user_id = ${userId} AND group_id IS NULL`
      }
    `;
    await deleteCloudinaryAttachments(attachments);
    return NextResponse.json({ ok: true, deletedIds: [row.id] });
  } catch (e) {
    console.error(e);
    if (e instanceof Error && e.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Failed to delete transaction" }, { status: 500 });
  }
}
