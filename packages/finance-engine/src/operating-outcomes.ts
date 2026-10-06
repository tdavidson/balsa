import { formatDecimal, parseDecimal } from "./forecast-model";
import {
  settleForecastLines,
  type CashSettlementInput,
} from "./forecast-settlement";

export const operatingOutcomeVersion = "operating-outcomes-2026-10-05.1";

/** Values remain exact decimal strings. Missing or withdrawn evidence is never zero. */
export function compareOperatingObservation(
  predicted: string,
  observed: string | null,
  coverage: "partial" | "complete" | "missing" | "unavailable",
) {
  const expected = parseDecimal(predicted);
  const actual = observed === null ? null : parseDecimal(observed);
  if (expected === null || (observed !== null && actual === null))
    throw new Error("Invalid operating observation value.");
  const usable = coverage === "partial" || coverage === "complete";
  return {
    predicted,
    observed: usable ? observed : null,
    difference:
      usable && actual !== null ? formatDecimal(actual - expected) : null,
    coverage,
    provisional: coverage !== "complete",
  };
}

export type OperatingCashBinding = {
  nodeId: string;
  month: string;
  driverId: string;
  amountMinor: string;
};

/** Read only: the settlement engine decides which allocations remain valid. */
export function observeOperatingCash(
  bindings: OperatingCashBinding[],
  input: CashSettlementInput,
  currency: string,
) {
  const settled = settleForecastLines(
    [],
    input,
    {
      start: input.throughDate.slice(0, 7),
      end: input.throughDate.slice(0, 7),
    },
    currency,
  );
  return bindings.map((binding) => {
    const occurrences = input.occurrences.filter(
      (o) =>
        o.driverId === binding.driverId && o.originalMonth === binding.month,
    );
    const payments = occurrences.flatMap((occurrence) => {
      const result = settled.results.find((r) => r.id === occurrence.id)!;
      return input.allocations
        .filter(
          (a) =>
            a.occurrenceId === occurrence.id &&
            !a.revoked &&
            !result.invalidAllocationIds.includes(a.id),
        )
        .flatMap((allocation) => {
          const actual = input.actuals.find(
            (a) => a.id === allocation.actualEntryId,
          );
          return actual && actual.postingDate <= input.throughDate
            ? [
                {
                  allocationId: allocation.id,
                  entryId: actual.id,
                  date: actual.postingDate,
                  amountMinor: allocation.amountMinor,
                },
              ]
            : [];
        });
    });
    payments.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.allocationId.localeCompare(b.allocationId),
    );
    const received = payments.reduce(
      (sum, p) => sum + BigInt(p.amountMinor),
      0n,
    );
    const invalidAllocationIds = occurrences.flatMap(
      (o) => settled.results.find((r) => r.id === o.id)!.invalidAllocationIds,
    );
    return {
      ...binding,
      observedMinor: payments.length ? String(received) : null,
      differenceMinor: payments.length
        ? String(received - BigInt(binding.amountMinor))
        : null,
      payments,
      invalidAllocationIds,
      occurrences: occurrences.map((o) => ({
        version: o.version,
        expectedDate: o.expectedDate,
        ...settled.results.find((r) => r.id === o.id)!,
      })),
      status: !occurrences.length
        ? "not_reconciled"
        : invalidAllocationIds.length
          ? "needs_review"
          : occurrences.every(
                (o) =>
                  settled.results.find((r) => r.id === o.id)!.state ===
                  "settled",
              )
            ? "settled"
            : occurrences.some((o) => o.status === "cancelled")
              ? "cancelled"
              : payments.length
                ? "partial"
                : "unmatched",
    };
  });
}
