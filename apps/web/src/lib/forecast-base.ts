import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { calculationRuns, companies, getDatabase } from "@finance/database";
import { forecastFormulaVersion, type ForecastRunInput } from "@nevermodel/finance-engine";
import { compareIds, forecastAsOfMonth, loadForecastAccounts, loadForecastDrivers, loadForecastInputs, loadForecastModel } from "@/lib/forecast-inputs";
import { loadRecurrenceReview } from "./forecast-recurrence";
import type { DbExecutor } from "@/lib/db-executor";

/** Parse the stored input, treating a parse failure or a non-object result as not reusable. */
function parseStoredInput(inputJson: string): (Partial<ForecastRunInput> & Record<string, unknown>) | null {
  try {
    const parsed: unknown = JSON.parse(inputJson);
    return parsed && typeof parsed === "object" ? (parsed as Partial<ForecastRunInput> & Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The base forecast input for anything computed on demand: previews, scenario
 * forecasts, and the agent's simulate tool. When the latest run at the current
 * formula version is at the company's head revision and its as-of month, its
 * stored actuals summary and settings are reused, so the ledger is not
 * reloaded. Drivers, templates, and active chart accounts are always reloaded:
 * they can change without a revision bump (a new account or template), and a
 * stale account list would exclude a driver whose template uses a new account.
 * Otherwise the whole input is loaded fresh. Base drivers never include
 * scenario-tagged items.
 */
export async function loadForecastBaseWith(db: DbExecutor, companyId: string, now: Date = new Date()): Promise<ForecastRunInput> {
  const [[latestRun], [company]] = await Promise.all([
    db.select({ id: calculationRuns.id, revision: calculationRuns.financialStateRevision, inputJson: calculationRuns.inputJson })
      .from(calculationRuns)
      .where(and(eq(calculationRuns.companyId, companyId), eq(calculationRuns.engineVersion, forecastFormulaVersion)))
      .orderBy(desc(sql`${calculationRuns.financialStateRevision}::bigint`), desc(calculationRuns.createdAt))
      .limit(1),
    db.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, companyId)).limit(1),
  ]);
  if (latestRun && company && latestRun.revision === company.revision) {
    const parsed = parseStoredInput(latestRun.inputJson);
    const asOfMonth = await forecastAsOfMonth(companyId, now, db);
    if (parsed && "actuals" in parsed && parsed.asOfMonth === asOfMonth && parsed.settlement?.throughDate === now.toISOString().slice(0, 10)) {
      const [{ drivers, templates }, accounts, model] = await Promise.all([loadForecastDrivers(companyId, {}, db), loadForecastAccounts(companyId, db), loadForecastModel(companyId, db)]);
      // The model is reloaded with drivers and templates; a stored model is dropped so a deleted one cannot linger.
      const { model: _storedModel, ...stored } = parsed as ForecastRunInput;
      void _storedModel;
      const recurrence = await loadRecurrenceReview(db, companyId, { drivers, templates, accounts, currency: stored.currency }, now.toISOString().slice(0, 10), new Set(stored.settlement?.occurrences.map((item) => item.key) ?? []));
      return { ...stored, recurrence: recurrence.states, drivers: drivers.sort((left, right) => compareIds(left.id, right.id)), templates: templates.sort((left, right) => compareIds(left.id, right.id)), accounts, ...(model ? { model } : {}) };
    }
  }
  return loadForecastInputs(companyId, { now, db });
}

export function loadForecastBase(companyId: string, now: Date = new Date()): Promise<ForecastRunInput> {
  return loadForecastBaseWith(getDatabase(), companyId, now);
}
