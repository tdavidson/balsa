import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { buildStandardStatements, rollupStandardByFiscalYear, standardLayoutVersion, type PostedJournalLine, type StandardMappingAccount, type StandardPeriodColumn } from "@balsa/finance-engine";
import { buildStandardWorkbook, columnLetter, formulaFunctions, type StandardWorkbookInput } from "./standard-workbook";

const account = (accountId: string, accountType: string, accountName: string, extra: Partial<StandardMappingAccount> = {}): StandardMappingAccount => ({ accountId, accountCode: accountId, accountName, accountType, normalBalance: accountType === "asset" || accountType === "expense" ? "debit" : "credit", ...extra });
const chart = [
  account("1000", "asset", "Cash - operating", { balanceTiming: "current" }),
  account("1100", "asset", "Accounts receivable", { balanceTiming: "current", workingCapitalCategory: "receivables" }),
  account("2000", "liability", "Accounts payable", { balanceTiming: "current" }),
  account("3000", "equity", "Common stock"),
  account("4000", "revenue", "Subscription revenue", { reportLine: "revenue", reportCategoryId: "subs" }),
  account("4010", "revenue", "Services revenue", { reportLine: "revenue" }),
  account("5000", "expense", "Hosting cost of revenue"),
  account("6200", "expense", "Office rent"),
];
const byId = new Map(chart.map((item) => [item.accountId, item]));
let sequence = 0;
function entry(period: string, legs: [string, number][], basis: PostedJournalLine["basis"] = "actual", scenarioId?: string): PostedJournalLine[] {
  const entryId = `e${++sequence}`;
  return legs.map(([accountId, amount], index) => { const item = byId.get(accountId)!; return { id: `${entryId}-${index}`, entryId, accountId, accountCode: item.accountCode, accountName: item.accountName, accountType: item.accountType, normalBalance: item.normalBalance, ...(item.balanceTiming ? { balanceTiming: item.balanceTiming } : {}), ...(item.workingCapitalCategory ? { workingCapitalCategory: item.workingCapitalCategory } : {}), basis, ...(scenarioId ? { scenarioId } : {}), currency: "USD", debitMinor: String(Math.max(amount, 0)), creditMinor: String(Math.max(-amount, 0)), period, postingDate: `${period}-15` }; });
}
const periods = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"];
const asOf = "2026-08";
const lines: PostedJournalLine[] = [...entry("2026-04", [["1000", 10_000_000], ["3000", -10_000_000]])];
for (const [index, period] of periods.entries()) {
  const basis = period <= asOf ? "actual" : "forecast";
  lines.push(...entry(period, [["1100", 1_234_567 + index * 1_001], ["4000", -1_000_000 - index * 1_001], ["4010", -234_567]], basis));
  lines.push(...entry(period, [["1000", 1_100_000], ["1100", -1_100_000]], basis));
  lines.push(...entry(period, [["5000", 150_033], ["6200", 400_000], ["2000", -550_033]], basis));
  lines.push(...entry(period, [["2000", 500_000], ["1000", -500_000]], basis));
  if (period > "2026-06") lines.push(...entry(period, [["5000", 160_000], ["6200", 400_000], ["2000", -560_000]], "plan"));
  if (period > "2026-06") lines.push(...entry(period, [["1100", 1_300_000], ["4000", -1_300_000]], "plan"));
  if (period > asOf) lines.push(...entry(period, [["6200", 250_000], ["1000", -250_000]], "scenario", "hire"));
}
const categories = [{ id: "subs", line: "revenue" as const, name: "Subscriptions", sortOrder: 1 }];
const columns = (selection: Parameters<typeof buildStandardStatements>[2]["selection"], basis: StandardPeriodColumn["basis"]): StandardPeriodColumn[] => periods.map((period) => ({ period, basis: period <= asOf ? "actual" : basis, statement: buildStandardStatements(lines, period, { accounts: chart, categories, currency: "USD", ...(selection ? { selection } : {}) }).byCurrency.find((item) => item.currency === "USD")! }));
const base = columns({ view: "projected", asOfPeriod: asOf }, "forecast");
const plan = columns({ basis: "plan" }, "forecast");
const scenario = columns({ view: "scenario", scenarioId: "hire", asOfPeriod: asOf }, "scenario");

