import "server-only";
import { and, eq } from "drizzle-orm";
import { getDatabase, intercompanyEliminationEntries, journalBatches, journalEntries, journalLineLineage, journalLines, reportingPeriods } from "@finance/database";
import { loadIntercompanyEliminationPreview } from "@/lib/intercompany-eliminations";
import { refreshCurrentCalculationRun } from "@/lib/refresh-calculation-run";

/** Post one reviewed mapping's exact current preview as a consolidated-only entry. */
export async function postIntercompanyElimination(input: { companyId: string; userId: string; period: string; mappingId: string }) {
  const [previous] = await getDatabase().select({ journalEntryId: intercompanyEliminationEntries.journalEntryId }).from(intercompanyEliminationEntries).where(and(eq(intercompanyEliminationEntries.companyId, input.companyId), eq(intercompanyEliminationEntries.period, input.period), eq(intercompanyEliminationEntries.mappingId, input.mappingId))).limit(1);
  if (previous) return { ok: true as const, entryId: previous.journalEntryId, idempotent: true, calculationRun: null };
  const preview = await loadIntercompanyEliminationPreview(input.companyId, input.period);
  const entry = preview.entries.filter((candidate) => candidate.mappingId === input.mappingId);
  const relatedExceptions = preview.exceptions.filter((exception) => exception.mappingId === input.mappingId);
  if (!entry.length || relatedExceptions.length) return { ok: false as const, blockers: relatedExceptions.map((exception) => exception.reason).length ? relatedExceptions.map((exception) => exception.reason) : ["This mapping does not have a fully matched elimination candidate."] };
  const db = getDatabase();
  const committed = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(intercompanyEliminationEntries).where(and(eq(intercompanyEliminationEntries.companyId, input.companyId), eq(intercompanyEliminationEntries.period, input.period), eq(intercompanyEliminationEntries.mappingId, input.mappingId))).limit(1);
    if (existing) return { entryId: existing.journalEntryId, idempotent: true };
    const [reportingPeriod] = await tx.select({ status: reportingPeriods.status }).from(reportingPeriods).where(and(eq(reportingPeriods.companyId, input.companyId), eq(reportingPeriods.month, input.period))).limit(1);
    if (reportingPeriod?.status === "closed") throw new Error(`Reporting period ${input.period} is closed; reverse or post an explicit adjustment instead.`);
    const key = `intercompany-elimination:${input.period}:${input.mappingId}`;
    const [batch] = await tx.insert(journalBatches).values({ companyId: input.companyId, label: `Intercompany elimination · ${input.period}`, source: "intercompany_elimination", status: "posted", idempotencyKey: key, postedAt: new Date() }).returning({ id: journalBatches.id });
    const [journalEntry] = await tx.insert(journalEntries).values({ companyId: input.companyId, batchId: batch!.id, postingDate: `${input.period}-01`, period: input.period, memo: `Eliminate matched intercompany balances for mapping ${input.mappingId}.`, status: "posted", basis: "elimination", postedAt: new Date() }).returning({ id: journalEntries.id });
    for (const candidate of entry) for (const line of candidate.lines) {
      const [postedLine] = await tx.insert(journalLines).values({ companyId: input.companyId, entryId: journalEntry!.id, accountId: line.accountId, currency: candidate.currency, debitMinor: line.debitMinor, creditMinor: line.creditMinor, externalKey: `${candidate.key}:${line.accountId}`, sourceLocation: `intercompany-mapping:${input.mappingId}`, memo: "CFO-approved intercompany elimination" }).returning({ id: journalLines.id });
      await tx.insert(journalLineLineage).values(line.upstreamLineIds.map((upstreamJournalLineId) => ({ companyId: input.companyId, journalLineId: postedLine!.id, upstreamJournalLineId, relationship: "intercompany_elimination" })));
    }
    await tx.insert(intercompanyEliminationEntries).values({ companyId: input.companyId, period: input.period, mappingId: input.mappingId, journalEntryId: journalEntry!.id, approvedByUserId: input.userId });
    return { entryId: journalEntry!.id, idempotent: false };
  });
  const calculationRun = committed.idempotent ? null : await refreshCurrentCalculationRun(input.companyId, { journalPeriods: [input.period], cause: { kind: "journal_posted", subjectType: "intercompany_elimination", subjectId: committed.entryId, actorUserId: input.userId, via: "ui" } });
  return { ok: true as const, ...committed, calculationRun };
}
