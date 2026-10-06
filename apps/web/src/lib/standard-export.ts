import "server-only";
import { eq } from "drizzle-orm";
import { companies, getDatabase } from "@finance/database";
import { standardLayoutVersion, standardLines, type JournalStatementSelection } from "@balsa/finance-engine";
import { buildStandardWorkbook, type StandardWorkbookInput } from "@balsa/model-export";
import { loadForecastBase } from "@/lib/forecast-base";
import { forecastAsOfMonth } from "@/lib/forecast-inputs";
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

  const categoryName = new Map(mapping.categories.map((category) => [category.id, category.name]));
  const lineLabel = new Map<string, string>(standardLines.map((line) => [line.id, line.label]));
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
  };
  const bytes = await buildStandardWorkbook(input);
  const safeName = company.name.replace(/[^A-Za-z0-9 _-]+/g, "").trim() || "Company";
  return { bytes, filename: `${safeName} - Standard model - ${now.toISOString().slice(0, 10)}.xlsx`, summary: { months: base.length, plan: Boolean(plan), scenarios: scenarios.length } };
}
