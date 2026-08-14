import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { addGroupAuditEvent, requireGroupPermission } from "@/lib/groups";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  try {
    await requireGroupPermission(userId, id, "view_group");
    const groups = await sql`
      SELECT id, name, currency, timezone, owner_user_id, invite_token, created_at::text AS created_at
      FROM groups
      WHERE id = ${id}
      LIMIT 1
    `;
    const group = groups[0];
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    const [members, invites, auditEvents, transactionsByMember] = await Promise.all([
      sql`
        SELECT id, user_id, role::text AS role, display_name, email, joined_at::text AS joined_at
        FROM group_members
        WHERE group_id = ${id}
        ORDER BY
          CASE role
            WHEN 'owner' THEN 1
            WHEN 'admin' THEN 2
            WHEN 'accountant' THEN 3
            WHEN 'contributor' THEN 4
            ELSE 5
          END,
          joined_at ASC
      `,
      sql`
        SELECT id, email, role::text AS role, token, status::text AS status, created_at::text AS created_at
        FROM group_invites
        WHERE group_id = ${id}
        ORDER BY created_at DESC
        LIMIT 20
      `,
      sql`
        SELECT id, actor_user_id, entity_type, entity_id, action, metadata, created_at::text AS created_at
        FROM group_audit_events
        WHERE group_id = ${id}
        ORDER BY created_at DESC
        LIMIT 50
      `,
      sql`
        SELECT
          COALESCE(paid_by_user_id, added_by_user_id, user_id) AS user_id,
          COUNT(*)::int AS transaction_count
        FROM transactions
        WHERE group_id = ${id}
        GROUP BY COALESCE(paid_by_user_id, added_by_user_id, user_id)
        ORDER BY transaction_count DESC
      `,
    ]);

    return NextResponse.json({
      group,
      members,
      invites,
      auditEvents,
      transactionsByMember,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error(error);
    return NextResponse.json({ error: "Failed to fetch group" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  try {
    await requireGroupPermission(userId, id, "manage_permissions");
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : null;
    const currency =
      typeof body.currency === "string" ? body.currency.trim().toUpperCase() : null;
    const timezone = typeof body.timezone === "string" ? body.timezone.trim() : null;

    if (name === "" || currency === "" || timezone === "") {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    if (currency && !/^[A-Z]{3}$/.test(currency)) {
      return NextResponse.json({ error: "Currency must be a 3-letter code" }, { status: 400 });
    }

    const rows = await sql`
      UPDATE groups
      SET
        name = COALESCE(${name}, name),
        currency = COALESCE(${currency}, currency),
        timezone = COALESCE(${timezone}, timezone),
        updated_at = now()
      WHERE id = ${id}
      RETURNING id, name, currency, timezone, created_at::text AS created_at
    `;
    const group = rows[0];
    if (!group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    await addGroupAuditEvent({
      groupId: id,
      actorUserId: userId,
      entityType: "group",
      entityId: id,
      action: "updated",
      metadata: { name, currency, timezone },
    });
    return NextResponse.json(group);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "Forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    console.error(error);
    return NextResponse.json({ error: "Failed to update group" }, { status: 500 });
  }
}
