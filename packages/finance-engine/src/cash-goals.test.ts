import { describe, expect, it } from "vitest";
import { cashGoalChange, evaluateCashGoal, type CashGoal } from "./cash-goals";
import { buildForecastRun, type ForecastRunInput } from "./forecast-run";
import { summarizeActualCash } from "./forecast-actuals";

const goal: CashGoal = { name: "October cash", metric: "ending_cash_at_month", currency: "USD", startMonth: "2026-10", endMonth: "2026-10", targetMinor: "40000000" };
const accounts: ForecastRunInput["accounts"] = [
  { accountId: "cash", accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" },
  { accountId: "equity", accountCode: "3000", accountName: "Capital", accountType: "equity", normalBalance: "credit" },
  { accountId: "income", accountCode: "4000", accountName: "Revenue", accountType: "revenue", normalBalance: "credit" },
  { accountId: "expense", accountCode: "6000", accountName: "Costs", accountType: "expense", normalBalance: "debit" },
];
const input: ForecastRunInput = {
  accounts, currency: "USD", asOfMonth: "2026-08", horizonMonths: 3, minimumCashMinor: "0",
  actuals: summarizeActualCash([
    { ...accounts[0]!, id: "opening:cash", currency: "USD", period: "2026-08", debitMinor: "50000000", creditMinor: "0" },
    { ...accounts[1]!, id: "opening:equity", currency: "USD", period: "2026-08", debitMinor: "0", creditMinor: "50000000" },
  ], "USD", "2026-08"),
  drivers: [
    { id: "receipts", label: "Receipts", itemType: "agreement", direction: "receipt", cadence: "monthly", effectiveFrom: "2026-09", amountMinor: "10000000" },
    { id: "costs", label: "Costs", itemType: "obligation", direction: "spend", cadence: "monthly", effectiveFrom: "2026-09", amountMinor: "15000000" },
  ],
  templates: [
    { id: "receipt", itemType: "agreement", direction: "receipt", debitAccountId: "cash", creditAccountId: "income" },
    { id: "spend", itemType: "obligation", direction: "spend", debitAccountId: "expense", creditAccountId: "cash" },
  ],
};

describe("cash goals", () => {
  it("evaluates the specification's baseline without changing its forecast", () => {
    const run = buildForecastRun(input); const original = structuredClone(run);
    expect(evaluateCashGoal(goal, run, [])).toMatchObject({ valueMinor: "40000000", headroomMinor: "0", outcome: "meets_target", basis: "projected", assurance: "supported" });
    expect(run).toEqual(original);
    expect(evaluateCashGoal({ ...goal, targetMinor: "90000000" }, run, []).headroomMinor).toBe("-50000000");
  });

  it("measures the minimum over the inclusive interval and the first breach, not just the final balance", () => {
    const run = buildForecastRun(input);
    const floor: CashGoal = { ...goal, metric: "minimum_month_end_cash", startMonth: "2026-09", endMonth: "2026-11", targetMinor: "42500000" };
    expect(evaluateCashGoal(floor, run, [])).toMatchObject({ valueMinor: "35000000", headroomMinor: "-7500000", firstBreachMonth: "2026-10" });
  });

  it("retains provisional status even when the arithmetic meets the target", () => {
    const run = buildForecastRun(input);
    expect(evaluateCashGoal(goal, run, ["Missing bank coverage."])).toMatchObject({ outcome: "meets_target", assurance: "provisional", reasons: ["Missing bank coverage."] });
    expect(evaluateCashGoal(goal, { ...run, verificationStatus: "exception", exceptions: [{ driverId: "x", reason: "No approved template." }] }, []).assurance).toBe("provisional");
  });

  it("does not pass missing dates, invalid intervals, or mismatched currencies", () => {
    const run = buildForecastRun(input);
    for (const invalid of [{ ...goal, endMonth: "2030-01" }, { ...goal, startMonth: "2027-01" }, { ...goal, currency: "EUR" }, { ...goal, targetMinor: "NaN" }]) expect(evaluateCashGoal(invalid, run, []).outcome).toBe("unavailable");
    expect(evaluateCashGoal(goal, { ...run, months: run.months.filter((row) => row.month !== "2026-10") }, []).valueMinor).toBeNull();
  });

  it("preserves exact minor units beyond Number's safe range", () => {
    const run = buildForecastRun(input);
    const huge = "9007199254740993123";
    const actual = { ...run, months: run.months.map((row) => row.month === "2026-10" ? { ...row, endingCashMinor: huge } : row) };
    expect(evaluateCashGoal({ ...goal, targetMinor: "9007199254740993122" }, actual, []).headroomMinor).toBe("1");
  });

  it("compares the same goal and keeps incompatible comparisons unavailable", () => {
    const before = evaluateCashGoal(goal, buildForecastRun(input), []);
    const after = evaluateCashGoal(goal, buildForecastRun({ ...input, drivers: input.drivers.map((driver) => driver.id === "costs" ? { ...driver, amountMinor: "17000000" } : driver) }), []);
    expect(cashGoalChange(before, after)).toBe("-4000000");
    expect(before.valueMinor).toBe("40000000");
    expect(cashGoalChange(before, { ...after, goal: { ...goal, endMonth: "2026-11" } })).toBeNull();
    expect(cashGoalChange(before, { ...after, formulaVersion: "future" })).toBeNull();
  });
});
