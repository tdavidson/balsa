import { describe, expect, it } from "vitest";
import { buildForecastRun, summarizeActualCash, type ForecastAccount, type ForecastRunInput, type PostedJournalLine } from "@balsa/finance-engine";
import { buildCashExplorer } from "./cash-explorer";

const accounts: ForecastAccount[] = [
  { accountId: "cash", accountCode: "1000", accountName: "Cash", statementLine: "Cash", accountType: "asset", normalBalance: "debit" },
  { accountId: "capital", accountCode: "3000", accountName: "Capital", accountType: "equity", normalBalance: "credit" },
  { accountId: "sales", accountCode: "4000", accountName: "Project receipts", accountType: "revenue", normalBalance: "credit" },
  { accountId: "expense", accountCode: "6000", accountName: "Payroll and benefits", accountType: "expense", normalBalance: "debit" },
];
function line(id: string, account: number, debit: string, credit: string, period: string): PostedJournalLine {
  return { ...accounts[account]!, id, entryId: id.split(":")[0]!, debitMinor: debit, creditMinor: credit, period, currency: "USD", basis: "actual" };
}
const history = [line("opening:0", 0, "10000000", "0", "2026-06"), line("opening:1", 1, "0", "10000000", "2026-06")];
const drivers: ForecastRunInput["drivers"] = [
  { id: "retainers", label: "Client retainers", itemType: "agreement", direction: "receipt", cadence: "monthly", amountMinor: "3000000", effectiveFrom: "2026-10" },
  { id: "projects", label: "Project receipts", itemType: "agreement", direction: "receipt", cadence: "monthly", amountMinor: "1000000", effectiveFrom: "2026-10" },
  ...[["payroll", "Payroll and benefits", "3500000"], ["contractors", "Contractors", "1000000"], ["overhead", "Rent and software", "1000000"], ["tax", "Tax payments", "500000"]].map(([id, label, amountMinor]) => ({ id: id!, label: label!, amountMinor: amountMinor!, itemType: "obligation" as const, direction: "spend" as const, cadence: "monthly" as const, effectiveFrom: "2026-10" })),
];
const agreement: ForecastRunInput["drivers"][number] = { id: "new-agreement", label: "New customer agreement", itemType: "agreement", direction: "receipt" as const, cadence: "once" as const, amountMinor: "2000000", effectiveFrom: "2026-10", evidenceId: "synthetic-agreement", decisionId: "synthetic-approval" };
const base: ForecastRunInput = { accounts, actuals: summarizeActualCash(history, "USD", "2026-09"), drivers, templates: [
  { id: "receipts", itemType: "agreement", direction: "receipt", debitAccountId: "cash", creditAccountId: "sales" },
  { id: "spending", itemType: "obligation" as const, direction: "spend", debitAccountId: "expense", creditAccountId: "cash" },
], currency: "USD", asOfMonth: "2026-09", horizonMonths: 3, minimumCashMinor: "0" };
function view(input = base, actuals = history) { return buildCashExplorer(input, buildForecastRun(input), actuals); }

describe("cash explorer from the shared forecast engine", () => {
  it("carries an approved $20,000 October agreement through every view and later balance without changing history", () => {
    const before = view();
    const after = view({ ...base, drivers: [...drivers, agreement] });
    expect(before.months.find((m) => m.month === "2026-10")?.endingCashMinor).toBe("8000000");
    expect(after.months.find((m) => m.month === "2026-10")?.endingCashMinor).toBe("10000000");
    for (const month of after.months) {
      const previous = before.months.find((m) => m.month === month.month)!;
      if (month.basis === "actual") expect(month).toEqual(previous);
      else expect(BigInt(month.endingCashMinor) - BigInt(previous.endingCashMinor)).toBe(2000000n);
      expect(month.reconciles).toBe(true);
    }
    expect(after.categories.find((row) => row.label === agreement.label)?.amounts).toEqual({ "2026-10": "2000000" });
    expect(before.categories.some((row) => row.label === agreement.label)).toBe(false);
    // Removing it from the approved-driver input restores the excluded forecast.
    expect(view()).toEqual(before);
    expect(after.categories.map((row) => row.label)).toEqual(expect.arrayContaining(drivers.map((driver) => driver.label)));
    expect(after.formulaVersion).toBe(buildForecastRun(base).formulaVersion);
  });

  it("nets internal cash transfers and excludes other currencies from the category table", () => {
    const actuals = [...history, line("transfer:0", 0, "900000", "0", "2026-09"), line("transfer:1", 0, "0", "900000", "2026-09"), { ...line("foreign:0", 0, "100000", "0", "2026-09"), currency: "EUR" }];
    const data = view({ ...base, actuals: summarizeActualCash(actuals, "USD", "2026-09") }, actuals);
    expect(data.months.find((month) => month.month === "2026-09")).toMatchObject({ receiptsMinor: "0", spendingMinor: "0", reconciles: true });
    expect(data.categories.some((row) => row.amounts["2026-09"])).toBe(false);
  });

  it("includes open-month actuals and retains unambiguous account names alongside forecast inputs", () => {
    const actuals = [line("project:0", 0, "12345", "0", "2026-10"), line("project:1", 2, "0", "12345", "2026-10")];
    const data = view({ ...base, openMonth: { month: "2026-10", throughDate: "2026-10-03", actualLines: actuals, forecastedLines: [], matches: [] } });
    expect(data.months.find((m) => m.month === "2026-10")).toMatchObject({ receiptsMinor: "4012345", reconciles: true });
    expect(data.categories.find((row) => row.id === "in:account:sales")?.amounts["2026-10"]).toBe("12345");
  });

  it("flags missing category support instead of silently changing the engine's totals", () => {
    const output = buildForecastRun(base);
    const data = buildCashExplorer(base, { ...output, projectedLines: [] }, history);
    expect(data.months.find((m) => m.month === "2026-10")).toMatchObject({ endingCashMinor: "8000000", reconciles: false });
  });

  it("preserves cents above the safe JavaScript integer range and negative balances", () => {
    const huge = "9007199254740993123";
    const actuals = [line("opening:0", 0, huge, "0", "2026-06"), line("opening:1", 1, "0", huge, "2026-06")];
    const data = view({ ...base, actuals: summarizeActualCash(actuals, "USD", "2026-09") }, actuals);
    expect(data.months.find((m) => m.month === "2026-10")?.endingCashMinor).toBe((BigInt(huge) - 2000000n).toString());
    const negative = view({ ...base, actuals: summarizeActualCash([], "USD", "2026-09") }, []);
    expect(negative.months.find((m) => m.month === "2026-10")).toMatchObject({ endingCashMinor: "-2000000", reconciles: true });
  });
});