const input: StandardWorkbookInput = {
  company: { name: "Synthetic Co", currency: "USD" }, generatedAt: "2026-10-06T00:00:00.000Z", versions: { layout: standardLayoutVersion, forecast: "test" },
  timeline: { firstPeriod: periods[0]!, lastPeriod: periods.at(-1)!, asOfPeriod: asOf, fiscalYearEndMonth: 6, isDefault: false }, minimumCashMinor: "5000000",
  base, baseRunway: { runwayMonths: null, cashOutMonth: null }, plan,
  scenarios: [{ id: "hire", name: "Hire an engineer", description: "Adds $2,500 a month", months: scenario, runway: { runwayMonths: null, cashOutMonth: null } }],
  accounts: chart.map((item) => ({ id: item.accountId, code: item.accountCode, name: item.accountName, section: item.accountType, lineLabel: null, categoryName: null, status: "suggested", reason: "" })),
  mapping: { confirmed: 2, total: chart.length, complete: false },
  drivers: [{ label: "Hosting", direction: "spend", lineLabel: "COGS", columns: { initialValue: "4%", startsIn: "2026-09", repeatsEvery: "1", changingBasedOn: "% of", changesEvery: "", changingBy: "", usingDriver: "Total revenues", maxMonths: "", maxValue: "", seasonality: "", escalation: "" }, amountsByPeriod: { "2026-09": "48000", "2026-10": "49000" }, exception: null }],
  metrics: [{ label: "Customers", unit: "customers", summary: "100 every month, changing 5% every month", valuesByPeriod: { "2026-09": "100", "2026-10": "105" } }],
};
const minor = (statement: Pick<StandardPeriodColumn["statement"], "incomeStatement" | "balanceSheet" | "cashFlow">, key: string) => Number(BigInt([...statement.incomeStatement, ...statement.balanceSheet, ...statement.cashFlow].find((row) => row.key === key)!.amountMinor)) / 100;
/** LibreOffice stores no cached value for a zero result, so a formula without one reads as zero; an error result stays NaN. */
const cellNumber = (value: ExcelJS.CellValue) => typeof value === "number" ? value : value && typeof value === "object" && "formula" in value ? (value.result === undefined ? 0 : typeof value.result === "number" ? value.result : NaN) : NaN;

describe("formulaFunctions", () => {
  it("finds function names outside strings and sheet names", () => {
    expect(formulaFunctions(`IF(SUMPRODUCT(ABS('Sum(x)'!A1:A2))<1,"MAX(","no")`)).toEqual(["IF", "SUMPRODUCT", "ABS"]);
    expect(columnLetter(1)).toBe("A"); expect(columnLetter(27)).toBe("AA"); expect(columnLetter(702)).toBe("ZZ");
  });
});

describe("buildStandardWorkbook", () => {
  let workbook: ExcelJS.Workbook;
  beforeAll(async () => { workbook = new ExcelJS.Workbook(); await workbook.xlsx.load((await buildStandardWorkbook(input)).buffer as ArrayBuffer); });

  it("follows the Standard model's sheet order", () => {
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["README", "Get Started", "Summary", "Forecast", "Statements", "Plan", "Budget", "Scenarios", "Mapping", "Lineage", "Checks"]);
  });

  it("writes line items as Balsa values and totals as formulas", () => {
    const sheet = workbook.getWorksheet("Statements")!;
    const rowOf = (label: string) => { let found = 0; sheet.eachRow((row, number) => { if (!found && row.getCell(1).value === label) found = number; }); return found; };
    expect(sheet.getCell(rowOf("Revenues"), 3).value).toBe(minor(base[0]!.statement, "line:revenue"));
    expect(sheet.getCell(rowOf("Subscriptions"), 3).value).toBe(minor(base[0]!.statement, "category:subs"));
    expect(sheet.getCell(rowOf("Uncategorized"), 3).value).toMatchObject({ formula: expect.stringMatching(/^C\d+-\(C\d+\)$/) });
    expect(sheet.getCell(rowOf("Gross margin"), 3).value).toMatchObject({ formula: expect.any(String) });
    expect(sheet.getCell(rowOf("Net income (loss)"), 3).value).toMatchObject({ formula: expect.any(String) });
  });

  it("lists drivers in the Standard driver columns with forecast-month amounts only", () => {
    const sheet = workbook.getWorksheet("Forecast")!;
    expect(sheet.getCell(5, 4).value).toBe("Initial value");
    expect(sheet.getRow(6).values).toEqual(expect.arrayContaining(["Hosting", "Spend", "COGS", "4%", "% of", "Total revenues"]));
    const septemberColumn = 4 + 11 + periods.indexOf("2026-09"); const augustColumn = 4 + 11 + periods.indexOf("2026-08");
    expect(sheet.getCell(6, septemberColumn).value).toBe(480);
    expect(sheet.getCell(6, augustColumn).value).toBeNull();
    let metricRow = 0; sheet.eachRow((row, number) => { if (row.getCell(1).value === "Customers") metricRow = number; });
    expect(sheet.getCell(metricRow, 4 + 11 + periods.indexOf("2026-10")).value).toBe(105);
  });

  it("omits Plan, Budget and Scenarios when there is nothing to show", async () => {
    const bare = new ExcelJS.Workbook();
    await bare.xlsx.load((await buildStandardWorkbook({ ...input, plan: null, scenarios: [], drivers: [], metrics: [] })).buffer as ArrayBuffer);
    expect(bare.worksheets.map((sheet) => sheet.name)).toEqual(["README", "Get Started", "Summary", "Statements", "Mapping", "Lineage", "Checks"]);
  });
});

