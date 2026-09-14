import "server-only";
import { and, asc, eq, lt, or } from "drizzle-orm";
import { calculationOutbox, companies, getDatabase } from "@finance/database";
import { buildJournalCalculationGraph, journalCalculationFormulaVersion } from "@nevermodel/finance-engine";
import { persistJournalCalculationGraph } from "@/lib/journal-calculation-graph";
import { loadJournalReconciliation } from "@/lib/journal-reconciliation";
import { loadJournalAllocationAnalysis } from "@/lib/journal-allocation-analysis";

export type CalculationJobResult = { id: string; status: "completed" | "superseded" | "failed" | "not_claimed"; error?: string };

export async function recoverStaleCalculationJobs(maxAgeMs = 10 * 60_000, now = new Date()) {
  const cutoff = new Date(now.getTime() - Math.max(1, maxAgeMs));
  return getDatabase().update(calculationOutbox).set({ status: "queued", error: "Recovered after an interrupted calculation worker.", updatedAt: now }).where(and(eq(calculationOutbox.status, "processing"), lt(calculationOutbox.updatedAt, cutoff))).returning({ id: calculationOutbox.id });
}

/**
 * Claim and calculate exactly one queued job. The conditional claim makes this
 * safe for a web request and a background worker to race without producing two
 * runs for the same company revision.
 */
export async function processCalculationOutboxJob(jobId: string): Promise<CalculationJobResult> {
  const db = getDatabase();
  const [job] = await db.update(calculationOutbox).set({ status: "processing", error: null, updatedAt: new Date() }).where(and(eq(calculationOutbox.id, jobId), or(eq(calculationOutbox.status, "queued"), eq(calculationOutbox.status, "failed")))).returning();
  if (!job) return { id: jobId, status: "not_claimed" };
  try {
    const [company] = await db.select({ financialStateRevision: companies.financialStateRevision }).from(companies).where(eq(companies.id, job.companyId)).limit(1);
    if (!company || company.financialStateRevision !== job.financialStateRevision) {
      await db.update(calculationOutbox).set({ status: "superseded", completedAt: new Date(), updatedAt: new Date() }).where(eq(calculationOutbox.id, job.id));
      return { id: job.id, status: "superseded" };
    }
    const run = job.engineVersion === journalCalculationFormulaVersion && /^\d{4}-(0[1-9]|1[0-2])$/.test(job.period)
        ? await (async () => {
          const reconciliation = await loadJournalReconciliation(job.companyId, job.period);
          const allocationAnalysis = await loadJournalAllocationAnalysis(job.companyId, job.period);
          const graph = buildJournalCalculationGraph({ period: job.period, trialBalance: reconciliation.trialBalance, statements: reconciliation.statements, ledgerReconciliation: reconciliation.report, accountBalances: reconciliation.accountBalances, allocationAnalysis });
          return persistJournalCalculationGraph({ companyId: job.companyId, financialStateRevision: job.financialStateRevision, graph, input: { trialBalance: reconciliation.trialBalance, statements: reconciliation.statements, ledgerReconciliation: reconciliation.report, accountBalances: reconciliation.accountBalances, allocationAnalysis } });
        })()
        : (() => { throw new Error(`Unsupported calculation engine or period: ${job.engineVersion} / ${job.period}`); })();
    await db.update(calculationOutbox).set({ status: "completed", calculationRunId: run.id, completedAt: new Date(), updatedAt: new Date() }).where(eq(calculationOutbox.id, job.id));
    return { id: job.id, status: "completed" };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 2_000) : "Unknown calculation failure";
    await db.update(calculationOutbox).set({ status: "failed", error: message, updatedAt: new Date() }).where(eq(calculationOutbox.id, job.id));
    return { id: job.id, status: "failed", error: message };
  }
}

/** Process a bounded batch for a cron/worker invocation. Journal jobs retry safely; former event jobs are superseded. */
export async function processQueuedCalculationJobs(limit = 10) {
  await recoverStaleCalculationJobs();
  const jobs = await getDatabase().select({ id: calculationOutbox.id }).from(calculationOutbox).where(or(eq(calculationOutbox.status, "queued"), eq(calculationOutbox.status, "failed"))).orderBy(asc(calculationOutbox.createdAt)).limit(Math.max(1, Math.min(limit, 50)));
  return Promise.all(jobs.map((job) => processCalculationOutboxJob(job.id)));
}
