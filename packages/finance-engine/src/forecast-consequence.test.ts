import { describe, expect, it } from "vitest";
import { diffForecastRuns } from "./forecast-consequence";
import { buildForecastRun, type ForecastRunInput } from "./forecast-run";

const accounts: ForecastRunInput["accounts"] = [
  { accountId: "cash", accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" },
  { accountId: "equity", accountCode: "3000", accountName: "Owner capital", accountType: "equity", normalBalance: "credit" },
  { accountId: "revenue", accountCode: "4000", accountName: "Revenue", accountType: "revenue", normalBalance: "credit" },
  { accountId: "payroll", accountCode: "6000", accountName: "Payroll", accountType: "expense", normalBalance: "debit" },
];
const capital = [
  { ...accounts[0]!, id: "c:0", entryId: "c", basis: "actual" as const, currency: "USD", debitMinor: "900000", creditMinor: "0", period: "2026-08" },
  { ...accounts[1]!, id: "c:1", entryId: "c", basis: "actual" as const, currency: "USD", debitMinor: "0", creditMinor: "900000", period: "2026-08" },
];
const templates: ForecastRunInput["templates"] = [
  { id: "spend", itemType: "obligation", direction: "spend", debitAccountId: "payroll", creditAccountId: "cash" },
  { id: "receipt", itemType: "agreement", direction: "receipt", debitAccountId: "cash", creditAccountId: "revenue" },
];
const payroll: ForecastRunInput["drivers"][number] = { id: "payroll", label: "Payroll", itemType: "obligation", direction: "spend", amountMinor: "100000", cadence: "monthly", effectiveFrom: "2026-09", evidenceId: "ev-1" };
const input = (drivers: ForecastRunInput["drivers"], asOfMonth = "2026-08"): ForecastRunInput => ({ actualLines: capital, drivers, templates, accounts, currency: "USD", asOfMonth, horizonMonths: 24, minimumCashMinor: "0" });

describe("diffForecastRuns", () => {
  it("returns null when no headline figure changed", () => {
    const run = buildForecastRun(input([payroll]));
    expect(diffForecastRuns(run, buildForecastRun(input([payroll])))).toBeNull();
    expect(diffForecastRuns(run, buildForecastRun(input([{ ...payroll, label: "Renamed" }])))).toBeNull();
  });

  it("attributes an added driver and its runway effect", () => {
    const consequence = diffForecastRuns(buildForecastRun(input([])), buildForecastRun(input([payroll])))!;
    expect(consequence.cashOutMonth).toEqual({ before: null, after: "2027-06" });
    expect(consequence.runwayMonths).toEqual({ before: null, after: 10 });
    expect(consequence.projectedSpending.deltaMinor).toBe("2400000");
    expect(consequence.horizonEndCash).toEqual({ month: "2028-08", beforeMinor: "900000", afterMinor: "-1500000", deltaMinor: "-2400000" });
    expect(consequence.drivers.added).toEqual([{ id: "payroll", label: "Payroll", direction: "spend", amountMinor: "100000", cadence: "monthly", effectiveFrom: "2026-09", evidenceId: "ev-1" }]);
  });

  it("reports changed and removed drivers", () => {
    const before = buildForecastRun(input([payroll]));
    const changed = diffForecastRuns(before, buildForecastRun(input([{ ...payroll, amountMinor: "30000" }])))!;
    expect(changed.drivers.changed[0]?.fields).toEqual(["amountMinor"]);
    expect(changed.runwayMonths.after).toBeNull();
    const removed = diffForecastRuns(before, buildForecastRun(input([])))!;
    expect(removed.drivers.removed.map((driver) => driver.id)).toEqual(["payroll"]);
    expect(removed.cashOutMonth).toEqual({ before: "2027-06", after: null });
  });

  it("handles a previous run with a different horizon", () => {
    const consequence = diffForecastRuns(buildForecastRun(input([payroll], "2026-07")), buildForecastRun(input([payroll])))!;
    expect(consequence.asOfMonth).toEqual({ before: "2026-07", after: "2026-08" });
    expect(consequence.cash.some((row) => row.beforeMinor === null)).toBe(true);
  });

  it("treats a missing previous run as all-null before values", () => {
    const consequence = diffForecastRuns(null, buildForecastRun(input([payroll])))!;
    expect(consequence.asOfMonth.before).toBeNull();
    expect(consequence.horizonEndCash.beforeMinor).toBeNull();
  });

  it("reports category and amount changes with before/after values", () => {
    const before = buildForecastRun(input([{ ...payroll, category: "salary", amountMinor: "100000" }]));
    const consequence = diffForecastRuns(before, buildForecastRun(input([{ ...payroll, category: "contractor", amountMinor: "150000" }])))!;
    expect(consequence.drivers.changed[0]?.fields).toEqual(["category", "amountMinor"]);
    expect(consequence.drivers.changed[0]?.before).toEqual({ id: "payroll", label: "Payroll", direction: "spend", category: "salary", amountMinor: "100000", cadence: "monthly", effectiveFrom: "2026-09", evidenceId: "ev-1" });
    expect(consequence.drivers.changed[0]?.after).toEqual({ id: "payroll", label: "Payroll", direction: "spend", category: "contractor", amountMinor: "150000", cadence: "monthly", effectiveFrom: "2026-09", evidenceId: "ev-1" });
  });
});
