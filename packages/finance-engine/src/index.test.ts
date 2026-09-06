import { describe, expect, it } from "vitest";
import { buildMonthlyCash, buildMonthlyProfitAndLoss } from "./index";

describe("buildMonthlyCash", () => {
  it("rolls forecast and actual events into ending cash", () => {
    expect(buildMonthlyCash(1000, [
      { month: "2026-01", amount: 500, kind: "receipt" },
      { month: "2026-01", amount: 200, kind: "spend" },
      { month: "2026-01", amount: 100, kind: "receipt", actual: true },
    ])).toEqual([{ month: "2026-01", receipts: 500, spending: 200, net: 300, endingCash: 1400, actualReceipts: 100, actualSpending: 0, actualNet: 100, variance: -200 }]);
  });

  it("supports a Company Zero close with forecast, actuals, and a later month", () => {
    const result = buildMonthlyCash(25000, [
      { month: "2026-09", amount: 12500, kind: "receipt" },
      { month: "2026-09", amount: 3200, kind: "spend" },
      { month: "2026-09", amount: 12500, kind: "receipt", actual: true },
      { month: "2026-09", amount: 3200, kind: "spend", actual: true },
      { month: "2026-10", amount: 12500, kind: "receipt" },
      { month: "2026-10", amount: 3200, kind: "spend" },
    ]);
    expect(result).toMatchObject([
      { month: "2026-09", net: 9300, actualNet: 9300, variance: 0, endingCash: 43600 },
      { month: "2026-10", net: 9300, actualNet: 0, variance: -9300, endingCash: 52900 },
    ]);
  });
});

describe("buildMonthlyProfitAndLoss", () => {
  it("calculates categories and preserves a calculation trace", () => {
    expect(buildMonthlyProfitAndLoss([
      { id: "fee", month: "2026-01", category: "management_fee", amount: 1000, direction: "receipt", sourceId: "source-1" },
      { id: "payroll", month: "2026-01", category: "salary", amount: 400, direction: "spend", sourceId: "source-2" },
    ])).toEqual([{ month: "2026-01", revenue: 1000, expenses: 400, operatingIncome: 600, byCategory: { management_fee: 0, salary: 400, contractor: 0, professional_services: 0, allocation: 0, prepaid: 0, other: 0 }, trace: [{ lineId: "fee", sourceId: "source-1", category: "management_fee", amount: 1000 }, { lineId: "payroll", sourceId: "source-2", category: "salary", amount: 400 }] }]);
  });

  it("spreads prepaid coverage over the service period while retaining cash timing", () => {
    const result = buildMonthlyProfitAndLoss([{ id: "insurance", month: "2026-09", category: "prepaid", amount: 1200, direction: "spend", accountingTreatment: "prepaid", recognitionStart: "2026-09", recognitionEnd: "2026-12" }]);
    expect(result.map((month) => [month.month, month.expenses])).toEqual([["2026-09", 300], ["2026-10", 300], ["2026-11", 300], ["2026-12", 300]]);
  });

  it("recognizes accrued services over their service period", () => {
    const result = buildMonthlyProfitAndLoss([{ id: "legal", month: "2026-10", category: "professional_services", amount: 900, direction: "spend", accountingTreatment: "accrual", recognitionStart: "2026-08", recognitionEnd: "2026-10" }]);
    expect(result.map((month) => [month.month, month.expenses])).toEqual([["2026-08", 300], ["2026-09", 300], ["2026-10", 300]]);
  });
});
