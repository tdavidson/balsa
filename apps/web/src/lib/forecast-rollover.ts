import "server-only";
import { and, desc, eq, inArray, like, lt, max, sql } from "drizzle-orm";
import { calculationOutbox, calculationRuns, companies, getDatabase, journalPeriodClosures } from "@finance/database";
import { processCalculationOutboxJob } from "@/lib/calculation-outbox";
import { forecastAsOfFromClosure } from "@/lib/forecast-drivers";
import { refreshCurrentCalculationRun } from "@/lib/refresh-calculation-run";

const forecastEngines = "forecast-run-%";
/** Matches recoverStaleCalculationJobs' default: a job "processing" for longer than this was interrupted. */
const staleProcessingMs = 10 * 60_000;

export type RolloverResult = {
  /** Companies given a new `period_rolled` revision. */
  refreshed: string[];
  /** Companies whose head revision's unfinished forecast job was re-run instead of bumping again. */
  retried: string[];
  /** Companies whose refresh threw or whose forecast job ended failed. Other companies still ran. */
  failed: { companyId: string; error: string }[];
  /** Candidates not started this tick because the limit or time budget was reached. */
  deferred: number;
};

/**
 * The newest unfinished forecast job at the company's head revision: queued,
 * failed, or processing past the stale cutoff (reset to queued here, scoped
 * to this one row, so it can be claimed). `in_flight` means a live worker
 * holds it, so the tick leaves the company alone.
 */
async function headForecastJob(companyId: string, revision: string, now: Date): Promise<{ id: string } | "in_flight" | null> {
  const db = getDatabase();
  const [job] = await db.select({ id: calculationOutbox.id, status: calculationOutbox.status, updatedAt: calculationOutbox.updatedAt }).from(calculationOutbox)
    .where(and(eq(calculationOutbox.companyId, companyId), eq(calculationOutbox.financialStateRevision, revision), eq(calculationOutbox.period, "forecast"), like(calculationOutbox.engineVersion, forecastEngines), inArray(calculationOutbox.status, ["queued", "failed", "processing"])))
    .orderBy(desc(calculationOutbox.createdAt)).limit(1);
  if (!job) return null;
  if (job.status !== "processing") return { id: job.id };
  const cutoff = new Date(now.getTime() - staleProcessingMs);
  const [recovered] = await db.update(calculationOutbox).set({ status: "queued", error: "Recovered after an interrupted calculation worker.", updatedAt: new Date() })
    .where(and(eq(calculationOutbox.id, job.id), eq(calculationOutbox.status, "processing"), lt(calculationOutbox.updatedAt, cutoff))).returning({ id: calculationOutbox.id });
  return recovered ?? "in_flight";
}

/**
 * Advance every company whose latest forecast run has fallen behind the
 * calendar (the as-of month a new run would use has moved past the stored
 * run's). Attributed to the calendar, not to a CFO action. Only companies
 * that already have at least one forecast run are candidates; a company
 * still onboarding has none yet.
 *
 * A company is bumped only when its latest run is at the head revision. If a
 * newer revision exists, its forecast job never completed; bumping again
 * would add a `period_rolled` revision on every tick while the job keeps
 * failing, so the tick re-runs that job instead (and bumps only if no such
 * job exists). The roll does not change posted entries, so it rebuilds no
 * journal graphs.
 *
 * Each company runs in isolation: a failure is recorded in `failed` and the
 * tick moves on. Bounded by `limit` companies started and by `budgetMs` of
 * wall time, so a cron tick never processes an unbounded backlog; the rest
 * are counted in `deferred` and picked up next tick.
 */
export async function refreshRolledForecasts(now = new Date(), limit = 20, options: { budgetMs?: number } = {}): Promise<RolloverResult> {
  const budgetMs = options.budgetMs ?? 30_000;
  const started = Date.now();
  const db = getDatabase();
  const latestRuns = await db.selectDistinctOn([calculationRuns.companyId], { companyId: calculationRuns.companyId, asOfMonth: calculationRuns.asOfMonth, revision: calculationRuns.financialStateRevision })
    .from(calculationRuns).where(like(calculationRuns.engineVersion, forecastEngines))
    .orderBy(calculationRuns.companyId, desc(sql`${calculationRuns.financialStateRevision}::bigint`), desc(calculationRuns.createdAt));
  const closures = latestRuns.length
    ? await db.select({ companyId: journalPeriodClosures.companyId, period: max(journalPeriodClosures.period) }).from(journalPeriodClosures)
      .where(inArray(journalPeriodClosures.companyId, latestRuns.map((run) => run.companyId))).groupBy(journalPeriodClosures.companyId)
    : [];
  const latestClosure = new Map(closures.map((closure) => [closure.companyId, closure.period]));
  // Same rule as forecastAsOfMonth, computed for every company from one closure query.
  const candidates = latestRuns.filter((run) => run.asOfMonth < forecastAsOfFromClosure(latestClosure.get(run.companyId) ?? null, now));

  const result: RolloverResult = { refreshed: [], retried: [], failed: [], deferred: 0 };
  let startedCount = 0;
  for (const run of candidates) {
    if (startedCount >= limit || Date.now() - started >= budgetMs) break;
    startedCount += 1;
    try {
      const [company] = await db.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, run.companyId)).limit(1);
      if (!company) continue; // deleted since the scan
      const pending = company.revision === run.revision ? null : await headForecastJob(run.companyId, company.revision, now);
      if (pending === "in_flight") continue;
      if (pending) {
        const job = await processCalculationOutboxJob(pending.id, now);
        if (job.status === "failed") result.failed.push({ companyId: run.companyId, error: job.error ?? "Forecast job failed" });
        else result.retried.push(run.companyId);
        continue;
      }
      const refreshed = await refreshCurrentCalculationRun(run.companyId, { now, rebuildJournalGraphs: false, cause: { kind: "period_rolled", subjectType: "company", subjectId: run.companyId, actorUserId: null, via: "worker" } });
      if (refreshed.forecastStatus === "failed") result.failed.push({ companyId: run.companyId, error: refreshed.error ?? "Forecast job failed" });
      else result.refreshed.push(run.companyId);
    } catch (error) {
      result.failed.push({ companyId: run.companyId, error: error instanceof Error ? error.message.slice(0, 2_000) : "Unknown rollover failure" });
    }
  }
  result.deferred = candidates.length - startedCount;
  return result;
}
