"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Account, BudgetPlan, Category, Transaction } from "./budget-types";

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
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgetPlans: BudgetPlan[];
  loading: boolean;
  error: string | null;
}

interface BudgetActions {
  addTransaction: (tx: {
    amount: number;
    categoryId: string;
    date: string;
    notes: string;
    smsMessage?: string | null;
    type: Transaction["type"];
    accountId?: string;
    fromAccountId?: string;
    toAccountId?: string;
    idempotencyKey?: string;
    transactionCharges?: number;
  }) => Promise<Transaction>;
  updateTransaction: (
    id: string,
    tx: Partial<Transaction> & { fromAccountId?: string; toAccountId?: string }
  ) => Promise<Transaction>;
  deleteTransaction: (id: string) => Promise<void>;
  addAccount: (name: string) => Promise<Account>;
  updateAccount: (id: string, name: string) => Promise<Account>;
  deleteAccount: (id: string) => Promise<void>;
  getAccountById: (id: string) => Account | undefined;
  getDefaultAccount: () => Account | undefined;
  addCategory: (cat: Omit<Category, "id">) => Promise<void>;
  updateCategory: (id: string, cat: Partial<Pick<Category, "name" | "type">>) => Promise<void>;
  deleteCategory: (
    id: string,
    options?: { reassignToCategoryId?: string; deleteTransactions?: boolean }
  ) => Promise<void>;
  getCategoryById: (id: string) => Category | undefined;
  upsertBudgetPlan: (plan: Omit<BudgetPlan, "id">) => Promise<BudgetPlan>;
  deleteBudgetPlan: (id: string) => Promise<void>;
  refetch: () => Promise<void>;
}

type BudgetContextValue = BudgetState & BudgetActions;

const BudgetContext = createContext<BudgetContextValue | null>(null);

export function BudgetProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgetPlans, setBudgetPlans] = useState<BudgetPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [accts, cats, txRes, budgets] = await Promise.all([
        fetchJson<Account[]>(`${API}/accounts`),
        fetchJson<Category[]>(`${API}/categories`),
        fetchJson<{ transactions: Transaction[]; nextCursor: string | null }>(`${API}/transactions`),
        fetchJson<BudgetPlan[]>(`${API}/budgets`),
      ]);
      setAccounts(accts);
      setCategories(cats);
      setTransactions(txRes.transactions);
      setBudgetPlans(budgets);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
      setAccounts([]);
      setCategories([]);
      setTransactions([]);
      setBudgetPlans([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const addTransaction = useCallback(
    async (tx: Parameters<BudgetActions["addTransaction"]>[0]) => {
      const created = await fetchJson<Transaction>(`${API}/transactions`, {
        method: "POST",
        body: JSON.stringify(tx),
      });
      if (created.transferGroupId) {
        const txRes = await fetchJson<{ transactions: Transaction[] }>(`${API}/transactions`);
        setTransactions(txRes.transactions);
      } else {
        setTransactions((prev) =>
          prev.some((t) => t.id === created.id) ? prev : [created, ...prev]
        );
      }
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
    const res = await fetchJson<{ ok: boolean; deletedIds?: string[] }>(
      `${API}/transactions/${id}`,
      { method: "DELETE" }
    );
    const ids = new Set(res.deletedIds ?? [id]);
    setTransactions((prev) => prev.filter((t) => !ids.has(t.id)));
  }, []);

  const addAccount = useCallback(async (name: string) => {
    const created = await fetchJson<Account>(`${API}/accounts`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    setAccounts((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    return created;
  }, []);

  const updateAccount = useCallback(async (id: string, name: string) => {
    const updated = await fetchJson<Account>(`${API}/accounts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    setAccounts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...updated } : a))
    );
    return updated;
  }, []);

  const deleteAccount = useCallback(async (id: string) => {
    await fetchJson(`${API}/accounts/${id}`, { method: "DELETE" });
    setAccounts((prev) => prev.filter((a) => a.id !== id));
    await fetchData();
  }, [fetchData]);

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
        setBudgetPlans((prev) => prev.filter((plan) => plan.categoryId !== id));
      }
    },
    [fetchData]
  );

  const getCategoryById = useCallback(
    (id: string) => categories.find((c) => c.id === id),
    [categories]
  );

  const upsertBudgetPlan = useCallback(async (plan: Omit<BudgetPlan, "id">) => {
    const saved = await fetchJson<BudgetPlan>(`${API}/budgets`, {
      method: "POST",
      body: JSON.stringify(plan),
    });
    setBudgetPlans((prev) => {
      const next = prev.filter((existing) => existing.id !== saved.id);
      return [...next, saved].sort((a, b) => {
        if (a.month !== b.month) return b.month.localeCompare(a.month);
        if (a.type !== b.type) return a.type === "overall" ? -1 : 1;
        return (a.categoryId ?? "").localeCompare(b.categoryId ?? "");
      });
    });
    return saved;
  }, []);

  const deleteBudgetPlan = useCallback(async (id: string) => {
    await fetchJson(`${API}/budgets/${id}`, { method: "DELETE" });
    setBudgetPlans((prev) => prev.filter((plan) => plan.id !== id));
  }, []);

  const getAccountById = useCallback(
    (id: string) => accounts.find((a) => a.id === id),
    [accounts]
  );

  const getDefaultAccount = useCallback(
    () => accounts.find((a) => a.isDefault) ?? accounts[0],
    [accounts]
  );

  const value = useMemo<BudgetContextValue>(
    () => ({
      accounts,
      categories,
      transactions,
      budgetPlans,
      loading,
      error,
      addTransaction,
      updateTransaction,
      deleteTransaction,
      addAccount,
      updateAccount,
      deleteAccount,
      addCategory,
      updateCategory,
      deleteCategory,
      getCategoryById,
      upsertBudgetPlan,
      deleteBudgetPlan,
      getAccountById,
      getDefaultAccount,
      refetch: fetchData,
    }),
    [
      accounts,
      categories,
      transactions,
      budgetPlans,
      loading,
      error,
      addTransaction,
      updateTransaction,
      deleteTransaction,
      addAccount,
      updateAccount,
      deleteAccount,
      addCategory,
      updateCategory,
      deleteCategory,
      getCategoryById,
      upsertBudgetPlan,
      deleteBudgetPlan,
      getAccountById,
      getDefaultAccount,
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
