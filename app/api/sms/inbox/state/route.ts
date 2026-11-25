import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { inspectInboxStates } from "@/lib/sms-inbox";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const messages = await inspectInboxStates(userId);
    return NextResponse.json({ messages }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not refresh message status" }, { status: 500 });
  }
}
