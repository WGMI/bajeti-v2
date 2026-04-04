import type { DateFormat } from "./settings-store";

/**
 * Coerce a Postgres `date` value to `YYYY-MM-DD` for API JSON.
 * Prefer `date::text AS date` in SQL so drivers never return a JS Date (timezone skew).
 */
export function normalizeTransactionDateFromDb(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") {
    const t = raw.trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return t.slice(0, 10);
  }
  if (raw instanceof Date) {
    // Legacy fallback: pg `date` deserialized as Date is ambiguous; use local calendar parts.
    const y = raw.getFullYear();
    const mo = raw.getMonth() + 1;
    const d = raw.getDate();
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return String(raw).slice(0, 10);
}

/**
 * Transaction dates are timezone-free calendar days (Postgres `date` / `YYYY-MM-DD`).
 * Use UTC for both parsing and `toLocaleDateString`, so the UI always matches the
 * stored Y-M-D regardless of the user's timezone (avoids Mar 30 in DB → Mar 29 in UI).
 */
export function calendarDateFromIso(isoDateString: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDateString.trim());
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const monthIndex = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  const d = new Date(Date.UTC(y, monthIndex, day));
  if (
    d.getUTCFullYear() !== y ||
    d.getUTCMonth() !== monthIndex ||
    d.getUTCDate() !== day
  ) {
    return null;
  }
  return d;
}

const LOCALE_OPTS_UTC = { timeZone: "UTC" } as const;

/** Descending sort by YYYY-MM-DD prefix (matches Postgres `date` ordering). */
export function compareIsoDateStringsDesc(a: string, b: string): number {
  return b.slice(0, 10).localeCompare(a.slice(0, 10));
}

export function formatDateWithPreference(
  isoDateString: string,
  preference: DateFormat
): string {
  const d = calendarDateFromIso(isoDateString);
  if (!d) return "—";
  switch (preference) {
    case "short":
      return d.toLocaleDateString(undefined, {
        ...LOCALE_OPTS_UTC,
        month: "numeric",
        day: "numeric",
        year: "2-digit",
      });
    case "long":
      return d.toLocaleDateString(undefined, {
        ...LOCALE_OPTS_UTC,
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    case "medium":
    default:
      return d.toLocaleDateString(undefined, {
        ...LOCALE_OPTS_UTC,
        month: "short",
        day: "numeric",
        year: "numeric",
      });
  }
}
