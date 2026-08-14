import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { addGroupAuditEvent } from "@/lib/groups";

type EmailInviteRow = {
  id: string;
  email: string | null;
  role: string;
  status: string;
  expires_at: string | null;
  group_id: string;
  group_name: string;
  currency: string;
  timezone: string;
};

type GroupInviteLinkRow = {
  id: string;
  name: string;
  currency: string;
  timezone: string;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  try {
    const rows = await sql`
      SELECT
        gi.id,
        gi.email,
        gi.role::text AS role,
        gi.status::text AS status,
        gi.expires_at::text AS expires_at,
        gi.group_id,
        g.name AS group_name,
        g.currency,
        g.timezone
      FROM group_invites gi
      INNER JOIN groups g ON g.id = gi.group_id
      WHERE gi.token = ${token}
      LIMIT 1
    `;
    const invite = rows[0];
    if (invite) {
      return NextResponse.json({ ...invite, invite_type: "email" });
    }

    const groupRows = await sql`
      SELECT id, name, currency, timezone
      FROM groups
      WHERE invite_token = ${token}
      LIMIT 1
    `;
    const group = groupRows[0] as GroupInviteLinkRow | undefined;
    if (!group) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }
    return NextResponse.json({
      invite_type: "link",
      email: null,
      role: "viewer",
      status: "pending",
      expires_at: null,
      group_id: group.id,
      group_name: group.name,
      currency: group.currency,
      timezone: group.timezone,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to fetch invite" }, { status: 500 });
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { token } = await params;

  try {
    const inviteRows = await sql`
      SELECT id, group_id, role::text AS role, status::text AS status, expires_at
      FROM group_invites
      WHERE token = ${token}
      LIMIT 1
    `;
    const invite = inviteRows[0] as EmailInviteRow | undefined;
    if (invite) {
      if (invite.status !== "pending") {
        return NextResponse.json({ error: "Invite is not pending" }, { status: 400 });
      }
      if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
        await sql`UPDATE group_invites SET status = 'expired' WHERE id = ${invite.id}`;
        return NextResponse.json({ error: "Invite expired" }, { status: 400 });
      }

      await sql`
        INSERT INTO group_members (group_id, user_id, role)
        VALUES (${invite.group_id}, ${userId}, ${invite.role}::group_member_role)
        ON CONFLICT (group_id, user_id)
        DO UPDATE SET role = EXCLUDED.role
      `;
      await sql`
        UPDATE group_invites
        SET status = 'accepted', accepted_at = now()
        WHERE id = ${invite.id}
      `;
      await addGroupAuditEvent({
        groupId: invite.group_id,
        actorUserId: userId,
        entityType: "invite",
        entityId: invite.id,
        action: "accepted",
        metadata: { role: invite.role, inviteType: "email" },
      });
      return NextResponse.json({ ok: true, groupId: invite.group_id });
    }

    const groupRows = await sql`
      SELECT id
      FROM groups
      WHERE invite_token = ${token}
      LIMIT 1
    `;
    const group = groupRows[0] as { id: string } | undefined;
    if (!group) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }

    await sql`
      INSERT INTO group_members (group_id, user_id, role)
      VALUES (${group.id}, ${userId}, 'viewer')
      ON CONFLICT (group_id, user_id)
      DO NOTHING
    `;
    await addGroupAuditEvent({
      groupId: group.id,
      actorUserId: userId,
      entityType: "group_invite_link",
      entityId: group.id,
      action: "accepted",
      metadata: { role: "viewer", inviteType: "link" },
    });
    return NextResponse.json({ ok: true, groupId: group.id });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to accept invite" }, { status: 500 });
  }
}
