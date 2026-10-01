import "server-only";
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import { calculationRuns, companies, decisions, economicItems, evidence, forecastConsequences, forecastDimensions, forecastVariables, getDatabase, journalPeriodClosures } from "@finance/database";
import { forecastFormulaVersion, type ForecastConsequence, type ForecastRun } from "@balsa/finance-engine";
import type { ConsequenceSource } from "@/lib/consequence-copy";
import { forecastAsOfFromClosure } from "@/lib/forecast-drivers";

const parsedRuns = new Map<string, ForecastRun>();

/**
 * The latest persisted forecast run. `stale` means a newer revision's forecast has not completed yet,
 * or the calendar has moved past the run's as-of month (the as-of the next run would use is later).
 */
export async function loadLatestForecast(companyId: string, now = new Date()) {
  const db = getDatabase();
  const [[row], [company], [closure]] = await Promise.all([
    db.select({ id: calculationRuns.id, revision: calculationRuns.financialStateRevision, asOfMonth: calculationRuns.asOfMonth, engineVersion: calculationRuns.engineVersion }).from(calculationRuns).where(and(eq(calculationRuns.companyId, companyId), like(calculationRuns.engineVersion, "forecast-run-%"))).orderBy(desc(sql`${calculationRuns.financialStateRevision}::bigint`), desc(calculationRuns.createdAt)).limit(1),
    db.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, companyId)).limit(1),
    db.select({ period: journalPeriodClosures.period }).from(journalPeriodClosures).where(eq(journalPeriodClosures.companyId, companyId)).orderBy(desc(journalPeriodClosures.period)).limit(1),
  ]);
  if (!row) return null;
  let run = parsedRuns.get(row.id);
  if (!run) {
    const [full] = await db.select({ outputJson: calculationRuns.outputJson }).from(calculationRuns).where(eq(calculationRuns.id, row.id)).limit(1);
    if (!full) return null;
    run = JSON.parse(full.outputJson) as ForecastRun;
    parsedRuns.set(row.id, run);
    if (parsedRuns.size > 20) parsedRuns.delete(parsedRuns.keys().next().value!);
  }
  const stale = company?.revision !== row.revision || row.engineVersion !== forecastFormulaVersion || row.asOfMonth < forecastAsOfFromClosure(closure?.period ?? null, now);
  return { runId: row.id, revision: row.revision, run, stale };
}

export type LatestForecast = NonNullable<Awaited<ReturnType<typeof loadLatestForecast>>>;

/**
 * The as-of period a projected/scenario reader should validate against and report in
 * its labels/echo: the latest forecast's as-of month when one exists — matching the
 * override `withDerivedForecast` applies in journal-ledger.ts, so the value agrees with
 * what the engine actually used — otherwise the caller's requested value, unchanged.
 * `forecastAnchored` tells the caller whether the as-of came from a forecast, so it can
 * clamp an out-of-range label instead of rejecting the request (the caller's own
 * out-of-range value, with no forecast involved, should still be rejected as before).
 *
 * `forecast` lets a caller that already loaded the forecast for this request reuse it:
 * `undefined` (the default) loads it here as before; `null` means "no forecast exists".
 */
export async function effectiveAsOfPeriod(companyId: string, view: string, requested: string | undefined, forecast?: LatestForecast | null): Promise<{ asOfPeriod: string | undefined; forecastAnchored: boolean }> {
  if (view !== "projected" && view !== "scenario") return { asOfPeriod: requested, forecastAnchored: false };
  const resolved = forecast !== undefined ? forecast : await loadLatestForecast(companyId);
  return resolved ? { asOfPeriod: resolved.run.asOfMonth, forecastAnchored: true } : { asOfPeriod: requested, forecastAnchored: false };
}

