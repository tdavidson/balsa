import { suggestCashMatches } from "./forecast-match-suggestions";
import { describe, expect, it } from "vitest";
import { settleForecastLines, type CashActual, type CashOccurrence, type CashSettlementInput } from "./forecast-settlement";
import type { PostedJournalLine } from "./ledger";

const lines: PostedJournalLine[] = [
  { id: "cash-line", entryId: "projection:receipt:base:2026-09", accountId: "cash", accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit", currency: "USD", period: "2026-09", postingDate: "2026-09-15", debitMinor: "10000000", creditMinor: "0", basis: "forecast" },
  { id: "offset-line", entryId: "projection:receipt:base:2026-09", accountId: "receivable", accountCode: "1100", accountName: "Receivable", accountType: "asset", normalBalance: "debit", currency: "USD", period: "2026-09", postingDate: "2026-09-15", debitMinor: "0", creditMinor: "10000000", basis: "forecast" },
];
const occurrence: CashOccurrence = { id: "expected", key: lines[0]!.entryId!, label: "Customer receipt", origin: "driver", driverId: "receipt", originalMonth: "2026-09", expectedDate: "2026-09-15", amountMinor: "10000000", originalAmountMinor: "10000000", currency: "USD", version: 1, status: "active", final: false, lines, sourceLineIds: [] };
const actual: CashActual = { id: "actual", postingDate: "2026-09-15", currency: "USD", amountMinor: "6000000", debitAccountId: "cash", creditAccountId: "receivable", entityId: null, reversed: false, memo: "Customer installment" };
const base: CashSettlementInput = { throughDate: "2026-09-25", occurrences: [occurrence], allocations: [{ id: "allocation", occurrenceId: occurrence.id, actualEntryId: actual.id, amountMinor: "6000000", revoked: false }], actuals: [actual] };
const suggestions = (input: CashSettlementInput) => suggestCashMatches(input, settleForecastLines(lines, input, { start: "2026-09", end: "2026-12" }, "USD").results);

describe("reviewed cash match suggestions", () => {
  it("never proposes already allocated capacity or reversed cash", () => {
    expect(suggestions(base)).toEqual([]);
    expect(suggestions({ ...base, allocations: [], actuals: [{ ...actual, reversed: true }] })).toEqual([]);
    expect(suggestions({ ...base, allocations: [], actuals: [{ ...actual, currency: "EUR" }] })).toEqual([]);
    expect(suggestions({ ...base, allocations: [], actuals: [{ ...actual, entityId: "another" }] })).toEqual([]);
  });
  it("shows ambiguity without auto-matching identical obligations", () => {
    const input = { ...base, allocations: [], occurrences: [occurrence, { ...occurrence, id: "another", key: "another" }] };
    const result = suggestions(input); expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ automatic: false, proposedMinor: "6000000", competingOccurrenceIds: ["another"] });
    expect(result[1]?.competingOccurrenceIds).toEqual([occurrence.id]);
  });
  it("proposes only the available partial balance and excludes future actuals", () => {
    const input = { ...base, actuals: [{ ...actual, amountMinor: "8000000" }] };
    expect(suggestions(input)[0]).toMatchObject({ availableMinor: "2000000", proposedMinor: "2000000", automatic: false });
    expect(suggestions({ ...input, actuals: [{ ...actual, postingDate: "2026-10-01" }] })).toEqual([]);
  });
});
