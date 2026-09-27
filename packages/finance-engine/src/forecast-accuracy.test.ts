import { assessForecastAccuracy } from "./forecast-accuracy";
import { describe, expect, it } from "vitest";
import { type CashActual, type CashOccurrence, type CashSettlementInput } from "./forecast-settlement";
import type { PostedJournalLine } from "./ledger";

const lines: PostedJournalLine[] = [
  { id: "cash-line", entryId: "projection:receipt:base:2026-09", accountId: "cash", accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit", currency: "USD", period: "2026-09", postingDate: "2026-09-15", debitMinor: "10000000", creditMinor: "0", basis: "forecast" },
  { id: "offset-line", entryId: "projection:receipt:base:2026-09", accountId: "receivable", accountCode: "1100", accountName: "Receivable", accountType: "asset", normalBalance: "debit", currency: "USD", period: "2026-09", postingDate: "2026-09-15", debitMinor: "0", creditMinor: "10000000", basis: "forecast" },
];
const occurrence: CashOccurrence = { id: "expected", key: lines[0]!.entryId!, label: "Customer receipt", origin: "driver", driverId: "receipt", originalMonth: "2026-09", expectedDate: "2026-09-15", amountMinor: "10000000", originalAmountMinor: "10000000", currency: "USD", version: 1, status: "active", final: false, lines, sourceLineIds: [] };
const actual: CashActual = { id: "actual", postingDate: "2026-09-15", currency: "USD", amountMinor: "6000000", debitAccountId: "cash", creditAccountId: "receivable", entityId: null, reversed: false, memo: "Customer installment" };
const base: CashSettlementInput = { throughDate: "2026-09-25", occurrences: [occurrence], allocations: [{ id: "allocation", occurrenceId: occurrence.id, actualEntryId: actual.id, amountMinor: "6000000", revoked: false }], actuals: [actual] };
describe("preserved forecast accuracy", () => {
  const assess = (current = base, capturedAt = "2026-09-01T12:00:00Z") => assessForecastAccuracy({ baselineId: "plan", capturedAt, expectations: [occurrence], current, currency: "USD", limitations: [] });
  it("does not score outstanding or partial receipts as zero", () => { const output = assess(); expect(output.sampleCount).toBe(0); expect(output.pendingCount).toBe(1); expect(output.rows[0]?.amountErrorMinor).toBeNull(); });
  it("measures an explicitly final short payment and its date separately", () => {
    const output = assess({ ...base, occurrences: [{ ...occurrence, final: true }], actuals: [{ ...actual, postingDate: "2026-09-20" }] });
    expect(output.rows[0]).toMatchObject({ status: "measured", amountErrorMinor: "-4000000", cashOptimismMinor: "4000000", timingErrorDays: 5 }); expect(output.weightedAbsoluteErrorBasisPoints).toBe("4000");
  });
  it("excludes retrospective forecasts and reversed allocations", () => { expect(assess(base, "2026-09-16T12:00:00Z").excludedCount).toBe(1); expect(assess({ ...base, actuals: [{ ...actual, reversed: true }] }).excludedCount).toBe(1); });
});
