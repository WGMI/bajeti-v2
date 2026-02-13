import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";

const CURRENCY_CODES = [
  "USD",
  "EUR",
  "GBP",
  "TZS",
  "KES",
  "NGN",
  "ZAR",
  "INR",
] as const;
const DATE_FORMATS = ["short", "medium", "long"] as const;
const FIRST_DAY_VALUES = ["sunday", "monday"] as const;

type CurrencyCode = (typeof CURRENCY_CODES)[number];
type DateFormat = (typeof DATE_FORMATS)[number];
type FirstDayOfWeek = (typeof FIRST_DAY_VALUES)[number];

type SettingsRow = {
  currency: string;
  date_format: string;
  first_day_of_week: string;
};

function rowToSettings(row: SettingsRow) {
  return {
    currency: row.currency as CurrencyCode,
    dateFormat: row.date_format as DateFormat,
    firstDayOfWeek: row.first_day_of_week as FirstDayOfWeek,
  };
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const rows = await sql`
      SELECT currency, date_format, first_day_of_week
      FROM user_settings
      WHERE user_id = ${userId}
    `;
    if (rows.length === 0) {
      await sql`
        INSERT INTO user_settings (user_id, currency, date_format, first_day_of_week)
        VALUES (${userId}, 'USD', 'medium', 'monday')
      `;
      return NextResponse.json(
        rowToSettings({
          currency: "USD",
          date_format: "medium",
          first_day_of_week: "monday",
        })
      );
    }
    return NextResponse.json(rowToSettings(rows[0] as SettingsRow));
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to fetch settings" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await request.json();
    const currency = body.currency as string | undefined;
    const dateFormat = body.dateFormat as string | undefined;
    const firstDayOfWeek = body.firstDayOfWeek as string | undefined;

    if (currency !== undefined && !CURRENCY_CODES.includes(currency as CurrencyCode)) {
      return NextResponse.json({ error: "Invalid currency" }, { status: 400 });
    }
    if (dateFormat !== undefined && !DATE_FORMATS.includes(dateFormat as DateFormat)) {
      return NextResponse.json(
        { error: "Invalid dateFormat" },
        { status: 400 }
      );
    }
    if (firstDayOfWeek !== undefined && !FIRST_DAY_VALUES.includes(firstDayOfWeek as FirstDayOfWeek)) {
      return NextResponse.json(
        { error: "Invalid firstDayOfWeek" },
        { status: 400 }
      );
    }

    const existing = await sql`
      SELECT currency, date_format, first_day_of_week
      FROM user_settings
      WHERE user_id = ${userId}
    `;
    const current = (existing[0] as SettingsRow | undefined) ?? {
      currency: "USD",
      date_format: "medium",
      first_day_of_week: "monday",
    };
    const nextCurrency = currency ?? current.currency;
    const nextDateFormat = dateFormat ?? current.date_format;
    const nextFirstDay = firstDayOfWeek ?? current.first_day_of_week;

    await sql`
      INSERT INTO user_settings (user_id, currency, date_format, first_day_of_week)
      VALUES (${userId}, ${nextCurrency}, ${nextDateFormat}, ${nextFirstDay})
      ON CONFLICT (user_id) DO UPDATE SET
        currency = ${nextCurrency},
        date_format = ${nextDateFormat},
        first_day_of_week = ${nextFirstDay}
    `;

    return NextResponse.json(
      rowToSettings({
        currency: nextCurrency,
        date_format: nextDateFormat,
        first_day_of_week: nextFirstDay,
      })
    );
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 }
    );
  }
}
