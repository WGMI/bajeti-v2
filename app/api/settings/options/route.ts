import { NextResponse } from "next/server";

const CURRENCY_CODES = ["USD", "EUR", "GBP", "TZS", "KES", "NGN", "ZAR", "INR"] as const;
const DATE_FORMATS = ["short", "medium", "long"] as const;
const FIRST_DAY_VALUES = ["sunday", "monday"] as const;
const THEMES = ["system", "light", "dark"] as const;

const SMS_TX_DATE_SOURCES = ["message", "received_at"] as const;

export async function GET() {
  return NextResponse.json({
    currency: CURRENCY_CODES,
    dateFormat: DATE_FORMATS,
    firstDayOfWeek: FIRST_DAY_VALUES,
    smsTransactionDateSource: SMS_TX_DATE_SOURCES,
    theme: THEMES,
  });
}
