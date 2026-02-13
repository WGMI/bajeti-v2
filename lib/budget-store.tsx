"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Category, CategoryType, Transaction } from "./budget-types";

const API = "/api";

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
    credentials: "same-origin",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? "Request failed");
  }
  return res.json();
}

interface BudgetState {
  categories: Category[];
  transactions: Transaction[];
  loading: boolean;
  error: string | null;
}

interface BudgetActions {
  addTransaction: (tx: Omit<Transaction, "id">) => Promise<Transaction>;
  updateTransaction: (id: string, tx: Partial<Transaction>) => Promise<Transaction>;
  deleteTransaction: (id: string) => Promise<void>;
  addCategory: (cat: Omit<Category, "id">) => Promise<void>;
  updateCategory: (id: string, cat: Partial<Pick<Category, "name" | "type">>) => Promise<void>;
  deleteCategory: (
    id: string,
    options?: { reassignToCategoryId?: string; deleteTransactions?: boolean }
  ) => Promise<void>;
  getCategoryById: (id: string) => Category | undefined;
  refetch: () => Promise<void>;
}

type BudgetContextValue = BudgetState & BudgetActions;

const BudgetContext = createContext<BudgetContextValue | null>(null);

export function BudgetProvider({ children }: { children: React.ReactNode }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cats, txRes] = await Promise.all([
        fetchJson<Category[]>(`${API}/categories`),
        fetchJson<{ transactions: Transaction[]; nextCursor: string | null }>(`${API}/transactions`),
      ]);
      setCategories(cats);
      setTransactions(txRes.transactions);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
      setCategories([]);
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const addTransaction = useCallback(
    async (tx: Omit<Transaction, "id">) => {
      const created = await fetchJson<Transaction>(`${API}/transactions`, {
        method: "POST",
        body: JSON.stringify(tx),
      });
      setTransactions((prev) => [created, ...prev]);
      return created;
    },
    []
  );

  const updateTransaction = useCallback(
    async (id: string, patch: Partial<Transaction>) => {
      const updated = await fetchJson<Transaction>(`${API}/transactions/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setTransactions((prev) =>
        prev.map((t) => (t.id === id ? updated : t))
      );
      return updated;
    },
    []
  );

  const deleteTransaction = useCallback(async (id: string) => {
    await fetchJson(`${API}/transactions/${id}`, { method: "DELETE" });
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addCategory = useCallback(
    async (cat: Omit<Category, "id">) => {
      const created = await fetchJson<Category>(`${API}/categories`, {
        method: "POST",
        body: JSON.stringify({ ...cat, isDefault: false }),
      });
      setCategories((prev) => [...prev, created]);
    },
    []
  );

  const updateCategory = useCallback(
    async (id: string, patch: Partial<Pick<Category, "name" | "type">>) => {
      const updated = await fetchJson<Category>(`${API}/categories/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setCategories((prev) =>
        prev.map((c) => (c.id === id ? updated : c))
      );
    },
    []
  );

  const deleteCategory = useCallback(
    async (
      id: string,
      options?: { reassignToCategoryId?: string; deleteTransactions?: boolean }
    ) => {
      const init: RequestInit = { method: "DELETE" };
      if (options && (options.reassignToCategoryId || options.deleteTransactions)) {
        init.body = JSON.stringify(options);
      }
      await fetchJson(`${API}/categories/${id}`, init);
      setCategories((prev) => prev.filter((c) => c.id !== id));
      if (options) {
        await fetchData();
      } else {
        setTransactions((prev) => prev.filter((t) => t.categoryId !== id));
      }
    },
    [fetchData]
  );

  const getCategoryById = useCallback(
    (id: string) => categories.find((c) => c.id === id),
    [categories]
  );

  const value = useMemo<BudgetContextValue>(
    () => ({
      categories,
      transactions,
      loading,
      error,
      addTransaction,
      updateTransaction,
      deleteTransaction,
      addCategory,
      updateCategory,
      deleteCategory,
      getCategoryById,
      refetch: fetchData,
    }),
    [
      categories,
      transactions,
      loading,
      error,
      addTransaction,
      updateTransaction,
      deleteTransaction,
      addCategory,
      updateCategory,
      deleteCategory,
      getCategoryById,
      fetchData,
    ]
  );

  return (
    <BudgetContext.Provider value={value}>{children}</BudgetContext.Provider>
  );
}

export function useBudget() {
  const ctx = useContext(BudgetContext);
  if (!ctx) throw new Error("useBudget must be used within BudgetProvider");
  return ctx;
}
