import { auth, clerkClient } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { apiJson } from "@/lib/api-response";

export async function DELETE() {
  const { userId } = await auth();
  if (!userId) {
    return apiJson({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await sql.transaction((tx) => [
      tx`DELETE FROM counterparty_category_rules WHERE user_id = ${userId}`,
      tx`DELETE FROM transactions WHERE user_id = ${userId}`,
      tx`DELETE FROM categories WHERE user_id = ${userId}`,
      tx`DELETE FROM accounts WHERE user_id = ${userId}`,
      tx`DELETE FROM user_mobile_settings WHERE user_id = ${userId}`,
      tx`DELETE FROM user_settings WHERE user_id = ${userId}`,
    ]);

    const client = await clerkClient();
    await client.users.deleteUser(userId);

    return apiJson({ ok: true });
  } catch (error) {
    console.error("[account deletion]", error);
    return apiJson(
      {
        error:
          "We could not finish deleting your account. Your Bajeti financial data may already be deleted; please try again.",
      },
      { status: 500 }
    );
  }
}
