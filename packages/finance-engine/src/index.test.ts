import { describe, expect, it } from "vitest";
import { expandScheduleItem, matchActualsToExpected, parseCadence, runEngine, summarizeMonths, traceValue, type ActualEvent, type ScheduleItem } from "./index";

const fee: ScheduleItem = { id: "fee", label: "Fund I management fee", direction: "receipt", amount: 12500, category: "management_fee", cadence: "monthly", effectiveFrom: "2026-09", accountingTreatment: "cash", basis: "contractual", provenance: { evidenceId: "e1" } };
const contractor: ScheduleItem = { id: "contractor", label: "Contractor retainer", direction: "spend", amount: 3200, category: "contractor", cadence: "monthly", effectiveFrom: "2026-09", accountingTreatment: "cash", basis: "contractual", provenance: {} };
const actual = (overrides: Partial<ActualEvent> & { id: string; month: string; amount: number; direction: ActualEvent["direction"] }): ActualEvent => ({ description: overrides.id, activity: "operating", provenance: {}, ...overrides });

describe("expandScheduleItem", () => {
  const horizon = { start: "2026-01", end: "2026-12" };
  it("keeps a quarterly item on its own calendar", () => {
    const months = expandScheduleItem({ ...fee, cadence: "quarterly", effectiveFrom: "2026-02" }, horizon).map((event) => event.month);
    expect(months).toEqual(["2026-02", "2026-05", "2026-08", "2026-11"]);
  });
  it("respects effective dates and the horizon", () => {
    expect(expandScheduleItem({ ...contractor, effectiveFrom: "2025-11", effectiveTo: "2026-03" }, horizon).map((event) => event.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(expandScheduleItem({ ...contractor, cadence: "once", effectiveFrom: "2027-01" }, horizon)).toEqual([]);
    expect(expandScheduleItem({ ...contractor, cadence: "annual", effectiveFrom: "2025-06" }, horizon).map((event) => event.month)).toEqual(["2026-06"]);
  });
  it("normalizes free-text cadence", () => {
    expect(parseCadence("Quarterly")).toBe("quarterly");
    expect(parseCadence("per year")).toBe("annual");
    expect(parseCadence("monthly retainer")).toBe("monthly");
    expect(parseCadence(undefined)).toBe("once");
  });
});

describe("matchActualsToExpected", () => {
  const horizon = { start: "2026-09", end: "2026-10" };
  it("prefers a persisted link, then counterparty, then amount", () => {
    const expected = [...expandScheduleItem({ ...fee, counterpartyEntityId: "fund-1" }, horizon), ...expandScheduleItem({ ...contractor, id: "c2", counterpartyEntityId: "vendor" }, horizon)];
    const matches = matchActualsToExpected(expected, [
      actual({ id: "a-link", month: "2026-09", amount: 100, direction: "receipt", settlesItemId: "fee" }),
      actual({ id: "a-cp", month: "2026-10", amount: 999, direction: "receipt", counterpartyEntityId: "fund-1" }),
      actual({ id: "a-amount", month: "2026-09", amount: 3200, direction: "spend" }),
    ]);
    expect(matches).toEqual([
      { expectedKey: "fee:2026-09", actualId: "a-link", reason: "link" },
      { expectedKey: "fee:2026-10", actualId: "a-cp", reason: "counterparty" },
      { expectedKey: "c2:2026-09", actualId: "a-amount", reason: "amount" },
    ]);
  });
  it("lets a late payment settle an expectation from a prior month", () => {
    const expected = expandScheduleItem({ ...contractor, cadence: "once", effectiveFrom: "2026-09" }, horizon);
    expect(matchActualsToExpected(expected, [actual({ id: "late", month: "2026-10", amount: 3200, direction: "spend" })])).toEqual([{ expectedKey: "contractor:2026-09", actualId: "late", reason: "amount" }]);
  });
});

describe("runEngine cash", () => {
  it("never counts an expectation alongside the actual that settles it", () => {
    const output = runEngine({ openingCash: { month: "2026-09", amount: 25000 }, asOfMonth: "2026-09", horizon: { start: "2026-09", end: "2026-10" }, items: [fee, contractor], actuals: [actual({ id: "r", month: "2026-09", amount: 12500, direction: "receipt" }), actual({ id: "s", month: "2026-09", amount: 3200, direction: "spend" })] });
    const [september, october] = output.months;
    expect(september).toMatchObject({ status: "open", openingCash: 25000, receipts: 12500, spending: 3200, actualReceipts: 12500, actualSpending: 3200, endingCash: 34300, variance: 0 });
    expect(october).toMatchObject({ status: "open", openingCash: 34300, receipts: 12500, spending: 3200, actualReceipts: 0, endingCash: 43600, contractualReceipts: 12500, assumedReceipts: 0 });
  });
  it("projects unsettled expectations in open months and only actuals in history", () => {
    const output = runEngine({ openingCash: { month: "2026-08", amount: 1000 }, asOfMonth: "2026-09", horizon: { start: "2026-08", end: "2026-09" }, items: [fee, { ...fee, effectiveFrom: "2026-08" }].map((item, index) => ({ ...item, id: `${item.id}-${index}` })), actuals: [] });
    const [august, september] = output.months;
    expect(august).toMatchObject({ status: "history", receipts: 0, endingCash: 1000, expectedReceipts: 12500 });
    expect(august!.outstanding.receivables.map((item) => item.amount)).toEqual([12500]);
    expect(september).toMatchObject({ status: "open", receipts: 25000, endingCash: 26000 });
    expect(september!.outstanding.receivables).toHaveLength(1);
  });
  it("starts the roll at the opening cash month and leaves earlier months without a balance", () => {
    const output = runEngine({ openingCash: { month: "2026-09", amount: 500 }, asOfMonth: "2026-10", horizon: { start: "2026-07", end: "2026-10" }, items: [], actuals: [actual({ id: "old", month: "2026-07", amount: 100, direction: "receipt" }), actual({ id: "new", month: "2026-09", amount: 100, direction: "receipt" })] });
    expect(output.months.map((month) => [month.month, month.endingCash])).toEqual([["2026-07", undefined], ["2026-08", undefined], ["2026-09", 600], ["2026-10", 600]]);
  });
  it("ignores transfers for cash and keeps investment activity out of the P&L", () => {
    const output = runEngine({ openingCash: { month: "2026-09", amount: 1000 }, asOfMonth: "2026-10", horizon: { start: "2026-09", end: "2026-09" }, items: [], actuals: [actual({ id: "t", month: "2026-09", amount: 400, direction: "spend", activity: "transfer" }), actual({ id: "i", month: "2026-09", amount: 300, direction: "spend", activity: "investment" }), actual({ id: "o", month: "2026-09", amount: 50, direction: "spend", category: "software" })] });
    expect(output.months[0]).toMatchObject({ actualSpending: 350, endingCash: 650 });
    expect(output.months[0]!.pnl).toMatchObject({ expenses: 50, byCategory: expect.objectContaining({ software: 50 }) });
  });
  it("treats closed months as history and reports statement differences", () => {
    const output = runEngine({ openingCash: { month: "2026-09", amount: 1000 }, asOfMonth: "2026-09", closedMonths: ["2026-09"], horizon: { start: "2026-09", end: "2026-09" }, items: [fee], actuals: [actual({ id: "r", month: "2026-09", amount: 12000, direction: "receipt" })], statementBalances: [{ month: "2026-09", opening: 1000, ending: 13100 }] });
    expect(output.months[0]).toMatchObject({ status: "closed", receipts: 12000, endingCash: 13000, variance: -500, statement: { opening: 1000, ending: 13100, difference: 100 } });
  });
  it("includes scenario items only when the scenario is requested", () => {
    const hire: ScheduleItem = { ...contractor, id: "hire", label: "Finance contractor", amount: 6000, effectiveFrom: "2027-01", basis: "assumed", scenarioId: "s1" };
    const base = runEngine({ asOfMonth: "2026-12", horizon: { start: "2027-01", end: "2027-01" }, items: [hire], actuals: [] });
    const scenario = runEngine({ asOfMonth: "2026-12", horizon: { start: "2027-01", end: "2027-01" }, items: [hire], actuals: [], scenarioId: "s1" });
    expect(base.months[0]!.spending).toBe(0);
    expect(scenario.months[0]).toMatchObject({ spending: 6000, assumedSpending: 6000, contractualSpending: 0 });
  });
});

describe("runEngine P&L", () => {
  it("categorizes actuals and unsettled expectations, and spreads prepaid and accrual items", () => {
    const insurance: ScheduleItem = { id: "ins", label: "D&O insurance", direction: "spend", amount: 1200, category: "insurance", cadence: "once", effectiveFrom: "2026-09", accountingTreatment: "prepaid", recognitionStart: "2026-09", recognitionEnd: "2026-12", basis: "contractual", provenance: {} };
    const output = runEngine({ asOfMonth: "2026-10", horizon: { start: "2026-09", end: "2026-12" }, items: [insurance, contractor], actuals: [
      actual({ id: "pay-ins", month: "2026-09", amount: 1200, direction: "spend", settlesItemId: "ins" }),
      actual({ id: "legal", month: "2026-10", amount: 900, direction: "spend", category: "professional_services", accountingTreatment: "accrual", recognitionStart: "2026-08", recognitionEnd: "2026-10" }),
      actual({ id: "fee", month: "2026-10", amount: 5000, direction: "receipt", category: "management_fee" }),
    ] });
    const expenses = output.months.map((month) => [month.month, month.pnl.expenses]);
    // September: insurance 300 + accrued legal 300 (the contractor expectation is history and unsettled, so outstanding only)
    // October: insurance 300 + legal 300 + contractor 3200 projected; November and December: insurance 300 + contractor 3200
    expect(expenses).toEqual([["2026-09", 600], ["2026-10", 3800], ["2026-11", 3500], ["2026-12", 3500]]);
    expect(output.months[1]!.pnl).toMatchObject({ revenue: 5000, revenueByCategory: expect.objectContaining({ management_fee: 5000 }), byCategory: expect.objectContaining({ professional_services: 300, contractor: 3200, insurance: 300 }) });
    expect(output.months[0]!.outstanding.payables.map((item) => item.label)).toEqual(["Contractor retainer"]);
    expect(output.months[0]!.lines.some((line) => line.kind === "actual" && line.settles === "ins:2026-09")).toBe(true);
  });
  it("applies allocations as a contra expense and an intercompany receivable", () => {
    const legal: ScheduleItem = { id: "legal", label: "Smith LLP", direction: "spend", amount: 10000, category: "professional_services", cadence: "once", effectiveFrom: "2026-10", accountingTreatment: "cash", basis: "contractual", provenance: {} };
    const output = runEngine({ asOfMonth: "2026-10", horizon: { start: "2026-10", end: "2026-11" }, items: [legal], actuals: [], allocations: [{ id: "a1", itemId: "legal", bearerEntityId: "fund-1", bearerName: "Fund I", percentage: 40 }, { id: "a2", itemId: "legal", bearerEntityId: "fund-2", bearerName: "Fund II", percentage: 40 }] });
    expect(output.months[0]!.pnl).toMatchObject({ expenses: 2000, allocatedOut: 8000, byCategory: expect.objectContaining({ professional_services: 2000 }) });
    expect(output.months[1]!.intercompany).toEqual([{ entityId: "fund-1", name: "Fund I", balance: 4000 }, { entityId: "fund-2", name: "Fund II", balance: 4000 }]);
    expect(traceValue(output, { month: "2026-10", category: "professional_services" }).map((line) => line.kind)).toEqual(["expected", "recognized", "allocation", "allocation"]);
  });
  it("summarizes months for prompts", () => {
    const output = runEngine({ openingCash: { month: "2026-09", amount: 100 }, asOfMonth: "2026-09", horizon: { start: "2026-09", end: "2026-10" }, items: [fee], actuals: [] });
    expect(summarizeMonths(output, "2026-10", "2026-10")).toEqual([expect.objectContaining({ month: "2026-10", endingCash: 25100, revenue: 12500, contractualReceipts: 12500 })]);
  });
});
