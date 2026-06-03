import { sql } from "@/lib/db";
import type { CurrencyCode } from "@/lib/currency-codes";

const FRANKFURTER_API = "https://api.frankfurter.dev";

type FrankfurterRateResponse = {
  base?: string;
  quote?: string;
  date?: string;
  rate?: number;
  message?: string;
};

export type ExchangeRateResult = {
  rate: number;
  rateDate: string;
  source: string;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function convertWithRate(amount: number, rate: number): number {
  return roundMoney(amount * rate);
}

async function readCachedRate(
  base: CurrencyCode,
  quote: CurrencyCode,
  date: string
): Promise<ExchangeRateResult | null> {
  const rows = await sql`
    SELECT rate, rate_date::text AS rate_date, source
    FROM fx_rates
    WHERE base_currency = ${base}
      AND quote_currency = ${quote}
      AND rate_date = ${date}::date
    LIMIT 1
  `;
  const row = rows[0] as
    | { rate: string; rate_date: string; source: string }
    | undefined;
  if (!row) return null;
  const rate = Number(row.rate);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return { rate, rateDate: row.rate_date, source: row.source };
}

async function cacheRate(
  base: CurrencyCode,
  quote: CurrencyCode,
  rateDate: string,
  rate: number,
  source: string
): Promise<void> {
  await sql`
    INSERT INTO fx_rates (rate_date, base_currency, quote_currency, rate, source)
    VALUES (${rateDate}::date, ${base}, ${quote}, ${rate}, ${source})
    ON CONFLICT (rate_date, base_currency, quote_currency) DO UPDATE
    SET rate = EXCLUDED.rate,
        source = EXCLUDED.source,
        fetched_at = now()
  `;
}

async function fetchFrankfurterRate(
  base: CurrencyCode,
  quote: CurrencyCode,
  date: string
): Promise<ExchangeRateResult> {
  const url = `${FRANKFURTER_API}/v2/rate/${base}/${quote}?date=${encodeURIComponent(date)}`;
  const res = await fetch(url, { next: { revalidate: 86400 } });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as FrankfurterRateResponse | null;
    const detail = body?.message ?? res.statusText;
    throw new Error(`Frankfurter rate unavailable for ${base}/${quote} on ${date}: ${detail}`);
  }
  const data = (await res.json()) as FrankfurterRateResponse;
  const rate = data.rate;
  const rateDate = data.date ?? date;
  if (rate == null || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Frankfurter returned invalid rate for ${base}/${quote} on ${date}`);
  }
  await cacheRate(base, quote, rateDate, rate, "frankfurter");
  return { rate, rateDate, source: "frankfurter" };
}

/**
 * Returns the exchange rate to multiply `base` amount into `quote` currency
 * for the given calendar date (uses Frankfurter with DB cache).
 */
export async function getExchangeRate(
  base: CurrencyCode,
  quote: CurrencyCode,
  date: string
): Promise<ExchangeRateResult> {
  if (base === quote) {
    return { rate: 1, rateDate: date, source: "identity" };
  }

  const cached = await readCachedRate(base, quote, date);
  if (cached) return cached;

  try {
    return await fetchFrankfurterRate(base, quote, date);
  } catch (firstError) {
    // Frankfurter may store the resolved date separately from the request date.
    const cachedAfterFetch = await readCachedRate(base, quote, date);
    if (cachedAfterFetch) return cachedAfterFetch;
    throw firstError;
  }
}
