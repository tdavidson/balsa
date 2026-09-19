import { describe, expect, it } from "vitest";
import { summarizeActualCash } from "./forecast-actuals";
import { diffForecastRuns } from "./forecast-consequence";
import type { ForecastModel, ForecastVariableInput } from "./forecast-model";
import { buildForecastRun, type ForecastAccount, type ForecastRunInput } from "./forecast-run";
import type { PostedJournalLine } from "./ledger";

const accounts: ForecastAccount[] = [
  { accountId: "cash", accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit", statementLine: "Cash" },
  { accountId: "equity", accountCode: "3000", accountName: "Owner capital", accountType: "equity", normalBalance: "credit" },
  { accountId: "payroll", accountCode: "6000", accountName: "Payroll", accountType: "expense", normalBalance: "debit" },
];
const account = (id: string) => accounts.find((candidate) => candidate.accountId === id)!;
const posted = (id: string, accountId: string, debitMinor: string, creditMinor: string, period: string): PostedJournalLine => ({ ...account(accountId), id, entryId: id.split(":")[0]!, basis: "actual", currency: "USD", debitMinor, creditMinor, period });
// $1,000,000 of capital in May and nothing else: cash at the August as-of is 100,000,000 minor units.
const history = [posted("capital:0", "cash", "100000000", "0", "2026-05"), posted("capital:1", "equity", "0", "100000000", "2026-05")];
const templates: ForecastRunInput["templates"] = [{ id: "spend", itemType: "obligation", direction: "spend", debitAccountId: "payroll", creditAccountId: "cash" }];
const model = (engineers: ForecastVariableInput[]): ForecastModel => ({
  dimensions: [{ name: "team", items: ["Eng", "Sales"] }],
  variables: [
    { name: "headcount", kind: "number", dims: ["team"], inputs: [...engineers, { coords: { team: "Sales" }, from: "2026-08", value: "2" }] },
    { name: "payroll", kind: "money", dims: ["team"], formula: "headcount * salary", inputs: [] },
    { name: "salary", kind: "money", dims: ["team"], inputs: [{ coords: { team: "Eng" }, from: "2026-08", value: "10000" }, { coords: { team: "Sales" }, from: "2026-08", value: "8000" }] },
    { name: "tax", kind: "money", dims: ["team"], formula: "payroll * 0.0765", inputs: [] },
  ],
});
const payrollDriver: ForecastRunInput["drivers"][number] = { id: "payroll-item", label: "Payroll", itemType: "obligation", direction: "spend", amountMinor: "", amountFormula: "sum(payroll) + sum(tax)", cadence: "monthly", effectiveFrom: "2026-09" };
const run = (engineers: ForecastVariableInput[]) => buildForecastRun({ actuals: summarizeActualCash(history, "USD", "2026-08"), drivers: [payrollDriver], templates, accounts, currency: "USD", asOfMonth: "2026-08", horizonMonths: 24, minimumCashMinor: "0", model: model(engineers) });
const threeEngineers: ForecastVariableInput[] = [{ coords: { team: "Eng" }, from: "2026-08", value: "3" }];

describe("headcount → payroll → payroll tax → cash", () => {
  it("projects the formula driver's monthly cash, runway, and trace", () => {
    const before = run(threeEngineers);
    // 3 × 10,000 + 2 × 8,000 = 46,000 payroll; 7.65% tax = 3,519; 49,519 a month = 4,951,900 minor units.
    expect(before.exceptions).toEqual([]);
    expect(before.months.find((month) => month.month === "2026-09")).toMatchObject({ spendingMinor: "4951900", endingCashMinor: "95048100" });
    // 100,000,000 − 4,951,900·n < 0 first at n = 21 (2028-05): twenty full months funded.
    expect(before.runway).toMatchObject({ cashOutMonth: "2028-05", runwayMonths: 20 });
    expect(before.drivers[0]!.amountByMonth!["2026-09"]).toBe("4951900");
    expect(before.modelSummary!.variables.map((variable) => [variable.name, variable.monthlyTotals["2026-09"]])).toEqual([["headcount", "5"], ["payroll", "46000"], ["salary", "18000"], ["tax", "3519"]]);
  });

  it("moves cash, runway, and the consequence when Eng headcount rises from January", () => {
    const before = run(threeEngineers);
    const after = run([...threeEngineers, { coords: { team: "Eng" }, from: "2027-01", value: "4" }]);
    // From January: 40,000 + 16,000 payroll and 3,060 + 1,224 tax = 60,284 a month.
    expect(after.months.find((month) => month.month === "2027-01")!.spendingMinor).toBe("6028400");
    // 80,192,400 left after December; 13 more months fit, the 14th (2028-02) does not.
    expect(after.runway).toMatchObject({ cashOutMonth: "2028-02", runwayMonths: 17 });
    const consequence = diffForecastRuns(before, after)!;
    expect(consequence.runwayMonths).toEqual({ before: 20, after: 17 });
    expect(consequence.cashOutMonth).toEqual({ before: "2028-05", after: "2028-02" });
    expect(consequence.horizonEndCash).toEqual({ month: "2028-08", beforeMinor: "-18845600", afterMinor: "-40375600", deltaMinor: "-21530000" });
    expect(consequence.projectedSpending.deltaMinor).toBe("21530000");
    expect(consequence.drivers.changed.map((change) => change.fields)).toEqual([["amountByMonth"]]);
  });
});
