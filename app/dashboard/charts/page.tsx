"use client";

import { Suspense, useMemo, useState, type ReactNode } from "react";
import { useUser } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { RotateCw } from "lucide-react";
import { CustomChartPreview } from "@/components/dashboard/custom-chart-preview";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useBudget } from "@/lib/budget-store";
import type { CategoryType, Transaction } from "@/lib/budget-types";
import {
  buildChart, chartFromTransactionFilters, chartValidation, counterpartyOf, defaultChart, dimensions,
  filterChartTransactions, isTimeDimension, measures, resolveChartRange, transactionTypes,
  type ChartConfig, type Dimension, type Display, type Measure, type Period,
} from "@/lib/custom-charts";
import { formatCurrencyWithSign } from "@/lib/format-currency";
import { formatDateWithPreference } from "@/lib/format-date";
import { useSettings } from "@/lib/settings-store";
import { useEffectiveCurrency } from "@/lib/use-effective-currency";

type Option<T extends string = string> = { value: T; label: string };
type SavedChart = { id: string; config: ChartConfig };
const selectClass = "h-9 min-w-0 w-full rounded-md border border-input bg-background px-2.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const groupOptions = Object.entries(dimensions).map(([value, label]) => ({ value: value as Dimension, label }));
const measureOptions = Object.entries(measures).map(([value, measure]) => ({ value: value as Measure, label: measure.label }));
const typeOptions = Object.entries(transactionTypes).map(([value, label]) => ({ value: value as CategoryType, label }));
const dateOptions = [{ value: "all", label: "All time" }, { value: "rolling", label: "Last N months" }, { value: "custom", label: "Custom dates" }] as const;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="grid min-w-0 gap-1.5 text-sm font-medium"><span>{label}</span>{children}</label>;
}

