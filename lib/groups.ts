import { sql } from "@/lib/db";

export type GroupRole = "owner" | "admin" | "accountant" | "contributor" | "viewer";

export type GroupPermission =
  | "delete_group"
  | "transfer_ownership"
  | "manage_members"
  | "manage_permissions"
  | "approve_transactions"
  | "create_budgets"
  | "manage_categories"
  | "invite_members"
  | "edit_transactions"
  | "create_transactions"
  | "view_group";

const rolePermissions: Record<GroupRole, Set<GroupPermission>> = {
  owner: new Set([
    "delete_group",
    "transfer_ownership",
    "manage_members",
    "manage_permissions",
    "approve_transactions",
    "create_budgets",
    "manage_categories",
    "invite_members",
    "edit_transactions",
    "create_transactions",
    "view_group",
  ]),
  admin: new Set([
    "manage_members",
    "approve_transactions",
    "create_budgets",
    "manage_categories",
    "invite_members",
    "edit_transactions",
    "create_transactions",
    "view_group",
  ]),
  accountant: new Set(["edit_transactions", "create_transactions", "view_group"]),
  contributor: new Set(["create_transactions", "view_group"]),
  viewer: new Set(["view_group"]),
};

export function isGroupRole(value: unknown): value is GroupRole {
  return (
    value === "owner" ||
    value === "admin" ||
    value === "accountant" ||
    value === "contributor" ||
    value === "viewer"
  );
}

export function roleCan(role: GroupRole, permission: GroupPermission): boolean {
  return rolePermissions[role].has(permission);
}

export async function getGroupMembership(userId: string, groupId: string) {
  const rows = await sql`
    SELECT role::text AS role
    FROM group_members
    WHERE user_id = ${userId} AND group_id = ${groupId}
    LIMIT 1
  `;
  const role = (rows[0] as { role?: string } | undefined)?.role;
  return isGroupRole(role) ? { role } : null;
}

export async function requireGroupPermission(
  userId: string,
  groupId: string,
  permission: GroupPermission
) {
  const membership = await getGroupMembership(userId, groupId);
  if (!membership || !roleCan(membership.role, permission)) {
    throw new Error("Forbidden");
  }
  return membership;
}

export async function addGroupAuditEvent(input: {
  groupId: string;
  actorUserId: string;
  entityType: string;
  entityId?: string | null;
  action: string;
  metadata?: Record<string, unknown>;
}) {
  await sql`
    INSERT INTO group_audit_events (
      group_id, actor_user_id, entity_type, entity_id, action, metadata
    )
    VALUES (
      ${input.groupId},
      ${input.actorUserId},
      ${input.entityType},
      ${input.entityId ?? null},
      ${input.action},
      ${JSON.stringify(input.metadata ?? {})}::jsonb
    )
  `;
}
