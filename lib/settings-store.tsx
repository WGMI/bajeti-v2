"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const STORAGE_KEY = "bajeti-settings";

export type CurrencyCode =
  | "USD"
  | "EUR"
  | "GBP"
  | "TZS"
  | "KES"
  | "NGN"
  | "ZAR"
  | "INR";

export type DateFormat = "short" | "medium" | "long";
export type FirstDayOfWeek = "sunday" | "monday";

export interface AppSettings {
  currency: CurrencyCode;
  dateFormat: DateFormat;
  firstDayOfWeek: FirstDayOfWeek;
}

const DEFAULT_SETTINGS: AppSettings = {
  currency: "USD",
  dateFormat: "medium",
  firstDayOfWeek: "monday",
};

function loadFromCache(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      currency: (parsed.currency ?? DEFAULT_SETTINGS.currency) as CurrencyCode,
      dateFormat: (parsed.dateFormat ?? DEFAULT_SETTINGS.dateFormat) as DateFormat,
      firstDayOfWeek: (parsed.firstDayOfWeek ?? DEFAULT_SETTINGS.firstDayOfWeek) as FirstDayOfWeek,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveToCache(settings: AppSettings) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

async function fetchSettings(): Promise<AppSettings | null> {
  try {
    const res = await fetch("/api/settings");
    if (!res.ok) return null;
    const data = await res.json();
    return {
      currency: data.currency ?? DEFAULT_SETTINGS.currency,
      dateFormat: data.dateFormat ?? DEFAULT_SETTINGS.dateFormat,
      firstDayOfWeek: data.firstDayOfWeek ?? DEFAULT_SETTINGS.firstDayOfWeek,
    };
  } catch {
    return null;
  }
}

async function persistSettings(settings: AppSettings): Promise<void> {
  try {
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
  } catch {
    // ignore; cache still updated
  }
}

interface SettingsContextValue extends AppSettings {
  setCurrency: (currency: CurrencyCode) => void;
  setDateFormat: (format: DateFormat) => void;
  setFirstDayOfWeek: (day: FirstDayOfWeek) => void;
  updateSettings: (patch: Partial<AppSettings>) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => loadFromCache());

  useEffect(() => {
    fetchSettings().then((fromDb) => {
      if (fromDb) {
        setSettings(fromDb);
        saveToCache(fromDb);
      }
    });
  }, []);

  const setCurrency = useCallback((currency: CurrencyCode) => {
    setSettings((prev) => {
      const next = { ...prev, currency };
      saveToCache(next);
      persistSettings(next);
      return next;
    });
  }, []);

  const setDateFormat = useCallback((dateFormat: DateFormat) => {
    setSettings((prev) => {
      const next = { ...prev, dateFormat };
      saveToCache(next);
      persistSettings(next);
      return next;
    });
  }, []);

  const setFirstDayOfWeek = useCallback((firstDayOfWeek: FirstDayOfWeek) => {
    setSettings((prev) => {
      const next = { ...prev, firstDayOfWeek };
      saveToCache(next);
      persistSettings(next);
      return next;
    });
  }, []);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveToCache(next);
      persistSettings(next);
      return next;
    });
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({
      ...settings,
      setCurrency,
      setDateFormat,
      setFirstDayOfWeek,
      updateSettings,
    }),
    [
      settings,
      setCurrency,
      setDateFormat,
      setFirstDayOfWeek,
      updateSettings,
    ]
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx)
    throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}

export const CURRENCY_OPTIONS: { value: CurrencyCode; label: string }[] = [
  { value: "USD", label: "US Dollar (USD)" },
  { value: "EUR", label: "Euro (EUR)" },
  { value: "GBP", label: "British Pound (GBP)" },
  { value: "TZS", label: "Tanzanian Shilling (TZS)" },
  { value: "KES", label: "Kenyan Shilling (KES)" },
  { value: "NGN", label: "Nigerian Naira (NGN)" },
  { value: "ZAR", label: "South African Rand (ZAR)" },
  { value: "INR", label: "Indian Rupee (INR)" },
];
