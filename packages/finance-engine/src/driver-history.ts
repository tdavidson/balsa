import type { DriverPattern } from "./driver-patterns";

/**
 * Deterministic reading of a line's actual history, and the Standard-model
 * pattern it suggests. The agent cites these numbers; it never computes them.
 * A suggestion is a proposal for a person to approve, never an applied change.
 */
export const driverHistoryVersion = "driver-history-2026-10-06.1";

export type HistoryPoint = { month: string; value: number };
export type HistoryStats = {
  months: number;
  mean: number; last: number; min: number; max: number;
  /** Coefficient of variation of the values; 0 is perfectly steady. */
  variation: number | null;
  /** Compound monthly growth from a log-linear fit, and how well it fits (R²). */
  monthlyGrowth: number | null; growthFit: number | null;
  /** Share of revenue each month: mean, spread and range; null when revenue is missing in any month. */
  revenueShare: { mean: number; variation: number; min: number; max: number } | null;
  /** How much revenue itself moved over the same months; a share of flat revenue says nothing. */
  revenueVariation: number | null;
};
export type PatternSuggestion = { pattern: DriverPattern; basis: "share_of_revenue" | "growth" | "average" | "last"; rationale: string; confidence: "high" | "medium" | "low" };

const round = (value: number, places: number) => Number(value.toFixed(places));
const decimal = (value: number, places = 6) => { const text = round(value, places).toFixed(places).replace(/0+$/, "").replace(/\.$/, ""); return text === "-0" ? "0" : text; };
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const variation = (values: number[]) => { const average = mean(values); if (average === 0) return null; const spread = Math.sqrt(mean(values.map((value) => (value - average) ** 2))); return Math.abs(spread / average); };

export function analyzeHistory(points: HistoryPoint[], revenue?: HistoryPoint[]): HistoryStats {
  const values = points.map((point) => point.value);
  const stats: HistoryStats = { months: values.length, mean: values.length ? mean(values) : 0, last: values.at(-1) ?? 0, min: values.length ? Math.min(...values) : 0, max: values.length ? Math.max(...values) : 0, variation: values.length ? variation(values) : null, monthlyGrowth: null, growthFit: null, revenueShare: null, revenueVariation: null };
  if (values.length >= 3 && values.every((value) => value > 0)) {
    const logs = values.map(Math.log); const xs = values.map((_, index) => index);
    const xMean = mean(xs); const yMean = mean(logs);
    const slope = xs.reduce((sum, x, index) => sum + (x - xMean) * (logs[index]! - yMean), 0) / xs.reduce((sum, x) => sum + (x - xMean) ** 2, 0);
    const fitted = xs.map((x) => yMean + slope * (x - xMean));
    const total = logs.reduce((sum, y) => sum + (y - yMean) ** 2, 0);
    const residual = logs.reduce((sum, y, index) => sum + (y - fitted[index]!) ** 2, 0);
    stats.monthlyGrowth = Math.exp(slope) - 1; stats.growthFit = total === 0 ? 1 : 1 - residual / total;
  }
  if (revenue && points.length) {
    const byMonth = new Map(revenue.map((point) => [point.month, point.value]));
    const shares = points.map((point) => { const total = byMonth.get(point.month); return total && total > 0 ? point.value / total : null; });
    if (shares.every((share) => share !== null)) { const values = shares as number[]; stats.revenueShare = { mean: mean(values), variation: variation(values) ?? 0, min: Math.min(...values), max: Math.max(...values) }; stats.revenueVariation = variation(points.map((point) => byMonth.get(point.month)!)); }
  }
  return stats;
}

const percent = (value: number) => `${round(value * 100, 1)}%`;
const amount = (value: number, money: boolean) => money ? `$${round(value, 2).toLocaleString("en-US")}` : round(value, 2).toLocaleString("en-US");

/**
 * The pattern a history suggests, in order of preference: a steady share of
 * revenue (for anything but revenue itself), a steady compound growth, then
 * the recent average. `money` formats amounts and rounds to cents.
 * `startOffset` is how many months after the last actual the pattern's first
 * month falls: 1 for a driver starting next month (the default), 0 for a
 * metric that continues from its last actual, negative for a driver that
 * started earlier. A growth pattern's initial value is projected to that month
 * so the forecast continues the trend instead of repeating the last actual.
 */
export function suggestPattern(stats: HistoryStats, options: { label: string; money: boolean; isRevenue?: boolean; revenueRef?: { kind: "report_line"; line: string }; startOffset?: number }): PatternSuggestion | null {
  if (stats.months === 0 || stats.max <= 0) return null;
  const span = `the last ${stats.months} month${stats.months === 1 ? "" : "s"}`;
  if (stats.months < 3) return { pattern: { initialValue: decimal(stats.last, options.money ? 2 : 6), repeatsEveryMonths: 1 }, basis: "last", rationale: `${options.label} has only ${stats.months} month${stats.months === 1 ? "" : "s"} of actuals; the suggestion repeats the latest, ${amount(stats.last, options.money)}.`, confidence: "low" };
  const share = stats.revenueShare;
  // A share of revenue is evidence only when both revenue and the line actually moved and moved together.
  const moved = (stats.revenueVariation ?? 0) >= 0.05 && (stats.variation ?? 0) >= 0.05;
  if (!options.isRevenue && options.revenueRef && share && moved && share.variation <= 0.15 && share.mean > 0) {
    return { pattern: { initialValue: decimal(share.mean, 4), repeatsEveryMonths: 1, change: { basis: "pct_of", ref: options.revenueRef } }, basis: "share_of_revenue", rationale: `${options.label} has run at ${percent(share.mean)} of revenue over ${span}, between ${percent(share.min)} and ${percent(share.max)}.`, confidence: share.variation <= 0.08 ? "high" : "medium" };
  }
  if (stats.monthlyGrowth !== null && stats.growthFit !== null && stats.growthFit >= 0.8 && Math.abs(stats.monthlyGrowth) >= 0.005) {
    const by = decimal(stats.monthlyGrowth, 4);
    const start = stats.last * (1 + Number(by)) ** (options.startOffset ?? 1);
    return { pattern: { initialValue: decimal(start, options.money ? 2 : 6), repeatsEveryMonths: 1, change: { basis: "pct_change", everyMonths: 1, by } }, basis: "growth", rationale: `${options.label} has ${stats.monthlyGrowth > 0 ? "grown" : "fallen"} about ${percent(Math.abs(stats.monthlyGrowth))} a month over ${span} (fit R² ${round(stats.growthFit, 2)}), to ${amount(stats.last, options.money)}.`, confidence: stats.growthFit >= 0.95 ? "high" : "medium" };
  }
  const recent = stats.mean;
  return { pattern: { initialValue: decimal(recent, options.money ? 2 : 6), repeatsEveryMonths: 1 }, basis: "average", rationale: `${options.label} averaged ${amount(recent, options.money)} a month over ${span}, between ${amount(stats.min, options.money)} and ${amount(stats.max, options.money)}, with no steady trend or link to revenue.`, confidence: (stats.variation ?? 1) <= 0.2 ? "medium" : "low" };
}
