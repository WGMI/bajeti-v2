/**
 * Transaction amounts are stored as positive magnitudes; `type` determines direction in totals/UI.
 */

/** Normalize a stored or legacy amount to a positive magnitude. */
export function normalizeStoredAmount(amount: number): number {
  return Math.abs(amount);
}

/**
 * Parse and validate amount for insert/update.
 * Returns null when the value is missing, not a number, or not positive.
 */
export function parseAmountForStorage(raw: unknown): number | null {
  const num = Number(raw);
  if (Number.isNaN(num)) return null;
  const abs = Math.abs(num);
  if (abs <= 0) return null;
  return abs;
}

/** Parse optional transaction charges; returns 0 when missing. Rejects negative values. */
export function parseChargesForStorage(raw: unknown): number | null {
  if (raw == null || raw === "") return 0;
  const num = Number(raw);
  if (Number.isNaN(num) || num < 0) return null;
  return Math.abs(num);
}

/** Expense outflow including separate charges (for balances and totals). */
export function expenseOutflow(amount: number, charges: number | null | undefined): number {
  return Math.abs(amount) + Math.max(0, charges ?? 0);
}
