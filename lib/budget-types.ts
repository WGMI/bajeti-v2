export type CategoryType = "income" | "expense" | "transfer";

export type TransferLeg = "out" | "in";

export interface Account {
  id: string;
  name: string;
  isDefault?: boolean;
  /** Present on list API when balances are computed. */
  balance?: number;
  /** Money in (income + transfer in), from list API. */
  totalIn?: number;
  /** Money out (expenses + transfer out), from list API. */
  totalOut?: number;
}

export interface Category {
  id: string;
  name: string;
  type: CategoryType;
  isDefault?: boolean;
}

export interface Transaction {
  id: string;
  amount: number;
  /** Storage currency (user home currency when converted from SMS). */
  currency?: string | null;
  originalAmount?: number | null;
  originalCurrency?: string | null;
  fxRate?: number | null;
  fxRateDate?: string | null;
  fxSource?: string | null;
  accountId: string;
  /** Present on API responses when loaded with an account join. */
  accountName?: string;
  categoryId: string;
  /** Present on API responses when loaded with a category join. */
  categoryName?: string;
  /** Present on API responses: `{ id, name }` for display. */
  category?: { id: string; name: string };
  date: string; // ISO date YYYY-MM-DD
  notes: string;
  type: CategoryType;
  transferGroupId?: string | null;
  transferLeg?: TransferLeg | null;
  /** Other account in a paired transfer (when loaded). */
  counterAccountId?: string | null;
  counterAccountName?: string | null;
  /** Payee / payer label from SMS when available. */
  smsCounterparty?: string | null;
  smsCounterpartyKey?: string | null;
  /** Present on POST /api/transactions responses only. */
  status?: "created" | "duplicate";
  /** User-facing note when `status` is `duplicate`. */
  message?: string;
}

export const DEFAULT_CATEGORIES: Omit<Category, "id">[] = [
  { name: "Food", type: "expense", isDefault: true },
  { name: "Rent", type: "expense", isDefault: true },
  { name: "Transport", type: "expense", isDefault: true },
  { name: "Bills", type: "expense", isDefault: true },
  { name: "Entertainment", type: "expense", isDefault: true },
  { name: "Savings", type: "expense", isDefault: true },
  { name: "Salary", type: "income", isDefault: true },
  { name: "Other Income", type: "income", isDefault: true },
  { name: "Transfer", type: "transfer", isDefault: true },
  { name: "Other", type: "expense", isDefault: true },
];
