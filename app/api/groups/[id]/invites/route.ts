import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { addGroupAuditEvent, isGroupRole, requireGroupPermission } from "@/lib/groups";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  try {
    await requireGroupPermission(userId, id, "invite_members");
    const body = await request.json();
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const role = isGroupRole(body.role) ? body.role : "viewer";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
    }
    if (role === "owner") {
      return NextResponse.json({ error: "Use ownership transfer for owner role" }, { status: 400 });
    }

    const rows = await sql`
      INSERT INTO group_invites (group_id, email, role, invited_by_user_id, expires_at)
      VALUES (${id}, ${email}, ${role}::group_member_role, ${userId}, now() + interval '14 days')
      RETURNING id, email, role::text AS role, token, status::text AS status, created_at::text AS created_at
    `;
    const invite = rows[0];
    await addGroupAuditEvent({
      groupId: id,
      actorUserId: userId,
      entityType: "invite",
      entityId: invite?.id ? String(invite.id) : null,
      action: "created",
      metadata: { email, role },
    });
    return NextResponse.json(invite);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error(error);
    return NextResponse.json({ error: "Failed to create invite" }, { status: 500 });
  }
}
