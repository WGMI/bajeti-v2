export type CategoryType = "income" | "expense" | "transfer";

export interface Category {
  id: string;
  name: string;
  type: CategoryType;
  isDefault?: boolean;
}

export interface Transaction {
  id: string;
  amount: number;
  categoryId: string;
  /** Present on API responses when loaded with a category join. */
  categoryName?: string;
  /** Present on API responses: `{ id, name }` for display. */
  category?: { id: string; name: string };
  date: string; // ISO date YYYY-MM-DD
  notes: string;
  type: CategoryType;
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
