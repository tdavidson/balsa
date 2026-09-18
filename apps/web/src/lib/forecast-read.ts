import "server-only";
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import { calculationRuns, companies, decisions, economicItems, evidence, forecastConsequences, getDatabase, journalPeriodClosures } from "@finance/database";
import type { ForecastConsequence, ForecastRun } from "@nevermodel/finance-engine";
import { forecastAsOfFromClosure } from "@/lib/forecast-drivers";

const parsedRuns = new Map<string, ForecastRun>();

/**
 * The latest persisted forecast run. `stale` means a newer revision's forecast has not completed yet,
 * or the calendar has moved past the run's as-of month (the as-of the next run would use is later).
 */
export async function loadLatestForecast(companyId: string, now = new Date()) {
  const db = getDatabase();
  const [[row], [company], [closure]] = await Promise.all([
    db.select({ id: calculationRuns.id, revision: calculationRuns.financialStateRevision, asOfMonth: calculationRuns.asOfMonth }).from(calculationRuns).where(and(eq(calculationRuns.companyId, companyId), like(calculationRuns.engineVersion, "forecast-run-%"))).orderBy(desc(sql`${calculationRuns.financialStateRevision}::bigint`), desc(calculationRuns.createdAt)).limit(1),
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
  const stale = company?.revision !== row.revision || row.asOfMonth < forecastAsOfFromClosure(closure?.period ?? null, now);
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

/** Recent consequences with a human label for each cause's subject, including every subject of a bulk cause. */
export async function loadRecentConsequences(companyId: string, limit = 10) {
  const db = getDatabase();
  const rows = await db.select().from(forecastConsequences).where(eq(forecastConsequences.companyId, companyId)).orderBy(desc(forecastConsequences.createdAt)).limit(Math.max(1, Math.min(limit, 50)));
  const causes = rows.flatMap((row) => row.causes as RawCause[]);
  const subjectIds = (cause: RawCause) => [...(cause.subjectId ? [cause.subjectId] : []), ...(cause.subjectIds ?? [])];
  const ids = (type: string) => [...new Set(causes.filter((cause) => cause.subjectType === type).flatMap(subjectIds))];
  const [items, documents, answers] = await Promise.all([
    ids("economic_item").length ? db.select({ id: economicItems.id, label: economicItems.label }).from(economicItems).where(and(eq(economicItems.companyId, companyId), inArray(economicItems.id, ids("economic_item")))) : [],
    ids("evidence").length ? db.select({ id: evidence.id, label: evidence.sourceName }).from(evidence).where(and(eq(evidence.companyId, companyId), inArray(evidence.id, ids("evidence")))) : [],
    ids("decision").length ? db.select({ id: decisions.id, label: decisions.question }).from(decisions).where(and(eq(decisions.companyId, companyId), inArray(decisions.id, ids("decision")))) : [],
  ]);
  const labels = new Map([...items, ...documents, ...answers].map((row) => [row.id, row.label]));
  return rows.map((row) => ({
    id: row.id, revision: row.revision, createdAt: row.createdAt.toISOString(), delta: row.delta as ForecastConsequence,
    causes: (row.causes as RawCause[]).map((cause) => ({ ...cause, subjectLabel: cause.subjectId ? labels.get(cause.subjectId) ?? null : null, subjectLabels: (cause.subjectIds ?? []).map((id) => labels.get(id)).filter((label): label is string => Boolean(label)) })),
  }));
}
