import { sql } from "@/lib/db";

export const DEFAULT_ACCOUNT_NAME = "Wallet";

export type AccountRow = {
  id: string;
  name: string;
  is_default: boolean;
};

export function rowToAccount(row: AccountRow) {
  return {
    id: row.id,
    name: row.name,
    isDefault: row.is_default,
  };
}

/** Ensures the user has a default Wallet account; returns its id. */
export async function ensureDefaultAccount(userId: string): Promise<string> {
  const existing = await sql`
    SELECT id FROM accounts
    WHERE user_id = ${userId} AND is_default = true
    LIMIT 1
  `;
  const row = existing[0] as { id: string } | undefined;
  if (row) return row.id;

  const inserted = await sql`
    INSERT INTO accounts (user_id, name, is_default)
    VALUES (${userId}, ${DEFAULT_ACCOUNT_NAME}, true)
    ON CONFLICT DO NOTHING
    RETURNING id
  `;
  const insertedRow = inserted[0] as { id: string } | undefined;
  if (insertedRow) return insertedRow.id;

  const fallback = await sql`
    SELECT id FROM accounts
    WHERE user_id = ${userId} AND is_default = true
    LIMIT 1
  `;
  const fallbackRow = fallback[0] as { id: string } | undefined;
  if (!fallbackRow) {
    throw new Error("Failed to ensure default account");
  }
  return fallbackRow.id;
}

export async function resolveAccountId(
  userId: string,
  accountId: string | null | undefined
): Promise<string> {
  if (accountId) {
    const rows = await sql`
      SELECT id FROM accounts
      WHERE user_id = ${userId} AND id = ${accountId}
      LIMIT 1
    `;
    if (rows[0]) return accountId;
  }
  return ensureDefaultAccount(userId);
}

export async function listAccountsForUser(userId: string) {
  await ensureDefaultAccount(userId);
  const rows = await sql`
    SELECT
      a.id,
      a.name,
      a.is_default,
      COALESCE(SUM(
        CASE
          WHEN t.type = 'income' THEN ABS(t.amount)
          WHEN t.type = 'expense' THEN -ABS(t.amount)
          WHEN t.type = 'transfer' AND t.transfer_leg = 'in' THEN ABS(t.amount)
          WHEN t.type = 'transfer' AND t.transfer_leg = 'out' THEN -ABS(t.amount)
          ELSE 0
        END
      ), 0)::text AS balance,
      COALESCE(SUM(
        CASE
          WHEN t.type = 'income' THEN ABS(t.amount)
          WHEN t.type = 'transfer' AND t.transfer_leg = 'in' THEN ABS(t.amount)
          ELSE 0
        END
      ), 0)::text AS total_in,
      COALESCE(SUM(
        CASE
          WHEN t.type = 'expense' THEN ABS(t.amount)
          WHEN t.type = 'transfer' AND t.transfer_leg = 'out' THEN ABS(t.amount)
          ELSE 0
        END
      ), 0)::text AS total_out
    FROM accounts a
    LEFT JOIN transactions t ON t.account_id = a.id AND t.user_id = ${userId}
    WHERE a.user_id = ${userId}
    GROUP BY a.id, a.name, a.is_default
    ORDER BY a.is_default DESC, a.name ASC
  `;
  return rows as Array<AccountRow & { balance: string; total_in: string; total_out: string }>;
}
