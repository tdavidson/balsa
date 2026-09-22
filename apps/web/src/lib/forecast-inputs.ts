import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { chartAccounts, companies, economicItems, forecastDimensions, forecastEntryTemplates, forecastVariables, getDatabase, journalPeriodClosures } from "@finance/database";
import { addMonths, buildForecastedCloses, isValidMonth, monthRange, resolveFormulaDrivers, summarizeActualCash, type ForecastDriver, type ForecastModel, type ForecastRunInput } from "@nevermodel/finance-engine";
import type { DbExecutor } from "@/lib/db-executor";
import { chartAccountToForecastAccount, economicItemToDriver, forecastAsOfFromClosure, templateRowToTemplate } from "@/lib/forecast-drivers";
import { rowsToModel } from "@/lib/forecast-model-rows";
import { loadPostedJournalLines } from "@/lib/journal-ledger";

export const forecastHorizonMonths = 24;

/** Confirmed items and active templates: the only inputs a projection may use. */
export async function loadForecastDrivers(companyId: string, options: { scenarioId?: string } = {}, db: DbExecutor = getDatabase()) {
  const [items, templates] = await Promise.all([
    db.select().from(economicItems).where(and(eq(economicItems.companyId, companyId), eq(economicItems.status, "confirmed"))),
    db.select().from(forecastEntryTemplates).where(and(eq(forecastEntryTemplates.companyId, companyId), eq(forecastEntryTemplates.active, "Y"))),
  ]);
  return {
    drivers: items.filter((item) => (options.scenarioId ? item.scenarioId === options.scenarioId : !item.scenarioId)).map(economicItemToDriver),
    templates: templates.map(templateRowToTemplate),
  };
}

/** max(latest closed period, last full calendar month). */
export async function forecastAsOfMonth(companyId: string, now: Date, db: DbExecutor = getDatabase()) {
  const [closure] = await db.select({ period: journalPeriodClosures.period }).from(journalPeriodClosures).where(eq(journalPeriodClosures.companyId, companyId)).orderBy(desc(journalPeriodClosures.period)).limit(1);
  return forecastAsOfFromClosure(closure?.period ?? null, now);
}

export const compareIds = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

/** The company's active chart accounts as forecast accounts, in id order. */
export async function loadForecastAccounts(companyId: string, db: DbExecutor = getDatabase()) {
  const rows = await db.select().from(chartAccounts).where(and(eq(chartAccounts.companyId, companyId), eq(chartAccounts.active, "Y")));
  return rows.map(chartAccountToForecastAccount).sort((left, right) => compareIds(left.accountId, right.accountId));
}

/** The company's active forecast model in canonical order, or undefined when it has none. */
export async function loadForecastModel(companyId: string, db: DbExecutor = getDatabase()): Promise<ForecastModel | undefined> {
  const [dimensions, variables] = await Promise.all([
    db.select({ name: forecastDimensions.name, items: forecastDimensions.items }).from(forecastDimensions).where(and(eq(forecastDimensions.companyId, companyId), eq(forecastDimensions.active, "Y"))),
    db.select({ name: forecastVariables.name, kind: forecastVariables.kind, dims: forecastVariables.dims, formula: forecastVariables.formula, inputs: forecastVariables.inputs }).from(forecastVariables).where(and(eq(forecastVariables.companyId, companyId), eq(forecastVariables.active, "Y"))),
  ]);
  return rowsToModel(dimensions, variables);
}

/** Resolve formula drivers for a projection window, including one base month for prev(). */
export function resolveDriversForWindow(drivers: ForecastDriver[], model: ForecastModel | undefined, window: { start: string; end: string }) {
  if (!isValidMonth(window.start) || !isValidMonth(window.end) || window.start > window.end) return { drivers, exceptions: [] as { driverId: string; reason: string }[] };
  const resolution = resolveFormulaDrivers(drivers, model, monthRange(addMonths(window.start, -1), window.end));
  const failed = new Set(resolution.exceptions.map((exception) => exception.driverId));
  return { drivers: resolution.drivers.filter((driver) => !failed.has(driver.id)), exceptions: resolution.exceptions };
}

/**
 * The compact, canonical forecast input: an actuals summary rather than raw
 * lines, with drivers, templates, and accounts in id order so the stored input
 * hash does not depend on the order Postgres returns rows in.
 */
export async function loadForecastInputs(companyId: string, options: { now?: Date; db?: DbExecutor } = {}): Promise<ForecastRunInput> {
  const db = options.db ?? getDatabase();
  const now = options.now ?? new Date();
  const [company] = await db.select({ baseCurrency: companies.baseCurrency, minimumCashMinor: companies.minimumCashMinor }).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) throw new Error("Company not found while loading forecast inputs");
  const asOfMonth = await forecastAsOfMonth(companyId, now, db);
  const currentMonth = now.toISOString().slice(0, 7);
  const openMonth = addMonths(asOfMonth, 1) === currentMonth ? currentMonth : null;
  const [{ drivers, templates }, actualLines, accounts, model] = await Promise.all([
    loadForecastDrivers(companyId, {}, db),
    loadPostedJournalLines(companyId, openMonth ?? asOfMonth, db),
    loadForecastAccounts(companyId, db),
    loadForecastModel(companyId, db),
  ]);
  const baseCurrencyLines = actualLines.filter((line) => line.currency === company.baseCurrency);
  const closes = openMonth ? buildForecastedCloses(baseCurrencyLines, openMonth) : null;
  const openActualLines = openMonth ? baseCurrencyLines.filter((line) => line.period === openMonth && ["actual", "adjustment", "elimination"].includes(line.basis ?? "actual")) : [];
  return { actuals: summarizeActualCash(actualLines, company.baseCurrency, asOfMonth), drivers: drivers.sort((left, right) => compareIds(left.id, right.id)), templates: templates.sort((left, right) => compareIds(left.id, right.id)), accounts, currency: company.baseCurrency, asOfMonth, horizonMonths: forecastHorizonMonths, minimumCashMinor: company.minimumCashMinor, ...(openMonth && closes ? { openMonth: { month: openMonth, throughDate: now.toISOString().slice(0, 10), actualLines: openActualLines, forecastedLines: closes.projectedLines, matches: closes.matches } } : {}), ...(model ? { model } : {}) };
}
