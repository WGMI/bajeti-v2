import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { sql } from "@/lib/db";

const CURRENCY_CODES = ["USD", "EUR", "GBP", "TZS", "KES", "NGN", "ZAR", "INR"] as const;
const DATE_FORMATS = ["short", "medium", "long"] as const;
const FIRST_DAY_VALUES = ["sunday", "monday"] as const;
const THEMES = ["system", "light", "dark"] as const;

type CurrencyCode = (typeof CURRENCY_CODES)[number];
type DateFormat = (typeof DATE_FORMATS)[number];
type FirstDayOfWeek = (typeof FIRST_DAY_VALUES)[number];
type Theme = (typeof THEMES)[number];

type SharedSettingsRow = {
  currency: string;
  date_format: string;
  first_day_of_week: string;
  sms_transaction_date_source: string;
};

type MobileSettingsRow = {
  theme: string;
  notifications_enabled: boolean;
  biometrics_enabled: boolean;
};

const DEFAULT_SHARED: SharedSettingsRow = {
  currency: "USD",
  date_format: "medium",
  first_day_of_week: "monday",
  sms_transaction_date_source: "received_at",
};

const DEFAULT_MOBILE: MobileSettingsRow = {
  theme: "system",
  notifications_enabled: true,
  biometrics_enabled: false,
};

const SMS_TX_DATE_SOURCES = ["message", "received_at"] as const;

function toResponse(shared: SharedSettingsRow, mobile: MobileSettingsRow) {
  const smsTx =
    SMS_TX_DATE_SOURCES.includes(
      shared.sms_transaction_date_source as (typeof SMS_TX_DATE_SOURCES)[number]
    )
      ? shared.sms_transaction_date_source
      : "received_at";
  return {
    currency: shared.currency as CurrencyCode,
    dateFormat: shared.date_format as DateFormat,
    firstDayOfWeek: shared.first_day_of_week as FirstDayOfWeek,
    smsTransactionDateSource: smsTx,
    theme: mobile.theme as Theme,
    notificationsEnabled: mobile.notifications_enabled,
    biometricsEnabled: mobile.biometrics_enabled,
  };
}

async function getOrCreateSharedSettings(userId: string): Promise<SharedSettingsRow> {
  const rows = await sql`
    SELECT currency, date_format, first_day_of_week, sms_transaction_date_source
    FROM user_settings
    WHERE user_id = ${userId}
  `;
  if (rows.length > 0) return rows[0] as SharedSettingsRow;

  await sql`
    INSERT INTO user_settings (user_id, currency, date_format, first_day_of_week)
    VALUES (${userId}, ${DEFAULT_SHARED.currency}, ${DEFAULT_SHARED.date_format}, ${DEFAULT_SHARED.first_day_of_week})
  `;
  return DEFAULT_SHARED;
}

