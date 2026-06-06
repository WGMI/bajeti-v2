import { auth } from "@clerk/nextjs/server";
import { apiJson } from "@/lib/api-response";
import { sql } from "@/lib/db";
import { parseSMS, smsParseResultForApi } from "@/lib/sms-parser";
import { candidateCounterpartyRuleKeys } from "@/lib/sms-parser";
import { getSmsTransactionDateSource } from "@/lib/user-sms-settings";
import { resolveCategoryForSmsIngestion } from "@/lib/counterparty-helpers";
import { DEFAULT_CATEGORIES } from "@/lib/budget-types";
import { createHash } from "crypto";
import { buildSmsIdempotencyKey } from "@/lib/sms-idempotency";
import { resolveSmsTransactionAmount } from "@/lib/resolve-sms-transaction-amount";
import type { CategoryType } from "@/lib/budget-types";
import { rowToTransaction, type TransactionRow } from "@/lib/transaction-api";
import { resolveAccountId } from "@/lib/accounts";
import { insertSmsTransaction } from "@/lib/sms-transaction-insert";

type CategoryRow = { id: string; name: string; type: string };
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
  currency: string | null;
  date: string;
  charges: number;
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

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

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

export async function GET() {
  return apiJson({ error: "Method not allowed" }, { status: 405 });
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return apiJson({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      messages,
      timestamp = null,
      accountId: accountIdRaw,
    }: {
      messages: unknown;
      timestamp?: number | null;
      accountId?: unknown;
    } = body;

    if (!Array.isArray(messages)) {
      return apiJson(
        { error: "Invalid payload: messages must be an array of strings" },
        { status: 400 }
      );
    }

    if (messages.length > MAX_MESSAGES) {
      return apiJson(
        { error: `Too many messages (max ${MAX_MESSAGES})` },
        { status: 400 }
      );
    }

    if (!messages.every((m) => typeof m === "string")) {
      return apiJson({ error: "Invalid payload: all messages must be strings" }, { status: 400 });
    }

    const transactionDateSource = await getSmsTransactionDateSource(userId);
    const resolvedAccountId = await resolveAccountId(
      userId,
      typeof accountIdRaw === "string" && accountIdRaw.trim() ? accountIdRaw.trim() : undefined
    );

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
              transactionDateSource,
            })
          ),
        });
        continue;
      }

      try {
        const parsed = parseSMS(message, {
          timestamp: typeof timestamp === "number" ? timestamp : null,
          transactionDateSource,
        });

        const parsedForResponse = extractParsedForResponse(parsed);
        const effectiveType = await resolveEffectiveTransactionType(userId, parsed);

        // Skip creating a transaction for invalid parse results.
        let skipReason: string | null = null;
        if (effectiveType === "neither") {
          skipReason = "Message did not match an income, expense, or transfer transaction";
        } else if (parsed.amount <= 0 || !parsed.currency) {
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
        const amountResolution = await resolveSmsTransactionAmount(userId, parsed);
        if (!amountResolution.ok) {
          results.push({
            index: i,
            status: "ignored",
            transactionCreated: false,
            reason: amountResolution.reason,
            parsed: parsedForResponse,
          });
          continue;
        }
        const { resolved: stored } = amountResolution;

        const { category, transferToAccountId } = await resolveCategoryForSmsIngestion(
          userId,
          { ...parsed, type: transactionType },
          categoryRows
        );

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
            amount: stored.idempotencyAmount,
            currency: stored.idempotencyCurrency,
            date: parsed.date,
            transactionRef: parsed.transactionRef,
          })
        );

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
          results.push({
            index: i,
            status: "ignored",
            transactionCreated: false,
            reason: "SMS already processed (duplicate)",
            parsed: parsedForResponse,
          });
          continue;
        }

        results.push({
          index: i,
          status: "created",
          transactionCreated: true,
          parsed: parsedForResponse,
          transaction: created,
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

    return apiJson({ summary, results });
  } catch (e) {
    console.error("[POST /api/sms/bulk]", e);
    return apiJson({ error: "Failed to process bulk SMS" }, { status: 500 });
  }
}

