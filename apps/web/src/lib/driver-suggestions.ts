import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { companies, economicItems, forecastMetricActuals, forecastMetrics, getDatabase } from "@finance/database";
import { addMonths, analyzeHistory, describePattern, matchingForecastTemplates, standardLines, suggestPattern, type DriverPattern, type HistoryPoint, type HistoryStats, type PatternSuggestion } from "@balsa/finance-engine";
import { parseStoredPattern } from "@/lib/driver-pattern-schema";
import type { DecisionEffect } from "@/lib/decision-effects";
import { economicItemToDriver } from "@/lib/forecast-drivers";
import { forecastAsOfMonth, loadForecastAccounts, loadForecastDrivers } from "@/lib/forecast-inputs";
import { loadLatestForecast } from "@/lib/forecast-read";
import { loadPostedJournalLines } from "@/lib/journal-ledger";
import { loadStandardStatementMonths } from "@/lib/standard-statements";

export type DriverSuggestionTarget =
  | { kind: "driver"; id: string; label: string; lineLabel: string | null; currentPattern: DriverPattern | null }
  | { kind: "account"; accountId: string; label: string; lineLabel: string | null; direction: "receipt" | "spend"; cashAccountId: string | null }
  | { kind: "metric"; name: string; label: string; currentPattern: DriverPattern };
export type DriverSuggestion = { key: string; target: DriverSuggestionTarget; history: HistoryPoint[]; stats: HistoryStats; suggestion: PatternSuggestion | null; summary: string | null; effect: DecisionEffect | null; note: string | null };

const revenueRef = { kind: "report_line" as const, line: "revenue" };
const monthNumber = (month: string) => { const [year, number] = month.split("-").map(Number) as [number, number]; return year * 12 + number; };
/** Months from the last actual to a pattern's first month; see `suggestPattern`. */
const startOffset = (history: HistoryPoint[], firstMonth: string) => { const last = history.at(-1)?.month; return last ? monthNumber(firstMonth) - monthNumber(last) : 1; };
const same = (left: DriverPattern | null | undefined, right: DriverPattern) => JSON.stringify(left ?? null) === JSON.stringify(right);

/**
 * What the actuals say about each forecast input, deterministically: for every
 * confirmed driver, every income or expense account with activity and no
 * driver, and every operating metric with actuals, the recent history, its
 * statistics, a suggested pattern with its reasons, and the decision effect
 * that would apply it. Nothing here changes the forecast; a suggestion becomes
 * a proposed decision that a person applies.
 */
