import type { PostedJournalLine } from "./ledger";

export type CashOccurrence = {
  id: string; key: string; label: string; origin: "driver" | "history";
  driverId: string | null; originalMonth: string; expectedDate: string;
  amountMinor: string; originalAmountMinor: string; currency: string; version: number;
  status: "active" | "cancelled"; final: boolean;
  lines: PostedJournalLine[]; sourceLineIds: string[];
  autoMatchFactId?: string | null;
  recurrencePolicyId?: string; recurrencePolicyVersion?: number; recurrenceRuleVersion?: string;
};
export type CashAllocation = { id: string; occurrenceId: string; actualEntryId: string; amountMinor: string; revoked: boolean };
export type CashActual = { id: string; postingDate: string; currency: string; amountMinor: string; debitAccountId: string; creditAccountId: string; entityId: string | null; reversed: boolean; memo: string; factId?: string | null };
export type CashSettlementInput = { throughDate: string; occurrences: CashOccurrence[]; allocations: CashAllocation[]; actuals: CashActual[] };
export type CashOccurrenceResult = { id: string; allocatedMinor: string; remainingMinor: string; varianceMinor: string; state: "unmatched" | "partial" | "settled" | "cancelled"; overdue: boolean; invalidAllocationIds: string[] };

/** The first supported settlement shape is a balanced, single-currency cash movement.
 * Transfers, split journals and FX require explicit accounting support, never an amount-only guess.
 */
export function cashMovement(lines: PostedJournalLine[]): Omit<CashActual, "id" | "reversed" | "memo"> | null {
  if (lines.length !== 2) return null;
  const [a, b] = lines;
  if (!a || !b || a.accountId === b.accountId || a.currency !== b.currency || a.period !== b.period || a.postingDate !== b.postingDate || (a.entityId ?? null) !== (b.entityId ?? null) || lines.some((line) => line.fxRateId || line.transactionCurrency && line.transactionCurrency !== line.currency)) return null;
  if (lines.some((line) => !/^\d+$/.test(line.debitMinor) || !/^\d+$/.test(line.creditMinor))) return null;
  const debit = lines.find((line) => BigInt(line.debitMinor) > 0n && BigInt(line.creditMinor) === 0n);
  const credit = lines.find((line) => BigInt(line.creditMinor) > 0n && BigInt(line.debitMinor) === 0n);
  if (!debit || !credit || BigInt(debit.debitMinor) !== BigInt(credit.creditMinor)) return null;
  const cash = lines.filter((line) => line.accountType === "asset" && /cash/i.test(line.statementLine ?? line.accountName));
  if (cash.length !== 1) return null;
  return { postingDate: a.postingDate ?? `${a.period}-01`, currency: a.currency, amountMinor: BigInt(debit.debitMinor).toString(), debitAccountId: debit.accountId, creditAccountId: credit.accountId, entityId: a.entityId ?? null };
}

export function compatibleCashMovement(occurrence: CashOccurrence, actual: CashActual): boolean {
  const expected = cashMovement(occurrence.lines);
  return Boolean(expected && !actual.reversed && actual.currency === occurrence.currency && actual.debitAccountId === expected.debitAccountId && actual.creditAccountId === expected.creditAccountId && actual.entityId === expected.entityId);
}

/** Replace identified projections with only their unfulfilled portion. This emits
 * balanced journal lines for the existing calculation engine; it never posts actuals.
 */
