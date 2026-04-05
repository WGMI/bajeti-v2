import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";
import { effectiveCounterpartyFromTransaction } from "@/lib/counterparty-helpers";
import type { CategoryType } from "@/lib/budget-types";

const WINDOW_DAYS = 90;
const MIN_OCCURRENCES = 3;
const MAX_SUGGESTIONS = 12;

type TxRow = {
  id: string;
  notes: string | null;
  type: string;
  sms_counterparty: string | null;
  sms_counterparty_key: string | null;
};

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - WINDOW_DAYS);
    const sinceDate = since.toISOString().slice(0, 10);

    const ruleRows = (await sql`
      SELECT counterparty_key, transaction_type::text AS transaction_type
      FROM counterparty_category_rules
      WHERE user_id = ${userId}
    `) as { counterparty_key: string; transaction_type: string }[];
    const ruled = new Set(
      ruleRows.map((r) => `${r.transaction_type}\0${r.counterparty_key}`)
    );

    const txRows = (await sql`
      SELECT id, notes, type::text AS type, sms_counterparty, sms_counterparty_key
      FROM transactions
      WHERE user_id = ${userId} AND date >= ${sinceDate}::date
    `) as TxRow[];

    type Agg = { count: number; labelVotes: Map<string, number> };
    const groups = new Map<string, Agg>();

    for (const row of txRows) {
      const eff = effectiveCounterpartyFromTransaction(
        row.notes ?? "",
        row.type as CategoryType,
        row.sms_counterparty_key,
        row.sms_counterparty
      );
      if (!eff) continue;
      const gkey = `${row.type}\0${eff.key}`;
      if (ruled.has(gkey)) continue;
      let agg = groups.get(gkey);
      if (!agg) {
        agg = { count: 0, labelVotes: new Map() };
        groups.set(gkey, agg);
      }
      agg.count += 1;
      const label = eff.label.trim();
      if (label) {
        agg.labelVotes.set(label, (agg.labelVotes.get(label) ?? 0) + 1);
      }
    }

    const suggestions = [...groups.entries()]
      .filter(([, agg]) => agg.count >= MIN_OCCURRENCES)
      .map(([gkey, agg]) => {
        const [transactionType, counterpartyKey] = gkey.split("\0") as [
          CategoryType,
          string,
        ];
        let bestLabel = counterpartyKey;
        let bestN = 0;
        for (const [lab, n] of agg.labelVotes) {
          if (n > bestN || (n === bestN && lab.length > bestLabel.length)) {
            bestN = n;
            bestLabel = lab;
          }
        }
        return {
          counterpartyKey,
          label: bestLabel,
          transactionType,
          count: agg.count,
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_SUGGESTIONS);

    return NextResponse.json({
      windowDays: WINDOW_DAYS,
      minOccurrences: MIN_OCCURRENCES,
      suggestions,
    });
  } catch (e) {
    console.error("[GET /api/counterparty-suggestions]", e);
    return NextResponse.json(
      { error: "Failed to load suggestions" },
      { status: 500 }
    );
  }
}
