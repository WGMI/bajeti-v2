import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { createHash } from "crypto";
import {
  transactionCreateResponse,
  rowToTransaction,
  type TransactionRow,
} from "@/lib/transaction-api";
import { syncGroupMemberProfiles } from "@/lib/group-member-profiles";
import { parseAmountForStorage, parseChargesForStorage } from "@/lib/transaction-amount";
import { getBajetiScope, requireBajetiPermission } from "@/lib/bajeti-scope";
import { resolveAccountId } from "@/lib/accounts";
import { createTransferPair } from "@/lib/transfers";
import {
  insertTransactionAttachments,
  parseAttachmentInputs,
} from "@/lib/transaction-attachments";
import {
  encryptNumber,
  encryptOptionalText,
  encryptText,
} from "@/lib/text-encryption";

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

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

async function fetchTransactionByIdempotency(
  userId: string,
  groupId: string | null,
  hashedKey: string,
  rawKey: string | null | undefined
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
    WHERE ${
      groupId
        ? sql`t.group_id = ${groupId}`
        : sql`t.user_id = ${userId} AND t.group_id IS NULL`
    }
      AND (t.sms_idempotency_key = ${hashedKey} OR t.sms_idempotency_key = ${rawKey})
    LIMIT 1
  `;
  return (await hydrateAddedByNames(rows as TransactionRow[], groupId))[0] ?? null;
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

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { searchParams } = new URL(request.url);
    const scope = await getBajetiScope(userId, request);
    const limitParam = searchParams.get("limit");
    const limit = Math.min(
      Math.max(1, limitParam ? parseInt(limitParam, 10) : DEFAULT_LIMIT),
      MAX_LIMIT
    );
    const cursor = searchParams.get("cursor");
    const typeFilter = searchParams.get("type");
    const accountFilter = searchParams.get("accountId");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const search = searchParams.get("search")?.trim() || null;
    const usePagination = cursor != null || limitParam != null;
    const validType =
      typeFilter === "income" || typeFilter === "expense" || typeFilter === "transfer"
        ? typeFilter
        : null;

    const tTypeCond = validType ? sql`t.type = ${validType}::category_type` : sql`true`;
    const accountCond = accountFilter ? sql`t.account_id = ${accountFilter}::uuid` : sql`true`;
    const tDateFromCond = dateFrom ? sql`t.date >= ${dateFrom}::date` : sql`true`;
    const tDateToCond = dateTo ? sql`t.date <= ${dateTo}::date` : sql`true`;

    const cursorParts = cursor?.split("|");
    const cursorDate = cursorParts?.[0];
    const cursorId = cursorParts?.[1];
    if (cursor && (!cursorDate || !cursorId)) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }

    const rows = (await sql`
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
      WHERE ${
        scope.groupId
          ? sql`t.group_id = ${scope.groupId}`
          : sql`t.user_id = ${userId} AND t.group_id IS NULL`
      }
        AND ${tTypeCond} AND ${tDateFromCond} AND ${tDateToCond}
        AND ${accountCond}
      ORDER BY t.date DESC, t.id DESC
    `) as TransactionRow[];

    const hydratedRows = await hydrateAddedByNames(rows, scope.groupId);
    const allTransactions = hydratedRows.map(rowToTransaction);
    const normalizedSearch = search?.toLocaleLowerCase();
    const matchingTransactions = normalizedSearch
      ? allTransactions.filter((transaction) =>
          [
            transaction.notes,
            transaction.smsMessage,
            transaction.categoryName,
            transaction.accountName,
          ].some((value) => value?.toLocaleLowerCase().includes(normalizedSearch))
        )
      : allTransactions;
    const totalIncome = matchingTransactions.reduce(
      (sum, transaction) =>
        transaction.type === "income" ? sum + Math.abs(transaction.amount) : sum,
      0
    );
    const totalExpense = matchingTransactions.reduce(
      (sum, transaction) =>
        transaction.type === "expense"
          ? sum + Math.abs(transaction.amount) + transaction.transactionCharges
          : sum,
      0
    );
    const afterCursor =
      cursorDate && cursorId
        ? matchingTransactions.filter(
            (transaction) =>
              transaction.date < cursorDate ||
              (transaction.date === cursorDate && transaction.id < cursorId)
          )
        : matchingTransactions;
    const transactions = usePagination ? afterCursor.slice(0, limit) : afterCursor;
    const last = transactions[transactions.length - 1];
    const nextCursor =
      usePagination && transactions.length === limit && last
        ? `${last.date}|${last.id}`
        : null;

    return NextResponse.json({
      transactions,
      nextCursor,
      totalIncome,
      totalExpense,
    });
  } catch (e) {
    console.error(e);
    if (e instanceof Error && e.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Failed to fetch transactions" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const scope = await requireBajetiPermission(userId, request, "create_transactions");
    const body = await request.json();
    const {
      amount,
      categoryId,
      date,
      notes = "",
      smsMessage = null,
      type,
      accountId,
      fromAccountId,
      toAccountId,
      idempotencyKey,
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

    const normalizedIdempotencyKey =
      typeof idempotencyKey === "string" && idempotencyKey.trim().length > 0
        ? idempotencyKey.trim().slice(0, 255)
        : null;
    const hashedIdempotencyKey = normalizedIdempotencyKey ? sha256(normalizedIdempotencyKey) : null;

    if (type === "transfer") {
      if (!fromAccountId || !toAccountId) {
        return NextResponse.json(
          { error: "Transfers require fromAccountId and toAccountId" },
          { status: 400 }
        );
      }
      try {
        const pair = await createTransferPair({
          userId,
          groupId: scope.groupId,
          fromAccountId,
          toAccountId,
          amount,
          categoryId,
          date,
          notes,
          smsMessage:
            typeof smsMessage === "string" && smsMessage.trim() ? smsMessage.trim() : null,
          idempotencyKey: hashedIdempotencyKey,
        });
        const outLeg = pair.find((r) => r.transfer_leg === "out") ?? pair[0];
        if (attachments && attachments.length > 0) {
          await insertTransactionAttachments({
            transactionId: outLeg.id,
            groupId: scope.groupId,
            userId,
            attachments,
          });
          const row = await fetchTransactionById(userId, scope.groupId, outLeg.id);
          if (!row) {
            return NextResponse.json({ error: "Insert failed" }, { status: 500 });
          }
          return NextResponse.json(transactionCreateResponse(row, "created"));
        }
        return NextResponse.json(transactionCreateResponse(outLeg, "created"));
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create transfer";
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }

    const numAmount = parseAmountForStorage(amount);
    if (numAmount == null) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }
    const numCharges = parseChargesForStorage(transactionCharges);
    if (numCharges == null) {
      return NextResponse.json({ error: "Invalid transaction charges" }, { status: 400 });
    }

    const encryptionSubjectId = scope.groupId ?? userId;
    const resolvedAccountId = await resolveAccountId(userId, accountId, scope.groupId);

    if (hashedIdempotencyKey) {
      const existing = await fetchTransactionByIdempotency(
        userId,
        scope.groupId,
        hashedIdempotencyKey,
        normalizedIdempotencyKey
      );
      if (existing) {
        return NextResponse.json(transactionCreateResponse(existing, "duplicate"));
      }
    }

    const rows = await sql`
      INSERT INTO transactions (
        user_id, group_id, added_by_user_id, paid_by_user_id,
        amount_encrypted, transaction_charges, transaction_charges_encrypted,
        category_id, account_id, date, notes, sms_message, type, sms_idempotency_key
      )
      VALUES (
        ${userId},
        ${scope.groupId},
        ${userId},
        ${userId},
        ${encryptNumber(numAmount, { userId: encryptionSubjectId, field: "amount" })},
        ${null},
        ${encryptNumber(numCharges, {
          userId: encryptionSubjectId,
          field: "transaction_charges",
        })},
        ${categoryId},
        ${resolvedAccountId},
        ${date},
        ${encryptText(notes, { userId: encryptionSubjectId, field: "notes" })},
        ${encryptOptionalText(
          typeof smsMessage === "string" && smsMessage.trim() ? smsMessage.trim() : null,
          { userId: encryptionSubjectId, field: "sms_message" }
        )},
        ${type}::category_type,
        ${hashedIdempotencyKey}
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `;
    const insertedId = (rows[0] as { id: string } | undefined)?.id;
    if (!insertedId) {
      if (!normalizedIdempotencyKey || !hashedIdempotencyKey) {
        return NextResponse.json({ error: "Insert failed" }, { status: 500 });
      }
      const existing = await fetchTransactionByIdempotency(
        userId,
        scope.groupId,
        hashedIdempotencyKey,
        normalizedIdempotencyKey
      );
      if (!existing) {
        return NextResponse.json({ error: "Insert failed" }, { status: 500 });
      }
      return NextResponse.json(transactionCreateResponse(existing, "duplicate"));
    }

    if (attachments && attachments.length > 0) {
      await insertTransactionAttachments({
        transactionId: insertedId,
        groupId: scope.groupId,
        userId,
        attachments,
      });
    }

    const row = await fetchTransactionById(userId, scope.groupId, insertedId);
    if (!row) {
      return NextResponse.json({ error: "Insert failed" }, { status: 500 });
    }
    return NextResponse.json(transactionCreateResponse(row, "created"));
  } catch (e) {
    console.error(e);
    if (e instanceof Error && e.message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Failed to create transaction" }, { status: 500 });
  }
}
