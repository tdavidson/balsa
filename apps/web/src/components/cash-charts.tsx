"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Charts for the workspace column. They draw values that deterministic code
 * already calculated (or, before anything is approved, balances extraction read
 * from statements, drawn as unverified). They never compute a reported result.
 *
 * Ink is actual and approved; pencil is forecast or unconfirmed, matching the
 * design language. Every chart has a hover layer and a selectable month.
 */

const shortMonth = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const longMonth = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const monthDate = (month: string) => new Date(`${month.slice(0, 7)}-01T00:00:00Z`);

export function compactMoney(value: number) {
  const absolute = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (absolute >= 1_000_000) return `${sign}$${(absolute / 1_000_000).toFixed(absolute >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (absolute >= 1_000) return `${sign}$${(absolute / 1_000).toFixed(absolute >= 10_000 ? 0 : 1).replace(/\.0$/, "")}K`;
  return `${sign}$${Math.round(absolute)}`;
}

/** Round, evenly spaced ticks covering [min, max], always including zero. */
export function niceTicks(min: number, max: number, count = 4) {
  const low = Math.min(0, min);
  const high = Math.max(0, max);
  if (high === low) return [0, 1];
  const raw = (high - low) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= raw) ?? raw;
  const ticks: number[] = [];
  for (let tick = Math.floor(low / step) * step; tick <= high + step * 0.001; tick += step) ticks.push(Math.round(tick * 100) / 100);
  if (ticks.at(-1)! < high) ticks.push(ticks.at(-1)! + step);
  return ticks;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A column path with a 4px rounded data end and a square baseline. */
function columnPath(x: number, baseline: number, width: number, height: number) {
  const radius = Math.min(4, width / 2, Math.abs(height));
  if (height === 0) return "";
  if (height > 0) {
    const top = baseline - height;
    return `M${x},${baseline}V${top + radius}Q${x},${top} ${x + radius},${top}H${x + width - radius}Q${x + width},${top} ${x + width},${top + radius}V${baseline}Z`;
  }
  const bottom = baseline - height;
  return `M${x},${baseline}V${bottom - radius}Q${x},${bottom} ${x + radius},${bottom}H${x + width - radius}Q${x + width},${bottom} ${x + width},${bottom - radius}V${baseline}Z`;
}

function ChartFrame({ title, subtitle, legend, children }: { title: string; subtitle?: ReactNode; legend?: ReactNode; children: ReactNode }) {
  return (
    <figure className="grid gap-2">
      <figcaption className="grid gap-0.5">
        <span className="text-[13px] text-ink">{title}</span>
        {subtitle ? <span className="text-[12px] text-ink-2">{subtitle}</span> : null}
      </figcaption>
      {legend ? <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2">{legend}</div> : null}
      {children}
    </figure>
  );
}

function LegendKey({ label, kind }: { label: string; kind: "ink-line" | "pencil-line" | "outline" | "ink-fill" | "pencil-fill" }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {kind === "ink-line" ? <i className="inline-block h-[2px] w-3.5 rounded-full bg-ink" /> : kind === "pencil-line" ? <i className="inline-block h-[2px] w-3.5 rounded-full bg-pencil" /> : kind === "outline" ? <i className="inline-block size-2.5 rounded-[2px] border-[1.5px] border-ink" /> : kind === "ink-fill" ? <i className="inline-block size-2.5 rounded-[2px] bg-ink" /> : <i className="inline-block size-2.5 rounded-[2px] bg-pencil-2" />}
      {label}
    </span>
  );
}

function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x, 72), Math.max(72, width - 72));
  return <div role="presentation" className="pointer-events-none absolute -top-2 z-10 grid -translate-x-1/2 -translate-y-full gap-0.5 rounded-md border border-rule bg-background px-2.5 py-1.5 text-[12px] whitespace-nowrap text-ink shadow-sm" style={{ left }}>{children}</div>;
}

function labelStride(count: number, plotWidth: number) {
  return Math.max(1, Math.ceil(count / Math.max(1, Math.floor(plotWidth / 44))));
}

/** Label every `stride`-th tick, and the last one only when it clears the previous label. */
function showTick(index: number, count: number, stride: number) {
  if (index % stride === 0) return true;
  return index === count - 1 && index % stride >= Math.ceil(stride / 2) + (stride > 2 ? 1 : 0);
}

export type CashBalancePoint = { month: string; value: number; kind: "actual" | "forecast" | "unverified" };

/**
 * Ending cash by month: actual months in ink, forecast months in pencil
 * (joined to the last actual month), and, before approval, extracted balances
 * as an unverified pencil line. An optional scenario draws as a thin ink line.
 */
export function CashBalanceChart({ points, scenario, selectedMonth, onSelectMonth, format, subtitle }: { points: CashBalancePoint[]; scenario?: { name: string; points: { month: string; value: number }[] } | null; selectedMonth?: string; onSelectMonth?: (month: string) => void; format: (value: number) => string; subtitle?: ReactNode }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = 184;
  const margin = { top: 12, right: 12, bottom: 22, left: 48 };
  const months = [...new Set([...points.map((point) => point.month), ...(scenario?.points.map((point) => point.month) ?? [])])].sort();
  const plotWidth = Math.max(0, width - margin.left - margin.right);
  const plotHeight = height - margin.top - margin.bottom;
  const values = [...points.map((point) => point.value), ...(scenario?.points.map((point) => point.value) ?? [])];
  const ticks = niceTicks(Math.min(...values, 0), Math.max(...values, 0));
  const yMin = ticks[0]!;
  const yMax = ticks.at(-1)!;
  const x = (month: string) => margin.left + (months.length <= 1 ? plotWidth / 2 : (months.indexOf(month) / (months.length - 1)) * plotWidth);
  const y = (value: number) => margin.top + plotHeight - ((value - yMin) / (yMax - yMin || 1)) * plotHeight;
  const byMonth = new Map(points.map((point) => [point.month, point]));
  const scenarioByMonth = new Map(scenario?.points.map((point) => [point.month, point.value]) ?? []);
  const actual = points.filter((point) => point.kind === "actual");
  const lastActual = actual.at(-1);
  const forecast = [...(lastActual ? [lastActual] : []), ...points.filter((point) => point.kind === "forecast")];
  // An unverified run joins the approved month before it, so a single new month still reads as a line.
  const firstUnverified = points.findIndex((point) => point.kind === "unverified");
  const unverified = firstUnverified < 0 ? [] : [...(firstUnverified > 0 && points[firstUnverified - 1]!.kind === "actual" ? [points[firstUnverified - 1]!] : []), ...points.slice(firstUnverified).filter((point) => point.kind === "unverified")];
  const line = (series: { month: string; value: number }[]) => series.map((point, index) => `${index ? "L" : "M"}${x(point.month).toFixed(1)},${y(point.value).toFixed(1)}`).join("");
  const stride = labelStride(months.length, plotWidth);
  const kinds = new Set(points.map((point) => point.kind));
  const legend = (kinds.size + (scenario ? 1 : 0)) > 1 ? <>
    {kinds.has("actual") && <LegendKey label="Actual" kind="ink-line" />}
    {kinds.has("forecast") && <LegendKey label="Forecast" kind="pencil-line" />}
    {kinds.has("unverified") && <LegendKey label="Extracted, not yet approved" kind="pencil-line" />}
    {scenario && <LegendKey label={scenario.name} kind="outline" />}
  </> : null;
  const hoverMonth = hover === null ? null : months[hover];
  const hovered = hoverMonth ? byMonth.get(hoverMonth) : undefined;
  const last = points.at(-1);

  return (
    <ChartFrame title="Cash balance" subtitle={subtitle} legend={legend}>
      <div ref={ref} className="relative">
        {width > 0 && months.length > 0 && (
          <svg width={width} height={height} role="img" aria-label={`Ending cash by month, ${months.length} months${last ? `, latest ${format(last.value)}` : ""}.`} className="block overflow-visible">
            {ticks.map((tick) => <g key={tick}>
              <line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} className={tick === 0 ? "stroke-pencil" : "stroke-rule"} strokeWidth="1" />
              <text x={margin.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" fontSize="11" className="fill-pencil font-sans tabular-nums">{compactMoney(tick)}</text>
            </g>)}
            {months.map((month, index) => showTick(index, months.length, stride) ? <text key={month} x={x(month)} y={height - 6} textAnchor="middle" fontSize="11" className={cn("font-sans", month === selectedMonth ? "fill-ink" : "fill-pencil")}>{shortMonth.format(monthDate(month))}</text> : null)}
            {unverified.length > 1 && <path d={line(unverified)} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" className="stroke-pencil" />}
            {forecast.length > 1 && <path d={line(forecast)} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" className="stroke-pencil" />}
            {actual.length > 1 && <path d={line(actual)} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" className="stroke-ink" />}
            {scenario && scenario.points.length > 1 && <path d={line(scenario.points)} fill="none" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" className="stroke-ink" opacity={0.55} />}
            {points.filter((point) => point.kind === "unverified" || points.length === 1).map((point) => <circle key={`dot-${point.month}`} cx={x(point.month)} cy={y(point.value)} r={4} strokeWidth="2" className={cn("stroke-background", point.kind === "unverified" ? "fill-pencil" : "fill-ink")} />)}
            {last && points.length > 1 && <circle cx={x(last.month)} cy={y(last.value)} r={4} strokeWidth="2" className={cn("stroke-background", last.kind === "actual" ? "fill-ink" : "fill-pencil")} />}
            {selectedMonth && byMonth.has(selectedMonth) && <line x1={x(selectedMonth)} x2={x(selectedMonth)} y1={margin.top} y2={margin.top + plotHeight} className="stroke-pencil-2" strokeWidth="1" />}
            {hoverMonth && <line x1={x(hoverMonth)} x2={x(hoverMonth)} y1={margin.top} y2={margin.top + plotHeight} className="stroke-ink-2" strokeWidth="1" />}
            {hovered && <circle cx={x(hovered.month)} cy={y(hovered.value)} r={4.5} strokeWidth="2" className={cn("stroke-background", hovered.kind === "actual" ? "fill-ink" : "fill-pencil")} />}
            <rect
              x={margin.left - 8} y={0} width={plotWidth + 16} height={height} fill="transparent"
              className={onSelectMonth ? "cursor-pointer" : undefined}
              onPointerMove={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                const ratio = months.length <= 1 ? 0 : (event.clientX - bounds.left - 8) / plotWidth;
                setHover(Math.min(months.length - 1, Math.max(0, Math.round(ratio * (months.length - 1)))));
              }}
              onPointerLeave={() => setHover(null)}
              onClick={() => { if (hoverMonth && onSelectMonth) onSelectMonth(hoverMonth); }}
            />
          </svg>
        )}
        {hoverMonth && width > 0 && (
          <Tooltip x={x(hoverMonth)} width={width}>
            <span className="text-ink-2">{longMonth.format(monthDate(hoverMonth))}</span>
            {hovered && <span className="tabular-nums">{format(hovered.value)} <span className="text-pencil">{hovered.kind === "actual" ? "actual" : hovered.kind === "forecast" ? "forecast" : "extracted, unverified"}</span></span>}
            {scenario && scenarioByMonth.has(hoverMonth) && <span className="tabular-nums">{format(scenarioByMonth.get(hoverMonth)!)} <span className="text-pencil">{scenario.name}</span></span>}
          </Tooltip>
        )}
      </div>
    </ChartFrame>
  );
}

export type NetFlowBar = { month: string; endMonth: string; label: string; tooltipLabel: string; actual: boolean; net: number; scenarioNet: number | null };

/** Net cash flow per period; select a period to inspect it. */
export function NetCashFlowChart({ bars, scenarioName, selectedMonth, onSelect, format }: { bars: NetFlowBar[]; scenarioName?: string | null; selectedMonth?: string; onSelect: (bar: NetFlowBar) => void; format: (value: number) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = 170;
  const margin = { top: 10, right: 8, bottom: 22, left: 48 };
  const plotWidth = Math.max(0, width - margin.left - margin.right);
  const plotHeight = height - margin.top - margin.bottom;
  const ticks = niceTicks(Math.min(0, ...bars.map((bar) => Math.min(bar.net, bar.scenarioNet ?? 0))), Math.max(0, ...bars.map((bar) => Math.max(bar.net, bar.scenarioNet ?? 0))), 3);
  const yMin = ticks[0]!;
  const yMax = ticks.at(-1)!;
  const y = (value: number) => margin.top + plotHeight - ((value - yMin) / (yMax - yMin || 1)) * plotHeight;
  const zero = y(0);
  const slot = bars.length ? plotWidth / bars.length : 0;
  const overlay = Boolean(scenarioName);
  const barWidth = Math.max(2, Math.min(overlay ? 14 : 24, slot * (overlay ? 0.32 : 0.55)));
  const stride = labelStride(bars.length, plotWidth);
  const hovered = hover === null ? null : bars[hover];

  return (
    <ChartFrame
      title="Net cash flow"
      subtitle="Select a period to inspect it."
      legend={<>
        {bars.some((bar) => bar.actual) && <LegendKey label="Actual" kind="ink-fill" />}
        {bars.some((bar) => !bar.actual) && <LegendKey label="Forecast" kind="pencil-fill" />}
        {scenarioName && <LegendKey label={scenarioName} kind="outline" />}
      </>}
    >
      <div ref={ref} className="relative">
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={`Net cash flow for ${bars.length} periods. Actual periods in ink, forecast periods in pencil.${scenarioName ? ` Outlined bars: ${scenarioName}.` : ""}`} className="block overflow-visible">
            {ticks.map((tick) => <g key={tick}>
              <line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} className={tick === 0 ? "stroke-pencil" : "stroke-rule"} strokeWidth="1" />
              <text x={margin.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" fontSize="11" className="fill-pencil font-sans tabular-nums">{compactMoney(tick)}</text>
            </g>)}
            {bars.map((bar, index) => {
              const center = margin.left + index * slot + slot / 2;
              const x = overlay ? center - barWidth - 1 : center - barWidth / 2;
              const barHeight = zero - y(bar.net);
              const selected = bar.endMonth === selectedMonth;
              return (
                <g key={bar.month} className="cursor-pointer" onPointerEnter={() => setHover(index)} onPointerLeave={() => setHover(null)} onClick={() => onSelect(bar)}>
                  <rect x={margin.left + index * slot} y={margin.top} width={slot} height={plotHeight} fill="transparent" />
                  {selected && <rect x={margin.left + index * slot + 1} y={margin.top} width={Math.max(0, slot - 2)} height={plotHeight} className="fill-rule" opacity={0.5} />}
                  <path d={columnPath(x, zero, barWidth, barHeight === 0 ? (bar.net < 0 ? -1 : 1) : barHeight)} className={cn(bar.net < 0 ? "fill-red-ink" : bar.actual ? "fill-ink" : "fill-pencil-2")} opacity={bar.net < 0 && !bar.actual ? 0.45 : 1} />
                  {bar.scenarioNet !== null && <path d={columnPath(center + 1, zero, barWidth, (zero - y(bar.scenarioNet)) || 1)} fill="none" strokeWidth="1.5" className={bar.scenarioNet < 0 ? "stroke-red-ink" : "stroke-ink"} />}
                  {showTick(index, bars.length, stride) ? <text x={center} y={height - 6} textAnchor="middle" fontSize="11" className={cn("font-sans", selected ? "fill-ink" : "fill-pencil")}>{bar.label}</text> : null}
                </g>
              );
            })}
          </svg>
        )}
        {hovered && width > 0 && (
          <Tooltip x={margin.left + hover! * slot + slot / 2} width={width}>
            <span className="text-ink-2">{hovered.tooltipLabel}</span>
            <span className="tabular-nums">{format(hovered.net)} <span className="text-pencil">{hovered.actual ? "actual" : "forecast"}</span></span>
            {scenarioName && hovered.scenarioNet !== null && <span className="tabular-nums">{format(hovered.scenarioNet)} <span className="text-pencil">{scenarioName}</span></span>}
          </Tooltip>
        )}
      </div>
    </ChartFrame>
  );
}

export type RevenueExpenseRow = { month: string; label: string; tooltipLabel: string; revenue: number; expenses: number };

/** Revenue and expenses per period, side by side on one axis. */
export function RevenueExpenseChart({ rows, format }: { rows: RevenueExpenseRow[]; format: (value: number) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = 160;
  const margin = { top: 10, right: 8, bottom: 22, left: 48 };
  const plotWidth = Math.max(0, width - margin.left - margin.right);
  const plotHeight = height - margin.top - margin.bottom;
  const ticks = niceTicks(0, Math.max(0, ...rows.map((row) => Math.max(row.revenue, row.expenses))), 3);
  const yMax = ticks.at(-1)!;
  const y = (value: number) => margin.top + plotHeight - (Math.max(0, value) / (yMax || 1)) * plotHeight;
  const baseline = y(0);
  const slot = rows.length ? plotWidth / rows.length : 0;
  const barWidth = Math.max(2, Math.min(14, slot * 0.32));
  const stride = labelStride(rows.length, plotWidth);
  const hovered = hover === null ? null : rows[hover];

  return (
    <ChartFrame title="Revenue and expenses" legend={<><LegendKey label="Revenue" kind="ink-fill" /><LegendKey label="Expenses" kind="pencil-fill" /></>}>
      <div ref={ref} className="relative">
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={`Revenue and expenses for ${rows.length} periods.`} className="block overflow-visible">
            {ticks.map((tick) => <g key={tick}>
              <line x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} className={tick === 0 ? "stroke-pencil" : "stroke-rule"} strokeWidth="1" />
              <text x={margin.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" fontSize="11" className="fill-pencil font-sans tabular-nums">{compactMoney(tick)}</text>
            </g>)}
            {rows.map((row, index) => {
              const center = margin.left + index * slot + slot / 2;
              return (
                <g key={row.month} onPointerEnter={() => setHover(index)} onPointerLeave={() => setHover(null)}>
                  <rect x={margin.left + index * slot} y={margin.top} width={slot} height={plotHeight} fill="transparent" />
                  {row.revenue > 0 && <path d={columnPath(center - barWidth - 1, baseline, barWidth, baseline - y(row.revenue))} className="fill-ink" />}
                  {row.expenses > 0 && <path d={columnPath(center + 1, baseline, barWidth, baseline - y(row.expenses))} className="fill-pencil-2" />}
                  {showTick(index, rows.length, stride) ? <text x={center} y={height - 6} textAnchor="middle" fontSize="11" className="fill-pencil font-sans">{row.label}</text> : null}
                </g>
              );
            })}
          </svg>
        )}
        {hovered && width > 0 && (
          <Tooltip x={margin.left + hover! * slot + slot / 2} width={width}>
            <span className="text-ink-2">{hovered.tooltipLabel}</span>
            <span className="tabular-nums">Revenue {format(hovered.revenue)}</span>
            <span className="tabular-nums">Expenses {format(hovered.expenses)}</span>
          </Tooltip>
        )}
      </div>
    </ChartFrame>
  );
}
