import { describe, expect, it } from "vitest";
import { buildCashGoalBridge, type CashBridgeSnapshot } from "./cash-goal-bridge";
import { buildForecastRun, type ForecastRunInput } from "./forecast-run";
import { evaluateCashGoal, type CashGoal } from "./cash-goals";
import { summarizeActualCash } from "./forecast-actuals";
import type { PostedJournalLine } from "./ledger";

const accounts: ForecastRunInput["accounts"] = [
  { accountId: "cash", accountCode: "1000", accountName: "Cash", accountType: "asset", normalBalance: "debit" },
  { accountId: "capital", accountCode: "3000", accountName: "Capital", accountType: "equity", normalBalance: "credit" },
  { accountId: "revenue", accountCode: "4000", accountName: "Revenue", accountType: "revenue", normalBalance: "credit" },
  { accountId: "cost", accountCode: "6000", accountName: "Cost", accountType: "expense", normalBalance: "debit" },
];
const journal = (id: string, amount: string, period: string, debit = "cash", credit = "capital"): PostedJournalLine[] => [{ account: debit, debit: amount, credit: "0" }, { account: credit, debit: "0", credit: amount }].map((row, index) => ({ ...accounts.find((account) => account.accountId === row.account)!, id: `${id}:${index}`, entryId: id, period, postingDate: `${period}-15`, basis: "actual", currency: "USD", debitMinor: row.debit, creditMinor: row.credit, provenance: { factId: `fact:${id}` } }));
const opening = journal("opening", "50000000", "2026-08");
const goal: CashGoal = { name: "October cash", metric: "ending_cash_at_month", currency: "USD", startMonth: "2026-10", endMonth: "2026-10", targetMinor: "40000000" };
const input: ForecastRunInput = {
  currency: "USD", asOfMonth: "2026-08", horizonMonths: 4, minimumCashMinor: "0", actuals: summarizeActualCash(opening, "USD", "2026-08"), accounts,
  drivers: [{ id: "receipt", label: "Customer receipts", itemType: "agreement", direction: "receipt", amountMinor: "10000000", cadence: "monthly", effectiveFrom: "2026-09" }, { id: "spend", label: "Operating costs", itemType: "obligation", direction: "spend", amountMinor: "15000000", cadence: "monthly", effectiveFrom: "2026-09" }],
  templates: [{ id: "receipt-template", itemType: "agreement", direction: "receipt", debitAccountId: "cash", creditAccountId: "revenue" }, { id: "spend-template", itemType: "obligation", direction: "spend", debitAccountId: "cost", creditAccountId: "cash" }],
  openMonth: { month: "2026-09", throughDate: "2026-09-25", actualLines: [], forecastedLines: [], matches: [] }, settlement: { throughDate: "2026-09-25", occurrences: [], allocations: [], actuals: [] },
};
const snap = (next = input, actuals = opening, definition = goal): CashBridgeSnapshot => { const output = buildForecastRun(next); return { companyId: "company", goalVersionId: "goal-v1", input: next, output, evaluation: evaluateCashGoal(definition, output, []), actualJournalLines: actuals }; };
const balanced = (bridge: ReturnType<typeof buildCashGoalBridge>) => expect(BigInt(bridge.explainedMinor) + BigInt(bridge.residualMinor!)).toBe(BigInt(bridge.deltaMinor!));