export function settleForecastLines(baseLines: PostedJournalLine[], input: CashSettlementInput, horizon: { start: string; end: string }, currency: string) {
  const actualById = new Map(input.actuals.filter((actual) => actual.postingDate <= input.throughDate).map((actual) => [actual.id, actual]));
  const occurrences = new Map(input.occurrences.map((occurrence) => [occurrence.id, occurrence]));
  const active = input.allocations.filter((allocation) => !allocation.revoked);
  const totals = new Map<string, bigint>();
  for (const allocation of active) {
    const actual = actualById.get(allocation.actualEntryId); const occurrence = occurrences.get(allocation.occurrenceId);
    if (actual && occurrence && compatibleCashMovement(occurrence, actual) && /^\d+$/.test(allocation.amountMinor)) totals.set(actual.id, (totals.get(actual.id) ?? 0n) + BigInt(allocation.amountMinor));
  }
  const exceptions: { driverId: string; reason: string }[] = [];
  const occurrenceKeys = new Set(input.occurrences.map((occurrence) => occurrence.key));
  const lines = baseLines.filter((line) => !occurrenceKeys.has(line.entryId ?? line.id));
  const results: CashOccurrenceResult[] = [];
  for (const occurrence of [...input.occurrences].sort((a, b) => a.id.localeCompare(b.id))) {
    const invalidAllocationIds: string[] = []; let allocated = 0n;
    for (const allocation of active.filter((item) => item.occurrenceId === occurrence.id)) {
      const actual = actualById.get(allocation.actualEntryId);
      if (!actual || !compatibleCashMovement(occurrence, actual) || !/^\d+$/.test(allocation.amountMinor) || (totals.get(actual.id) ?? 0n) > BigInt(actual.amountMinor)) { invalidAllocationIds.push(allocation.id); continue; }
      allocated += BigInt(allocation.amountMinor);
    }
    const amount = BigInt(occurrence.amountMinor);
    if (allocated > amount) {
      exceptions.push({ driverId: occurrence.id, reason: `${occurrence.label}: allocations exceed the expected amount; review settlement.` });
      allocated = 0n;
      invalidAllocationIds.push(...active.filter((item) => item.occurrenceId === occurrence.id).map((item) => item.id));
    }
    // A reversal invalidates a previous final settlement too; its shortfall must reopen.
    const final = occurrence.final && invalidAllocationIds.length === 0;
    const remaining = occurrence.status === "cancelled" || final ? 0n : amount - allocated;
    const month = occurrence.expectedDate.slice(0, 7);
    const overdue = remaining > 0n && occurrence.expectedDate < input.throughDate;
    const original = baseLines.filter((line) => (line.entryId ?? line.id) === occurrence.key);
    const currentMovement = cashMovement(original);
    const reviewedMovement = cashMovement(occurrence.lines);
    if (original.length && (!currentMovement || !reviewedMovement || currentMovement.amountMinor !== occurrence.amountMinor || currentMovement.currency !== reviewedMovement.currency || currentMovement.debitAccountId !== reviewedMovement.debitAccountId || currentMovement.creditAccountId !== reviewedMovement.creditAccountId || currentMovement.entityId !== reviewedMovement.entityId)) exceptions.push({ driverId: occurrence.id, reason: `${occurrence.label}: the driver changed after this occurrence was reviewed. Revise the occurrence explicitly.` });
    if (invalidAllocationIds.length) exceptions.push({ driverId: occurrence.id, reason: `${occurrence.label}: an allocated actual was reversed, changed, or is outside the cutoff; its balance has reopened.` });
    if (remaining > 0n && month < horizon.start) exceptions.push({ driverId: occurrence.id, reason: `${occurrence.label}: ${remaining} minor units are overdue in a prior month. Reschedule or resolve them; they have not been silently moved into this month.` });
    if (occurrence.currency !== currency) exceptions.push({ driverId: occurrence.id, reason: `${occurrence.label}: expectation currency differs from the reporting currency; conversion requires review.` });
    if (remaining > 0n && month >= horizon.start && month <= horizon.end && occurrence.currency === currency) {
      if (!cashMovement(occurrence.lines)) exceptions.push({ driverId: occurrence.id, reason: `${occurrence.label}: unsupported cash settlement shape.` });
      else for (const [index, line] of occurrence.lines.entries()) {
        lines.push({ ...line, id: `expectation:${occurrence.id}:${index}`, entryId: `expectation:${occurrence.id}`, entrySource: "approved_expectation", basis: "forecast", period: month, postingDate: occurrence.expectedDate, debitMinor: BigInt(line.debitMinor) > 0n ? remaining.toString() : "0", creditMinor: BigInt(line.creditMinor) > 0n ? remaining.toString() : "0", provenance: { ...line.provenance, sourceLocation: `expectation:${occurrence.id}:v${occurrence.version}` } });
      }
    }
    results.push({ id: occurrence.id, allocatedMinor: allocated.toString(), remainingMinor: remaining.toString(), varianceMinor: (final || allocated === amount) && occurrence.status !== "cancelled" ? (allocated - BigInt(occurrence.originalAmountMinor)).toString() : "0", state: occurrence.status === "cancelled" ? "cancelled" : remaining === 0n ? "settled" : allocated > 0n ? "partial" : "unmatched", overdue, invalidAllocationIds });
  }
  return { lines, results, exceptions };
}
