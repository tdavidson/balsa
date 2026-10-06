import "server-only";
import { eq } from "drizzle-orm";
import { companies, forecastMetrics, getDatabase, seasonalityProfiles } from "@finance/database";
import { describePattern, driverAmountsByMonth, matchingForecastTemplates, resolvePatternDrivers, standardLayoutVersion, standardLines, type DriverRef, type EscalationRule, type JournalStatementSelection } from "@balsa/finance-engine";
import { buildStandardWorkbook, type ExportDriver, type ExportMetric, type StandardWorkbookInput } from "@balsa/model-export";
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
  for (const summary of summaries) {
    const [detail, { drivers }] = await Promise.all([loadActiveScenario(companyId, summary.id), loadScenarioDriversWith(db, companyId, summary.id)]);
    const { run } = runSimulation(forecastBase!, detail.changes, { scenarioId: summary.id, scenarioDrivers: drivers });
    scenarios.push({ id: summary.id, name: summary.name, description: summary.description, months: columns([...posted, ...run.projectedLines], { view: "scenario", scenarioId: summary.id, asOfPeriod: run.asOfMonth }, "scenario", run.asOfMonth), runway: { runwayMonths: run.runway.runwayMonths, cashOutMonth: run.runway.cashOutMonth } });
  }

  // Drivers in the Standard model's columns, with the amounts the forecast resolved; operating metrics alongside.
  const [{ templates }, forecastAccounts, model, patternContext, metricRows, profiles] = await Promise.all([loadForecastDrivers(companyId), loadForecastAccounts(companyId), loadForecastModel(companyId), loadPatternContext(companyId), db.select().from(forecastMetrics).where(eq(forecastMetrics.companyId, companyId)), db.select({ id: seasonalityProfiles.id, name: seasonalityProfiles.name }).from(seasonalityProfiles).where(eq(seasonalityProfiles.companyId, companyId))]);
  const periods = base.map((month) => month.period);
  const forecastAccountById = new Map(forecastAccounts.map((account) => [account.accountId, account]));
  const runDrivers = forecast?.run.drivers ?? [];
  const exceptionById = new Map((forecast?.run.exceptions ?? []).map((exception) => [exception.driverId, exception.reason]));
  const percent = (decimal: string) => `${Number((Number(decimal) * 100).toFixed(4))}%`;
  const refLabel = (ref: DriverRef) => ref.kind === "driver" ? runDrivers.find((driver) => driver.id === ref.driverId)?.label ?? "another driver" : ref.kind === "metric" ? metricRows.find((metric) => metric.name === ref.name)?.label ?? ref.name : `Total ${(lineLabel.get(ref.line) ?? ref.line).toLowerCase()}`;
  const escalationText = (rule: EscalationRule) => `${percent(rule.rate)} every ${rule.everyMonths} months from ${rule.anchor === "driver_start" ? "start" : `month ${rule.anchor.calendarMonth}`}`;
  const drivers: ExportDriver[] = runDrivers.map((driver) => {
    const pattern = driver.pattern; const change = pattern?.change;
    const template = matchingForecastTemplates(driver, templates);
    const account = template.length === 1 ? forecastAccountById.get(driver.direction === "receipt" ? template[0]!.creditAccountId : template[0]!.debitAccountId) : undefined;
    const step = { once: 0, monthly: 1, quarterly: 3, annual: 12 }[driver.cadence];
    const columns = pattern ? {
      initialValue: change?.basis === "pct_of" ? percent(pattern.initialValue) : pattern.initialValue, startsIn: driver.effectiveFrom, repeatsEvery: String(pattern.repeatsEveryMonths),
      changingBasedOn: change ? { pct_change: "% change", abs_change: "# change", log_change: "log change", pct_of: "% of", per_unit: "# per" }[change.basis] : "",
      changesEvery: change && "everyMonths" in change ? String(change.everyMonths) : "", changingBy: change && "by" in change ? (change.basis === "pct_change" ? percent(change.by) : change.by) : "",
      usingDriver: change && "ref" in change ? refLabel(change.ref) : "", maxMonths: pattern.maxMonths ? String(pattern.maxMonths) : "", maxValue: pattern.maxValue ?? "",
      seasonality: pattern.seasonalityProfileId ? profiles.find((profile) => profile.id === pattern.seasonalityProfileId)?.name ?? "" : "",
      escalation: pattern.escalation === "company" ? (patternContext?.escalation ? `Company: ${escalationText(patternContext.escalation)}` : "Company (not set)") : pattern.escalation ? escalationText(pattern.escalation) : "",
    } : { initialValue: driver.amountFormula ? "" : (Number(driver.amountMinor) / 100).toFixed(2), startsIn: driver.effectiveFrom, repeatsEvery: String(step), changingBasedOn: driver.amountFormula ? `formula: ${driver.amountFormula}` : "", changesEvery: "", changingBy: "", usingDriver: "", maxMonths: "", maxValue: "", seasonality: "", escalation: "" };
    return { label: driver.label, direction: driver.direction, lineLabel: account?.reportLine ? lineLabel.get(account.reportLine) ?? null : null, columns, amountsByPeriod: driverAmountsByMonth(driver, periods), exception: exceptionById.get(driver.id) ?? null };
  });
  const metricValues = resolvePatternDrivers([], { months: periods, templates, ...(model ? { model } : {}), ...(patternContext ? { context: patternContext } : {}), allMetrics: true });
  const metrics: ExportMetric[] = metricRows.map((metric) => ({ label: metric.label, unit: metric.unit, summary: patternContext?.metrics?.find((item) => item.name === metric.name) ? describePattern(patternContext.metrics.find((item) => item.name === metric.name)!.pattern) : "", valuesByPeriod: metricValues.metrics[metric.name] ?? {} }));

  const categoryName = new Map(mapping.categories.map((category) => [category.id, category.name]));
  const input: StandardWorkbookInput = {
    company: { name: company.name, currency: company.baseCurrency },
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
    drivers,
    metrics,
  };
  const bytes = await buildStandardWorkbook(input);
  const safeName = company.name.replace(/[^A-Za-z0-9 _-]+/g, "").trim() || "Company";
  return { bytes, filename: `${safeName} - Standard model - ${now.toISOString().slice(0, 10)}.xlsx`, summary: { months: base.length, plan: Boolean(plan), scenarios: scenarios.length } };
}
