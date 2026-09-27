import type { journalEntries, journalLines } from "@finance/database";
import type { JournalPostingRequest } from "./journal-posting";
/** Preserve the original basis, treatment and lineage so settlement can reopen reversed actuals. */
export function journalReversalRequest(entry: typeof journalEntries.$inferSelect, lines: (typeof journalLines.$inferSelect)[], correction: { postingDate: string; period: string; memo: string }, actorUserId?: string): JournalPostingRequest {
  const basis = entry.basis as JournalPostingRequest["basis"];
  return {
    ...(actorUserId ? { actorUserId } : {}), idempotencyKey: `reversal:${entry.id}:${correction.period}`, label: `Reversal of ${entry.memo}`, source: "journal_reversal", ...correction,
    ...(basis ? { basis } : {}), reversalOfEntryId: entry.id, ...(entry.scenarioId ? { scenarioId: entry.scenarioId } : {}), ...(entry.entityId ? { entityId: entry.entityId } : {}),
    lines: lines.map((line) => ({ accountId: line.accountId, ...(line.entityId ? { entityId: line.entityId } : {}), currency: line.currency, debitMinor: line.creditMinor, creditMinor: line.debitMinor, externalKey: `reversal:${line.id}`,
      ...(line.transactionCurrency ? { transactionCurrency: line.transactionCurrency } : {}), ...(line.transactionCreditMinor != null ? { transactionDebitMinor: line.transactionCreditMinor } : {}), ...(line.transactionDebitMinor != null ? { transactionCreditMinor: line.transactionDebitMinor } : {}), ...(line.fxRateId ? { fxRateId: line.fxRateId } : {}),
      ...(line.sourceId ? { sourceId: line.sourceId } : {}), ...(line.sourceRowId ? { sourceRowId: line.sourceRowId } : {}), ...(line.evidenceId ? { evidenceId: line.evidenceId } : {}), ...(line.factId ? { factId: line.factId } : {}), ...(line.decisionId ? { decisionId: line.decisionId } : {}), ...(line.policyId ? { policyId: line.policyId } : {}), ...(line.approvalEventId ? { approvalEventId: line.approvalEventId } : {}), ...(line.sourceLocation ? { sourceLocation: line.sourceLocation } : {}), memo: `Reversal: ${line.memo ?? entry.memo}` })),
  };
}
