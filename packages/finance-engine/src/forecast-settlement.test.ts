import { describe, expect, it } from "vitest";
import { cashMovement, settleForecastLines, type CashActual, type CashOccurrence, type CashSettlementInput } from "./forecast-settlement";
import type { PostedJournalLine } from "./ledger";

const lines: PostedJournalLine[] = [
  { id: "cash-line", entryId: "projection:receipt:base:2026-09", accountId: "cash", accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit", currency: "USD", period: "2026-09", postingDate: "2026-09-15", debitMinor: "10000000", creditMinor: "0", basis: "forecast" },
  { id: "offset-line", entryId: "projection:receipt:base:2026-09", accountId: "receivable", accountCode: "1100", accountName: "Receivable", accountType: "asset", normalBalance: "debit", currency: "USD", period: "2026-09", postingDate: "2026-09-15", debitMinor: "0", creditMinor: "10000000", basis: "forecast" },
];
const occurrence: CashOccurrence = { id: "expected", key: lines[0]!.entryId!, label: "Customer receipt", origin: "driver", driverId: "receipt", originalMonth: "2026-09", expectedDate: "2026-09-15", amountMinor: "10000000", originalAmountMinor: "10000000", currency: "USD", version: 1, status: "active", final: false, lines, sourceLineIds: [] };
const actual: CashActual = { id: "actual", postingDate: "2026-09-15", currency: "USD", amountMinor: "6000000", debitAccountId: "cash", creditAccountId: "receivable", entityId: null, reversed: false, memo: "Customer installment" };
const base: CashSettlementInput = { throughDate: "2026-09-25", occurrences: [occurrence], allocations: [{ id: "allocation", occurrenceId: occurrence.id, actualEntryId: actual.id, amountMinor: "6000000", revoked: false }], actuals: [actual] };
const settle = (input: CashSettlementInput, baseline = lines, start = "2026-09") => settleForecastLines(baseline, input, { start, end: "2026-12" }, "USD");

describe("forecast cash settlement", () => {
  it("reduces only the settled portion and keeps balanced remaining journal lines", () => {
    const result = settle(base);
    expect(result.results[0]).toMatchObject({ allocatedMinor: "6000000", remainingMinor: "4000000", state: "partial" });
    expect(result.lines.map((line) => [line.debitMinor, line.creditMinor])).toEqual([["4000000", "0"], ["0", "4000000"]]);
    expect(result.lines.every((line) => line.entrySource === "approved_expectation")).toBe(true);
  });
  it("surfaces changed account treatment even when the amount stays the same", () => {
    const changed = lines.map((line) => line.accountId === "receivable" ? { ...line, accountId: "revenue" } : line);
    expect(settle(base, changed).exceptions.some((item) => item.reason.includes("driver changed"))).toBe(true);
  });
  it("never suppresses an unrelated obligation using the same accounts", () => {
    const other = lines.map((line) => ({ ...line, id: `other:${line.id}`, entryId: "other" }));
    expect(settle(base, [...lines, ...other]).lines.filter((line) => line.entryId === "other")).toEqual(other);
  });
  it("supports split payments and combined actuals without allocating the same cash twice", () => {
    const full = settle({ ...base, actuals: [actual, { ...actual, id: "second", amountMinor: "4000000" }], allocations: [...base.allocations, { ...base.allocations[0]!, id: "second-allocation", actualEntryId: "second", amountMinor: "4000000" }] });
    expect(full.lines).toHaveLength(0); expect(full.results[0]?.state).toBe("settled");
    const other = { ...occurrence, id: "other", key: "other", amountMinor: "3000000", originalAmountMinor: "3000000" };
    const over = settle({ ...base, occurrences: [occurrence, other], allocations: [...base.allocations, { ...base.allocations[0]!, id: "over", occurrenceId: "other", amountMinor: "1" }] });
    expect(over.results.every((item) => item.allocatedMinor === "0")).toBe(true);
    expect(over.exceptions).toHaveLength(2);
  });
  it("records final shortfall but reopens it if the actual is reversed", () => {
    const final = { ...base, occurrences: [{ ...occurrence, final: true }] };
    expect(settle(final).results[0]).toMatchObject({ remainingMinor: "0", varianceMinor: "-4000000", state: "settled" });
    const reversed = settle({ ...final, actuals: [{ ...actual, reversed: true }] });
    expect(reversed.results[0]).toMatchObject({ remainingMinor: "10000000", state: "unmatched", invalidAllocationIds: ["allocation"] });
  });
  it("retains the original amount when an excess payment is explicitly incorporated", () => {
    const adjusted = settle({ ...base, occurrences: [{ ...occurrence, amountMinor: "11000000", final: true }], actuals: [{ ...actual, amountMinor: "11000000" }], allocations: [{ ...base.allocations[0]!, amountMinor: "11000000" }] });
    expect(adjusted.results[0]?.varianceMinor).toBe("1000000");
  });
  it("moves only the remaining cash effect and preserves overdue identities across month rollover", () => {
    expect(settle({ ...base, occurrences: [{ ...occurrence, expectedDate: "2026-11-15" }] }).lines.every((line) => line.period === "2026-11")).toBe(true);
    const overdue = settle({ ...base, throughDate: "2026-10-02" }, [], "2026-10");
    expect(overdue.results[0]).toMatchObject({ overdue: true, remainingMinor: "4000000" });
    expect(overdue.lines).toHaveLength(0); expect(overdue.exceptions[0]?.reason).toContain("Reschedule");
  });
  it("honors the cutoff, revocation, and cancellation without deleting history", () => {
    expect(settle({ ...base, throughDate: "2026-09-14" }).results[0]?.allocatedMinor).toBe("0");
    expect(settle({ ...base, allocations: [{ ...base.allocations[0]!, revoked: true }] }).results[0]?.remainingMinor).toBe("10000000");
    expect(settle({ ...base, occurrences: [{ ...occurrence, status: "cancelled" }] }).results[0]).toMatchObject({ state: "cancelled", allocatedMinor: "6000000", remainingMinor: "0" });
  });
  it("rejects transfers, FX, unbalanced or split shapes, and mismatched recognition treatment", () => {
    expect(cashMovement([...lines, lines[0]!])).toBeNull();
    expect(cashMovement(lines.map((line) => ({ ...line, fxRateId: "rate" })))).toBeNull();
    expect(cashMovement([lines[0]!, { ...lines[1]!, accountName: "Other Cash" }])).toBeNull();
    expect(settle({ ...base, actuals: [{ ...actual, creditAccountId: "revenue" }] }).results[0]?.allocatedMinor).toBe("0");
    const foreign = settle({ ...base, occurrences: [{ ...occurrence, currency: "EUR" }] });
    expect(foreign.lines).toHaveLength(0); expect(foreign.exceptions.some((item) => item.reason.includes("currency"))).toBe(true);
  });
});
