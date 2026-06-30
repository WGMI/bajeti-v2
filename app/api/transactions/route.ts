import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { createHash } from "crypto";
import {
  transactionCreateResponse,
  rowToTransaction,
  type TransactionRow,
} from "@/lib/transaction-api";
import { parseAmountForStorage, parseChargesForStorage } from "@/lib/transaction-amount";
import { resolveAccountId } from "@/lib/accounts";
import { createTransferPair } from "@/lib/transfers";
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

async function fetchTransactionByIdempotency(
  userId: string,
  hashedKey: string,
  rawKey: string | null | undefined
): Promise<TransactionRow | null> {
  const rows = await sql`
    SELECT
      t.id, t.user_id, t.amount_encrypted,
      t.transaction_charges, t.transaction_charges_encrypted,
      t.currency, t.original_amount, t.original_amount_encrypted, t.original_currency,
      t.fx_rate, t.fx_rate_encrypted, t.fx_rate_date::text AS fx_rate_date, t.fx_source,
      t.account_id, t.category_id, t.date::text AS date, t.notes, t.sms_message, t.type,
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
    WHERE t.user_id = ${userId}
      AND (t.sms_idempotency_key = ${hashedKey} OR t.sms_idempotency_key = ${rawKey})
    LIMIT 1
  `;
  return (rows[0] as TransactionRow | undefined) ?? null;
}

async function fetchTransactionById(userId: string, id: string): Promise<TransactionRow | null> {
  const rows = await sql`
    SELECT
      t.id, t.user_id, t.amount_encrypted,
      t.transaction_charges, t.transaction_charges_encrypted,
      t.currency, t.original_amount, t.original_amount_encrypted, t.original_currency,
      t.fx_rate, t.fx_rate_encrypted, t.fx_rate_date::text AS fx_rate_date, t.fx_source,
      t.account_id, t.category_id, t.date::text AS date, t.notes, t.sms_message, t.type,
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

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { searchParams } = new URL(request.url);
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
        t.id, t.user_id, t.amount_encrypted,
        t.transaction_charges, t.transaction_charges_encrypted,
        t.currency, t.original_amount, t.original_amount_encrypted, t.original_currency,
        t.fx_rate, t.fx_rate_encrypted, t.fx_rate_date::text AS fx_rate_date, t.fx_source,
        t.account_id, t.category_id, t.date::text AS date, t.notes, t.sms_message, t.type,
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
      WHERE t.user_id = ${userId}
        AND ${tTypeCond} AND ${tDateFromCond} AND ${tDateToCond}
        AND ${accountCond}
      ORDER BY t.date DESC, t.id DESC
    `) as TransactionRow[];

    const allTransactions = rows.map(rowToTransaction);
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
    return NextResponse.json({ error: "Failed to fetch transactions" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
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

    const resolvedAccountId = await resolveAccountId(userId, accountId);

    if (hashedIdempotencyKey) {
      const existing = await fetchTransactionByIdempotency(
        userId,
        hashedIdempotencyKey,
        normalizedIdempotencyKey
      );
      if (existing) {
        return NextResponse.json(transactionCreateResponse(existing, "duplicate"));
      }
    }

    const rows = await sql`
      INSERT INTO transactions (
        user_id, amount_encrypted, transaction_charges, transaction_charges_encrypted,
        category_id, account_id, date, notes, sms_message, type, sms_idempotency_key
      )
      VALUES (
        ${userId},
        ${encryptNumber(numAmount, { userId, field: "amount" })},
        ${null},
        ${encryptNumber(numCharges, { userId, field: "transaction_charges" })},
        ${categoryId},
        ${resolvedAccountId},
        ${date},
        ${encryptText(notes, { userId, field: "notes" })},
        ${encryptOptionalText(
          typeof smsMessage === "string" && smsMessage.trim() ? smsMessage.trim() : null,
          { userId, field: "sms_message" }
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
        hashedIdempotencyKey,
        normalizedIdempotencyKey
      );
      if (!existing) {
        return NextResponse.json({ error: "Insert failed" }, { status: 500 });
      }
      return NextResponse.json(transactionCreateResponse(existing, "duplicate"));
    }

    const row = await fetchTransactionById(userId, insertedId);
    if (!row) {
      return NextResponse.json({ error: "Insert failed" }, { status: 500 });
    }
    return NextResponse.json(transactionCreateResponse(row, "created"));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to create transaction" }, { status: 500 });
  }
}
