import "server-only";
import { loadRecognitionProofs } from "./recognition-continuity";
import { and, desc, eq } from "drizzle-orm";
import { chartAccounts, companies, forecastMetricActuals, forecastMetrics, seasonalityProfiles, economicItems, forecastDimensions, forecastEntryTemplates, forecastVariables, getDatabase, journalPeriodClosures } from "@finance/database";
import { addMonths, isStandardLineId, isValidMonth, monthRange, resolveFormulaDrivers, resolveStandardMapping, summarizeActualCash, resolvePatternDrivers, type ForecastAccount, type ForecastDriver, type ForecastEntryTemplate, type ForecastModel, type ForecastRunInput, type PatternContext, type StandardLineId } from "@balsa/finance-engine";
import type { DbExecutor } from "@/lib/db-executor";
import { chartAccountToForecastAccount, economicItemToDriver, forecastAsOfFromClosure, templateRowToTemplate } from "@/lib/forecast-drivers";
import { rowsToModel } from "@/lib/forecast-model-rows";
import { loadPostedJournalLines } from "@/lib/journal-ledger";
import { loadRecurrenceReview } from "./forecast-recurrence";
import { loadSettlementInput } from "./forecast-settlement-load";
import { forecastHorizonFor } from "./model-timeline";
import { parseStoredEscalation, parseStoredPattern } from "./driver-pattern-schema";
import { loadBankLinkedAccountIds } from "./cash-accounts";


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

/** Use the last full calendar month; a future closure cannot advance the actual cutoff. */
export async function forecastAsOfMonth(companyId: string, now: Date, db: DbExecutor = getDatabase()) {
  const [closure] = await db.select({ period: journalPeriodClosures.period }).from(journalPeriodClosures).where(eq(journalPeriodClosures.companyId, companyId)).orderBy(desc(journalPeriodClosures.period)).limit(1);
  return forecastAsOfFromClosure(closure?.period ?? null, now);
}

export const compareIds = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

/** The company's active chart accounts as forecast accounts, in id order. */
export async function loadForecastAccounts(companyId: string, db: DbExecutor = getDatabase()) {
  const [rows, linkedIds] = await Promise.all([db.select().from(chartAccounts).where(and(eq(chartAccounts.companyId, companyId), eq(chartAccounts.active, "Y"))), loadBankLinkedAccountIds(companyId, db)]);
  // Each account's Standard line (confirmed, or the suggestion), so a driver can reference "total revenue".
  const forecastAccounts = rows.map((row) => chartAccountToForecastAccount(row, linkedIds));
  const lines = resolveStandardMapping(forecastAccounts.map((account, index) => ({ ...account, reportLine: rows[index]!.reportLine && isStandardLineId(rows[index]!.reportLine!) ? rows[index]!.reportLine as StandardLineId : null })), []);
  return forecastAccounts.map((account) => { const line = lines.get(account.accountId)?.line; return line ? { ...account, reportLine: line } : account; }).sort((left, right) => compareIds(left.accountId, right.accountId));
}

/** The company's active forecast model in canonical order, or undefined when it has none. */
export async function loadForecastModel(companyId: string, db: DbExecutor = getDatabase()): Promise<ForecastModel | undefined> {
  const [dimensions, variables] = await Promise.all([
    db.select({ name: forecastDimensions.name, items: forecastDimensions.items }).from(forecastDimensions).where(and(eq(forecastDimensions.companyId, companyId), eq(forecastDimensions.active, "Y"))),
    db.select({ name: forecastVariables.name, kind: forecastVariables.kind, dims: forecastVariables.dims, formula: forecastVariables.formula, inputs: forecastVariables.inputs }).from(forecastVariables).where(and(eq(forecastVariables.companyId, companyId), eq(forecastVariables.active, "Y"))),
  ]);
  return rowsToModel(dimensions, variables);
}

/** Resolve formula and pattern drivers for a projection window, including one base month for prev(). */
export function resolveDriversForWindow(drivers: ForecastDriver[], model: ForecastModel | undefined, window: { start: string; end: string }, patterns?: { templates: ForecastEntryTemplate[]; accounts: ForecastAccount[]; context?: PatternContext }) {
  if (!isValidMonth(window.start) || !isValidMonth(window.end) || window.start > window.end) return { drivers, exceptions: [] as { driverId: string; reason: string }[] };
  const months = monthRange(addMonths(window.start, -1), window.end);
  const resolution = resolveFormulaDrivers(drivers, model, months);
  const patterned = resolvePatternDrivers(resolution.drivers, { months, templates: patterns?.templates ?? [], accountLines: new Map((patterns?.accounts ?? []).flatMap((account) => account.reportLine ? [[account.accountId, account.reportLine] as const] : [])), ...(model ? { model } : {}), ...(patterns?.context ? { context: patterns.context } : {}) });
  const exceptions = [...resolution.exceptions, ...patterned.exceptions];
  const failed = new Set(exceptions.map((exception) => exception.driverId));
  return { drivers: patterned.drivers.filter((driver) => !failed.has(driver.id)), exceptions };
}

