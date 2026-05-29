export type CategoryType = "income" | "expense" | "transfer";

export type TransferLeg = "out" | "in";

export interface Account {
  id: string;
  name: string;
  isDefault?: boolean;
  /** Present on list API when balances are computed. */
  balance?: number;
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
