import "server-only";
import { eq, sql } from "drizzle-orm";
import { companies, getDatabase } from "@finance/database";
import { buildForecastRun } from "@balsa/finance-engine";
import type { DbExecutor } from "@/lib/db-executor";
import { loadForecastInputs } from "@/lib/forecast-inputs";
import { persistForecastRun, recordForecastConsequence } from "@/lib/forecast-persistence";
import { captureApprovedRecurrences } from "./forecast-recurrence";
import { applyApprovedAutoSettlements } from "./forecast-auto-settlement";

class ForecastSuperseded extends Error {}

/**
 * First key of the two-key advisory lock that serializes a company's forecast
 * jobs: `pg_advisory_xact_lock(FORECAST_LOCK_NAMESPACE, hashtext(companyId))`.
 * The namespace keeps these locks apart from any other advisory lock user.
 */
export const FORECAST_LOCK_NAMESPACE = 7401;

export type ForecastJobResult = { id: string; reused: boolean } | { superseded: true };

/**
 * Derive, persist, and diff the forecast for one committed revision.
 *
 * One READ COMMITTED transaction, set explicitly so a changed database
 * default cannot turn it into a snapshot that predates the lock wait. Jobs for
 * a company serialize on an advisory lock, so the previous-run lookup sees every run committed before this job.
 * A run is persisted only if the company is still at this revision both
 * before and after the work; otherwise nothing is written and the result is
 * `{ superseded: true }`, leaving this revision's causes to the newer job.
 *
 * Every query inside the transaction goes through `tx`. Nothing in it may
 * call `getDatabase()`: the dev pool has one connection, so that deadlocks.
 *
 * `afterCompute` is a test-only hook. It runs inside the transaction after the
 * run and consequence are written and before the final revision check, so a
 * test can simulate a mutation landing mid-job. Production callers never pass it.
 */
export async function runForecastJob(companyId: string, financialStateRevision: string, options: { now?: Date; afterCompute?: (tx: DbExecutor) => Promise<void> } = {}): Promise<ForecastJobResult> {
  const currentRevision = async (tx: DbExecutor) => (await tx.select({ revision: companies.financialStateRevision }).from(companies).where(eq(companies.id, companyId)).limit(1))[0]?.revision;
  try {
    return await getDatabase().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${FORECAST_LOCK_NAMESPACE}, hashtext(${companyId}))`);
      if ((await currentRevision(tx)) !== financialStateRevision) throw new ForecastSuperseded();
      let input = await loadForecastInputs(companyId, { ...(options.now ? { now: options.now } : {}), db: tx });
      if (await captureApprovedRecurrences(tx, companyId, input, (options.now ?? new Date()).toISOString().slice(0, 10))) input = await loadForecastInputs(companyId, { ...(options.now ? { now: options.now } : {}), db: tx });
      if (input.settlement && await applyApprovedAutoSettlements(tx, companyId, input.settlement, input.currency)) input = await loadForecastInputs(companyId, { ...(options.now ? { now: options.now } : {}), db: tx });
      const run = buildForecastRun(input);
      const persisted = await persistForecastRun({ companyId, financialStateRevision, run, input }, tx);
      // Unconditional: a retry after a failure between persist and record must still record. The (company, revision) unique index keeps it idempotent.
      await recordForecastConsequence({ companyId, financialStateRevision, nextRunId: persisted.id, run }, tx);
      if (options.afterCompute) await options.afterCompute(tx);
      if ((await currentRevision(tx)) !== financialStateRevision) throw new ForecastSuperseded();
      return persisted;
    }, { isolationLevel: "read committed" });
  } catch (error) {
    if (error instanceof ForecastSuperseded) return { superseded: true };
    throw error;
  }
}
