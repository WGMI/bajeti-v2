import { sql } from "@/lib/db";
import { getGroupMembership } from "@/lib/groups";
import { decryptNumber, decryptOptionalNumber } from "@/lib/text-encryption";

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
export async function ensureDefaultAccount(
  userId: string,
  groupId: string | null = null
): Promise<string> {
  if (groupId) {
    const membership = await getGroupMembership(userId, groupId);
    if (!membership) throw new Error("Forbidden");
  }
  const existing = await sql`
    SELECT id FROM accounts
    WHERE ${
      groupId
        ? sql`group_id = ${groupId}`
        : sql`user_id = ${userId} AND group_id IS NULL AND is_default = true`
    }
    LIMIT 1
  `;
  const row = existing[0] as { id: string } | undefined;
  if (row) return row.id;

  const inserted = await sql`
    INSERT INTO accounts (user_id, group_id, name, is_default)
    VALUES (${userId}, ${groupId}, ${DEFAULT_ACCOUNT_NAME}, true)
    ON CONFLICT DO NOTHING
    RETURNING id
  `;
  const insertedRow = inserted[0] as { id: string } | undefined;
  if (insertedRow) return insertedRow.id;

  const fallback = await sql`
    SELECT id FROM accounts
    WHERE ${
      groupId
        ? sql`group_id = ${groupId}`
        : sql`user_id = ${userId} AND group_id IS NULL AND is_default = true`
    }
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
  accountId: string | null | undefined,
  groupId: string | null = null
): Promise<string> {
  if (accountId) {
    const rows = await sql`
      SELECT id FROM accounts
      WHERE id = ${accountId} AND ${
        groupId
          ? sql`group_id = ${groupId}`
          : sql`user_id = ${userId} AND group_id IS NULL`
      }
      LIMIT 1
    `;
    if (rows[0]) return accountId;
  }
  return ensureDefaultAccount(userId, groupId);
}

export async function listAccountsForUser(userId: string, groupId: string | null = null) {
  await ensureDefaultAccount(userId, groupId);
  const accounts = (await sql`
    SELECT id, name, is_default
    FROM accounts
    WHERE ${
      groupId
        ? sql`group_id = ${groupId}`
        : sql`user_id = ${userId} AND group_id IS NULL`
    }
    ORDER BY is_default DESC, name ASC
  `) as AccountRow[];
  const transactions = (await sql`
    SELECT
      account_id,
      amount_encrypted,
      transaction_charges,
      transaction_charges_encrypted,
      type::text AS type,
      transfer_leg::text AS transfer_leg
    FROM transactions
    WHERE ${
      groupId
        ? sql`group_id = ${groupId}`
        : sql`user_id = ${userId} AND group_id IS NULL`
    }
  `) as {
    account_id: string;
    amount_encrypted: string | null;
    transaction_charges: string | null;
    transaction_charges_encrypted: string | null;
    type: string;
    transfer_leg: string | null;
  }[];
  const totals = new Map<string, { balance: number; totalIn: number; totalOut: number }>();

  for (const transaction of transactions) {
    const encryptionSubjectId = groupId ?? userId;
    const amount = Math.abs(
      decryptNumber(transaction.amount_encrypted, null, {
        userId: encryptionSubjectId,
        field: "amount",
      })
    );
    const charges = Math.max(
      0,
      decryptOptionalNumber(
        transaction.transaction_charges_encrypted,
        transaction.transaction_charges,
        { userId: encryptionSubjectId, field: "transaction_charges" }
      ) ?? 0
    );
    const total = totals.get(transaction.account_id) ?? {
      balance: 0,
      totalIn: 0,
      totalOut: 0,
    };
    if (
      transaction.type === "income" ||
      (transaction.type === "transfer" && transaction.transfer_leg === "in")
    ) {
      total.balance += amount;
      total.totalIn += amount;
    } else if (transaction.type === "expense") {
      total.balance -= amount + charges;
      total.totalOut += amount + charges;
    } else if (transaction.type === "transfer" && transaction.transfer_leg === "out") {
      total.balance -= amount;
      total.totalOut += amount;
    }
    totals.set(transaction.account_id, total);
  }

  return accounts.map((account) => {
    const total = totals.get(account.id) ?? { balance: 0, totalIn: 0, totalOut: 0 };
    return {
      ...account,
      balance: String(total.balance),
      total_in: String(total.totalIn),
      total_out: String(total.totalOut),
    };
  });
}
