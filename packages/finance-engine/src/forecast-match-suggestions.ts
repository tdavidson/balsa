import { compatibleCashMovement, type CashOccurrenceResult, type CashSettlementInput } from "./forecast-settlement";
/** Candidate ranking supports a human review; none of these signals establishes identity. */
export function suggestCashMatches(input: CashSettlementInput, results: CashOccurrenceResult[]) {
  const pairs = input.occurrences.flatMap((occurrence) => {
    const result = results.find((item) => item.id === occurrence.id);
    if (occurrence.status !== "active" || occurrence.final || !result || BigInt(result.remainingMinor) <= 0n) return [];
    return input.actuals.flatMap((actual) => {
      if (!compatibleCashMovement(occurrence, actual) || actual.postingDate > input.throughDate) return [];
      const allocated = input.allocations.filter((item) => !item.revoked && item.actualEntryId === actual.id).reduce((sum, item) => sum + BigInt(item.amountMinor), 0n);
      const available = BigInt(actual.amountMinor) - allocated;
      const days = Math.abs(Date.parse(`${actual.postingDate}T00:00:00Z`) - Date.parse(`${occurrence.expectedDate}T00:00:00Z`)) / 86400000;
      if (available <= 0n || !Number.isFinite(days) || days > 90) return [];
      const words = new Set(occurrence.label.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3));
      const descriptionOverlap = actual.memo.toLowerCase().split(/[^a-z0-9]+/).some((word) => words.has(word));
      const sameRemainingAmount = available === BigInt(result.remainingMinor);
      return [{ occurrenceId: occurrence.id, actualEntryId: actual.id, availableMinor: available.toString(), proposedMinor: (available < BigInt(result.remainingMinor) ? available : BigInt(result.remainingMinor)).toString(), daysApart: days, descriptionOverlap, sameRemainingAmount, reasons: ["Same currency, entity and accounting treatment", `${days} days from expected date`, ...(sameRemainingAmount ? ["Available actual equals outstanding estimate"] : ["Amount requires partial-allocation review"]), ...(descriptionOverlap ? ["Description contains a shared word"] : [])] }];
    });
  });
  return pairs.map((pair) => ({ ...pair, competingOccurrenceIds: pairs.filter((other) => other.actualEntryId === pair.actualEntryId && other.occurrenceId !== pair.occurrenceId).map((other) => other.occurrenceId), automatic: false as const })).sort((a, b) => Number(b.sameRemainingAmount) - Number(a.sameRemainingAmount) || Number(b.descriptionOverlap) - Number(a.descriptionOverlap) || a.daysApart - b.daysApart || a.actualEntryId.localeCompare(b.actualEntryId));
}
