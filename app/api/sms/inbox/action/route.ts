import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { inspectInboxMessage, smsRequest, type InboxRow } from "@/lib/sms-inbox";
import { importSms, type SmsImportEdits } from "@/lib/sms-import-service";
import { assertDistinctAccounts } from "@/lib/transfers";

export const maxDuration = 60;

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { ids, action, edits } = await request.json();
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || !ids.every(id => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)) || !["sync", "dismiss"].includes(action)) {
      return NextResponse.json({ error: "Choose up to 100 messages and an action" }, { status: 400 });
    }
    if (edits != null && (ids.length !== 1 || typeof edits !== "object" || Array.isArray(edits))) return NextResponse.json({ error: "Edit one message at a time" }, { status: 400 });
    const rows = await sql`SELECT * FROM sms_inbox WHERE user_id = ${userId}
      AND id IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)::uuid) AND status = 'pending'` as InboxRow[];
    const results: { id: string; status: string; error?: string }[] = [];
    for (const row of rows) {
      try {
        if (action === "dismiss") {
          await sql`UPDATE sms_inbox SET status = 'dismissed', updated_at = now() WHERE user_id = ${userId} AND id = ${row.id} AND status = 'pending'`;
          results.push({ id: row.id, status: "dismissed" });
          continue;
        }
        const item = await inspectInboxMessage(userId, row);
        let transactionId = item.transactionId;
        if (item.previewStatus !== "duplicate") {
          if (!item.preview) throw new Error(item.reason ?? "Message needs review");
          let validated: SmsImportEdits | undefined;
          if (edits) {
            const amount = Number(edits.amount), charges = Number(edits.transactionCharges ?? 0);
            const date = typeof edits.date === "string" ? new Date(edits.date) : null;
            if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(charges) || charges < 0 || !date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== edits.date) throw new Error("Check amount, fees and date");
            const type = edits.type ?? item.preview.type;
            if (type !== "income" && type !== "expense" && type !== "transfer") throw new Error("Choose a transaction type");
            if (typeof edits.categoryId !== "string") throw new Error("Choose a category for this transaction type");
            const category = await sql`SELECT id FROM categories WHERE user_id = ${userId} AND group_id IS NULL AND id::text = ${edits.categoryId} AND type::text = ${type}`;
            if (!category.length) throw new Error("Choose a category for this transaction type");
            if (edits.notes != null && typeof edits.notes !== "string") throw new Error("Check the transaction notes");
            validated = { amount, transactionCharges: charges, date: edits.date, categoryId: edits.categoryId, type, notes: edits.notes?.trim() };
            if (type === "transfer" && (edits.type != null || edits.fromAccountId != null || edits.toAccountId != null)) {
              const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
              const { fromAccountId, toAccountId } = edits;
              if (typeof fromAccountId !== "string" || typeof toAccountId !== "string" || !uuid.test(fromAccountId) || !uuid.test(toAccountId)) {
                throw new Error("Choose two different accounts for the transfer");
              }
              await assertDistinctAccounts(userId, null, fromAccountId, toAccountId);
              validated.fromAccountId = fromAccountId;
              validated.toAccountId = toAccountId;
            }
          }
          const response = await importSms(userId, smsRequest(item.message, item.timestamp, item.accountId), validated);
          const result = await response.json();
          if (!response.ok || !["created", "duplicate"].includes(result.status) || !result.transaction?.id) throw new Error(result.reason ?? result.error ?? "Could not sync");
          transactionId = result.transaction.id;
        }
        await sql`UPDATE sms_inbox SET status = 'synced', transaction_id = ${transactionId}, updated_at = now() WHERE user_id = ${userId} AND id = ${row.id}`;
        results.push({ id: row.id, status: "synced" });
      } catch (e) {
        results.push({ id: row.id, status: "failed", error: e instanceof Error ? e.message : "Could not sync" });
      }
    }
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "Could not process messages" }, { status: 500 });
  }
}
