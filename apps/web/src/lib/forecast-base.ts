import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { calculationRuns, companies, getDatabase } from "@finance/database";
import { forecastFormulaVersion, type ForecastRunInput } from "@nevermodel/finance-engine";
import { compareIds, forecastAsOfMonth, loadForecastAccounts, loadForecastDrivers, loadForecastInputs } from "@/lib/forecast-inputs";

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
export async function loadForecastBase(companyId: string, now: Date = new Date()): Promise<ForecastRunInput> {
  const db = getDatabase();
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
    if (parsed && "actuals" in parsed && parsed.asOfMonth === asOfMonth) {
      const [{ drivers, templates }, accounts] = await Promise.all([loadForecastDrivers(companyId, {}, db), loadForecastAccounts(companyId, db)]);
      return { ...(parsed as ForecastRunInput), drivers: drivers.sort((left, right) => compareIds(left.id, right.id)), templates: templates.sort((left, right) => compareIds(left.id, right.id)), accounts };
    }
  }
  return loadForecastInputs(companyId, { now, db });
}