export async function loadDriverSuggestions(companyId: string, options: { months?: number; now?: Date } = {}) {
  const span = Math.min(Math.max(options.months ?? 6, 2), 24);
  const db = getDatabase();
  const now = options.now ?? new Date();
  const forecast = await loadLatestForecast(companyId, now);
  const asOf = forecast?.run.asOfMonth ?? await forecastAsOfMonth(companyId, now);
  const start = addMonths(asOf, -(span - 1));
  const [[company], items, { templates }, accounts, metricRows, actualRows, posted] = await Promise.all([
    db.select({ baseCurrency: companies.baseCurrency, fiscalYearEnd: companies.fiscalYearEnd }).from(companies).where(eq(companies.id, companyId)).limit(1),
    db.select().from(economicItems).where(and(eq(economicItems.companyId, companyId), eq(economicItems.status, "confirmed"), isNull(economicItems.scenarioId))),
    loadForecastDrivers(companyId),
    loadForecastAccounts(companyId),
    db.select().from(forecastMetrics).where(eq(forecastMetrics.companyId, companyId)),
    db.select().from(forecastMetricActuals).where(eq(forecastMetricActuals.companyId, companyId)),
    loadPostedJournalLines(companyId, asOf),
  ]);
  const actuals = await loadStandardStatementMonths({ companyId, start, end: asOf, currency: company!.baseCurrency, view: "actual", asOfPeriod: asOf, forecast: null, fiscalYearEnd: company!.fiscalYearEnd });
  const months = actuals.months.map((month) => month.period);
  const lineLabel = new Map<string, string>(standardLines.map((line) => [line.id, line.label]));
  const accountById = new Map(accounts.map((account) => [account.accountId, account]));
  const major = (minor: string) => Number(BigInt(minor)) / 100;

  // Per-account income-statement amounts by month, and total revenue.
  const byAccount = new Map<string, Map<string, number>>();
  for (const month of actuals.months) for (const row of month.statement.incomeStatement.filter((candidate) => candidate.kind === "line")) for (const entry of row.accounts) {
    const series = byAccount.get(entry.accountId) ?? new Map<string, number>(); series.set(month.period, (series.get(month.period) ?? 0) + major(entry.amountMinor)); byAccount.set(entry.accountId, series);
  }
  const revenue: HistoryPoint[] = actuals.months.map((month) => ({ month: month.period, value: major(month.statement.incomeStatement.find((row) => row.key === "line:revenue")?.amountMinor ?? "0") }));
  const historyOf = (accountId: string): HistoryPoint[] => months.map((month) => ({ month, value: byAccount.get(accountId)?.get(month) ?? 0 }));
  // Activity before the first month with any amount is not history yet.
  const trim = (points: HistoryPoint[]) => points.slice(Math.max(0, points.findIndex((point) => point.value !== 0)));

  // How each income or expense account settles: directly through a cash account (the most frequent one),
  // through receivables or payables (then the company's main cash account), or not in cash at all.
  const settlement = new Map<string, { cashAccountId: string | null; via: "cash" | "working_capital" | "none" }>();
  { const direct = new Map<string, Map<string, number>>(); const workingCapital = new Set<string>(); const entries = new Map<string, typeof posted>(); const cashActivity = new Map<string, number>();
    for (const line of posted.filter((candidate) => candidate.period >= start && (candidate.basis ?? "actual") === "actual")) { entries.set(line.entryId ?? line.id, [...(entries.get(line.entryId ?? line.id) ?? []), line]); if (line.isCash) cashActivity.set(line.accountId, (cashActivity.get(line.accountId) ?? 0) + 1); }
    for (const lines of entries.values()) {
      const cash = lines.filter((line) => line.isCash); const settling = lines.some((line) => line.workingCapitalCategory === "receivables" || line.workingCapitalCategory === "payables" || line.workingCapitalCategory === "deferred_revenue" || line.workingCapitalCategory === "prepaids");
      for (const line of lines.filter((candidate) => !candidate.isCash)) {
        for (const cashLine of cash) { const tally = direct.get(line.accountId) ?? new Map<string, number>(); tally.set(cashLine.accountId, (tally.get(cashLine.accountId) ?? 0) + 1); direct.set(line.accountId, tally); }
        if (settling) workingCapital.add(line.accountId);
      }
    }
    const mainCash = [...cashActivity.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;
    for (const accountId of byAccount.keys()) {
      const tally = direct.get(accountId);
      if (tally?.size) settlement.set(accountId, { cashAccountId: [...tally.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]![0], via: "cash" });
      else if (workingCapital.has(accountId) && mainCash) settlement.set(accountId, { cashAccountId: mainCash, via: "working_capital" });
      else settlement.set(accountId, { cashAccountId: null, via: "none" });
    } }

  const suggestions: DriverSuggestion[] = [];
  const coveredAccounts = new Map<string, string[]>();
  const drivers = items.map((item) => ({ item, driver: economicItemToDriver(item) }));
  for (const { driver } of drivers) {
    const template = matchingForecastTemplates(driver, templates);
    const accountId = template.length === 1 ? (driver.direction === "receipt" ? template[0]!.creditAccountId : template[0]!.debitAccountId) : null;
    if (accountId) coveredAccounts.set(accountId, [...(coveredAccounts.get(accountId) ?? []), driver.id]);
  }
  for (const { item, driver } of drivers) {
    const template = matchingForecastTemplates(driver, templates);
    const accountId = template.length === 1 ? (driver.direction === "receipt" ? template[0]!.creditAccountId : template[0]!.debitAccountId) : null;
    const line = accountId ? accountById.get(accountId)?.reportLine ?? null : null;
    const target: DriverSuggestionTarget = { kind: "driver", id: item.id, label: item.label, lineLabel: line ? lineLabel.get(line) ?? null : null, currentPattern: driver.pattern ?? null };
    const history = accountId ? trim(historyOf(accountId)) : [];
    const stats = analyzeHistory(history, revenue);
    if (item.amountFormula) { suggestions.push({ key: `driver:${item.id}`, target, history, stats, suggestion: null, summary: null, effect: null, note: "Uses a formula; suggestions do not replace formulas." }); continue; }
    if (!accountId) { suggestions.push({ key: `driver:${item.id}`, target, history, stats, suggestion: null, summary: null, effect: null, note: "Has no single posting template, so its account history is unknown." }); continue; }
    const shared = (coveredAccounts.get(accountId)?.length ?? 0) > 1;
    const suggestion = shared ? null : suggestPattern(stats, { label: item.label, money: true, isRevenue: line === "revenue", revenueRef, startOffset: startOffset(history, driver.effectiveFrom) });
    // A deliberate link (a % of or # per) is never replaced by a statistic; the suggestion is shown for comparison.
    const linked = driver.pattern?.change?.basis === "pct_of" || driver.pattern?.change?.basis === "per_unit";
    const fresh = suggestion && !linked && !same(driver.pattern, suggestion.pattern) ? suggestion : null;
    suggestions.push({ key: `driver:${item.id}`, target, history, stats, suggestion, summary: suggestion ? describePattern(suggestion.pattern, suggestion.pattern.change?.basis === "pct_of" ? "total revenue" : undefined, { money: true }) : null, effect: fresh ? { kind: "set_item_pattern", itemId: item.id, pattern: fresh.pattern } as DecisionEffect : null, note: shared ? "Shares its account with other drivers, so its own history cannot be separated." : linked && suggestion ? "Already linked to another line or metric; shown for comparison only." : suggestion && !fresh ? "Already uses this pattern." : null });
  }
  // Income and expense accounts with activity but no driver: candidates for new drivers, generated from actuals.
  for (const [accountId] of byAccount) {
    if (coveredAccounts.has(accountId)) continue;
    const account = accountById.get(accountId);
    const section = account ? (account.accountType === "contra" ? account.statementSection : account.accountType) : undefined;
    if (!account || (section !== "revenue" && section !== "expense")) continue;
    const history = trim(historyOf(accountId));
    if (!history.some((point) => point.value > 0)) continue;
    const direction = section === "revenue" ? "receipt" as const : "spend" as const;
    const stats = analyzeHistory(history, revenue);
    const suggestion = suggestPattern(stats, { label: account.accountName, money: true, isRevenue: account.reportLine === "revenue", revenueRef, startOffset: startOffset(history, addMonths(asOf, 1)) });
    const settles = settlement.get(accountId) ?? { cashAccountId: null, via: "none" as const };
    const cashAccountId = settles.cashAccountId;
    const amount = Math.max(0.01, Number((stats.last > 0 ? stats.last : stats.mean).toFixed(2)));
    const effect: DecisionEffect | null = suggestion && cashAccountId ? { kind: "add_item", item: { label: account.accountName, direction, amount, cadence: "monthly", effectiveFrom: addMonths(asOf, 1), category: direction === "receipt" ? "other_revenue" : "other", accountingTreatment: "cash", pattern: suggestion.pattern, accountId, cashAccountId } } as DecisionEffect : null;
    suggestions.push({ key: `account:${accountId}`, target: { kind: "account", accountId, label: `${account.accountCode} ${account.accountName}`, lineLabel: account.reportLine ? lineLabel.get(account.reportLine) ?? null : null, direction, cashAccountId }, history, stats, suggestion, summary: suggestion ? describePattern(suggestion.pattern, suggestion.pattern.change?.basis === "pct_of" ? "total revenue" : undefined, { money: true }) : null, effect, note: settles.via === "cash" ? "No driver forecasts this account yet." : settles.via === "working_capital" ? `No driver forecasts this account yet. It settles through receivables or payables, so the driver posts to ${accountById.get(cashAccountId!)?.accountName ?? "the main cash account"}, the main cash account, without the collection or payment delay.` : "Not settled in cash in the window (for example depreciation), so it is not a cash driver." });
  }
  // Operating metrics: history from their recorded actuals.
  for (const metric of metricRows) {
    const pattern = parseStoredPattern(metric.pattern)!;
    const history = actualRows.filter((row) => row.metricId === metric.id).sort((left, right) => left.month.localeCompare(right.month)).slice(-span).map((row) => ({ month: row.month, value: Number(row.value) }));
    if (!history.length) continue;
    const stats = analyzeHistory(history);
    // A metric's pattern restarts from its last actual, so its first month is that actual.
    const suggestion = suggestPattern(stats, { label: metric.label, money: false, startOffset: 0 });
    const fresh = suggestion && !same(pattern, { ...suggestion.pattern }) ? suggestion : null;
    suggestions.push({ key: `metric:${metric.name}`, target: { kind: "metric", name: metric.name, label: metric.label, currentPattern: pattern }, history, stats, suggestion, summary: suggestion ? describePattern(suggestion.pattern) : null, effect: fresh ? { kind: "set_metric", metric: { name: metric.name, label: metric.label, unit: metric.unit, effectiveFrom: metric.effectiveFrom, effectiveTo: metric.effectiveTo, pattern: fresh.pattern } } as DecisionEffect : null, note: suggestion && !fresh ? "Already uses this pattern." : null });
  }
  return { asOfMonth: asOf, months, revenue, suggestions };
}
