import { cashFlag } from "./cash-flag";
import { cashMovement, compatibleCashMovement, settleForecastLines, type CashOccurrence, type CashSettlementInput } from "./forecast-settlement";
export type ForecastAccuracyInput = { baselineId: string; capturedAt: string; expectations: CashOccurrence[]; current: CashSettlementInput; currency: string; limitations: string[] };
/** Only preserved pre-event identities and explicitly allocated actuals form scored observations. */
export function assessForecastAccuracy(input: ForecastAccuracyInput) {
  const capturedDate = input.capturedAt.slice(0, 10);
  const currentResults = settleForecastLines([], input.current, { start: input.current.throughDate.slice(0, 7), end: input.current.throughDate.slice(0, 7) }, input.currency).results;
  const rows = input.expectations.map((baseline) => {
    const occurrence = input.current.occurrences.find((item) => item.id === baseline.id); const result = currentResults.find((item) => item.id === baseline.id);
    const allocations = input.current.allocations.filter((item) => item.occurrenceId === baseline.id && !item.revoked);
    const payments = allocations.flatMap((allocation) => { const actual = input.current.actuals.find((item) => item.id === allocation.actualEntryId); return actual && actual.postingDate <= input.current.throughDate && compatibleCashMovement(baseline, actual) ? [{ actualId: actual.id, date: actual.postingDate, amountMinor: allocation.amountMinor, allocationId: allocation.id }] : []; }).sort((a, b) => a.date.localeCompare(b.date) || a.actualId.localeCompare(b.actualId));
    const reasons: string[] = [];
    if (baseline.currency !== input.currency) reasons.push("Unsupported currency.");
    if (capturedDate >= baseline.expectedDate || payments.some((payment) => payment.date <= capturedDate)) reasons.push("This baseline was not preserved before the expected event and its actual payments.");
    if (!occurrence || occurrence.status === "cancelled") reasons.push("The obligation is absent or cancelled; cancellation is not an amount-accuracy observation.");
    if (result?.invalidAllocationIds.length || payments.length !== allocations.length) reasons.push("Some allocations are reversed, unavailable or have changed accounting treatment.");
    const measurable = reasons.length === 0 && result?.state === "settled";
    const actualMinor = payments.reduce((sum, payment) => sum + BigInt(payment.amountMinor), 0n);
    const amountErrorMinor = measurable ? String(actualMinor - BigInt(baseline.amountMinor)) : null;
    const expectedMovement = cashMovement(baseline.lines); const cash = baseline.lines.find((line) => line.accountType === "asset" && cashFlag(line, () => /cash/i.test(line.statementLine ?? line.accountName)));
    const receipt = expectedMovement?.debitAccountId === cash?.accountId;
    const lastPayment = payments.at(-1)?.date ?? null;
    const timingErrorDays = measurable && lastPayment ? Math.round((Date.parse(lastPayment) - Date.parse(baseline.expectedDate)) / 86400000) : null;
    return { id: baseline.id, driverId: baseline.driverId, label: baseline.label, expectedDate: baseline.expectedDate, expectedMinor: baseline.amountMinor, actualMinor: String(actualMinor), finalPaymentDate: lastPayment, amountErrorMinor, cashOptimismMinor: amountErrorMinor === null ? null : String((receipt ? -1n : 1n) * BigInt(amountErrorMinor)), timingErrorDays, status: reasons.length ? "excluded" as const : measurable ? "measured" as const : "pending" as const, reasons, payments, originalSourceLineIds: baseline.sourceLineIds };
  });
  const measured = rows.filter((row) => row.status === "measured");
  const absoluteError = measured.reduce((sum, row) => sum + (BigInt(row.amountErrorMinor!) < 0n ? -BigInt(row.amountErrorMinor!) : BigInt(row.amountErrorMinor!)), 0n);
  const denominator = measured.reduce((sum, row) => sum + BigInt(row.expectedMinor), 0n);
  const groups = [...new Set(measured.map((row) => row.driverId).filter((id): id is string => !!id))].map((driverId) => { const own = measured.filter((row) => row.driverId === driverId); return { driverId, sampleCount: own.length, lateCount: own.filter((row) => (row.timingErrorDays ?? 0) > 0).length, cashOptimismMinor: String(own.reduce((sum, row) => sum + BigInt(row.cashOptimismMinor!), 0n)), observation: own.length < 3 ? "Too few completed observations to describe a repeated pattern." : "Review repeated timing or amount errors before changing the assumption; no automatic recalibration." }; });
  return { formulaVersion: "preserved-expectation-accuracy-2026-09-26.1", formula: "amount error = allocated final actual - preserved expected; timing error = final payment date - preserved expected date; weighted absolute error = sum(abs(amount error))/sum(expected)", baselineId: input.baselineId, throughDate: input.current.throughDate, currency: input.currency, rows, groups, sampleCount: measured.length, pendingCount: rows.filter((row) => row.status === "pending").length, excludedCount: rows.filter((row) => row.status === "excluded").length, weightedAbsoluteErrorBasisPoints: denominator ? String(absoluteError * 10000n / denominator) : null, absoluteErrorMinor: String(absoluteError), cashOptimismMinor: String(measured.reduce((sum, row) => sum + BigInt(row.cashOptimismMinor!), 0n)), limitations: [...input.limitations, "Only explicitly matched, completed obligations preserved before their events are scored. Unmatched or partial obligations are not treated as zero actuals.", ...(measured.length < 3 ? ["Fewer than three completed observations: insufficient history for a repeated-pattern conclusion."] : [])], inputs: input };
}
