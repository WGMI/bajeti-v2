import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const messages = await sql`SELECT i.id,
      CASE WHEN i.status = 'pending' AND EXISTS (SELECT 1 FROM transactions t WHERE t.user_id = ${userId} AND t.group_id IS NULL AND t.sms_raw_hash = i.fingerprint)
        THEN 'synced' ELSE i.status END AS status
      FROM sms_inbox i WHERE i.user_id = ${userId}`;
    return NextResponse.json({ messages }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not refresh message status" }, { status: 500 });
  }
}
