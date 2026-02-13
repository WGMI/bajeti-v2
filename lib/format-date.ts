import type { DateFormat } from "./settings-store";

export function formatDateWithPreference(
  isoDateString: string,
  preference: DateFormat
): string {
  // Use only YYYY-MM-DD so we handle both "2026-01-31" and "2026-01-31T00:00:00.000Z"
  const dateOnly = isoDateString.slice(0, 10);
  const d = new Date(dateOnly + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "—";
  switch (preference) {
    case "short":
      return d.toLocaleDateString(undefined, {
        month: "numeric",
        day: "numeric",
        year: "2-digit",
      });
    case "long":
      return d.toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    case "medium":
    default:
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
  }
}
