import { describe, expect, it } from "vitest";
import { buildJournalStatements } from "./statements";

const line = (id: string, accountType: string, normalBalance: "debit" | "credit", debitMinor: string, creditMinor: string, period: string, statementLine?: string) => ({ id, accountId: id, accountCode: id, accountName: id, accountType, normalBalance, debitMinor, creditMinor, currency: "USD", period, ...(statementLine ? { statementLine } : {}) });

describe("buildJournalStatements", () => {
  it("builds a traditional balance sheet and period income statement from journals", () => {
    const statements = buildJournalStatements([
      line("cash", "asset", "debit", "10000", "0", "2026-08", "Cash"), line("opening-equity", "equity", "credit", "0", "10000", "2026-08", "Contributed capital"),
      line("cash-september", "asset", "debit", "5000", "0", "2026-09", "Cash"), line("revenue", "revenue", "credit", "0", "5000", "2026-09", "Management fees"),
      line("expense", "expense", "debit", "2000", "0", "2026-09", "Software"), line("cash-expense", "asset", "debit", "0", "2000", "2026-09", "Cash"),
    ], "2026-09");
    const usd = statements.byCurrency[0]!;
    expect(usd.incomeStatement.netIncomeMinor).toBe("3000");
    expect(usd.balanceSheet.totalAssetsMinor).toBe("13000");
    expect(usd.balanceSheet.totalLiabilitiesAndEquityMinor).toBe("13000");
    expect(usd.balanceSheet.balanced).toBe(true);
    expect(usd.incomeStatement.revenue).toMatchObject([{ label: "Management fees", amountMinor: "5000" }]);
  });

  it("does not mix currencies", () => {
    const statements = buildJournalStatements([line("cash", "asset", "debit", "100", "0", "2026-09"), line("equity", "equity", "credit", "0", "100", "2026-09"), { ...line("cad-cash", "asset", "debit", "100", "0", "2026-09"), currency: "CAD" }, { ...line("cad-equity", "equity", "credit", "0", "100", "2026-09"), currency: "CAD" }], "2026-09");
    expect(statements.byCurrency.map((item) => item.currency)).toEqual(["CAD", "USD"]);
  });

  it("uses explicit chart timing for conventional current and non-current sections", () => {
    const usd = buildJournalStatements([
      { ...line("cash", "asset", "debit", "100", "0", "2026-09", "Cash"), balanceTiming: "current" as const },
      { ...line("equipment", "asset", "debit", "900", "0", "2026-09", "Equipment"), balanceTiming: "noncurrent" as const },
      { ...line("payable", "liability", "credit", "0", "400", "2026-09", "Accounts payable"), balanceTiming: "current" as const },
      { ...line("debt", "liability", "credit", "0", "600", "2026-09", "Term debt"), balanceTiming: "noncurrent" as const },
    ], "2026-09").byCurrency[0]!;
    expect(usd.balanceSheet.currentAssets).toMatchObject([{ label: "Cash", amountMinor: "100" }]);
    expect(usd.balanceSheet.noncurrentAssets).toMatchObject([{ label: "Equipment", amountMinor: "900" }]);
    expect(usd.balanceSheet.currentLiabilities).toMatchObject([{ label: "Accounts payable", amountMinor: "400" }]);
    expect(usd.balanceSheet.noncurrentLiabilities).toMatchObject([{ label: "Term debt", amountMinor: "600" }]);
  });

  it("derives direct cash flow from posted entry groups", () => {
    const statements = buildJournalStatements([
      { ...line("cash", "asset", "debit", "10000", "0", "2026-09", "Cash"), entryId: "fee" }, { ...line("revenue", "revenue", "credit", "0", "10000", "2026-09", "Management fees"), entryId: "fee" },
      { ...line("cash-2", "asset", "debit", "0", "3000", "2026-09", "Cash"), entryId: "software" }, { ...line("software", "expense", "debit", "3000", "0", "2026-09", "Software"), entryId: "software" },
      { ...line("cash-3", "asset", "debit", "5000", "0", "2026-09", "Cash"), entryId: "capital" }, { ...line("capital", "equity", "credit", "0", "5000", "2026-09", "Contributed capital"), entryId: "capital" },
    ], "2026-09");
    expect(statements.byCurrency[0]!.cashFlow).toMatchObject({ operatingMinor: "7000", financingMinor: "5000", investingMinor: "0", netChangeMinor: "12000", cashMovementMinor: "12000", cashReceiptsMinor: "15000", cashSpendingMinor: "3000", ties: true });
  });

  it("uses the approved chart-account cash-flow category before inference", () => {
    const statements = buildJournalStatements([
      { ...line("cash", "asset", "debit", "2500", "0", "2026-09", "Cash"), entryId: "asset-purchase" },
      { ...line("clearing", "asset", "credit", "0", "2500", "2026-09", "General clearing"), entryId: "asset-purchase", cashFlowCategory: "investing" },
    ], "2026-09");
    expect(statements.byCurrency[0]!.cashFlow).toMatchObject({ operatingMinor: "0", investingMinor: "2500", financingMinor: "0", inferredEntryIds: [] });
    expect(statements.byCurrency[0]!.cashFlow?.entries).toMatchObject([{ entryId: "asset-purchase", category: "investing", classification: "account" }]);
  });

  it("rolls an explicit working-capital account forward by period", () => {
    const statements = buildJournalStatements([
      { ...line("cash-aug", "asset", "debit", "10000", "0", "2026-08", "Cash"), entryId: "aug" }, { ...line("ar-aug", "asset", "credit", "0", "10000", "2026-08", "Accounts receivable"), entryId: "aug", workingCapitalCategory: "receivables" },
      { ...line("cash-sep", "asset", "debit", "4000", "0", "2026-09", "Cash"), entryId: "sep" }, { ...line("ar-sep", "asset", "credit", "0", "4000", "2026-09", "Accounts receivable"), entryId: "sep", workingCapitalCategory: "receivables" },
    ], "2026-09");
    expect(statements.byCurrency[0]!.workingCapital).toMatchObject([{ category: "receivables", openingMinor: "-10000", closingMinor: "-14000", changeMinor: "-4000" }]);
  });

  it("does not mix forecast entries into actual statements", () => {
    const lines = [
      { ...line("actual-cash", "asset", "debit", "1000", "0", "2026-09", "Cash"), entryId: "actual", basis: "actual" as const }, { ...line("actual-revenue", "revenue", "credit", "0", "1000", "2026-09", "Fees"), entryId: "actual", basis: "actual" as const },
      { ...line("forecast-cash", "asset", "debit", "2000", "0", "2026-09", "Cash"), entryId: "forecast", basis: "forecast" as const }, { ...line("forecast-revenue", "revenue", "credit", "0", "2000", "2026-09", "Fees"), entryId: "forecast", basis: "forecast" as const },
    ];
    expect(buildJournalStatements(lines, "2026-09").byCurrency[0]!.incomeStatement.netIncomeMinor).toBe("1000");
    expect(buildJournalStatements(lines, "2026-09", undefined, { basis: "forecast" }).byCurrency[0]!.incomeStatement.netIncomeMinor).toBe("2000");
  });

  it("keeps operating results visible while a period-close moves cumulative earnings into the designated account", () => {
    const statements = buildJournalStatements([
      { ...line("cash", "asset", "debit", "10000", "0", "2026-09", "Cash"), entryId: "operations" },
      { ...line("revenue", "revenue", "credit", "0", "10000", "2026-09", "Fees"), entryId: "operations" },
      { ...line("expense", "expense", "debit", "4000", "0", "2026-09", "Software"), entryId: "operations" },
      { ...line("cash-expense", "asset", "debit", "0", "4000", "2026-09", "Cash"), entryId: "operations" },
      { ...line("revenue-close", "revenue", "debit", "10000", "0", "2026-09", "Fees"), entryId: "close", entrySource: "period_close" },
      { ...line("expense-close", "expense", "credit", "0", "4000", "2026-09", "Software"), entryId: "close", entrySource: "period_close" },
      { ...line("retained", "equity", "credit", "0", "6000", "2026-09", "Retained Earnings"), entryId: "close", entrySource: "period_close" },
    ], "2026-09").byCurrency[0]!;
    expect(statements.incomeStatement.netIncomeMinor).toBe("6000");
    expect(statements.balanceSheet.retainedEarningsMinor).toBe("6000");
    expect(statements.balanceSheet.unclosedEarningsMinor).toBe("0");
    expect(statements.balanceSheet.balanced).toBe(true);
  });

  it("uses actuals through an as-of period and forecasts afterwards", () => {
    const lines = [
      { ...line("actual-cash", "asset", "debit", "1000", "0", "2026-09", "Cash"), entryId: "actual", basis: "actual" as const }, { ...line("actual-revenue", "revenue", "credit", "0", "1000", "2026-09", "Fees"), entryId: "actual", basis: "actual" as const },
      { ...line("forecast-cash", "asset", "debit", "2000", "0", "2026-10", "Cash"), entryId: "forecast", basis: "forecast" as const }, { ...line("forecast-revenue", "revenue", "credit", "0", "2000", "2026-10", "Fees"), entryId: "forecast", basis: "forecast" as const },
      { ...line("stale-forecast-cash", "asset", "debit", "3000", "0", "2026-09", "Cash"), entryId: "stale-forecast", basis: "forecast" as const }, { ...line("stale-forecast-revenue", "revenue", "credit", "0", "3000", "2026-09", "Fees"), entryId: "stale-forecast", basis: "forecast" as const },
    ];
    const statements = buildJournalStatements(lines, "2026-10", undefined, { view: "projected", asOfPeriod: "2026-09" });
    expect(statements.byCurrency[0]!.incomeStatement.netIncomeMinor).toBe("2000");
    expect(statements.byCurrency[0]!.balanceSheet.totalAssetsMinor).toBe("3000");
  });

  it("adds only the selected scenario to a projected baseline", () => {
    const lines = [
      { ...line("actual-cash", "asset", "debit", "1000", "0", "2026-09", "Cash"), entryId: "actual", basis: "actual" as const }, { ...line("actual-equity", "equity", "credit", "0", "1000", "2026-09", "Capital"), entryId: "actual", basis: "actual" as const },
      { ...line("forecast-cash", "asset", "debit", "2000", "0", "2026-10", "Cash"), entryId: "forecast", basis: "forecast" as const }, { ...line("forecast-revenue", "revenue", "credit", "0", "2000", "2026-10", "Fees"), entryId: "forecast", basis: "forecast" as const },
      { ...line("scenario-cash", "asset", "debit", "500", "0", "2026-10", "Cash"), entryId: "scenario-a", basis: "scenario" as const, scenarioId: "scenario-a" }, { ...line("scenario-revenue", "revenue", "credit", "0", "500", "2026-10", "Fees"), entryId: "scenario-a", basis: "scenario" as const, scenarioId: "scenario-a" },
      { ...line("other-cash", "asset", "debit", "700", "0", "2026-10", "Cash"), entryId: "scenario-b", basis: "scenario" as const, scenarioId: "scenario-b" }, { ...line("other-revenue", "revenue", "credit", "0", "700", "2026-10", "Fees"), entryId: "scenario-b", basis: "scenario" as const, scenarioId: "scenario-b" },
    ];
    const statements = buildJournalStatements(lines, "2026-10", undefined, { view: "scenario", asOfPeriod: "2026-09", scenarioId: "scenario-a" });
    expect(statements.byCurrency[0]!.incomeStatement.netIncomeMinor).toBe("2500");
    expect(statements.byCurrency[0]!.balanceSheet.totalAssetsMinor).toBe("3500");
  });

  it("excludes a plan pin from the scenario view even when its scenario id matches", () => {
    const lines = [
      { ...line("actual-cash", "asset", "debit", "1000", "0", "2026-09", "Cash"), entryId: "actual", basis: "actual" as const }, { ...line("actual-equity", "equity", "credit", "0", "1000", "2026-09", "Capital"), entryId: "actual", basis: "actual" as const },
      { ...line("plan-cash", "asset", "debit", "9000", "0", "2026-10", "Cash"), entryId: "plan-pin", basis: "plan" as const, scenarioId: "scenario-a" }, { ...line("plan-revenue", "revenue", "credit", "0", "9000", "2026-10", "Fees"), entryId: "plan-pin", basis: "plan" as const, scenarioId: "scenario-a" },
      { ...line("scenario-cash", "asset", "debit", "500", "0", "2026-10", "Cash"), entryId: "scenario-a", basis: "scenario" as const, scenarioId: "scenario-a" }, { ...line("scenario-revenue", "revenue", "credit", "0", "500", "2026-10", "Fees"), entryId: "scenario-a", basis: "scenario" as const, scenarioId: "scenario-a" },
    ];
    const statements = buildJournalStatements(lines, "2026-10", undefined, { view: "scenario", asOfPeriod: "2026-09", scenarioId: "scenario-a" });
    // Only the scenario-basis line (500) is added on top of actuals; the plan pin (9000) never reaches a live view.
    expect(statements.byCurrency[0]!.incomeStatement.netIncomeMinor).toBe("500");
    expect(statements.byCurrency[0]!.balanceSheet.totalAssetsMinor).toBe("1500");
  });

  it("uses an explicitly classified contra asset to reduce assets", () => {
    const statements = buildJournalStatements([
      line("equipment", "asset", "debit", "10000", "0", "2026-09", "Equipment"),
      { ...line("accumulated-depreciation", "contra", "credit", "0", "3000", "2026-09", "Accumulated depreciation"), statementSection: "asset" },
      line("equity", "equity", "credit", "0", "7000", "2026-09"),
    ], "2026-09");
    const usd = statements.byCurrency[0]!;
    expect(usd.balanceSheet.totalAssetsMinor).toBe("7000");
    expect(usd.balanceSheet.balanced).toBe(true);
    expect(usd.unclassified).toEqual([]);
  });

  it("keeps a contra account without a declared section unclassified", () => {
    const statements = buildJournalStatements([
      line("asset", "asset", "debit", "100", "0", "2026-09"),
      line("contra", "contra", "credit", "0", "100", "2026-09"),
    ], "2026-09");
    expect(statements.byCurrency[0]!.unclassified).toMatchObject([{ key: "contra", amountMinor: "100" }]);
  });
});
