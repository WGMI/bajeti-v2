import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { addGroupAuditEvent } from "@/lib/groups";

type GroupListRow = {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  role: string;
  member_count: string;
  pending_invites: string;
  created_at: string;
};

function rowToGroup(row: GroupListRow) {
  return {
    id: row.id,
    name: row.name,
    currency: row.currency,
    timezone: row.timezone,
    role: row.role,
    memberCount: Number(row.member_count ?? 0),
    pendingInvites: Number(row.pending_invites ?? 0),
    createdAt: row.created_at,
  };
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const rows = (await sql`
      SELECT
        g.id,
        g.name,
        g.currency,
        g.timezone,
        gm.role::text AS role,
        COUNT(DISTINCT members.id)::text AS member_count,
        COUNT(DISTINCT pending.id)::text AS pending_invites,
        g.created_at::text AS created_at
      FROM groups g
      INNER JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ${userId}
      LEFT JOIN group_members members ON members.group_id = g.id
      LEFT JOIN group_invites pending ON pending.group_id = g.id AND pending.status = 'pending'
      GROUP BY g.id, gm.role
      ORDER BY g.created_at DESC
    `) as GroupListRow[];
    return NextResponse.json({ groups: rows.map(rowToGroup) });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to fetch groups" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const currency = typeof body.currency === "string" ? body.currency.trim().toUpperCase() : "KES";
    const timezone = typeof body.timezone === "string" ? body.timezone.trim() : "Africa/Nairobi";

    if (!name) {
      return NextResponse.json({ error: "Group name is required" }, { status: 400 });
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      return NextResponse.json({ error: "Currency must be a 3-letter code" }, { status: 400 });
    }
    if (!timezone) {
      return NextResponse.json({ error: "Timezone is required" }, { status: 400 });
    }

    const groupRows = await sql`
      INSERT INTO groups (name, currency, timezone, owner_user_id)
      VALUES (${name}, ${currency}, ${timezone}, ${userId})
      RETURNING id, name, currency, timezone, created_at::text AS created_at
    `;
    const group = groupRows[0] as
      | { id: string; name: string; currency: string; timezone: string; created_at: string }
      | undefined;
    if (!group) {
      return NextResponse.json({ error: "Insert failed" }, { status: 500 });
    }

    await sql`
      INSERT INTO group_members (group_id, user_id, role)
      VALUES (${group.id}, ${userId}, 'owner')
    `;
    await addGroupAuditEvent({
      groupId: group.id,
      actorUserId: userId,
      entityType: "group",
      entityId: group.id,
      action: "created",
      metadata: { name, currency, timezone },
    });

    return NextResponse.json({
      ...group,
      role: "owner",
      memberCount: 1,
      pendingInvites: 0,
      createdAt: group.created_at,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to create group" }, { status: 500 });
  }
}
