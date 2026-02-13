/**
 * Format a number as currency using Intl.NumberFormat.
 * Use with the currency code from settings (e.g. "USD", "TZS").
 */
export function formatCurrency(
  amount: number,
  currencyCode: string,
  options?: { compact?: boolean }
): string {
  const formatter = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currencyCode,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    ...(options?.compact && {
      notation: "compact",
      maximumFractionDigits: 1,
    }),
  });
  return formatter.format(amount);
}

/**
 * Format amount with sign prefix (+ / −) for income/expense display.
 */
export function formatCurrencyWithSign(
  amount: number,
  currencyCode: string
): string {
  const formatted = formatCurrency(Math.abs(amount), currencyCode);
  const sign = amount >= 0 ? "+" : "−";
  return `${sign} ${formatted}`;
}