async function getOrCreateMobileSettings(userId: string): Promise<MobileSettingsRow> {
  const rows = await sql`
    SELECT theme, notifications_enabled, biometrics_enabled
    FROM user_mobile_settings
    WHERE user_id = ${userId}
  `;
  if (rows.length > 0) return rows[0] as MobileSettingsRow;

  await sql`
    INSERT INTO user_mobile_settings (user_id, theme, notifications_enabled, biometrics_enabled)
    VALUES (${userId}, ${DEFAULT_MOBILE.theme}, ${DEFAULT_MOBILE.notifications_enabled}, ${DEFAULT_MOBILE.biometrics_enabled})
  `;
  return DEFAULT_MOBILE;
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const [shared, mobile] = await Promise.all([
      getOrCreateSharedSettings(userId),
      getOrCreateMobileSettings(userId),
    ]);
    return NextResponse.json(toResponse(shared, mobile));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to fetch mobile settings" }, { status: 500 });
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
    const theme = body.theme as string | undefined;
    const notificationsEnabled = body.notificationsEnabled as boolean | undefined;
    const biometricsEnabled = body.biometricsEnabled as boolean | undefined;
    const smsTransactionDateSource = body.smsTransactionDateSource as
      | string
      | undefined;

    if (currency !== undefined && !CURRENCY_CODES.includes(currency as CurrencyCode)) {
      return NextResponse.json({ error: "Invalid currency" }, { status: 400 });
    }
    if (dateFormat !== undefined && !DATE_FORMATS.includes(dateFormat as DateFormat)) {
      return NextResponse.json({ error: "Invalid dateFormat" }, { status: 400 });
    }
    if (
      firstDayOfWeek !== undefined &&
      !FIRST_DAY_VALUES.includes(firstDayOfWeek as FirstDayOfWeek)
    ) {
      return NextResponse.json({ error: "Invalid firstDayOfWeek" }, { status: 400 });
    }
    if (theme !== undefined && !THEMES.includes(theme as Theme)) {
      return NextResponse.json({ error: "Invalid theme" }, { status: 400 });
    }
    if (
      notificationsEnabled !== undefined &&
      typeof notificationsEnabled !== "boolean"
    ) {
      return NextResponse.json({ error: "Invalid notificationsEnabled" }, { status: 400 });
    }
    if (biometricsEnabled !== undefined && typeof biometricsEnabled !== "boolean") {
      return NextResponse.json({ error: "Invalid biometricsEnabled" }, { status: 400 });
    }
    if (
      smsTransactionDateSource !== undefined &&
      !SMS_TX_DATE_SOURCES.includes(
        smsTransactionDateSource as (typeof SMS_TX_DATE_SOURCES)[number]
      )
    ) {
      return NextResponse.json(
        { error: "Invalid smsTransactionDateSource" },
        { status: 400 }
      );
    }

    const [currentShared, currentMobile] = await Promise.all([
      getOrCreateSharedSettings(userId),
      getOrCreateMobileSettings(userId),
    ]);

    const nextShared: SharedSettingsRow = {
      currency: currency ?? currentShared.currency,
      date_format: dateFormat ?? currentShared.date_format,
      first_day_of_week: firstDayOfWeek ?? currentShared.first_day_of_week,
      sms_transaction_date_source:
        smsTransactionDateSource ?? currentShared.sms_transaction_date_source,
    };

    const nextMobile: MobileSettingsRow = {
      theme: theme ?? currentMobile.theme,
      notifications_enabled: notificationsEnabled ?? currentMobile.notifications_enabled,
      biometrics_enabled: biometricsEnabled ?? currentMobile.biometrics_enabled,
    };

    await Promise.all([
      sql`
        INSERT INTO user_settings (
          user_id,
          currency,
          date_format,
          first_day_of_week,
          sms_transaction_date_source
        )
        VALUES (
          ${userId},
          ${nextShared.currency},
          ${nextShared.date_format},
          ${nextShared.first_day_of_week},
          ${nextShared.sms_transaction_date_source}
        )
        ON CONFLICT (user_id) DO UPDATE SET
          currency = ${nextShared.currency},
          date_format = ${nextShared.date_format},
          first_day_of_week = ${nextShared.first_day_of_week},
          sms_transaction_date_source = ${nextShared.sms_transaction_date_source}
      `,
      sql`
        INSERT INTO user_mobile_settings (user_id, theme, notifications_enabled, biometrics_enabled)
        VALUES (${userId}, ${nextMobile.theme}, ${nextMobile.notifications_enabled}, ${nextMobile.biometrics_enabled})
        ON CONFLICT (user_id) DO UPDATE SET
          theme = ${nextMobile.theme},
          notifications_enabled = ${nextMobile.notifications_enabled},
          biometrics_enabled = ${nextMobile.biometrics_enabled}
      `,
    ]);

    return NextResponse.json(toResponse(nextShared, nextMobile));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to update mobile settings" }, { status: 500 });
  }
}
