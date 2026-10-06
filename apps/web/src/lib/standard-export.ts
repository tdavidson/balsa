import "server-only";
import { eq } from "drizzle-orm";
import { companies, forecastMetrics, getDatabase, seasonalityProfiles } from "@finance/database";
import { driverAmountsByMonth, matchingForecastTemplates, monthRange, resolvePatternDrivers, standardLayoutVersion, standardLines, type ForecastDriver, type JournalStatementSelection, type StandardLineId } from "@balsa/finance-engine";
import { buildStandardWorkbook, driverExportPattern, metricExportPattern, type ExportDriver, type ExportLeg, type ExportMetric, type StandardWorkbookInput } from "@balsa/model-export";
import { loadForecastBase } from "@/lib/forecast-base";
import { forecastAsOfMonth, loadForecastAccounts, loadForecastDrivers, loadForecastModel, loadPatternContext } from "@/lib/forecast-inputs";
import { loadLatestForecast } from "@/lib/forecast-read";
import { loadScenarioDriversWith } from "@/lib/forecast-scenarios";
import { loadPostedJournalLines } from "@/lib/journal-ledger";
import { resolveModelTimeline } from "@/lib/model-timeline";
import { runSimulation } from "@/lib/scenario-changes";
import { listScenarios, loadActiveScenario } from "@/lib/scenarios";
import { loadStandardMapping, standardColumns } from "@/lib/standard-statements";

const statusLabel: Record<string, string> = { confirmed: "confirmed", suggested: "suggested", fallback: "needs a line", unclassified: "needs a section" };

/**
 * Everything the Standard workbook shows, computed the way Balsa computes it
 * on screen: the base outlook, the pinned plan, and every active scenario,
 * each a selection of the same posted lines plus that view's projections.
 */
