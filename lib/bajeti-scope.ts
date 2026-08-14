import { sql } from "@/lib/db";
import { getGroupMembership, roleCan, type GroupPermission } from "@/lib/groups";

export type BajetiScope = {
  groupId: string | null;
};

export function groupIdFromRequest(request: Request): string | null {
  const url = new URL(request.url);
  const raw =
    request.headers.get("x-bajeti-group-id") ??
    url.searchParams.get("groupId") ??
    null;
  const value = raw?.trim();
  return value && value !== "personal" ? value : null;
}

export async function getBajetiScope(userId: string, request: Request): Promise<BajetiScope> {
  const groupId = groupIdFromRequest(request);
  if (!groupId) return { groupId: null };
  const membership = await getGroupMembership(userId, groupId);
  if (!membership) {
    throw new Error("Forbidden");
  }
  return { groupId };
}

export async function requireBajetiPermission(
  userId: string,
  request: Request,
  permission: GroupPermission
): Promise<BajetiScope> {
  const scope = await getBajetiScope(userId, request);
  if (!scope.groupId) return scope;
  const membership = await getGroupMembership(userId, scope.groupId);
  if (!membership || !roleCan(membership.role, permission)) {
    throw new Error("Forbidden");
  }
  return scope;
}

export function scopeWhere(userId: string, groupId: string | null, alias = "") {
  const prefix = alias ? `${alias}.` : "";
  return groupId
    ? sql`${sql.unsafe(prefix)}group_id = ${groupId}`
    : sql`${sql.unsafe(prefix)}user_id = ${userId} AND ${sql.unsafe(prefix)}group_id IS NULL`;
}

export async function ensureDefaultCategoriesForScope(userId: string, groupId: string | null) {
  const { DEFAULT_CATEGORIES } = await import("@/lib/budget-types");
  const existing = await sql`
    SELECT id
    FROM categories
    WHERE ${scopeWhere(userId, groupId)}
    LIMIT 1
  `;
  if (existing.length > 0) return;
  for (const category of DEFAULT_CATEGORIES) {
    await sql`
      INSERT INTO categories (user_id, group_id, name, type, is_default)
      VALUES (${userId}, ${groupId}, ${category.name}, ${category.type}, ${category.isDefault ?? false})
    `;
  }
}
