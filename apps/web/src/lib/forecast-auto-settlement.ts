import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { evidence, factRecords, forecastOccurrences, forecastSettlementAllocations, recordAudit } from "@finance/database";
import { compatibleCashMovement, settleForecastLines, type CashSettlementInput } from "@balsa/finance-engine";
import type { DbTransaction } from "./db-executor";

export const autoSettlementRuleVersion = "exact-source-fact-2026-09-25.1";

/** Only an explicitly approved, one-off source-fact rule may allocate automatically.
 * Every journal line must name that fact. Ambiguity, excess amounts and reversals
 * remain review work. Account shapes and generic descriptions never establish identity.
 */
export async function applyApprovedAutoSettlements(tx: DbTransaction, companyId: string, input: CashSettlementInput, currency: string) {
  if (!input.occurrences.some((occurrence) => occurrence.autoMatchFactId)) return false;
  await tx.execute(sql`select pg_advisory_xact_lock(7406, hashtext(${companyId}))`);
  const approvedFacts = new Set((await tx.select({ id: factRecords.id }).from(factRecords).innerJoin(evidence, and(eq(evidence.id, factRecords.evidenceId), eq(evidence.companyId, companyId))).where(and(eq(factRecords.companyId, companyId), eq(factRecords.status, "approved"), eq(evidence.status, "approved")))).map((fact) => fact.id));
  const states = settleForecastLines([], input, { start: input.throughDate.slice(0, 7), end: input.throughDate.slice(0, 7) }, currency).results;
  const used = new Set(input.allocations.filter((allocation) => !allocation.revoked).map((allocation) => allocation.actualEntryId));
  let changed = false;
  for (const occurrence of input.occurrences) {
    if (!occurrence.autoMatchFactId || !approvedFacts.has(occurrence.autoMatchFactId) || occurrence.status !== "active" || occurrence.final || occurrence.currency !== currency) continue;
    if (input.occurrences.filter((other) => other.status === "active" && other.autoMatchFactId === occurrence.autoMatchFactId).length !== 1) continue;
    const state = states.find((item) => item.id === occurrence.id)!;
    if (state.invalidAllocationIds.length || BigInt(state.remainingMinor) <= 0n) continue;
    const rejected = new Set(input.allocations.filter((allocation) => allocation.revoked && allocation.occurrenceId === occurrence.id).map((allocation) => allocation.actualEntryId));
    const matches = input.actuals.filter((actual) => !used.has(actual.id) && !rejected.has(actual.id) && actual.factId === occurrence.autoMatchFactId && actual.postingDate <= input.throughDate && compatibleCashMovement(occurrence, actual));
    const total = matches.reduce((sum, actual) => sum + BigInt(actual.amountMinor), 0n);
    if (!matches.length || total > BigInt(state.remainingMinor)) continue;
    const [updated] = await tx.update(forecastOccurrences).set({ version: occurrence.version + 1 }).where(and(eq(forecastOccurrences.companyId, companyId), eq(forecastOccurrences.id, occurrence.id), eq(forecastOccurrences.version, occurrence.version))).returning({ id: forecastOccurrences.id });
    // A reviewer won the race. A later revision's job will recompute its approved policy.
    if (!updated) continue;
    const allocations = await tx.insert(forecastSettlementAllocations).values(matches.map((actual) => ({ companyId, occurrenceId: occurrence.id, actualEntryId: actual.id, amountMinor: actual.amountMinor }))).returning({ id: forecastSettlementAllocations.id });
    await recordAudit(tx, { companyId, actorUserId: null, via: "worker", action: "forecast.auto_allocated", entityType: "forecast_occurrence", entityId: occurrence.id, summary: "Allocated actual cash under an approved exact source-fact rule", before: { version: occurrence.version, remainingMinor: state.remainingMinor }, after: { ruleVersion: autoSettlementRuleVersion, factId: occurrence.autoMatchFactId, allocationIds: allocations.map((allocation) => allocation.id), actualEntryIds: matches.map((actual) => actual.id), amountMinor: total.toString(), version: occurrence.version + 1 } });
    matches.forEach((actual) => used.add(actual.id)); changed = true;
  }
  return changed;
}