export type ConsequenceCause = { revision: string; kind: string; subjectType: string; subjectId: string | null; subjectIds?: string[]; actorUserId: string | null; via: string; createdAt: string; subjectLabel: string | null; subjectLabels: string[] };
type RawCause = Omit<ConsequenceCause, "subjectLabel" | "subjectLabels">;

/** Every evidence id a driver ref in a consequence's delta carries, deduplicated in order of first appearance. */
export function driverEvidenceIds(delta: ForecastConsequence): string[] {
  const ids = [
    ...delta.drivers.added.map((driver) => driver.evidenceId),
    ...delta.drivers.removed.map((driver) => driver.evidenceId),
    ...delta.drivers.changed.flatMap((change) => [change.before.evidenceId, change.after.evidenceId]),
  ].filter((id): id is string => Boolean(id));
  return [...new Set(ids)];
}

/** Recent consequences with a human label for each cause's subject, including every subject of a bulk cause. */
export async function loadRecentConsequences(companyId: string, limit = 10) {
  const db = getDatabase();
  const rows = await db.select().from(forecastConsequences).where(eq(forecastConsequences.companyId, companyId)).orderBy(desc(forecastConsequences.createdAt)).limit(Math.max(1, Math.min(limit, 50)));
  const causes = rows.flatMap((row) => row.causes as RawCause[]);
  const subjectIds = (cause: RawCause) => [...(cause.subjectId ? [cause.subjectId] : []), ...(cause.subjectIds ?? [])];
  const ids = (type: string) => [...new Set(causes.filter((cause) => cause.subjectType === type).flatMap(subjectIds))];
  const evidenceIds = [...new Set([...ids("evidence"), ...rows.flatMap((row) => driverEvidenceIds(row.delta as ForecastConsequence))])];
  const [items, documents, answers, variables, dimensions] = await Promise.all([
    ids("economic_item").length ? db.select({ id: economicItems.id, label: economicItems.label }).from(economicItems).where(and(eq(economicItems.companyId, companyId), inArray(economicItems.id, ids("economic_item")))) : [],
    evidenceIds.length ? db.select({ id: evidence.id, label: evidence.sourceName }).from(evidence).where(and(eq(evidence.companyId, companyId), inArray(evidence.id, evidenceIds))) : [],
    ids("decision").length ? db.select({ id: decisions.id, label: decisions.question }).from(decisions).where(and(eq(decisions.companyId, companyId), inArray(decisions.id, ids("decision")))) : [],
    ids("forecast_variable").length ? db.select({ id: forecastVariables.id, label: forecastVariables.name }).from(forecastVariables).where(and(eq(forecastVariables.companyId, companyId), inArray(forecastVariables.id, ids("forecast_variable")))) : [],
    ids("forecast_dimension").length ? db.select({ id: forecastDimensions.id, label: forecastDimensions.name }).from(forecastDimensions).where(and(eq(forecastDimensions.companyId, companyId), inArray(forecastDimensions.id, ids("forecast_dimension")))) : [],
  ]);
  const labels = new Map([...items, ...documents, ...answers, ...variables, ...dimensions].map((row) => [row.id, row.label]));
  const sourceNames = new Map(documents.map((row) => [row.id, row.label]));
  return rows.map((row) => {
    const delta = row.delta as ForecastConsequence;
    const sources: ConsequenceSource[] = driverEvidenceIds(delta)
      .filter((evidenceId) => sourceNames.has(evidenceId))
      .map((evidenceId) => ({ evidenceId, sourceName: sourceNames.get(evidenceId) ?? null }));
    return {
      id: row.id, revision: row.revision, createdAt: row.createdAt.toISOString(), delta, sources,
      causes: [...(row.causes as RawCause[])].reverse().map((cause) => ({ ...cause, subjectLabel: cause.subjectId ? labels.get(cause.subjectId) ?? null : null, subjectLabels: (cause.subjectIds ?? []).map((id) => labels.get(id)).filter((label): label is string => Boolean(label)) })),
    };
  });
}
