import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { parseSMS, smsParseResultForApi } from "@/lib/sms-parser";
import { candidateCounterpartyRuleKeys } from "@/lib/sms-parser";
import { getSmsTransactionDateSource } from "@/lib/user-sms-settings";
import { DEFAULT_CATEGORIES } from "@/lib/budget-types";
import { resolveCategoryForSmsIngestion } from "@/lib/counterparty-helpers";
import { createHash } from "crypto";
import { buildSmsIdempotencyKey } from "@/lib/sms-idempotency";
import { resolveSmsTransactionAmount } from "@/lib/resolve-sms-transaction-amount";
import type { CategoryType } from "@/lib/budget-types";
import { resolveAccountId } from "@/lib/accounts";
import { insertSmsTransaction } from "@/lib/sms-transaction-insert";
import { rowToTransaction, type TransactionRow } from "@/lib/transaction-api";
import { keyedFingerprint } from "@/lib/text-encryption";

type CategoryRow = { id: string; name: string; type: string };
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

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function normalizeForHash(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * POST /api/sms
 *
 * Receives a money-related SMS message from the mobile app (or any authenticated
 * client), parses it, and optionally creates a transaction.
 *
 * Body: { message: string, timestamp?: number, accountId?: string }
 *
 * Auth: Clerk session (Bearer token or cookie). Same as other API routes.
 *
 * Returns: { parsed: SmsParseResult, transaction?: Transaction }
 */
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await request.json();
    const {
      message: messageRaw,
      timestamp = null,
      accountId: accountIdRaw,
    } = body;
    if (typeof messageRaw !== "string" || !messageRaw.trim()) {
      return NextResponse.json(
        { error: "Invalid payload: message must be a non-empty string" },
        { status: 400 }
      );
    }

    const transactionDateSource = await getSmsTransactionDateSource(userId);
    const resolvedAccountId = await resolveAccountId(
      userId,
      typeof accountIdRaw === "string" && accountIdRaw.trim() ? accountIdRaw.trim() : undefined
    );
    const parsed = parseSMS(messageRaw.trim(), {
      timestamp: typeof timestamp === "number" ? timestamp : null,
      transactionDateSource,
    });

    const effectiveType = await resolveEffectiveTransactionType(userId, parsed);

    // Skip creating a transaction for invalid parse results and inform client why.
    let skipReason: string | null = null;
    if (effectiveType === "neither") {
      skipReason = "Message did not match an income, expense, or transfer transaction";
    } else if (parsed.amount <= 0 || !parsed.currency) {
      skipReason = "Parsed transaction amount is missing or invalid";
    } else if (!parsed.date) {
      skipReason = "Parsed transaction date is missing or invalid";
    }

    if (skipReason) {
      return NextResponse.json({
        status: "ignored",
        transactionCreated: false,
        reason: skipReason,
        parsed: smsParseResultForApi(parsed),
      });
    }
    const transactionType = effectiveType as CategoryType;
    const amountResolution = await resolveSmsTransactionAmount(userId, parsed);
    if (!amountResolution.ok) {
      return NextResponse.json({
        status: "ignored",
        transactionCreated: false,
        reason: amountResolution.reason,
        parsed: smsParseResultForApi(parsed),
      });
    }
    const { resolved: stored } = amountResolution;

    // Ensure user has categories, then get first category of the parsed type
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

    const { category, transferToAccountId } = await resolveCategoryForSmsIngestion(
      userId,
      { ...parsed, type: effectiveType },
      categoryRows
    );
    if (!category) {
      return NextResponse.json(
        {
          error: `No ${effectiveType} category found for user`,
          status: "ignored",
          transactionCreated: false,
          reason: `No category found for parsed type: ${effectiveType}`,
          parsed: smsParseResultForApi(parsed),
        },
        { status: 400 }
      );
    }

    const normalizedMessage = normalizeForHash(parsed.message);
    const idempotencyInput = buildSmsIdempotencyKey({
      type: transactionType,
      amount: stored.idempotencyAmount,
      currency: stored.idempotencyCurrency,
      date: parsed.date,
      transactionRef: parsed.transactionRef,
    });
    const rawMessageHash = keyedFingerprint(normalizedMessage, "sms_raw");
    const smsIdempotencyKey = keyedFingerprint(idempotencyInput, "sms_idempotency");
    const legacySmsIdempotencyKey = sha256(idempotencyInput);
    const protectedLegacySmsIdempotencyKey = keyedFingerprint(
      legacySmsIdempotencyKey,
      "sms_idempotency"
    );
    const existingRows = await sql`
      SELECT
        t.id, t.user_id, t.amount_encrypted,
        t.transaction_charges, t.transaction_charges_encrypted,
        t.currency, t.original_amount, t.original_amount_encrypted, t.original_currency,
        t.fx_rate, t.fx_rate_encrypted, t.fx_rate_date::text AS fx_rate_date, t.fx_source,
        t.account_id, t.category_id, t.date::text AS date, t.notes, t.sms_message, t.type,
        t.sms_counterparty, t.sms_counterparty_key,
        t.transfer_group_id, t.transfer_leg::text AS transfer_leg,
        c.name AS category_name,
        ac.name AS account_name
      FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN accounts ac ON ac.id = t.account_id
      WHERE t.user_id = ${userId}
        AND t.sms_idempotency_key IN (
          SELECT jsonb_array_elements_text(
            ${JSON.stringify([
              smsIdempotencyKey,
              legacySmsIdempotencyKey,
              protectedLegacySmsIdempotencyKey,
            ])}::jsonb
          )
        )
      LIMIT 1
    `;
    const existing = existingRows[0] as TransactionRow | undefined;
    if (existing) {
      return NextResponse.json({
        status: "duplicate",
        transactionCreated: false,
        reason: "SMS already processed",
        parsed: smsParseResultForApi(parsed),
        transaction: rowToTransaction(existing),
      });
    }

    const transferCategoryId =
      transactionType === "transfer"
        ? categoryRows.find((c) => c.type === "transfer")?.id ?? category.id
        : null;

    const created = await insertSmsTransaction({
      userId,
      amount: stored.storedAmount,
      currency: stored.currency,
      originalAmount: stored.originalAmount,
      originalCurrency: stored.originalCurrency,
      fxRate: stored.fxRate,
      fxRateDate: stored.fxRateDate,
      fxSource: stored.fxSource,
      categoryId: category.id,
      date: parsed.date,
      message: parsed.message,
      transactionType,
      smsIdempotencyKey,
      rawMessageHash,
      counterparty: parsed.counterparty,
      counterpartyKey: parsed.counterpartyKey,
      transferCategoryId,
      accountId: resolvedAccountId,
      transferToAccountId,
      transactionCharges: parsed.charges,
    });

    if (!created) {
      const existingAfterConflict = await sql`
        SELECT
          t.id, t.user_id, t.amount_encrypted,
          t.transaction_charges, t.transaction_charges_encrypted,
          t.currency, t.original_amount, t.original_amount_encrypted, t.original_currency,
          t.fx_rate, t.fx_rate_encrypted, t.fx_rate_date::text AS fx_rate_date, t.fx_source,
          t.account_id, t.category_id, t.date::text AS date, t.notes, t.sms_message, t.type,
          t.sms_counterparty, t.sms_counterparty_key,
          t.transfer_group_id, t.transfer_leg::text AS transfer_leg,
          c.name AS category_name,
          ac.name AS account_name
        FROM transactions t
        LEFT JOIN categories c ON c.id = t.category_id
        LEFT JOIN accounts ac ON ac.id = t.account_id
        WHERE t.user_id = ${userId}
          AND t.sms_idempotency_key IN (
            SELECT jsonb_array_elements_text(
              ${JSON.stringify([
                smsIdempotencyKey,
                legacySmsIdempotencyKey,
                protectedLegacySmsIdempotencyKey,
              ])}::jsonb
            )
          )
        LIMIT 1
      `;
      const row = existingAfterConflict[0] as TransactionRow | undefined;
      if (!row) {
        return NextResponse.json(
          { error: "Failed to create transaction", parsed },
          { status: 500 }
        );
      }
      return NextResponse.json({
        status: "duplicate",
        transactionCreated: false,
        reason: "SMS already processed",
        parsed: smsParseResultForApi(parsed),
        transaction: rowToTransaction(row),
      });
    }

    return NextResponse.json({
      status: "created",
      transactionCreated: true,
      parsed: smsParseResultForApi(parsed),
      transaction: created,
    });
  } catch (e) {
    console.error("[POST /api/sms]", e);
    return NextResponse.json(
      { error: "Failed to process SMS" },
      { status: 500 }
    );
  }
}
