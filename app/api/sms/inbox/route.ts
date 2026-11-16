import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { encryptText, keyedFingerprint } from "@/lib/text-encryption";
import { inspectPendingMessages } from "@/lib/sms-inbox";
import { pendingSmsTotal } from "@/lib/pending-sms-total";

export const maxDuration = 60;

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const month = url.searchParams.get("month") ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: "Invalid month" }, { status: 400 });
  try {
    const { messages, savedBalance } = await inspectPendingMessages(userId, month);
    const devices = await sql`SELECT max(last_uploaded_at)::text AS latest FROM sms_inbox_devices WHERE user_id = ${userId}`;
    const lastUploadedAt = devices[0]?.latest as string | null;
    const summary = { ...pendingSmsTotal(messages, month, lastUploadedAt ?? null), savedBalance };
    return NextResponse.json({ messages: url.searchParams.get("summary") === "1" ? [] : messages, summary }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Messages are temporarily unavailable" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || !Array.isArray(body.messages) || body.messages.length > 100 || typeof body.deviceId !== "string" || !body.deviceId.trim() || body.deviceId.length > 100) {
      return NextResponse.json({ error: "Provide a device ID and up to 100 messages" }, { status: 400 });
    }
    const accounts = await sql`SELECT id FROM accounts WHERE user_id = ${userId} AND group_id IS NULL`;
    const allowedAccounts = new Set(accounts.map(a => a.id));
    for (const item of body.messages) {
      if (!item || typeof item !== "object" || typeof item.message !== "string" || !item.message.trim() || item.message.length > 20000 || typeof item.sender !== "string" || !item.sender.trim() || item.sender.length > 255 || typeof item.timestamp !== "number" || !Number.isFinite(item.timestamp) || item.timestamp < 0 || item.timestamp > Date.now() + 86400000 || (item.accountId != null && !allowedAccounts.has(item.accountId))) {
        return NextResponse.json({ error: "Invalid message or account" }, { status: 400 });
      }
    }
    const receipts: { localId: number; id: string; status: string }[] = [];
    for (const item of body.messages) {
      const normalized = item.message.replace(/\s+/g, " ").trim().toLowerCase();
      const fingerprint = keyedFingerprint(normalized, "sms_raw");
      await sql`INSERT INTO sms_inbox (user_id, fingerprint, sender, message_encrypted, received_at, account_id)
        VALUES (${userId}, ${fingerprint}, ${item.sender.trim()}, ${encryptText(item.message.trim(), { userId, field: "sms_message" })}, ${new Date(item.timestamp).toISOString()}, ${item.accountId ?? null})
        ON CONFLICT (user_id, fingerprint) DO NOTHING`;
      const rows = await sql`SELECT id, status FROM sms_inbox WHERE user_id = ${userId} AND fingerprint = ${fingerprint}`;
      receipts.push({ localId: item.localId, id: rows[0].id as string, status: rows[0].status as string });
    }
    await sql`INSERT INTO sms_inbox_devices (user_id, device_id) VALUES (${userId}, ${body.deviceId})
      ON CONFLICT (user_id, device_id) DO UPDATE SET last_uploaded_at = now()`;
    return NextResponse.json({ ok: true, accepted: body.messages.length, receipts });
  } catch {
    return NextResponse.json({ error: "Could not upload messages; retry is safe" }, { status: 500 });
  }
}
