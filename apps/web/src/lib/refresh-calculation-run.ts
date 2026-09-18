import "server-only";
import { calculationOutbox, companies, financialStateRevisions, getDatabase, journalEntries } from "@finance/database";
import { and, eq, sql } from "drizzle-orm";
import { forecastFormulaVersion, journalCalculationFormulaVersion } from "@nevermodel/finance-engine";
import { processCalculationOutboxJob } from "@/lib/calculation-outbox";
import type { RevisionCause } from "@/lib/revision-cause";

/**
 * Advance the financial-state revision after a committed mutation, record why,
 * and queue the journal graphs plus one derived-forecast run for it.
 */
export async function refreshCurrentCalculationRun(companyId: string, options: { journalPeriods?: string[]; cause: RevisionCause; now?: Date }) {
  const db = getDatabase();
  const revision = await db.transaction(async (tx) => {
    const [company] = await tx.update(companies).set({ financialStateRevision: sql`(financial_state_revision::bigint + 1)::text`, updatedAt: new Date() }).where(eq(companies.id, companyId)).returning({ financialStateRevision: companies.financialStateRevision });
    if (!company) throw new Error("Company not found while refreshing calculation");
    await tx.insert(financialStateRevisions).values({ companyId, revision: company.financialStateRevision, kind: options.cause.kind, subjectType: options.cause.subjectType, subjectId: options.cause.subjectId, actorUserId: options.cause.actorUserId, via: options.cause.via, ...(options.cause.subjectIds ? { subjectIds: options.cause.subjectIds } : {}) });
    const explicitPeriods = [...new Set(options.journalPeriods ?? [])].filter((period) => /^\d{4}-(0[1-9]|1[0-2])$/.test(period));
    // A non-posting mutation (for example, evidence approval or entity setup)
    // can affect controls or presentation across existing ledger periods. In
    // single-company mode, rebuilding all posted periods is the safe choice.
    const journalPeriods = explicitPeriods.length ? explicitPeriods : [...new Set((await tx.select({ period: journalEntries.period }).from(journalEntries).where(and(eq(journalEntries.companyId, companyId), eq(journalEntries.status, "posted")))).map((entry) => entry.period))];
    const journalJobs = journalPeriods.length
      ? await tx.insert(calculationOutbox).values(journalPeriods.map((period) => ({ companyId, financialStateRevision: company.financialStateRevision, engineVersion: journalCalculationFormulaVersion, period, status: "queued" }))).onConflictDoNothing().returning({ id: calculationOutbox.id, period: calculationOutbox.period })
      : [];
    const [forecastJob] = await tx.insert(calculationOutbox).values({ companyId, financialStateRevision: company.financialStateRevision, engineVersion: forecastFormulaVersion, period: "forecast", status: "queued" }).onConflictDoNothing().returning({ id: calculationOutbox.id });
    return { revision: company.financialStateRevision, journalJobs, forecastJobId: forecastJob?.id ?? null };
  });
  const results = await Promise.all(revision.journalJobs.map((job) => processCalculationOutboxJob(job.id)));
  // The forecast reads posted lines directly, not journal graphs; it runs last so one revision computes at a time.
  const forecastResult = revision.forecastJobId ? await processCalculationOutboxJob(revision.forecastJobId, options.now) : null;
  const failed = [...results, ...(forecastResult ? [forecastResult] : [])].find((result) => result.status === "failed");
  // The financial mutation has already committed. A failed calculation stays
  // durable in the outbox for retry; it must not falsely report that the CFO's
  // approved state change failed or invite an unsafe duplicate submission.
  return { financialStateRevision: revision.revision, jobId: revision.journalJobs[0]?.id ?? null, status: failed ? "failed" as const : results.length || forecastResult ? "completed" as const : "not_queued" as const, journalJobIds: revision.journalJobs.map((job) => job.id), forecastJobId: revision.forecastJobId, forecastStatus: forecastResult?.status ?? "not_queued", ...(failed?.error ? { error: failed.error } : {}) };
}
