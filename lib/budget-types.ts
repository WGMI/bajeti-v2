export type CategoryType = "income" | "expense";

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
  date: string; // ISO date YYYY-MM-DD
  notes: string;
  type: CategoryType;
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
];
