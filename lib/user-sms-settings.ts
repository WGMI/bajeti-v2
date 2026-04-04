import { sql } from "@/lib/db";
import type { SmsTransactionDateSource } from "@/lib/sms-parser";

/**
 * Reads the user's SMS transaction date preference. Defaults to `received_at` when unset or unknown.
 */
export async function getSmsTransactionDateSource(
  userId: string
): Promise<SmsTransactionDateSource> {
  const rows = await sql`
    SELECT sms_transaction_date_source
    FROM user_settings
    WHERE user_id = ${userId}
  `;
  const v = (rows[0] as { sms_transaction_date_source: string } | undefined)
    ?.sms_transaction_date_source;
  if (v === "message" || v === "received_at") return v;
  return "received_at";
}