describe("cash goal change attribution", () => {
  it("explains the $40k goal shortfall from a $20k monthly cost increase", () => {
    const after = snap({ ...input, drivers: input.drivers.map((driver) => driver.id === "spend" ? { ...driver, amountMinor: "17000000" } : driver) });
    const bridge = buildCashGoalBridge(snap(), after);
    expect(bridge).toMatchObject({ status: "complete", deltaMinor: "-4000000", headroomBeforeMinor: "0", headroomAfterMinor: "-4000000", residualMinor: "0" });
    expect(bridge.steps.find((step) => step.category === "assumptions")).toMatchObject({ deltaMinor: "-4000000", references: ["spend"] }); balanced(bridge);
  });
  it("separates new actuals from reviewed settlement, and attributes delayed remaining cash", () => {
    const before = snap(); const receipt = journal("receipt-actual", "6000000", "2026-09", "cash", "revenue");
    const lines = before.output.projectedLines.filter((line) => line.entryId === "projection:receipt:base:2026-09");
    const next: ForecastRunInput = { ...input, openMonth: { ...input.openMonth!, actualLines: receipt }, settlement: { throughDate: "2026-09-25", actuals: [{ id: "receipt-actual", postingDate: "2026-09-15", currency: "USD", amountMinor: "6000000", debitAccountId: "cash", creditAccountId: "revenue", entityId: null, reversed: false, memo: "Receipt" }], allocations: [{ id: "allocation", occurrenceId: "occurrence", actualEntryId: "receipt-actual", amountMinor: "6000000", revoked: false }], occurrences: [{ id: "occurrence", version: 1, key: "projection:receipt:base:2026-09", label: "Customer receipt", origin: "driver", driverId: "receipt", originalMonth: "2026-09", expectedDate: "2026-11-15", amountMinor: "10000000", originalAmountMinor: "10000000", currency: "USD", status: "active", final: false, lines, sourceLineIds: [] }] } };
    const bridge = buildCashGoalBridge(before, snap(next, [...opening, ...receipt]));
    expect(bridge.steps.find((step) => step.category === "actuals")?.deltaMinor).toBe("6000000");
    expect(bridge.steps.find((step) => step.category === "expectations")?.deltaMinor).toBe("-10000000");
    expect(bridge.deltaMinor).toBe("-4000000"); balanced(bridge);
    next.settlement!.occurrences[0]!.expectedDate = "2026-09-15";
    expect(buildCashGoalBridge(before, snap(next, [...opening, ...receipt])).deltaMinor).toBe("0");
  });
  it("handles calendar rollover without calling expired forecasts settled actuals", () => {
    const activity = [...journal("collection", "10000000", "2026-09", "cash", "revenue"), ...journal("payment", "15000000", "2026-09", "cost", "cash")];
    const next = { ...input, asOfMonth: "2026-09", actuals: summarizeActualCash([...opening, ...activity], "USD", "2026-09"), openMonth: { ...input.openMonth!, month: "2026-10", throughDate: "2026-10-02" }, settlement: { ...input.settlement!, throughDate: "2026-10-02" } };
    const bridge = buildCashGoalBridge(snap(), snap(next, [...opening, ...activity]));
    expect(bridge).toMatchObject({ status: "complete", deltaMinor: "0" });
    expect(bridge.steps.find((step) => step.category === "calendar")?.deltaMinor).toBe("5000000");
    expect(bridge.steps.find((step) => step.category === "actuals")?.deltaMinor).toBe("-5000000"); balanced(bridge);
  });
  it("re-evaluates a cash floor when its lowest-cash month changes", () => {
    const floor = { ...goal, metric: "minimum_month_end_cash" as const, startMonth: "2026-09", endMonth: "2026-10" };
    const next = { ...input, drivers: [...input.drivers, { ...input.drivers[0]!, id: "new-october", label: "October receipt", cadence: "once" as const, effectiveFrom: "2026-10", amountMinor: "20000000" }] };
    const bridge = buildCashGoalBridge(snap(input, opening, floor), snap(next, opening, floor));
    expect(bridge).toMatchObject({ deltaMinor: "5000000", status: "complete" });
    expect(bridge.steps.find((step) => step.category === "assumptions")).toMatchObject({ minimumMonthBefore: "2026-10", minimumMonthAfter: "2026-09" }); balanced(bridge);
  });
  it("does not invent a cash impact for improved coverage", () => {
    const bridge = buildCashGoalBridge({ ...snap(), coverage: "missing" }, { ...snap(), coverage: "complete" });
    expect(bridge).toMatchObject({ status: "complete", coverageChanged: true, explainedMinor: "0", residualMinor: "0", steps: [] });
  });
  it("keeps formula changes and non-reproducible saved values visibly unexplained", () => {
    const before = snap(); const after = snap({ ...input, drivers: [] });
    const legacy = { ...before, output: { ...before.output, formulaVersion: "legacy-version" } };
    const bridge = buildCashGoalBridge(legacy, after);
    expect(bridge).toMatchObject({ status: "partial", explainedMinor: "0", residualMinor: "10000000" }); balanced(bridge);
    expect(buildCashGoalBridge({ ...before, evaluation: { ...before.evaluation, valueMinor: "1" } }, after).status).toBe("partial");
  });
  it("rejects incompatible scope, currency, goal versions and missing periods", () => {
    const before = snap();
    for (const after of [{ ...snap(), companyId: "foreign" }, { ...snap(), goalVersionId: "goal-v2" }, snap(input, opening, { ...goal, currency: "EUR" }), snap(input, opening, { ...goal, endMonth: "2030-01" })]) expect(buildCashGoalBridge(before, after).status).toBe("unavailable");
  });
  it("uses exact minor units above the Number precision limit", () => {
    const largeOpening = journal("opening", "900719925474099300", "2026-08");
    const beforeInput = { ...input, actuals: summarizeActualCash(largeOpening, "USD", "2026-08") };
    const afterInput = { ...beforeInput, drivers: input.drivers.map((driver) => driver.id === "spend" ? { ...driver, amountMinor: "15000001" } : driver) };
    const bridge = buildCashGoalBridge(snap(beforeInput, largeOpening), snap(afterInput, largeOpening));
    expect(bridge.deltaMinor).toBe("-2"); balanced(bridge);
  });
});
