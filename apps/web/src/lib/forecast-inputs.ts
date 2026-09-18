import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { chartAccounts, companies, economicItems, forecastEntryTemplates, getDatabase, journalPeriodClosures } from "@finance/database";
import { summarizeActualCash, type ForecastRunInput } from "@nevermodel/finance-engine";
import type { DbExecutor } from "@/lib/db-executor";
import { chartAccountToForecastAccount, economicItemToDriver, forecastAsOfFromClosure, templateRowToTemplate } from "@/lib/forecast-drivers";
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
  const [{ drivers, templates }, actualLines, accounts] = await Promise.all([
    loadForecastDrivers(companyId, {}, db),
    loadPostedJournalLines(companyId, asOfMonth, db),
    loadForecastAccounts(companyId, db),
  ]);
  return { actuals: summarizeActualCash(actualLines, company.baseCurrency, asOfMonth), drivers: drivers.sort((left, right) => compareIds(left.id, right.id)), templates: templates.sort((left, right) => compareIds(left.id, right.id)), accounts, currency: company.baseCurrency, asOfMonth, horizonMonths: forecastHorizonMonths, minimumCashMinor: company.minimumCashMinor };
}
