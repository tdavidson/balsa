import "server-only";
import { calculationOutbox, companies, getDatabase, journalEntries } from "@finance/database";
import { and, eq, sql } from "drizzle-orm";
import { journalCalculationFormulaVersion } from "@nevermodel/finance-engine";
import { processCalculationOutboxJob } from "@/lib/calculation-outbox";

/**
 * Queue journal-native calculation graphs after a committed financial-state
 * mutation. The former event engine is deliberately not queued or compared:
 * reported truth comes only from posted entries and their controls.
 */
export async function refreshCurrentCalculationRun(companyId: string, options: { journalPeriods?: string[] } = {}) {
  // Mutations call this only after they commit. Advancing the revision and
  // queuing the job makes calculation freshness observable and retryable even
  // while this first, synchronous worker path is in use.
  const db = getDatabase();
  const revision = await db.transaction(async (tx) => {
    const [company] = await tx.update(companies).set({ financialStateRevision: sql`(financial_state_revision::bigint + 1)::text`, updatedAt: new Date() }).where(eq(companies.id, companyId)).returning({ financialStateRevision: companies.financialStateRevision });
    if (!company) throw new Error("Company not found while refreshing calculation");
    const explicitPeriods = [...new Set(options.journalPeriods ?? [])].filter((period) => /^\d{4}-(0[1-9]|1[0-2])$/.test(period));
    // A non-posting mutation (for example, evidence approval or entity setup)
    // can affect controls or presentation across existing ledger periods. In
    // single-company mode, rebuilding all posted periods is the safe choice.
    const journalPeriods = explicitPeriods.length ? explicitPeriods : [...new Set((await tx.select({ period: journalEntries.period }).from(journalEntries).where(and(eq(journalEntries.companyId, companyId), eq(journalEntries.status, "posted")))).map((entry) => entry.period))];
    const journalJobs = journalPeriods.length
      ? await tx.insert(calculationOutbox).values(journalPeriods.map((period) => ({ companyId, financialStateRevision: company.financialStateRevision, engineVersion: journalCalculationFormulaVersion, period, status: "queued" }))).onConflictDoNothing().returning({ id: calculationOutbox.id, period: calculationOutbox.period })
      : [];
    return { revision: company.financialStateRevision, journalJobs };
  });
  const results = await Promise.all(revision.journalJobs.map((job) => processCalculationOutboxJob(job.id)));
  const failed = results.find((result) => result.status === "failed");
  // The financial mutation has already committed. A failed calculation stays
  // durable in the outbox for retry; it must not falsely report that the CFO's
  // approved state change failed or invite an unsafe duplicate submission.
  return { financialStateRevision: revision.revision, jobId: revision.journalJobs[0]?.id ?? null, status: failed ? "failed" as const : results.length ? "completed" as const : "not_queued" as const, journalJobIds: revision.journalJobs.map((job) => job.id), ...(failed?.error ? { error: failed.error } : {}) };
}
