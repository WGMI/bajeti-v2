import { clerkClient } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";

type MemberLabel = {
  userId: string;
  displayName: string | null;
  email: string | null;
  label: string;
};

function labelFromParts(userId: string, displayName?: string | null, email?: string | null) {
  return displayName?.trim() || email?.trim() || userId;
}

function clerkDisplayName(user: {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
}) {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return fullName || user.username || null;
}

export async function syncGroupMemberProfiles(
  groupId: string,
  userIds: Array<string | null | undefined>
): Promise<Map<string, MemberLabel>> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();

  const memberRows = (await sql`
    SELECT user_id, display_name, email
    FROM group_members
    WHERE group_id = ${groupId}
      AND user_id = ANY(${ids})
  `) as Array<{ user_id: string; display_name: string | null; email: string | null }>;

  const labels = new Map<string, MemberLabel>();
  for (const row of memberRows) {
    labels.set(row.user_id, {
      userId: row.user_id,
      displayName: row.display_name,
      email: row.email,
      label: labelFromParts(row.user_id, row.display_name, row.email),
    });
  }

  const missing = ids.filter((id) => {
    const label = labels.get(id);
    return !label || label.label === id;
  });
  if (missing.length === 0) return labels;

  const client = await clerkClient();
  for (const userId of missing) {
    try {
      const user = await client.users.getUser(userId);
      const displayName = clerkDisplayName(user);
      const email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null;
      await sql`
        UPDATE group_members
        SET
          display_name = COALESCE(NULLIF(display_name, ''), ${displayName}),
          email = COALESCE(NULLIF(email, ''), ${email})
        WHERE group_id = ${groupId}
          AND user_id = ${userId}
      `;
      labels.set(userId, {
        userId,
        displayName,
        email,
        label: labelFromParts(userId, displayName, email),
      });
    } catch {
      labels.set(userId, {
        userId,
        displayName: null,
        email: null,
        label: userId,
      });
    }
  }

  return labels;
}