function Choice<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: readonly Option<T>[]; onChange: (value: T) => void;
}) {
  return <Field label={label}>
    <select className={selectClass} value={value} onChange={(event) => onChange(event.target.value as T)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </Field>;
}

function MultiFilter<T extends string>({ label, values, options, onChange }: {
  label: string; values: T[]; options: Option<T>[]; onChange: (values: T[]) => void;
}) {
  const missing = values.filter((value) => !options.some((option) => option.value === value));
  const choices = [...options, ...missing.map((value) => ({ value, label: `Unavailable ${label.toLowerCase().replace(/s$/, "")}` }))];
  return <details className="rounded-md border border-input bg-background">
    <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
      {label} <span className="ml-1 text-muted-foreground">{values.length ? `(${values.length})` : "(All)"}</span>
      {values.length === 1 && <span className="ml-2 text-muted-foreground">{choices.find((option) => option.value === values[0])?.label}</span>}
    </summary>
    <div className="max-h-48 space-y-1 overflow-y-auto border-t px-2 py-2">
      {values.length > 0 && <Button size="sm" variant="ghost" className="h-7" onClick={() => onChange([])}>Clear selection</Button>}
      {choices.length ? choices.map((option) => <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted">
        <input type="checkbox" checked={values.includes(option.value)} onChange={(event) => onChange(event.target.checked ? [...values, option.value] : values.filter((value) => value !== option.value))} />
        <span className="min-w-0 break-words">{option.label}</span>
      </label>) : <p className="px-1.5 text-sm text-muted-foreground">No options available.</p>}
    </div>
  </details>;
}

function readSavedCharts(key: string): SavedChart[] {
  const raw = window.localStorage.getItem(key);
  if (!raw) return [];
  const records: SavedChart[] = JSON.parse(raw);
  return Array.isArray(records) ? records : [];
}

function todayIn(timeZone?: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts();
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function ChartTransactions({ inspection, onClose }: {
  inspection: { label: string; transactions: Transaction[] };
  onClose: () => void;
}) {
  const { dateFormat } = useSettings();
  const currency = useEffectiveCurrency();
  const [page, setPage] = useState(0);
  const pageSize = 25;
  const rows = inspection.transactions.slice(page * pageSize, (page + 1) * pageSize);
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle className="break-words">{inspection.label}</DialogTitle>
        <DialogDescription>{inspection.transactions.length.toLocaleString()} matching ledger entries</DialogDescription>
      </DialogHeader>
      <ul className="divide-y">
        {rows.map((tx) => <li key={tx.id} className="flex flex-wrap justify-between gap-x-3 gap-y-1 py-3 text-sm">
          <div className="min-w-0 flex-1 basis-44">
            <p className="break-words font-medium">{tx.smsCounterparty || tx.categoryName || "Transaction"}</p>
            <p className="break-words text-muted-foreground">{[formatDateWithPreference(tx.date, dateFormat), tx.accountName, tx.categoryName].filter(Boolean).join(" · ")}</p>
            {tx.notes && <p className="mt-1 whitespace-pre-wrap break-words">{tx.notes}</p>}
          </div>
          <div className="text-right tabular-nums">
            <p>{formatCurrencyWithSign(tx.amount, tx.currency || currency, tx.type)}</p>
            {!!tx.transactionCharges && <p className="text-muted-foreground">{formatCurrencyWithSign(tx.transactionCharges, tx.currency || currency)} fee</p>}
          </div>
        </li>)}
      </ul>
      {inspection.transactions.length > pageSize && <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="outline" disabled={!page} onClick={() => setPage(page - 1)}>Previous</Button>
        <span className="text-sm text-muted-foreground">{page + 1} of {Math.ceil(inspection.transactions.length / pageSize)}</span>
        <Button size="sm" variant="outline" disabled={(page + 1) * pageSize >= inspection.transactions.length} onClick={() => setPage(page + 1)}>Next</Button>
      </div>}
    </DialogContent>
  </Dialog>;
}

function ChartBuilder({ initial, storageKey }: { initial: ChartConfig; storageKey: string }) {
  const { accounts, categories, transactions, groups, selectedGroupId, dataScope, loading, error, refetch } = useBudget();
  const { firstDayOfWeek, dateFormat } = useSettings();
  const currency = useEffectiveCurrency();
  const [config, setConfig] = useState(initial);
  const [saved, setSaved] = useState<SavedChart[]>(() => {
    try { return readSavedCharts(storageKey); } catch { return []; }
  });
  const [savedId, setSavedId] = useState("");
  const [notice, setNotice] = useState("");
  const [inspection, setInspection] = useState<{ label: string; transactions: Transaction[] } | null>(null);
  const scoped = dataScope === selectedGroupId;
  const allTransactions = useMemo(() => scoped ? transactions.filter((tx) => (tx.groupId ?? null) === selectedGroupId) : [], [scoped, selectedGroupId, transactions]);
  const counterparties = useMemo(() => {
    const options = new Map<string, string>();
    for (const transaction of allTransactions) {
      const { key, label } = counterpartyOf(transaction);
      if (!options.has(key)) options.set(key, label);
    }
    return [...options].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [allTransactions]);
  const today = todayIn(groups.find((group) => group.id === selectedGroupId)?.timezone);
  const validation = chartValidation(config);
  const matching = useMemo(() => scoped && !validation
    ? filterChartTransactions(allTransactions, config, today) : [], [allTransactions, config, scoped, today, validation]);
  const currencies = useMemo(() => [...new Set(matching.map((tx) => tx.currency || currency))].sort(), [currency, matching]);
  const chartCurrency = config.currency || currencies[0] || currency;
  const needsCurrency = config.measure !== "count" && !config.currency && currencies.length > 1;
  const chart = useMemo(() => {
    if (!scoped || validation || needsCurrency) return null;
    const rows = config.currency ? matching.filter((tx) => (tx.currency || currency) === config.currency) : matching;
    return buildChart(rows, config, firstDayOfWeek === "sunday");
  }, [config, currency, firstDayOfWeek, matching, needsCurrency, scoped, validation]);
  const date = (value: string) => formatDateWithPreference(value, dateFormat);
  const range = validation ? null : resolveChartRange(config, today);
  const dateLabel = range?.from && range.to ? `${date(range.from)} – ${date(range.to)}` :
    range?.from ? `From ${date(range.from)}` : range?.to ? `Through ${date(range.to)}` : "All time";

  function update(patch: Partial<ChartConfig>) {
    setConfig((current) => ({ ...current, ...patch }));
    setNotice("");
  }

  function openSaved(id: string) {
    const entry = saved.find((item) => item.id === id);
    setSavedId(entry?.id ?? "");
    setConfig(entry?.config ?? defaultChart);
    setNotice("");
  }

  function saveChart() {
    try {
      const id = savedId || crypto.randomUUID();
      const current = readSavedCharts(storageKey);
      const draft = { id, config: { ...config, title: config.title.trim() || measures[config.measure].label } };
      const next = current.some((item) => item.id === id) ? current.map((item) => item.id === id ? draft : item) : [...current, draft];
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      setSaved(next);
      setSavedId(id);
      setConfig(draft.config);
      setNotice("Saved in this browser.");
    } catch {
      setNotice("Could not save this chart in this browser.");
    }
  }

  function removeChart() {
    try {
      const next = readSavedCharts(storageKey).filter((item) => item.id !== savedId);
      window.localStorage.setItem(storageKey, JSON.stringify(next));
      setSaved(next);
      setSavedId("");
      setNotice("Removed from saved charts.");
    } catch {
      setNotice("Could not remove this saved chart.");
    }
  }

  return <div className="mx-auto max-w-7xl space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Charts</h1>
        <p className="mt-1 text-sm text-muted-foreground">Explore transactions across any date range.</p>
      </div>
      <Button variant="outline" disabled={loading} onClick={() => void refetch()}><RotateCw /> Refresh data</Button>
    </header>

    <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
      <Card className="min-w-0 shadow-sm">
        <CardHeader><CardTitle className="text-base">Chart settings</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Choice label="Saved charts · this browser" value={savedId} onChange={openSaved} options={[{ value: "", label: "New chart" }, ...saved.map(({ id, config }) => ({ value: id, label: config.title }))]} />
            <Field label="Chart name"><Input value={config.title} maxLength={100} placeholder={measures[config.measure].label} onChange={(event) => update({ title: event.target.value })} /></Field>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!!validation} onClick={saveChart}>{savedId ? "Update chart" : "Save chart"}</Button>
              {savedId ? <><Button variant="outline" onClick={() => openSaved("")}>New chart</Button><Button variant="ghost" onClick={removeChart}>Remove saved chart</Button></> :
                <Button variant="ghost" onClick={() => openSaved("")}>Reset chart</Button>}
            </div>
            {notice && <p className="text-sm text-muted-foreground" role="status">{notice}</p>}
          </div>

          <div className="space-y-3 border-t pt-4">
            <Choice label="Measure" value={config.measure} options={measureOptions} onChange={(measure) => update({ measure, comparison: config.comparison === measure || measure === "count" ? "" : config.comparison })} />
            <p className="text-sm text-muted-foreground">{measures[config.measure].description}</p>
            {config.measure !== "count" && <Choice label="Compare with" value={config.comparison} options={[{ value: "", label: "None" }, ...measureOptions.filter(({ value }) => value !== "count" && value !== config.measure)]} onChange={(comparison) => update({ comparison })} />}
            <div className="grid grid-cols-2 gap-2">
              <Choice label="Group by" value={config.group} options={groupOptions} onChange={(group) => update({ group, split: group === config.split ? "none" : config.split, display: config.display === "line" && !isTimeDimension(group) ? "auto" : config.display })} />
              <Choice label="Split by" value={config.split} options={groupOptions.filter(({ value }) => value === "none" || value !== config.group)} onChange={(split) => update({ split })} />
            </div>
            <Choice<Display> label="Display" value={config.display} onChange={(display) => update({ display })} options={[
              { value: "auto", label: "Suggested" }, { value: "bar", label: "Bar chart" },
              ...(isTimeDimension(config.group) ? [{ value: "line" as const, label: "Line chart" }] : []), { value: "table", label: "Table" },
            ]} />
          </div>

          <div className="space-y-3 border-t pt-4">
            <Choice<Period> label="Date range" value={config.period} options={dateOptions} onChange={(period) => update({ period })} />
            {config.period === "rolling" && <Field label="Number of months"><Input type="number" min={1} max={1200} value={config.months} onChange={(event) => update({ months: event.target.value })} /></Field>}
            {config.period === "custom" && <>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="From"><Input type="date" value={config.from} onChange={(event) => update({ from: event.target.value })} /></Field>
                <Field label="Through"><Input type="date" value={config.to} onChange={(event) => update({ to: event.target.value })} /></Field>
              </div>
              <p className="text-sm text-muted-foreground">Leave either date blank for an open-ended range.</p>
            </>}
            <MultiFilter label="Categories" values={config.categories} options={scoped ? categories.map(({ id, name }) => ({ value: id, label: name })) : []} onChange={(categories) => update({ categories })} />
            <MultiFilter label="Accounts" values={config.accounts} options={scoped ? accounts.map(({ id, name }) => ({ value: id, label: name })) : []} onChange={(accounts) => update({ accounts })} />
            <MultiFilter label="Transaction types" values={config.types} options={typeOptions} onChange={(types) => update({ types })} />
            <MultiFilter label="Counterparties" values={config.counterparties} options={counterparties} onChange={(counterparties) => update({ counterparties })} />
            {(currencies.length > 1 || config.currency) && <Choice label="Currency" value={config.currency ?? ""}
              options={[{ value: "", label: config.measure === "count" ? "All currencies" : "Automatic" }, ...[...new Set([...currencies, ...(config.currency ? [config.currency] : [])])].map((value) => ({ value, label: value }))]}
              onChange={(currency) => update({ currency })} />}
            <Field label="Search"><Input type="search" value={config.search} onChange={(event) => update({ search: event.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Min. amount"><Input type="number" min={0} step="any" value={config.min} onChange={(event) => update({ min: event.target.value })} /></Field>
              <Field label="Max. amount"><Input type="number" min={0} step="any" value={config.max} onChange={(event) => update({ max: event.target.value })} /></Field>
            </div>
          </div>
        </CardContent>
      </Card>

      {validation ? <p role="alert" className="rounded-lg border bg-card p-5 text-sm text-destructive">{validation}</p> :
        error ? <div role="alert" className="space-y-2 rounded-lg border bg-card p-5 text-sm"><p>{error}</p><Button variant="outline" onClick={() => void refetch()}>Try again</Button></div> :
        needsCurrency ? <p role="status" className="rounded-lg border bg-card p-5 text-sm">Choose a currency to calculate amounts. The matching transactions use {currencies.join(", ")}.</p> :
        chart ? <CustomChartPreview key={JSON.stringify([config.group, config.split])} config={config} chart={chart} currency={chartCurrency} dateLabel={dateLabel}
          onInspect={(label, transactions) => setInspection({ label, transactions })} /> :
        <p role="status" className="rounded-lg border bg-card p-5 text-sm text-muted-foreground">Loading transactions…</p>}
    </div>
    {inspection && <ChartTransactions inspection={inspection} onClose={() => setInspection(null)} />}
  </div>;
}

function ChartsContent() {
  const { user, isLoaded } = useUser();
  const { selectedGroupId, groups, loading, dataScope } = useBudget();
  const params = useSearchParams();
  if (!isLoaded || !user) return <p role="status" className="text-sm text-muted-foreground">Loading charts…</p>;
  const scope = selectedGroupId ?? "personal";
  if (selectedGroupId && !groups.some((group) => group.id === selectedGroupId) && loading && dataScope !== selectedGroupId) {
    return <p role="status" className="text-sm text-muted-foreground">Loading charts…</p>;
  }
  const storageKey = `bajeti:charts:v1:${user.id}:${scope}`;
  const sourceScope = params.get("groupId") ?? "personal";
  const initial = sourceScope === scope ? chartFromTransactionFilters(new URLSearchParams(params.toString())) : defaultChart;
  return <ChartBuilder key={`${storageKey}:${params}`} initial={initial} storageKey={storageKey} />;
}

export default function ChartsPage() {
  return <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading charts…</p>}><ChartsContent /></Suspense>;
}
