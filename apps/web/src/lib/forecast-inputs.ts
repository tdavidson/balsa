import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { chartAccounts, companies, economicItems, forecastEntryTemplates, getDatabase, journalPeriodClosures } from "@finance/database";
import { addMonths, type ForecastRunInput } from "@nevermodel/finance-engine";
import { chartAccountToForecastAccount, economicItemToDriver, templateRowToTemplate } from "@/lib/forecast-drivers";
import { loadPostedJournalLines } from "@/lib/journal-ledger";

export const forecastHorizonMonths = 24;

/** Confirmed items and active templates: the only inputs a projection may use. */
export async function loadForecastDrivers(companyId: string, options: { scenarioId?: string } = {}) {
  const db = getDatabase();
  const [items, templates] = await Promise.all([
    db.select().from(economicItems).where(and(eq(economicItems.companyId, companyId), eq(economicItems.status, "confirmed"))),
    db.select().from(forecastEntryTemplates).where(and(eq(forecastEntryTemplates.companyId, companyId), eq(forecastEntryTemplates.active, "Y"))),
  ]);
  return {
    drivers: items.filter((item) => (options.scenarioId ? item.scenarioId === options.scenarioId : !item.scenarioId)).map(economicItemToDriver),
    templates: templates.map(templateRowToTemplate),
  };
}

/** The latest closed period; before any close, the last full calendar month. */
export async function forecastAsOfMonth(companyId: string, now: Date) {
  const [closure] = await getDatabase().select({ period: journalPeriodClosures.period }).from(journalPeriodClosures).where(eq(journalPeriodClosures.companyId, companyId)).orderBy(desc(journalPeriodClosures.period)).limit(1);
  return closure?.period ?? addMonths(now.toISOString().slice(0, 7), -1);
}

export async function loadForecastInputs(companyId: string, now = new Date()): Promise<ForecastRunInput> {
  const db = getDatabase();
  const [company] = await db.select({ baseCurrency: companies.baseCurrency, minimumCashMinor: companies.minimumCashMinor }).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) throw new Error("Company not found while loading forecast inputs");
  const asOfMonth = await forecastAsOfMonth(companyId, now);
  const [{ drivers, templates }, actualLines, accountRows] = await Promise.all([
    loadForecastDrivers(companyId),
    loadPostedJournalLines(companyId, asOfMonth),
    db.select().from(chartAccounts).where(and(eq(chartAccounts.companyId, companyId), eq(chartAccounts.active, "Y"))),
  ]);
  return { actualLines, drivers, templates, accounts: accountRows.map(chartAccountToForecastAccount), currency: company.baseCurrency, asOfMonth, horizonMonths: forecastHorizonMonths, minimumCashMinor: company.minimumCashMinor };
}