/** The parity proof: an independent spreadsheet engine recalculates every formula and must land on Balsa's numbers. */
const soffice = (() => { try { execFileSync("soffice", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } })();
describe.skipIf(!soffice)("recalculated in LibreOffice", () => {
  let workbook: ExcelJS.Workbook;
  beforeAll(async () => {
    const directory = mkdtempSync(join(tmpdir(), "balsa-export-"));
    writeFileSync(join(directory, "model.xlsx"), await buildStandardWorkbook(input));
    try { execFileSync("soffice", ["--headless", "--calc", "--convert-to", "xlsx", "--outdir", join(directory, "out"), join(directory, "model.xlsx")], { env: { ...process.env, HOME: directory }, stdio: "ignore", timeout: 120_000 }); }
    catch { throw new Error("LibreOffice is installed but could not convert the workbook; install the Calc component (libreoffice-calc)."); }
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(readFileSync(join(directory, "out", "model.xlsx")).buffer as ArrayBuffer);
  }, 180_000);

  const rowOf = (sheet: ExcelJS.Worksheet, label: string, after = 0) => { let found = 0; sheet.eachRow((row, number) => { if (!found && number > after && row.getCell(1).value === label) found = number; }); return found; };

  it("passes every check", () => {
    const checks = workbook.getWorksheet("Checks")!;
    const results: Record<string, unknown> = {};
    checks.eachRow((row) => { const status = row.getCell(2).value; if (status !== null && status !== undefined) results[String(row.getCell(1).value)] = typeof status === "object" && "result" in status ? status.result : status; });
    expect(results).toEqual({
      "Net income equals Balsa": "yes", "Total assets equal Balsa": "yes", "Total liabilities and equity equal Balsa": "yes", "Cash end of period equals Balsa": "yes",
      "Balance sheet balances every month": "yes", "Cash flow explains the change in cash": "yes", "Summary net income equals the months it covers": "yes", "Every account with an amount is placed on a line": "yes", "Every account's line is confirmed in Balsa": "no",
    });
  });

  it("rolls up fiscal years exactly as Balsa does", () => {
    const summary = workbook.getWorksheet("Summary")!;
    const years = rollupStandardByFiscalYear(base, 6);
    expect(years.map((year) => year.fiscalYear)).toEqual([2026, 2027]);
    for (const [index, year] of years.entries()) {
      for (const key of ["net_income", "total_assets", "cf_cash_end", "gross_margin"]) {
        const label = [...year.statement.incomeStatement, ...year.statement.balanceSheet, ...year.statement.cashFlow].find((row) => row.key === key)!.label;
        expect(cellNumber(summary.getCell(rowOf(summary, label), 3 + index).value), `${key} FY${year.fiscalYear}`).toBeCloseTo(minor(year.statement, key), 2);
      }
    }
  });

  it("compares the plan with actuals over the default window", () => {
    const budget = workbook.getWorksheet("Budget")!;
    const actualPeriods = periods.filter((period) => period <= asOf);
    const sum = (set: StandardPeriodColumn[], key: string) => set.filter((month) => actualPeriods.includes(month.period)).reduce((total, month) => total + minor(month.statement, key), 0);
    const row = rowOf(budget, "Net income (loss)");
    expect(cellNumber(budget.getCell(row, 2).value)).toBeCloseTo(sum(plan, "net_income"), 2);
    expect(cellNumber(budget.getCell(row, 3).value)).toBeCloseTo(sum(base, "net_income"), 2);
    expect(cellNumber(budget.getCell(row, 4).value)).toBeCloseTo(sum(base, "net_income") - sum(plan, "net_income"), 2);
  });

  it("shows each scenario's difference from base", () => {
    const sheet = workbook.getWorksheet("Scenarios")!;
    const row = rowOf(sheet, "Cash change from base");
    const last = periods.length - 1;
    expect(cellNumber(sheet.getCell(row, 3 + last).value)).toBeCloseTo(minor(scenario[last]!.statement, "cf_cash_end") - minor(base[last]!.statement, "cf_cash_end"), 2);
    expect(cellNumber(sheet.getCell(row, 3 + last).value)).toBeCloseTo(-2_500 * periods.filter((period) => period > asOf).length, 2);
  });
});
