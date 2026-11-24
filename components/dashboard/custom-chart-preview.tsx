"use client";

import { useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Transaction } from "@/lib/budget-types";
import { buildChart, isTimeDimension, measures, type ChartConfig } from "@/lib/custom-charts";
import { formatCurrency } from "@/lib/format-currency";

const palette = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const pageSize = 20;
const monthFormat = new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric", timeZone: "UTC" });

function timeValue(key: string, group: ChartConfig["group"]) {
  if (group === "quarter") {
    const [year, quarter] = key.split("-");
    return Date.UTC(Number(year), (Number(quarter) - 1) * 3, 1);
  }
  if (group === "year") return Date.parse(`${key}-01-01T00:00:00Z`);
  if (group === "month") return Date.parse(`${key}-01T00:00:00Z`);
  return Date.parse(`${key}T00:00:00Z`);
}

export function CustomChartPreview({ config, chart, currency, dateLabel, onInspect }: {
  config: ChartConfig;
  chart: ReturnType<typeof buildChart>;
  currency: string;
  dateLabel: string;
  onInspect: (label: string, transactions: Transaction[]) => void;
}) {
  const [page, setPage] = useState(0);
  const { rows, series, totals } = chart;
  const count = config.measure === "count";
  const format = (value: number, compact = false) => count
    ? new Intl.NumberFormat().format(value)
    : formatCurrency(value, currency, { compact });
  const time = isTimeDimension(config.group);
  const display = config.display === "auto" ? (time ? "line" : "bar") : config.display;
  const Chart = display === "line" ? LineChart : BarChart;
  const canPlot = (config.group !== "none" || config.split !== "none") && display !== "table";
  const tooDense = series.length > palette.length || rows.length > (display === "line" ? 200 : 40);
  const showPlot = canPlot && !tooDense && rows.length > 0;
  const label = (value: string) => config.group === "month" ? monthFormat.format(timeValue(value, "month")) : value;
  const points = showPlot ? rows.map((row) => ({
    label: label(row.label),
    time: time ? timeValue(row.key, config.group) : 0,
    values: series.map(({ key, measure }) => row.cells.get(key)?.value ?? (measure === "average" ? null : 0)),
  })) : [];
  const proportional = time && display === "line" && points.length > 1;
  const pointLabels = new Map(points.map((point) => [point.time, point.label]));
  const seriesLabels = new Map(series.map((item) => [item.key, item.label]));
  const tableRows = rows.flatMap((row) => [...row.cells].map(([key, cell]) => ({ row, key, cell, seriesLabel: seriesLabels.get(key) })));
  const showSeries = series.length > 1 || config.split !== "none";
  const maxPage = Math.max(0, Math.ceil(tableRows.length / pageSize) - 1);
  const visiblePage = Math.min(page, maxPage);
  const visibleRows = tableRows.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize);

  return (
    <Card className="min-w-0 self-start shadow-sm">
      <CardHeader>
        <CardTitle className="break-words text-lg">{config.title.trim() || measures[config.measure].label}</CardTitle>
        <p className="text-sm text-muted-foreground">{dateLabel}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap gap-x-10 gap-y-4" aria-live="polite">
          {(config.comparison ? [config.measure, config.comparison] : [config.measure]).map((measure) => {
            const total = totals.get(measure);
            return (
              <div className="min-w-0" key={measure}>
                <p className="text-sm text-muted-foreground">{measures[measure].label}</p>
                <p className="break-words text-3xl font-semibold tabular-nums">
                  {measure === "average" && !total ? "—" : format(total?.value ?? 0)}
                </p>
                {total && (
                  <Button className="h-auto px-0 py-1" variant="link" onClick={() => onInspect(measures[measure].label, total.transactions)}>
                    View transactions ({total.transactions.length.toLocaleString()})
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {rows.length === 0 && <p className="text-sm text-muted-foreground">No transactions match this measure and these filters.</p>}
        {canPlot && tooDense && <p className="text-sm text-muted-foreground">The data table shows all groups. Narrow the filters or choose a broader grouping to plot them.</p>}
        {showPlot && (
          <div className="h-72 min-w-0" aria-label={`${measures[config.measure].label} chart`}>
            <ResponsiveContainer width="100%" height="100%">
              <Chart data={points} margin={{ left: 2, right: 8, top: 8, bottom: 0 }} onClick={(event) => {
                const row = rows[event?.activeTooltipIndex ?? -1];
                if (row) onInspect(label(row.label), [...new Set([...row.cells.values()].flatMap((cell) => cell.transactions))]);
              }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey={proportional ? "time" : "label"} type={proportional ? "number" : "category"}
                  domain={proportional ? ["dataMin", "dataMax"] : undefined} ticks={proportional ? points.map((point) => point.time) : undefined}
                  tickFormatter={(value) => proportional ? pointLabels.get(value) ?? "" : value}
                  minTickGap={24} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
                <YAxis width={75} tickFormatter={(value) => format(value, true)} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} allowDecimals={!count} />
                <Tooltip formatter={(value: number) => format(value)} labelFormatter={(value) => proportional ? pointLabels.get(value) : value} contentStyle={{ background: "var(--popover)", color: "var(--popover-foreground)", borderColor: "var(--border)", borderRadius: 8 }} />
                {series.length > 1 && <Legend />}
                {series.map((item, index) => {
                  const color = palette[index];
                  return display === "line"
                    ? <Line key={item.key} dataKey={`values[${index}]`} name={item.label} type="linear" stroke={color} strokeWidth={2} dot={points.length <= 24} isAnimationActive={false} />
                    : <Bar key={item.key} dataKey={`values[${index}]`} name={item.label} fill={color} maxBarSize={54} isAnimationActive={false} />;
                })}
              </Chart>
            </ResponsiveContainer>
          </div>
        )}

        {rows.length > 0 && (config.group !== "none" || config.split !== "none" || display === "table") && (
          <div className="min-w-0 space-y-2">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Chart values and matching transactions</caption>
                <thead className="text-left text-muted-foreground"><tr>
                  <th scope="col" className="border-b px-2 py-2 font-medium">Group</th>
                  {showSeries && <th scope="col" className="border-b px-2 py-2 font-medium">Series</th>}
                  <th scope="col" className="border-b px-2 py-2 text-right font-medium">Value</th>
                </tr></thead>
                <tbody>
                  {visibleRows.map(({ row, key, cell, seriesLabel }) => (
                    <tr key={JSON.stringify([row.key, key])} className="border-b">
                      <td className="break-words px-2 py-2">{label(row.label)}</td>
                      {showSeries && <td className="break-words px-2 py-2">{seriesLabel}</td>}
                      <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                        <button type="button" className="text-primary underline-offset-4 hover:underline" aria-label={`${label(row.label)}, ${seriesLabel}, ${format(cell.value)}. View transactions`} onClick={() => onInspect(`${label(row.label)} · ${seriesLabel}`, cell.transactions)}>
                          {format(cell.value)}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {maxPage > 0 && <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="outline" size="sm" disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)}>Previous</Button>
              <span className="text-sm text-muted-foreground">{visiblePage + 1} of {maxPage + 1}</span>
              <Button variant="outline" size="sm" disabled={visiblePage === maxPage} onClick={() => setPage(visiblePage + 1)}>Next</Button>
            </div>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
