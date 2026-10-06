import "server-only";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { companies, economicItems, evidence, forecastMetricActuals, forecastMetrics, getDatabase } from "@finance/database";
import { addMonths, describePattern, matchingForecastTemplates, monthRange, resolvePatternDrivers, standardLines } from "@balsa/finance-engine";
import { parseStoredEscalation } from "@/lib/driver-pattern-schema";
import { economicItemToDriver } from "@/lib/forecast-drivers";
import { forecastAsOfMonth, loadForecastAccounts, loadForecastDrivers, loadForecastModel, loadPatternContext } from "@/lib/forecast-inputs";
import { loadLatestForecast } from "@/lib/forecast-read";

/**
 * Everything the driver editor and the agent see: each confirmed base driver with the line
 * it posts to, its pattern in words, its next twelve months as the forecast
 * resolved them and any exception; operating metrics with their values; the
 * seasonality profiles and the default escalation.
 */
export async function loadDriverOverview(companyId: string) {
  const db = getDatabase();
  const [items, { templates }, accounts, model, patternContext, forecast, metricRows, [company]] = await Promise.all([
    db.select().from(economicItems).where(and(eq(economicItems.companyId, companyId), eq(economicItems.status, "confirmed"), isNull(economicItems.scenarioId))).orderBy(asc(economicItems.label)),
    loadForecastDrivers(companyId),
    loadForecastAccounts(companyId),
    loadForecastModel(companyId),
    loadPatternContext(companyId),
    loadLatestForecast(companyId),
    db.select().from(forecastMetrics).where(eq(forecastMetrics.companyId, companyId)).orderBy(asc(forecastMetrics.label)),
    db.select({ escalation: companies.defaultEscalation }).from(companies).where(eq(companies.id, companyId)).limit(1),
  ]);
  const lastActuals = await db.select({ metricId: forecastMetricActuals.metricId, month: forecastMetricActuals.month, value: forecastMetricActuals.value, sourceName: evidence.sourceName }).from(forecastMetricActuals).leftJoin(evidence, eq(forecastMetricActuals.evidenceId, evidence.id)).where(eq(forecastMetricActuals.companyId, companyId)).orderBy(desc(forecastMetricActuals.month));
  const asOf = forecast?.run.asOfMonth ?? await forecastAsOfMonth(companyId, new Date());
  const months = monthRange(addMonths(asOf, 1), addMonths(asOf, 12));
  const lineLabel = new Map<string, string>(standardLines.map((line) => [line.id, line.label]));
  const accountById = new Map(accounts.map((account) => [account.accountId, account]));
  const resolvedById = new Map((forecast?.run.drivers ?? []).map((driver) => [driver.id, driver]));
  const exceptionById = new Map((forecast?.run.exceptions ?? []).map((exception) => [exception.driverId, exception.reason]));
  // Metric values over the same months, resolved the way the forecast resolves them.
  const metricValues = resolvePatternDrivers([], { months, templates, ...(model ? { model } : {}), ...(patternContext ? { context: patternContext } : {}), allMetrics: true });
  const drivers = items.map((item) => {
    const driver = economicItemToDriver(item);
    const template = matchingForecastTemplates(driver, templates);
    const incomeAccount = template.length === 1 ? accountById.get(driver.direction === "receipt" ? template[0]!.creditAccountId : template[0]!.debitAccountId) : undefined;
    const resolved = resolvedById.get(item.id);
    const refLabel = (() => { const change = driver.pattern?.change; if (!change || (change.basis !== "pct_of" && change.basis !== "per_unit")) return undefined; const ref = change.ref; return ref.kind === "driver" ? items.find((other) => other.id === ref.driverId)?.label : ref.kind === "metric" ? metricRows.find((metric) => metric.name === ref.name)?.label ?? ref.name : `total ${(lineLabel.get(ref.line) ?? ref.line).toLowerCase()}`; })();
    return {
      id: item.id, label: item.label, direction: item.direction, category: item.category, amount: item.amount, cadence: item.cadence, effectiveFrom: item.effectiveFrom, effectiveTo: item.effectiveTo,
      amountFormula: item.amountFormula, pattern: driver.pattern ?? null, summary: driver.pattern ? describePattern(driver.pattern, refLabel, { money: true }) : null,
      line: incomeAccount?.reportLine ?? null, lineLabel: incomeAccount?.reportLine ? lineLabel.get(incomeAccount.reportLine) ?? null : null,
      next: months.map((month) => ({ month, amountMinor: resolved?.amountByMonth?.[month] ?? null })), exception: exceptionById.get(item.id) ?? null,
    };
  });
  return {
    asOfMonth: asOf, months, stale: forecast?.stale ?? true,
    drivers,
    metrics: metricRows.map((metric) => ({ ...metric, values: metricValues.metrics[metric.name] ?? null, exception: metricValues.metricExceptions[metric.name] ?? null, lastActual: lastActuals.find((row) => row.metricId === metric.id) ?? null, actualCount: lastActuals.filter((row) => row.metricId === metric.id).length })),
    seasonality: patternContext?.seasonality ?? [],
    escalation: parseStoredEscalation(company?.escalation),
    lines: standardLines.filter((line) => line.section === "revenue" || line.section === "expense").map((line) => ({ id: line.id, label: line.label, section: line.section })),
  };
}
