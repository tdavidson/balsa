import { describe, expect, it } from "vitest";
import { buildProjectedEntries, type ForecastDriver } from "./forecast-projections";

describe("buildProjectedEntries", () => {
  it("expands one approved driver into balanced monthly forecast entries", () => {
    const output = buildProjectedEntries([{ id: "fee", label: "Retainer", itemType: "agreement", direction: "receipt", category: "management_fee", amountMinor: "125000", cadence: "monthly", effectiveFrom: "2026-09" }], [{ id: "fee-template", itemType: "agreement", direction: "receipt", category: "management_fee", debitAccountId: "cash", creditAccountId: "revenue" }], { start: "2026-09", end: "2026-11" });
    expect(output.exceptions).toEqual([]); expect(output.entries).toHaveLength(3); expect(output.entries[0]).toMatchObject({ period: "2026-09", basis: "forecast", lines: [{ accountId: "cash", debitMinor: "125000" }, { accountId: "revenue", creditMinor: "125000" }] });
    expect(output.entries[0]!.projectionKey).toBe("projection:fee:base:2026-09");
  });
  it("keeps an unmapped driver as an exception", () => expect(buildProjectedEntries([{ id: "fee", label: "Retainer", itemType: "agreement", direction: "receipt", amountMinor: "1", cadence: "once", effectiveFrom: "2026-09" }], [], { start: "2026-09", end: "2026-09" }).exceptions).toEqual([{ driverId: "fee", reason: "Driver has no approved forecast-entry template." }]));
  it("changes the immutable posting version when a driver amount changes", () => {
    const driver = { id: "fee", label: "Retainer", itemType: "agreement" as const, direction: "receipt" as const, amountMinor: "100", cadence: "once" as const, effectiveFrom: "2026-09" };
    const template = { id: "template", itemType: "agreement" as const, direction: "receipt" as const, debitAccountId: "cash", creditAccountId: "revenue" };
    const original = buildProjectedEntries([driver], [template], { start: "2026-09", end: "2026-09" }).entries[0]!;
    const changed = buildProjectedEntries([{ ...driver, amountMinor: "200" }], [template], { start: "2026-09", end: "2026-09" }).entries[0]!;
    expect(changed.projectionKey).toBe(original.projectionKey);
    expect(changed.idempotencyKey).not.toBe(original.idempotencyKey);
  });
});
describe("formula drivers", () => {
  const template = { id: "spend", itemType: "obligation" as const, direction: "spend" as const, debitAccountId: "payroll", creditAccountId: "cash" };
  const formulaDriver = (amountByMonth: Record<string, string>, cadence: ForecastDriver["cadence"] = "monthly"): ForecastDriver => ({ id: "f", label: "Payroll", itemType: "obligation", direction: "spend", amountMinor: "", amountFormula: "sum(payroll)", amountByMonth, cadence, effectiveFrom: "2026-09" });

  it("posts each month's formula amount and skips zero or missing months", () => {
    const output = buildProjectedEntries([formulaDriver({ "2026-09": "100", "2026-10": "0", "2026-11": "250" })], [template], { start: "2026-09", end: "2026-12" });
    expect(output.exceptions).toEqual([]);
    expect(output.entries.map((entry) => [entry.period, entry.lines[0]!.debitMinor, entry.lines[1]!.creditMinor])).toEqual([["2026-09", "100", "100"], ["2026-11", "250", "250"]]);
    expect(output.entries[0]!.idempotencyKey).toBe("projection:f:base:2026-09:spend:payroll:cash:100");
  });

  it("lets the cadence choose the months", () => {
    const output = buildProjectedEntries([formulaDriver({ "2026-09": "1", "2026-10": "2", "2026-11": "3", "2026-12": "4" }, "quarterly")], [template], { start: "2026-09", end: "2026-12" });
    expect(output.entries.map((entry) => [entry.period, entry.lines[0]!.debitMinor])).toEqual([["2026-09", "1"], ["2026-12", "4"]]);
  });

  it("turns a negative or invalid month into an exception with no entries", () => {
    expect(buildProjectedEntries([formulaDriver({ "2026-09": "100", "2026-10": "-5" })], [template], { start: "2026-09", end: "2026-10" })).toEqual({ entries: [], exceptions: [{ driverId: "f", reason: "Formula amount for 2026-10 is negative." }] });
    expect(buildProjectedEntries([formulaDriver({ "2026-09": "error" })], [template], { start: "2026-09", end: "2026-10" })).toEqual({ entries: [], exceptions: [{ driverId: "f", reason: "Formula amount for 2026-09 is invalid." }] });
  });

  it("refuses a formula driver that was never resolved", () => {
    const { amountByMonth: _unused, ...unresolved } = formulaDriver({});
    void _unused;
    expect(buildProjectedEntries([unresolved], [template], { start: "2026-09", end: "2026-10" }).exceptions).toEqual([{ driverId: "f", reason: "Formula driver was not resolved against the forecast model." }]);
  });
});

describe("reviewed schedule dates", () => {
  it("clamps month-end payment days and rejects invalid dates", () => {
    const driver: ForecastDriver = { id: "month-end", label: "Synthetic", itemType: "obligation", direction: "spend", amountMinor: "100", cadence: "monthly", effectiveFrom: "2027-01", expectedDay: 31 };
    const template = { id: "template", itemType: "obligation" as const, direction: "spend" as const, debitAccountId: "expense", creditAccountId: "cash" };
    expect(buildProjectedEntries([driver], [template], { start: "2027-01", end: "2027-03" }).entries.map((item) => item.postingDate)).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
    expect(buildProjectedEntries([{ ...driver, expectedDay: 32 }], [template], { start: "2027-01", end: "2027-03" }).exceptions).toHaveLength(1);
  });
});