export async function buildStandardModelExport(companyId: string, now = new Date()) {
  const db = getDatabase();
  const [company] = await db.select({ name: companies.name, baseCurrency: companies.baseCurrency, minimumCashMinor: companies.minimumCashMinor, modelFirstPeriod: companies.modelFirstPeriod, modelLastPeriod: companies.modelLastPeriod, fiscalYearEnd: companies.fiscalYearEnd }).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) throw new Error("Company not found");
  const forecast = await loadLatestForecast(companyId, now);
  const timeline = resolveModelTimeline(company, await forecastAsOfMonth(companyId, now));
  const asOfPeriod = forecast?.run.asOfMonth ?? timeline.lastPeriod;
  const range = { start: timeline.firstPeriod, end: timeline.lastPeriod };
  const lineLabel = new Map<string, string>(standardLines.map((line) => [line.id, line.label]));
  const [mapping, posted] = await Promise.all([loadStandardMapping(companyId), loadPostedJournalLines(companyId, range.end)]);
  const columns = (lines: typeof posted, selection: JournalStatementSelection, view: "projected" | "scenario", asOf: string) => standardColumns({ lines, selection, mapping, ...range, currency: company.baseCurrency, view, asOfPeriod: asOf });

  const base = columns([...posted, ...(forecast?.run.projectedLines ?? [])], { view: "projected", asOfPeriod }, "projected", asOfPeriod);
  const plan = posted.some((line) => line.basis === "plan") ? columns(posted, { basis: "plan" }, "projected", asOfPeriod) : null;

  // Scenarios are computed on demand, never stored: the base input plus each scenario's items and changes.
  const summaries = await listScenarios(companyId);
  const forecastBase = summaries.length ? await loadForecastBase(companyId, now) : null;
  const scenarios: StandardWorkbookInput["scenarios"] = [];
  const scenarioRuns: { id: string; drivers: ForecastDriver[]; exceptions: { driverId: string; reason: string }[] }[] = [];
  for (const summary of summaries) {
    const [detail, { drivers }] = await Promise.all([loadActiveScenario(companyId, summary.id), loadScenarioDriversWith(db, companyId, summary.id)]);
    const { run } = runSimulation(forecastBase!, detail.changes, { scenarioId: summary.id, scenarioDrivers: drivers });
    scenarioRuns.push({ id: summary.id, drivers: run.drivers, exceptions: run.exceptions });
    scenarios.push({ id: summary.id, name: summary.name, description: summary.description, months: columns([...posted, ...run.projectedLines], { view: "scenario", scenarioId: summary.id, asOfPeriod: run.asOfMonth }, "scenario", run.asOfMonth), runway: { runwayMonths: run.runway.runwayMonths, cashOutMonth: run.runway.cashOutMonth } });
  }

  // Drivers in the Standard model's columns, as live formulas where the workbook can reproduce Balsa's amounts; operating metrics alongside.
  const [{ templates }, forecastAccounts, model, patternContext, metricRows, profiles] = await Promise.all([loadForecastDrivers(companyId), loadForecastAccounts(companyId), loadForecastModel(companyId), loadPatternContext(companyId), db.select().from(forecastMetrics).where(eq(forecastMetrics.companyId, companyId)), db.select({ id: seasonalityProfiles.id, name: seasonalityProfiles.name, deviations: seasonalityProfiles.deviations }).from(seasonalityProfiles).where(eq(seasonalityProfiles.companyId, companyId))]);
  const periods = base.map((month) => month.period);
  const forecastAccountById = new Map(forecastAccounts.map((account) => [account.accountId, account]));
  const runDrivers = forecast?.run.drivers ?? [];
  const exceptionById = new Map((forecast?.run.exceptions ?? []).map((exception) => [exception.driverId, exception.reason]));
  const profileName = (id: string) => profiles.find((profile) => profile.id === id)?.name ?? null;
  const leg = (accountId: string | undefined): ExportLeg | null => { const resolved = accountId ? mapping.resolved.get(accountId) : undefined; return resolved?.line ? { line: resolved.line as StandardLineId, categoryId: resolved.categoryId } : null; };
  const toExport = (driver: ForecastDriver, scenarioId: string | null, exceptions: Map<string, string>): ExportDriver => {
    const template = matchingForecastTemplates(driver, templates);
    const single = template.length === 1 ? template[0]! : null;
    const postingId = single ? (driver.direction === "receipt" ? single.creditAccountId : single.debitAccountId) : undefined;
    const settlementId = single ? (driver.direction === "receipt" ? single.debitAccountId : single.creditAccountId) : undefined;
    const referenceLine = postingId ? forecastAccountById.get(postingId)?.reportLine ?? null : null;
    const pattern = driverExportPattern(driver, profileName);
    const note = !pattern && !driver.amountFormula ? "Dated amounts in Balsa" : null;
    const formula = driver.amountFormula !== undefined ? { text: driver.amountFormula, startsIn: driver.effectiveFrom, endsIn: driver.effectiveTo ?? null, repeatsEvery: { once: 0, monthly: 1, quarterly: 3, annual: 12 }[driver.cadence] } : null;
    return { id: driver.id, label: driver.label, direction: driver.direction, lineLabel: referenceLine ? lineLabel.get(referenceLine) ?? null : null, referenceLine, scenarioId, excludedIn: [], pattern, note, formula, posting: leg(postingId), settlement: leg(settlementId), amountsByPeriod: driverAmountsByMonth(driver, periods), exception: exceptions.get(driver.id) ?? null };
  };
  const drivers: ExportDriver[] = runDrivers.map((driver) => toExport(driver, null, exceptionById));
  // A scenario's own row for every driver it adds, or whose pattern or amounts it changes (including through a link); the base row steps aside while it is active.
  for (const scenarioRun of scenarioRuns) {
    const exceptions = new Map(scenarioRun.exceptions.map((exception) => [exception.driverId, exception.reason]));
    for (const driver of scenarioRun.drivers) {
      const original = drivers.find((candidate) => candidate.id === driver.id && candidate.scenarioId === null);
      const own = toExport(driver, scenarioRun.id, exceptions);
      if (original && JSON.stringify(original.pattern) === JSON.stringify(own.pattern) && JSON.stringify(original.amountsByPeriod) === JSON.stringify(own.amountsByPeriod) && original.exception === own.exception) continue;
      original?.excludedIn.push(scenarioRun.id); drivers.push(own);
    }
    for (const original of drivers) if (original.scenarioId === null && !scenarioRun.drivers.some((driver) => driver.id === original.id)) original.excludedIn.push(scenarioRun.id);
  }
  const metricValues = resolvePatternDrivers(runDrivers, { months: periods, templates, ...(model ? { model } : {}), ...(patternContext ? { context: patternContext } : {}), allMetrics: true });
  const metrics: ExportMetric[] = metricRows.map((metric) => {
    const resolved = patternContext?.metrics?.find((item) => item.name === metric.name);
    return { name: metric.name, label: metric.label, unit: metric.unit, pattern: resolved ? metricExportPattern(resolved, profileName) : null, actuals: resolved?.actuals ?? {}, valuesByPeriod: metricValues.metrics[metric.name] ?? {} };
  });
  // A driver that uses a model variable sees it as a row of Balsa's values.
  for (const name of new Set(runDrivers.flatMap((driver) => driver.pattern?.change && "ref" in driver.pattern.change && driver.pattern.change.ref.kind === "metric" ? [driver.pattern.change.ref.name] : []))) {
    if (!metrics.some((metric) => metric.name === name) && metricValues.metrics[name]) metrics.push({ name, label: `${name} (model variable)`, unit: null, pattern: null, variable: true, note: "A forecast model variable, totalled from the Model sheet", actuals: {}, valuesByPeriod: metricValues.metrics[name]! });
  }
  const forecastPeriods = (forecast?.run.months ?? []).filter((month) => month.basis === "forecast" && periods.includes(month.month)).map((month) => month.month);
  const escalation = patternContext?.escalation ? { rate: Number(patternContext.escalation.rate), everyMonths: patternContext.escalation.everyMonths, anchorMonth: patternContext.escalation.anchor === "driver_start" ? null : patternContext.escalation.anchor.calendarMonth } : null;

  const categoryName = new Map(mapping.categories.map((category) => [category.id, category.name]));
  const input: StandardWorkbookInput = {
    company: { id: companyId, name: company.name, currency: company.baseCurrency },
    generatedAt: now.toISOString(),
    versions: { layout: standardLayoutVersion, forecast: forecast?.run.formulaVersion ?? null },
    timeline: { firstPeriod: range.start, lastPeriod: range.end, asOfPeriod, fiscalYearEndMonth: timeline.fiscalYearEndMonth, isDefault: timeline.isDefault },
    minimumCashMinor: company.minimumCashMinor,
    base,
    baseRunway: forecast ? { runwayMonths: forecast.run.runway.runwayMonths, cashOutMonth: forecast.run.runway.cashOutMonth } : null,
    plan,
    scenarios,
    accounts: mapping.rows.map((row) => {
      const resolved = mapping.resolved.get(row.id)!;
      return { id: row.id, code: row.code, name: row.name, section: mapping.accounts.find((account) => account.accountId === row.id)?.accountType ?? null, lineLabel: resolved.line ? lineLabel.get(resolved.line) ?? resolved.line : null, categoryName: resolved.categoryId ? categoryName.get(resolved.categoryId) ?? null : null, status: statusLabel[resolved.status] ?? resolved.status, reason: resolved.reason };
    }),
    mapping: mapping.summary,
    model: model && forecast ? { definition: model, months: monthRange(forecast.run.asOfMonth, forecast.run.horizon.end) } : null,
    forecast: { forecastPeriods, drivers, metrics, scenarios: scenarios.map((scenario) => ({ id: scenario.id, name: scenario.name })), seasonality: profiles.map((profile) => ({ name: profile.name, deviations: (profile.deviations as string[]).map(Number) })), escalation },
  };
  const bytes = await buildStandardWorkbook(input);
  const safeName = company.name.replace(/[^A-Za-z0-9 _-]+/g, "").trim() || "Company";
  return { bytes, filename: `${safeName} - Standard model - ${now.toISOString().slice(0, 10)}.xlsx`, summary: { months: base.length, plan: Boolean(plan), scenarios: scenarios.length } };
}
