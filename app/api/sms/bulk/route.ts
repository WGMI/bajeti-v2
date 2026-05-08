import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { parseSMS, smsParseResultForApi } from "@/lib/sms-parser";
import { candidateCounterpartyRuleKeys } from "@/lib/sms-parser";
import { getSmsTransactionDateSource } from "@/lib/user-sms-settings";
import { resolveCategoryForSmsIngestion } from "@/lib/counterparty-helpers";
import { DEFAULT_CATEGORIES } from "@/lib/budget-types";
import { createHash } from "crypto";
import { buildSmsIdempotencyKey } from "@/lib/sms-idempotency";
import type { CategoryType } from "@/lib/budget-types";
import { normalizeTransactionDateFromDb } from "@/lib/format-date";

type CategoryRow = { id: string; name: string; type: string };
type TransactionRow = {
  id: string;
  amount: string;
  category_id: string;
  date: string;
  notes: string | null;
  type: string;
  sms_counterparty: string | null;
  sms_counterparty_key: string | null;
};

function rowToTransaction(row: TransactionRow) {
  return {
    id: row.id,
    amount: Number(row.amount),
    categoryId: row.category_id,
    date: normalizeTransactionDateFromDb(row.date),
    notes: row.notes ?? "",
    type: row.type as CategoryType,
    smsCounterparty: row.sms_counterparty,
    smsCounterpartyKey: row.sms_counterparty_key,
  };
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function normalizeForHash(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

type BulkItemParsed = {
  message: string;
  type: "income" | "expense" | "transfer" | "neither";
  amount: number;
  date: string;
  fee: number;
  transactionRef: string | null;
  counterparty: string | null;
  counterpartyKey: string | null;
};

type BulkItemResult =
  | {
      index: number;
      status: "created";
      transactionCreated: true;
      parsed: BulkItemParsed;
      transaction: ReturnType<typeof rowToTransaction>;
    }
  | {
      index: number;
      status: "duplicate";
      transactionCreated: false;
      reason: string;
      parsed: BulkItemParsed;
      transaction: ReturnType<typeof rowToTransaction>;
    }
  | {
      index: number;
      status: "ignored";
      transactionCreated: false;
      reason: string;
      parsed: BulkItemParsed;
    }
  | {
      index: number;
      status: "failed";
      transactionCreated: false;
      reason: string;
      parsed?: BulkItemParsed;
    };

type BulkSummary = {
  created: number;
  duplicates: number;
  ignored: number;
  failed: number;
};

const MAX_MESSAGES = 100;

function extractParsedForResponse(parsed: ReturnType<typeof parseSMS>): BulkItemParsed {
  return smsParseResultForApi(parsed) as BulkItemParsed;
}

async function resolveEffectiveTransactionType(
  userId: string,
  parsed: ReturnType<typeof parseSMS>
): Promise<CategoryType | "neither"> {
  const baseType = parsed.type as CategoryType | "neither";
  if (baseType === "neither" || !parsed.counterpartyKey) return baseType;
  const candidateKeys = candidateCounterpartyRuleKeys(parsed.counterpartyKey, parsed.message ?? "");
  if (candidateKeys.length === 0) return baseType;
  const ruleRows = await sql`
    SELECT 1
    FROM counterparty_category_rules
    WHERE user_id = ${userId}
      AND transaction_type = ${"transfer"}::category_type
      AND counterparty_key IN (
        SELECT jsonb_array_elements_text(${JSON.stringify(candidateKeys)}::jsonb)
      )
    LIMIT 1
  `;
  return ruleRows.length > 0 ? "transfer" : baseType;
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      messages,
      timestamp = null,
      includeFeeInExpense = false,
    }: {
      messages: unknown;
      timestamp?: number | null;
      includeFeeInExpense?: boolean;
    } = body;

    if (!Array.isArray(messages)) {
      return NextResponse.json(
        { error: "Invalid payload: messages must be an array of strings" },
        { status: 400 }
      );
    }

    if (messages.length > MAX_MESSAGES) {
      return NextResponse.json(
        { error: `Too many messages (max ${MAX_MESSAGES})` },
        { status: 400 }
      );
    }

    if (!messages.every((m) => typeof m === "string")) {
      return NextResponse.json({ error: "Invalid payload: all messages must be strings" }, { status: 400 });
    }

    const transactionDateSource = await getSmsTransactionDateSource(userId);

    // Ensure user has categories, so each parsed SMS can map to its income/expense category.
    let categoryRows = await sql`
      SELECT id, name, type
      FROM categories
      WHERE user_id = ${userId}
      ORDER BY type, name
    ` as CategoryRow[];

    if (categoryRows.length === 0) {
      for (const c of DEFAULT_CATEGORIES) {
        await sql`
          INSERT INTO categories (user_id, name, type, is_default)
          VALUES (${userId}, ${c.name}, ${c.type}, ${c.isDefault ?? false})
        `;
      }
      categoryRows = await sql`
        SELECT id, name, type
        FROM categories
        WHERE user_id = ${userId}
        ORDER BY type, name
      ` as CategoryRow[];
    }

    const results: BulkItemResult[] = [];

    for (let i = 0; i < messages.length; i++) {
      const rawMessage = messages[i];
      const message = rawMessage.trim();
      if (!message) {
        results.push({
          index: i,
          status: "ignored",
          transactionCreated: false,
          reason: "Empty SMS message",
          parsed: extractParsedForResponse(
            parseSMS("", {
              timestamp: typeof timestamp === "number" ? timestamp : null,
              includeFeeInExpense: Boolean(includeFeeInExpense),
              transactionDateSource,
            })
          ),
        });
        continue;
      }

      try {
        const parsed = parseSMS(message, {
          timestamp: typeof timestamp === "number" ? timestamp : null,
          includeFeeInExpense: Boolean(includeFeeInExpense),
          transactionDateSource,
        });

        const parsedForResponse = extractParsedForResponse(parsed);
        const effectiveType = await resolveEffectiveTransactionType(userId, parsed);

        // Skip creating a transaction for invalid parse results.
        let skipReason: string | null = null;
        if (effectiveType === "neither") {
          skipReason = "Message did not match an income, expense, or transfer transaction";
        } else if (parsed.amount <= 0) {
          skipReason = "Parsed transaction amount is missing or invalid";
        } else if (!parsed.date) {
          skipReason = "Parsed transaction date is missing or invalid";
        }

        if (skipReason) {
          results.push({
            index: i,
            status: "ignored",
            transactionCreated: false,
            reason: skipReason,
            parsed: parsedForResponse,
          });
          continue;
        }
        const transactionType = effectiveType as CategoryType;

        const category = (await resolveCategoryForSmsIngestion(
          userId,
          { ...parsed, type: transactionType },
          categoryRows
        )) as { id: string; type: CategoryType } | undefined;

        if (!category) {
          results.push({
            index: i,
            status: "ignored",
            transactionCreated: false,
            reason: `No category found for parsed type: ${effectiveType}`,
            parsed: parsedForResponse,
          });
          continue;
        }

        const rawMessageHash = sha256(normalizeForHash(parsed.message));
        const smsIdempotencyKey = sha256(
          buildSmsIdempotencyKey({
            type: transactionType,
            amount: parsed.amount,
            date: parsed.date,
            transactionRef: parsed.transactionRef,
          })
        );

        const existingRows = await sql`
          SELECT id, amount, category_id, date::text AS date, notes, type,
            sms_counterparty, sms_counterparty_key
          FROM transactions
          WHERE user_id = ${userId} AND sms_idempotency_key = ${smsIdempotencyKey}
          LIMIT 1
        `;
        const existing = existingRows[0] as TransactionRow | undefined;
        if (existing) {
          results.push({
            index: i,
            status: "duplicate",
            transactionCreated: false,
            reason: "SMS already processed",
            parsed: parsedForResponse,
            transaction: rowToTransaction(existing),
          });
          continue;
        }

        const rows = await sql`
          INSERT INTO transactions (
            user_id,
            amount,
            category_id,
            date,
            notes,
            type,
            sms_idempotency_key,
            sms_raw_hash,
            sms_counterparty,
            sms_counterparty_key
          )
          VALUES (
            ${userId},
            ${parsed.amount},
            ${category.id},
            ${parsed.date},
            ${parsed.message},
            ${transactionType}::category_type,
            ${smsIdempotencyKey},
            ${rawMessageHash},
            ${parsed.counterparty},
            ${parsed.counterpartyKey}
          )
          ON CONFLICT DO NOTHING
          RETURNING id, amount, category_id, date::text AS date, notes, type,
            sms_counterparty, sms_counterparty_key
        `;

        const row = rows[0] as TransactionRow | undefined;
        if (!row) {
          // Highly likely a unique-index conflict: treat as duplicate.
          const existingRowsAfterConflict = await sql`
            SELECT id, amount, category_id, date::text AS date, notes, type,
              sms_counterparty, sms_counterparty_key
            FROM transactions
            WHERE user_id = ${userId} AND sms_idempotency_key = ${smsIdempotencyKey}
            LIMIT 1
          `;
          const existingAfterConflict = existingRowsAfterConflict[0] as TransactionRow | undefined;
          if (existingAfterConflict) {
            results.push({
              index: i,
              status: "duplicate",
              transactionCreated: false,
              reason: "SMS already processed",
              parsed: parsedForResponse,
              transaction: rowToTransaction(existingAfterConflict),
            });
          } else {
            results.push({
              index: i,
              status: "failed",
              transactionCreated: false,
              reason: "Insert returned no row and no existing transaction found after conflict",
              parsed: parsedForResponse,
            });
          }
          continue;
        }

        results.push({
          index: i,
          status: "created",
          transactionCreated: true,
          parsed: parsedForResponse,
          transaction: rowToTransaction(row),
        });
      } catch (e) {
        results.push({
          index: i,
          status: "failed",
          transactionCreated: false,
          reason: e instanceof Error ? e.message : "Failed to process SMS",
        });
      }
    }

    const summary: BulkSummary = results.reduce(
      (acc, r) => {
        if (r.status === "created") acc.created += 1;
        else if (r.status === "duplicate") acc.duplicates += 1;
        else if (r.status === "ignored") acc.ignored += 1;
        else if (r.status === "failed") acc.failed += 1;
        return acc;
      },
      { created: 0, duplicates: 0, ignored: 0, failed: 0 }
    );

    return NextResponse.json({ summary, results });
  } catch (e) {
    console.error("[POST /api/sms/bulk]", e);
    return NextResponse.json({ error: "Failed to process bulk SMS" }, { status: 500 });
  }
}

