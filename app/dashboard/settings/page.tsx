"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useSettings, CURRENCY_OPTIONS } from "@/lib/settings-store";
import type { CurrencyCode, DateFormat, FirstDayOfWeek } from "@/lib/settings-store";
import { Settings as SettingsIcon } from "lucide-react";

export default function SettingsPage() {
  const {
    currency,
    dateFormat,
    firstDayOfWeek,
    setCurrency,
    setDateFormat,
    setFirstDayOfWeek,
  } = useSettings();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <SettingsIcon className="h-7 w-7" />
          Settings
        </h1>
        <p className="text-muted-foreground mt-1">
          Customize how amounts and dates are displayed across the app.
        </p>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-medium">Display</CardTitle>
          <p className="text-sm text-muted-foreground font-normal">
            Currency and formatting preferences. Changes apply immediately.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="currency">Currency</Label>
            <Select
              value={currency}
              onValueChange={(v) => setCurrency(v as CurrencyCode)}
            >
              <SelectTrigger id="currency" className="max-w-xs">
                {CURRENCY_OPTIONS.find((o) => o.value === currency)?.label ??
                  currency}
              </SelectTrigger>
              <SelectContent>
                {CURRENCY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              All amounts on the dashboard and reports will use this currency
              symbol and formatting.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dateFormat">Date format</Label>
            <Select
              value={dateFormat}
              onValueChange={(v) => setDateFormat(v as DateFormat)}
            >
              <SelectTrigger id="dateFormat" className="max-w-xs">
                {dateFormat === "short" && "Short (e.g. 2/7/25)"}
                {dateFormat === "medium" && "Medium (e.g. Feb 7, 2025)"}
                {dateFormat === "long" && "Long (e.g. February 7, 2025)"}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="short">Short (e.g. 2/7/25)</SelectItem>
                <SelectItem value="medium">Medium (e.g. Feb 7, 2025)</SelectItem>
                <SelectItem value="long">Long (e.g. February 7, 2025)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              How dates are shown in transaction lists and monthly view.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="firstDayOfWeek">First day of week</Label>
            <Select
              value={firstDayOfWeek}
              onValueChange={(v) => setFirstDayOfWeek(v as FirstDayOfWeek)}
            >
              <SelectTrigger id="firstDayOfWeek" className="max-w-xs">
                {firstDayOfWeek === "sunday" ? "Sunday" : "Monday"}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sunday">Sunday</SelectItem>
                <SelectItem value="monday">Monday</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Used for weekly summaries and any calendar-style views.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
