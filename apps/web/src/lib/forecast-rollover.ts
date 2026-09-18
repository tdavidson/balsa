import "server-only";
import { desc, like, sql } from "drizzle-orm";
import { calculationRuns, getDatabase } from "@finance/database";
import { forecastAsOfMonth } from "@/lib/forecast-inputs";
import { refreshCurrentCalculationRun } from "@/lib/refresh-calculation-run";

const forecastEngines = "forecast-run-%";

/**
 * Advance every company whose latest forecast run has fallen behind the
 * calendar (the as-of month a new run would use has moved past the stored
 * run's). Attributed to the calendar, not to a CFO action. Only companies
 * that already have at least one forecast run are candidates; a company
 * still onboarding has none yet. Bounded by `limit` per invocation so a cron
 * tick never processes an unbounded backlog.
 */
export async function refreshRolledForecasts(now = new Date(), limit = 20) {
  const db = getDatabase();
  const latestRuns = await db.selectDistinctOn([calculationRuns.companyId], { companyId: calculationRuns.companyId, asOfMonth: calculationRuns.asOfMonth })
    .from(calculationRuns).where(like(calculationRuns.engineVersion, forecastEngines))
    .orderBy(calculationRuns.companyId, desc(sql`${calculationRuns.financialStateRevision}::bigint`), desc(calculationRuns.createdAt));

  const refreshed: string[] = [];
  for (const run of latestRuns) {
    if (refreshed.length >= limit) break;
    const currentAsOf = await forecastAsOfMonth(run.companyId, now);
    if (run.asOfMonth >= currentAsOf) continue;
    await refreshCurrentCalculationRun(run.companyId, { now, cause: { kind: "period_rolled", subjectType: "company", subjectId: run.companyId, actorUserId: null, via: "worker" } });
    refreshed.push(run.companyId);
  }
  return { refreshed };
}
