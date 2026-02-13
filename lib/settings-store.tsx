"use client";

import React, {
  createContext,
  useCallback,
  useContext,
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

function loadSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      currency: parsed.currency ?? DEFAULT_SETTINGS.currency,
      dateFormat: parsed.dateFormat ?? DEFAULT_SETTINGS.dateFormat,
      firstDayOfWeek: parsed.firstDayOfWeek ?? DEFAULT_SETTINGS.firstDayOfWeek,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: AppSettings) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
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
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  const setCurrency = useCallback((currency: CurrencyCode) => {
    setSettings((prev) => {
      const next = { ...prev, currency };
      saveSettings(next);
      return next;
    });
  }, []);

  const setDateFormat = useCallback((dateFormat: DateFormat) => {
    setSettings((prev) => {
      const next = { ...prev, dateFormat };
      saveSettings(next);
      return next;
    });
  }, []);

  const setFirstDayOfWeek = useCallback((firstDayOfWeek: FirstDayOfWeek) => {
    setSettings((prev) => {
      const next = { ...prev, firstDayOfWeek };
      saveSettings(next);
      return next;
    });
  }, []);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
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