/**
 * The compact, canonical forecast input: an actuals summary rather than raw
 * lines, with drivers, templates, and accounts in id order so the stored input
 * hash does not depend on the order Postgres returns rows in.
 */
/** Operating metrics, seasonality profiles and the default escalation; undefined when the company has none. */
export async function loadPatternContext(companyId: string, db: DbExecutor = getDatabase()): Promise<PatternContext | undefined> {
  const [metrics, profiles, [company], actualRows] = await Promise.all([
    db.select().from(forecastMetrics).where(eq(forecastMetrics.companyId, companyId)),
    db.select().from(seasonalityProfiles).where(eq(seasonalityProfiles.companyId, companyId)),
    db.select({ escalation: companies.defaultEscalation }).from(companies).where(eq(companies.id, companyId)).limit(1),
    db.select({ metricId: forecastMetricActuals.metricId, month: forecastMetricActuals.month, value: forecastMetricActuals.value }).from(forecastMetricActuals).where(eq(forecastMetricActuals.companyId, companyId)),
  ]);
  const escalation = parseStoredEscalation(company?.escalation);
  const actualsByMetric = new Map<string, Record<string, string>>();
  for (const row of actualRows.sort((left, right) => left.month.localeCompare(right.month))) actualsByMetric.set(row.metricId, { ...(actualsByMetric.get(row.metricId) ?? {}), [row.month]: row.value });
  if (!metrics.length && !profiles.length && !escalation) return undefined;
  return {
    metrics: metrics.sort((left, right) => compareIds(left.name, right.name)).map((metric) => ({ name: metric.name, label: metric.label, effectiveFrom: metric.effectiveFrom, ...(metric.effectiveTo ? { effectiveTo: metric.effectiveTo } : {}), pattern: parseStoredPattern(metric.pattern)!, ...(actualsByMetric.get(metric.id) ? { actuals: actualsByMetric.get(metric.id)! } : {}) })),
    seasonality: profiles.sort((left, right) => compareIds(left.id, right.id)).map((profile) => ({ id: profile.id, name: profile.name, deviations: profile.deviations })),
    escalation,
  };
}

export async function loadForecastInputs(companyId: string, options: { now?: Date; db?: DbExecutor } = {}): Promise<ForecastRunInput> {
  const db = options.db ?? getDatabase();
  const now = options.now ?? new Date();
  const [company] = await db.select({ baseCurrency: companies.baseCurrency, minimumCashMinor: companies.minimumCashMinor, modelLastPeriod: companies.modelLastPeriod }).from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company) throw new Error("Company not found while loading forecast inputs");
  const asOfMonth = await forecastAsOfMonth(companyId, now, db);
  const currentMonth = now.toISOString().slice(0, 7);
  const openMonth = addMonths(asOfMonth, 1) === currentMonth ? currentMonth : null;
  const [{ drivers, templates }, loadedActualLines, accounts, model, patterns] = await Promise.all([
    loadForecastDrivers(companyId, {}, db),
    loadPostedJournalLines(companyId, openMonth ?? asOfMonth, db),
    loadForecastAccounts(companyId, db),
    loadForecastModel(companyId, db),
    loadPatternContext(companyId, db),
  ]);
  const throughDate = now.toISOString().slice(0, 10);
  const actualLines = loadedActualLines.filter((line) => !line.postingDate || line.postingDate <= throughDate);
  const settlement = await loadSettlementInput(db, companyId, actualLines, throughDate);
  const recurrence = await loadRecurrenceReview(db, companyId, { drivers, templates, accounts, currency: company.baseCurrency }, throughDate, new Set(settlement.occurrences.map((item) => item.key)));
  const baseCurrencyLines = actualLines.filter((line) => line.currency === company.baseCurrency);
  // In a stable order, like drivers and templates: the run, and every preview token hashed from it, must not depend on the order the database returns rows.
  const openActualLines = openMonth ? baseCurrencyLines.filter((line) => line.period === openMonth && ["actual", "adjustment", "elimination"].includes(line.basis ?? "actual")).sort((left, right) => (left.postingDate ?? "").localeCompare(right.postingDate ?? "") || compareIds(left.entryId ?? "", right.entryId ?? "") || compareIds(left.id, right.id)) : [];
  const recognitionProofs = await loadRecognitionProofs(db, companyId, asOfMonth, company.baseCurrency, actualLines);
  return { recognitionProofs, actuals: summarizeActualCash(actualLines, company.baseCurrency, asOfMonth), drivers: drivers.sort((left, right) => compareIds(left.id, right.id)), templates: templates.sort((left, right) => compareIds(left.id, right.id)), accounts, currency: company.baseCurrency, asOfMonth, horizonMonths: forecastHorizonFor(asOfMonth, company.modelLastPeriod), minimumCashMinor: company.minimumCashMinor, settlement, recurrence: recurrence.states, ...(openMonth ? { openMonth: { month: openMonth, throughDate, actualLines: openActualLines, forecastedLines: [], matches: [] } } : {}), ...(model ? { model } : {}), ...(patterns ? { patterns } : {}) };
}
