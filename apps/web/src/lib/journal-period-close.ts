import { and, eq } from "drizzle-orm";
import { chartAccounts, getDatabase, journalBatches, journalEntries, journalLineLineage, journalLines, journalPeriodCloseEntries, journalPeriodClosures, journalPeriodPromotions, recordAudit, reportingPeriods } from "@finance/database";
import { previewRetainedEarningsClose, type RetainedEarningsClosePreview } from "@nevermodel/finance-engine";
import { loadPostedJournalLines } from "@/lib/journal-ledger";
import { loadJournalReconciliation } from "@/lib/journal-reconciliation";
import { refreshCurrentCalculationRun } from "@/lib/refresh-calculation-run";

export type JournalCloseChecklist = {
  eligible: boolean;
  closed: boolean;
  blockers: string[];
  reconciliation: Awaited<ReturnType<typeof loadJournalReconciliation>>;
  promotion: typeof journalPeriodPromotions.$inferSelect | null;
  closure: typeof journalPeriodClosures.$inferSelect | null;
  closeEntry: typeof journalPeriodCloseEntries.$inferSelect | null;
  earnings: { currency: string; unclosedMinor: string; retainedEarningsAccount: { id: string; code: string; name: string } | null }[];
  closeEntryPreview: RetainedEarningsClosePreview;
};

/**
 * The single authority for closing a reporting period. Both the ledger UI and
 * the legacy natural-language month command call this service so neither can
 * sidestep source-to-ledger reconciliation or CFO promotion.
 */
export async function loadJournalCloseChecklist(companyId: string, period: string): Promise<JournalCloseChecklist> {
  const [reconciliation, promotions, closures, closeEntries, accounts, lines] = await Promise.all([
    loadJournalReconciliation(companyId, period),
    getDatabase().select().from(journalPeriodPromotions).where(and(eq(journalPeriodPromotions.companyId, companyId), eq(journalPeriodPromotions.period, period))).limit(1),
    getDatabase().select().from(journalPeriodClosures).where(and(eq(journalPeriodClosures.companyId, companyId), eq(journalPeriodClosures.period, period))).limit(1),
    getDatabase().select().from(journalPeriodCloseEntries).where(and(eq(journalPeriodCloseEntries.companyId, companyId), eq(journalPeriodCloseEntries.period, period))).limit(1),
    getDatabase().select({ id: chartAccounts.id, code: chartAccounts.code, name: chartAccounts.name, statementLine: chartAccounts.statementLine, entityId: chartAccounts.entityId }).from(chartAccounts).where(and(eq(chartAccounts.companyId, companyId), eq(chartAccounts.active, "Y"))),
    loadPostedJournalLines(companyId, period),
  ]);
  const promotion = promotions[0] ?? null;
  const closure = closures[0] ?? null;
  const closeEntry = closeEntries[0] ?? null;
  const retainedAccounts = accounts.filter((account) => /retained[ _-]?earnings/i.test(`${account.statementLine ?? ""} ${account.name}`));
  const retainedEarningsAccount = retainedAccounts.find((account) => !account.entityId) ?? retainedAccounts[0] ?? null;
  const earnings = reconciliation.statements.byCurrency.map((statement) => ({ currency: statement.currency, unclosedMinor: statement.balanceSheet.unclosedEarningsMinor ?? "0", retainedEarningsAccount }));
  const closeEntryPreview = previewRetainedEarningsClose(lines, period, retainedAccounts.map((account) => ({ id: account.id, code: account.code, name: account.name, ...(account.entityId ? { entityId: account.entityId } : {}) })));
  const blockers = [...reconciliation.authority.blockers, ...(!promotion ? ["CFO promotion is required before close."] : []), ...(closeEntryPreview.status === "ready" && !closeEntry ? ["Post the reviewed retained-earnings close entry before closing this period."] : []), ...(closeEntryPreview.status === "blocked" ? closeEntryPreview.blockers : []), ...(closure ? ["Period is already closed."] : [])];
  return { eligible: blockers.length === 0, closed: Boolean(closure), blockers, reconciliation, promotion, closure, closeEntry, earnings, closeEntryPreview };
}

