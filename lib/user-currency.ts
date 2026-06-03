import { sql } from "@/lib/db";
import type { CurrencyCode } from "@/lib/currency-codes";
import { isCurrencyCode } from "@/lib/currency-codes";

const DEFAULT_CURRENCY: CurrencyCode = "USD";

/** User's home / display currency from settings. */
export async function getUserCurrency(userId: string): Promise<CurrencyCode> {
  const rows = await sql`
    SELECT currency
    FROM user_settings
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  const raw = (rows[0] as { currency: string } | undefined)?.currency;
  if (raw && isCurrencyCode(raw)) return raw;
  return DEFAULT_CURRENCY;
}
