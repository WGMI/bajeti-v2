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
const SMS_TX_DATE_SOURCES = ["message", "received_at"] as const;

type CurrencyCode = (typeof CURRENCY_CODES)[number];
type DateFormat = (typeof DATE_FORMATS)[number];
type FirstDayOfWeek = (typeof FIRST_DAY_VALUES)[number];
type SmsTransactionDateSource = (typeof SMS_TX_DATE_SOURCES)[number];

type SettingsRow = {
  currency: string;
  date_format: string;
  first_day_of_week: string;
  sms_transaction_date_source: string;
};

function rowToSettings(row: SettingsRow) {
  const sms =
    SMS_TX_DATE_SOURCES.includes(
      row.sms_transaction_date_source as SmsTransactionDateSource
    )
      ? (row.sms_transaction_date_source as SmsTransactionDateSource)
      : "received_at";
  return {
    currency: row.currency as CurrencyCode,
    dateFormat: row.date_format as DateFormat,
    firstDayOfWeek: row.first_day_of_week as FirstDayOfWeek,
    smsTransactionDateSource: sms,
  };
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const rows = await sql`
      SELECT currency, date_format, first_day_of_week, sms_transaction_date_source
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
          sms_transaction_date_source: "received_at",
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
    const smsTransactionDateSource = body.smsTransactionDateSource as
      | string
      | undefined;

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
    if (
      smsTransactionDateSource !== undefined &&
      !SMS_TX_DATE_SOURCES.includes(smsTransactionDateSource as SmsTransactionDateSource)
    ) {
      return NextResponse.json(
        { error: "Invalid smsTransactionDateSource" },
        { status: 400 }
      );
    }

    const existing = await sql`
      SELECT currency, date_format, first_day_of_week, sms_transaction_date_source
      FROM user_settings
      WHERE user_id = ${userId}
    `;
    const current = (existing[0] as SettingsRow | undefined) ?? {
      currency: "USD",
      date_format: "medium",
      first_day_of_week: "monday",
      sms_transaction_date_source: "received_at",
    };
    const nextCurrency = currency ?? current.currency;
    const nextDateFormat = dateFormat ?? current.date_format;
    const nextFirstDay = firstDayOfWeek ?? current.first_day_of_week;
    const nextSmsDate =
      smsTransactionDateSource ?? current.sms_transaction_date_source;

    await sql`
      INSERT INTO user_settings (
        user_id,
        currency,
        date_format,
        first_day_of_week,
        sms_transaction_date_source
      )
      VALUES (
        ${userId},
        ${nextCurrency},
        ${nextDateFormat},
        ${nextFirstDay},
        ${nextSmsDate}
      )
      ON CONFLICT (user_id) DO UPDATE SET
        currency = ${nextCurrency},
        date_format = ${nextDateFormat},
        first_day_of_week = ${nextFirstDay},
        sms_transaction_date_source = ${nextSmsDate}
    `;

    return NextResponse.json(
      rowToSettings({
        currency: nextCurrency,
        date_format: nextDateFormat,
        first_day_of_week: nextFirstDay,
        sms_transaction_date_source: nextSmsDate,
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