/** Post the exact reviewed close preview under an existing CFO promotion. */
export async function postRetainedEarningsClose(input: { companyId: string; userId: string; period: string }) {
  const state = await loadJournalCloseChecklist(input.companyId, input.period);
  if (state.closed || !state.promotion) return { ok: false as const, blockers: state.closed ? ["Period is already closed."] : ["CFO promotion is required before a close entry can be posted."] };
  if (state.closeEntry) return { ok: true as const, entryId: state.closeEntry.journalEntryId, idempotent: true, calculationRun: null };
  if (state.closeEntryPreview.status !== "ready") return { ok: false as const, blockers: state.closeEntryPreview.blockers.length ? state.closeEntryPreview.blockers : ["There are no remaining P&L balances to close."] };
  if (state.reconciliation.authority.blockers.length) return { ok: false as const, blockers: state.reconciliation.authority.blockers };
  const db = getDatabase();
  const committed = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(journalPeriodCloseEntries).where(and(eq(journalPeriodCloseEntries.companyId, input.companyId), eq(journalPeriodCloseEntries.period, input.period))).limit(1);
    if (existing) return { entryId: existing.journalEntryId, idempotent: true };
    const [batch] = await tx.insert(journalBatches).values({ companyId: input.companyId, label: `Retained earnings close · ${input.period}`, source: "period_close", status: "posted", idempotencyKey: `period-close:${input.period}:${state.promotion!.id}`, postedAt: new Date() }).returning({ id: journalBatches.id });
    const [entry] = await tx.insert(journalEntries).values({ companyId: input.companyId, batchId: batch!.id, postingDate: `${input.period}-01`, period: input.period, memo: `Close income and expense balances to retained earnings for ${input.period}.`, status: "posted", basis: "actual", postedAt: new Date() }).returning({ id: journalEntries.id });
    for (const preview of state.closeEntryPreview.entries) for (const line of preview.lines) {
      const [postedLine] = await tx.insert(journalLines).values({ companyId: input.companyId, entryId: entry!.id, accountId: line.accountId, entityId: line.entityId, currency: line.currency, debitMinor: line.debitMinor, creditMinor: line.creditMinor, externalKey: `${preview.key}:${line.key}`, memo: "Retained earnings period close" }).returning({ id: journalLines.id });
      if (line.upstreamLineIds.length) await tx.insert(journalLineLineage).values(line.upstreamLineIds.map((upstreamJournalLineId) => ({ companyId: input.companyId, journalLineId: postedLine!.id, upstreamJournalLineId, relationship: "period_close" })));
    }
    await tx.insert(journalPeriodCloseEntries).values({ companyId: input.companyId, period: input.period, promotionId: state.promotion!.id, journalEntryId: entry!.id, postedByUserId: input.userId });
    return { entryId: entry!.id, idempotent: false };
  });
  const calculationRun = committed.idempotent ? null : await refreshCurrentCalculationRun(input.companyId, { journalPeriods: [input.period], cause: { kind: "period_closed", subjectType: "reporting_period", subjectId: input.period, actorUserId: input.userId, via: "ui" } });
  return { ok: true as const, ...committed, calculationRun };
}

export async function closeJournalPeriod(input: { companyId: string; userId: string; period: string; note?: string }) {
  const state = await loadJournalCloseChecklist(input.companyId, input.period);
  if (!state.eligible || !state.promotion) return { ok: false as const, blockers: state.blockers };

  const db = getDatabase();
  // The closure, the reporting-period status, and the audit record are one
  // fact about the company: a period is never half closed.
  const { closure, reportingPeriod } = await db.transaction(async (tx) => {
    const [closed] = await tx.insert(journalPeriodClosures).values({
      companyId: input.companyId,
      period: input.period,
      promotionId: state.promotion!.id,
      closedByUserId: input.userId,
      note: input.note,
    }).onConflictDoNothing().returning();
    const [period] = await tx.insert(reportingPeriods).values({
      companyId: input.companyId,
      month: input.period,
      status: "closed",
      closedByUserId: input.userId,
    }).onConflictDoUpdate({
      target: [reportingPeriods.companyId, reportingPeriods.month],
      set: { status: "closed", closedByUserId: input.userId, updatedAt: new Date() },
    }).returning();
    await recordAudit(tx, { companyId: input.companyId, actorUserId: input.userId, via: "ui", action: "period.closed", entityType: "reporting_period", ...(period ? { entityId: period.id } : {}), summary: `Closed reporting period ${input.period}`, after: { period: input.period, ...(input.note ? { note: input.note } : {}) } });
    return { closure: closed ?? null, reportingPeriod: period };
  });
  const calculationRun = await refreshCurrentCalculationRun(input.companyId, { journalPeriods: [input.period], cause: { kind: "period_closed", subjectType: "reporting_period", subjectId: input.period, actorUserId: input.userId, via: "ui" } });
  return { ok: true as const, closure, reportingPeriod, calculationRun };
}
