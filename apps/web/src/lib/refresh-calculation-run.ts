import "server-only";
import { calculationOutbox, companies, financialStateRevisions, getDatabase, journalEntries } from "@finance/database";
import { and, eq, sql } from "drizzle-orm";
import { forecastFormulaVersion, journalCalculationFormulaVersion } from "@nevermodel/finance-engine";
import { processCalculationOutboxJob } from "@/lib/calculation-outbox";
import type { RevisionCause } from "@/lib/revision-cause";
import type { DbTransaction } from "@/lib/db-executor";

export type CalculationRefreshReceipt = { financialStateRevision: string; journalJobs: { id: string; period: string }[]; forecastJobId: string | null };

/** Increment the revision, record its cause, and enqueue calculation work using only the supplied transaction. */
export async function enqueueCalculationRefreshWith(tx: DbTransaction, companyId: string, options: { journalPeriods?: string[]; cause: RevisionCause; rebuildJournalGraphs?: boolean }): Promise<CalculationRefreshReceipt> {
  const [company] = await tx.update(companies).set({ financialStateRevision: sql`(financial_state_revision::bigint + 1)::text`, updatedAt: new Date() }).where(eq(companies.id, companyId)).returning({ financialStateRevision: companies.financialStateRevision });
  if (!company) throw new Error("Company not found while refreshing calculation");
  await tx.insert(financialStateRevisions).values({ companyId, revision: company.financialStateRevision, kind: options.cause.kind, subjectType: options.cause.subjectType, subjectId: options.cause.subjectId, actorUserId: options.cause.actorUserId, via: options.cause.via, ...(options.cause.subjectIds ? { subjectIds: options.cause.subjectIds } : {}) });
  const explicitPeriods = [...new Set(options.journalPeriods ?? [])].filter((period) => /^\d{4}-(0[1-9]|1[0-2])$/.test(period));
  const journalPeriods = options.rebuildJournalGraphs === false ? [] : explicitPeriods.length ? explicitPeriods : [...new Set((await tx.select({ period: journalEntries.period }).from(journalEntries).where(and(eq(journalEntries.companyId, companyId), eq(journalEntries.status, "posted")))).map((entry) => entry.period))];
  const journalJobs = journalPeriods.length ? await tx.insert(calculationOutbox).values(journalPeriods.map((period) => ({ companyId, financialStateRevision: company.financialStateRevision, engineVersion: journalCalculationFormulaVersion, period, status: "queued" }))).onConflictDoNothing().returning({ id: calculationOutbox.id, period: calculationOutbox.period }) : [];
  const [forecastJob] = await tx.insert(calculationOutbox).values({ companyId, financialStateRevision: company.financialStateRevision, engineVersion: forecastFormulaVersion, period: "forecast", status: "queued" }).onConflictDoNothing().returning({ id: calculationOutbox.id });
  return { financialStateRevision: company.financialStateRevision, journalJobs, forecastJobId: forecastJob?.id ?? null };
}

/** Process already-committed outbox work. Failures remain durable for retry. */
export async function processEnqueuedCalculationRefresh(receipt: CalculationRefreshReceipt, now?: Date) {
  const results = await Promise.all(receipt.journalJobs.map((job) => processCalculationOutboxJob(job.id)));
  const forecastResult = receipt.forecastJobId ? await processCalculationOutboxJob(receipt.forecastJobId, now) : null;
  const failed = [...results, ...(forecastResult ? [forecastResult] : [])].find((result) => result.status === "failed");
  return { financialStateRevision: receipt.financialStateRevision, jobId: receipt.journalJobs[0]?.id ?? null, status: failed ? "failed" as const : results.length || forecastResult ? "completed" as const : "not_queued" as const, journalJobIds: receipt.journalJobs.map((job) => job.id), forecastJobId: receipt.forecastJobId, forecastStatus: forecastResult?.status ?? "not_queued", ...(failed?.error ? { error: failed.error } : {}) };
}

/**
 * Advance the financial-state revision after a committed mutation, record why,
 * and queue the journal graphs plus one derived-forecast run for it.
 *
 * `rebuildJournalGraphs: false` queues only the forecast job. The calendar
 * rolling forward (`period_rolled`) changes no posted entry, so it has no
 * journal graph to rebuild.
 */
export async function refreshCurrentCalculationRun(companyId: string, options: { journalPeriods?: string[]; cause: RevisionCause; now?: Date; rebuildJournalGraphs?: boolean }) {
  const db = getDatabase();
  const receipt = await db.transaction((tx) => enqueueCalculationRefreshWith(tx, companyId, options));
  return processEnqueuedCalculationRefresh(receipt, options.now);
}
