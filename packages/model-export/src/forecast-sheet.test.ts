import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { buildStandardStatements, driverAmountsByMonth, monthRange, resolvePatternDrivers, standardLayoutVersion, type ForecastDriver, type ForecastEntryTemplate, type OperatingMetric, type PatternContext, type PostedJournalLine, type StandardLineId, type StandardMappingAccount, type StandardPeriodColumn } from "@balsa/finance-engine";
import { driverExportPattern, metricExportPattern } from "./export-patterns";
import { forecastColumns, simulateForecast, type ExportDriver, type ForecastInput } from "./forecast-sheet";
import { buildStandardWorkbook, type StandardWorkbookInput } from "./standard-workbook";

// A synthetic company whose drivers exercise every basis and option the sheet implements.
const periods = monthRange("2026-07", "2027-12");
const asOf = "2026-09";
const forecastPeriods = periods.filter((period) => period > asOf);

type Account = { id: string; type: string; name: string; line: StandardLineId; category?: string; timing?: "current" | "noncurrent" };
const accounts: Account[] = [
  { id: "cash", type: "asset", name: "Operating account", line: "cash", timing: "current" },
  { id: "ppe", type: "asset", name: "Equipment", line: "ppe", timing: "noncurrent" },
  { id: "debt", type: "liability", name: "Term loan", line: "debt_financing", timing: "noncurrent" },
  { id: "equity", type: "equity", name: "Common stock", line: "equity_investment" },
  { id: "rev-subs", type: "revenue", name: "Subscriptions", line: "revenue", category: "subs" },
  { id: "rev-services", type: "revenue", name: "Services", line: "revenue" },
  { id: "cogs", type: "expense", name: "Hosting", line: "cogs" },
  { id: "sales", type: "expense", name: "Commissions", line: "sga_sales" },
  { id: "events", type: "expense", name: "Events", line: "sga_sales" },
  { id: "rent", type: "expense", name: "Rent", line: "sga_ga" },
  { id: "payroll", type: "expense", name: "Payroll", line: "sga_ga" },
  { id: "software", type: "expense", name: "Software", line: "sga_misc" },
  { id: "legacy", type: "expense", name: "Legacy contract", line: "sga_misc" },
  { id: "modelled", type: "expense", name: "Modelled cost", line: "sga_misc" },
];
const accountById = new Map(accounts.map((account) => [account.id, account]));
const chart: StandardMappingAccount[] = accounts.map((account) => ({ accountId: account.id, accountCode: account.id, accountName: account.name, accountType: account.type, normalBalance: account.type === "asset" || account.type === "expense" ? "debit" : "credit", reportLine: account.line, ...(account.category ? { reportCategoryId: account.category } : {}), ...(account.timing ? { balanceTiming: account.timing } : {}), ...(account.id === "cash" ? { isCash: true } : {}) }));
const categories = [{ id: "subs", line: "revenue" as const, name: "Subscriptions", sortOrder: 1 }];

// One template per driver: receipts debit cash, spends credit cash, except the loan and the equipment purchase.
const posting: Record<string, string> = { subs: "rev-subs", services: "rev-services", hosting: "cogs", commission: "sales", events: "events", rent: "rent", payroll: "payroll", software: "software", equipment: "ppe", loan: "debt", legacy: "legacy", modelled: "modelled" };
const receipts = new Set(["subs", "services", "loan"]);
const templates: ForecastEntryTemplate[] = Object.entries(posting).map(([id, account]) => receipts.has(id)
  ? { id: `t-${id}`, itemType: "agreement", direction: "receipt", category: id, debitAccountId: "cash", creditAccountId: account }
  : { id: `t-${id}`, itemType: "obligation", direction: "spend", category: id, debitAccountId: account, creditAccountId: "cash" });
const driver = (id: string, extra: Partial<ForecastDriver>): ForecastDriver => ({ id, label: id[0]!.toUpperCase() + id.slice(1), itemType: receipts.has(id) ? "agreement" : "obligation", direction: receipts.has(id) ? "receipt" : "spend", category: id, amountMinor: "0", cadence: "monthly", effectiveFrom: "2026-10", ...extra });
const drivers: ForecastDriver[] = [
  driver("subs", { pattern: { initialValue: "10000", repeatsEveryMonths: 1, change: { basis: "pct_change", everyMonths: 1, by: "0.04" } } }),
  driver("services", { pattern: { initialValue: "25", repeatsEveryMonths: 1, change: { basis: "per_unit", ref: { kind: "metric", name: "customers" } }, seasonalityProfileId: "retail" } }),
  driver("hosting", { pattern: { initialValue: "0.05", repeatsEveryMonths: 1, change: { basis: "pct_of", ref: { kind: "report_line", line: "revenue" } } } }),
  driver("commission", { pattern: { initialValue: "0.1", repeatsEveryMonths: 1, change: { basis: "pct_of", ref: { kind: "driver", driverId: "subs" } }, maxValue: "1300" } }),
  driver("events", { pattern: { initialValue: "750.5", repeatsEveryMonths: 3, change: { basis: "pct_change", everyMonths: 6, by: "0.15" } }, effectiveFrom: "2026-11" }),
  driver("rent", { pattern: { initialValue: "3000", repeatsEveryMonths: 1, escalation: { rate: "0.03", everyMonths: 6, anchor: "driver_start" } } }),
  driver("payroll", { pattern: { initialValue: "14000", repeatsEveryMonths: 1, change: { basis: "abs_change", everyMonths: 3, by: "500" }, escalation: "company", maxMonths: 12 } }),
  driver("software", { pattern: { initialValue: "1000", repeatsEveryMonths: 1, change: { basis: "log_change", everyMonths: 3, by: "0.5" } }, effectiveTo: "2027-09" }),
  driver("equipment", { amountMinor: "2000000", cadence: "once", effectiveFrom: "2027-02" }),
  driver("loan", { amountMinor: "5000000", cadence: "once", effectiveFrom: "2026-11" }),
  driver("legacy", { pattern: { initialValue: "800", repeatsEveryMonths: 1, change: { basis: "pct_change", everyMonths: 12, by: "0.05" } }, effectiveFrom: "2025-01" }),
  driver("modelled", { amountFormula: "headcount * 120", amountByMonth: Object.fromEntries(forecastPeriods.map((period, index) => [period, String(240_000 + index * 12_000)])) }),
];
const metrics: OperatingMetric[] = [{ name: "customers", label: "Customers", effectiveFrom: "2026-07", pattern: { initialValue: "100", repeatsEveryMonths: 1, change: { basis: "pct_change", everyMonths: 1, by: "0.05" } }, actuals: { "2026-07": "100", "2026-08": "104", "2026-09": "110" } }];
const retail = { id: "retail", name: "Retail", deviations: ["-0.2", "-0.2", "-0.1", "-0.1", "0", "0", "0", "0", "0", "0", "0.2", "0.4"] };
const context: PatternContext = { metrics, seasonality: [retail], escalation: { rate: "0.025", everyMonths: 12, anchor: { calendarMonth: 1 } } };
const accountLines = new Map(accounts.map((account) => [account.id, account.line as string]));
const resolved = resolvePatternDrivers(drivers, { months: forecastPeriods, templates, accountLines, context, allMetrics: true });
if (resolved.exceptions.length) throw new Error(`fixture exceptions: ${JSON.stringify(resolved.exceptions)}`);
const amounts = (item: ForecastDriver) => driverAmountsByMonth(resolved.drivers.find((candidate) => candidate.id === item.id)!, periods);
const profileName = (id: string) => (id === retail.id ? retail.name : null);

const exportDrivers: ExportDriver[] = drivers.map((item) => {
  const account = accountById.get(posting[item.id]!)!;
  return {
    id: item.id, label: item.label, direction: item.direction, lineLabel: account.line, referenceLine: account.line,
    pattern: driverExportPattern(item, profileName), note: item.amountFormula ? `Formula in Balsa: ${item.amountFormula}` : null,
    posting: { line: account.line, categoryId: account.category ?? null }, settlement: { line: "cash", categoryId: null },
    amountsByPeriod: amounts(item), exception: null,
  };
});
const forecast: ForecastInput = {
  forecastPeriods, drivers: exportDrivers,
  metrics: metrics.map((metric) => ({ name: metric.name, label: metric.label!, unit: "customers", pattern: metricExportPattern(metric, profileName), actuals: metric.actuals!, valuesByPeriod: resolved.metrics[metric.name]! })),
  seasonality: [{ name: retail.name, deviations: retail.deviations.map(Number) }], escalation: { rate: 0.025, everyMonths: 12, anchorMonth: 1 },
};

// Statements: three months of actuals, then the drivers' amounts posted as the forecast.
let sequence = 0;
const entry = (period: string, legs: [string, number][], basis: NonNullable<PostedJournalLine["basis"]>): PostedJournalLine[] => {
  const entryId = `e${++sequence}`;
  return legs.map(([accountId, amount], index) => { const item = chart.find((candidate) => candidate.accountId === accountId)!; return { id: `${entryId}-${index}`, entryId, accountId, accountCode: item.accountCode, accountName: item.accountName, accountType: item.accountType, normalBalance: item.normalBalance, ...(item.balanceTiming ? { balanceTiming: item.balanceTiming } : {}), ...(item.isCash ? { isCash: true } : {}), basis, currency: "USD", debitMinor: String(Math.max(amount, 0)), creditMinor: String(Math.max(-amount, 0)), period, postingDate: `${period}-15` }; });
};
const lines: PostedJournalLine[] = [...entry("2026-07", [["cash", 20_000_000], ["equity", -20_000_000]], "actual")];
for (const period of periods.filter((candidate) => candidate <= asOf)) lines.push(...entry(period, [["cash", 900_000], ["rev-subs", -900_000]], "actual"), ...entry(period, [["rent", 300_000], ["cash", -300_000]], "actual"));
for (const item of exportDrivers) for (const period of forecastPeriods) {
  const minor = Number(item.amountsByPeriod[period] ?? "0"); if (!minor) continue;
  const account = posting[item.id]!;
  lines.push(...entry(period, item.direction === "receipt" ? [["cash", minor], [account, -minor]] : [[account, minor], ["cash", -minor]], "forecast"));
}
const base: StandardPeriodColumn[] = periods.map((period) => ({ period, basis: period <= asOf ? "actual" : "forecast", statement: buildStandardStatements(lines, period, { accounts: chart, categories, currency: "USD", selection: { view: "projected", asOfPeriod: asOf } }).byCurrency.find((item) => item.currency === "USD")! }));

const input: StandardWorkbookInput = {
  company: { name: "Driver Co", currency: "USD" }, generatedAt: "2026-10-07T00:00:00.000Z", versions: { layout: standardLayoutVersion, forecast: "test" },
  timeline: { firstPeriod: periods[0]!, lastPeriod: periods.at(-1)!, asOfPeriod: asOf, fiscalYearEndMonth: 12, isDefault: false }, minimumCashMinor: "0",
  base, baseRunway: null, plan: null, scenarios: [],
  accounts: chart.map((item) => ({ id: item.accountId, code: item.accountCode, name: item.accountName, section: item.accountType, lineLabel: null, categoryName: null, status: "confirmed", reason: "" })),
  mapping: { confirmed: chart.length, total: chart.length, complete: true }, forecast,
};

describe("simulateForecast", () => {
  it("reproduces the engine's amounts for every basis, and says why the rest are values", () => {
    const plan = simulateForecast(forecast, periods);
    const valueRows = [...plan.live.entries()].filter(([, live]) => !live).map(([key]) => [key, plan.reasons.get(key) ?? null]);
    expect(valueRows).toEqual([["driver:legacy", "It starts before the first month in this file"], ["driver:modelled", null]]);
    expect(plan.live.get("metric:customers")).toBe(true);
    // Spot checks against the engine, independent of the simulator's own comparison.
    const at = (key: string, period: string) => plan.values.get(key)![periods.indexOf(period)];
    expect(at("driver:subs", "2026-11")).toBe(10_400);
    expect(at("metric:customers", "2026-10")).toBeCloseTo(115.5, 6);
    expect(at("driver:services", "2026-11")).toBe(Number(amounts(drivers[1]!)["2026-11"]) / 100);
    expect(at("driver:commission", "2027-12")).toBe(1_300);
    expect(at("driver:payroll", "2027-10")).toBe(0);
    expect(at("driver:software", "2027-10")).toBe(0);
  });

  it("demotes a row whose formula would not reproduce Balsa", () => {
    const tampered = { ...forecast, drivers: forecast.drivers.map((item) => item.id === "rent" ? { ...item, amountsByPeriod: { ...item.amountsByPeriod, "2027-05": "300001" } } : item) };
    const plan = simulateForecast(tampered, periods);
    expect(plan.live.get("driver:rent")).toBe(false);
    expect(plan.reasons.get("driver:rent")).toMatch(/would not reproduce/);
  });
});

const soffice = (() => { try { execFileSync("soffice", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } })();
async function recalculate(bytes: Uint8Array | ArrayBuffer) {
  const directory = mkdtempSync(join(tmpdir(), "balsa-forecast-"));
  writeFileSync(join(directory, "model.xlsx"), new Uint8Array(bytes));
  execFileSync("soffice", ["--headless", "--calc", "--convert-to", "xlsx", "--outdir", join(directory, "out"), join(directory, "model.xlsx")], { env: { ...process.env, HOME: directory }, stdio: "ignore", timeout: 120_000 });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(readFileSync(join(directory, "out", "model.xlsx")).buffer as ArrayBuffer);
  return workbook;
}
const cellNumber = (value: ExcelJS.CellValue) => typeof value === "number" ? value : value === null || value === undefined ? 0 : typeof value === "object" && "formula" in value ? (value.result === undefined ? 0 : typeof value.result === "number" ? value.result : NaN) : NaN;
const checksOf = (workbook: ExcelJS.Workbook) => { const results: Record<string, unknown> = {}; workbook.getWorksheet("Checks")!.eachRow((row) => { const status = row.getCell(2).value; if (status !== null && status !== undefined) results[String(row.getCell(1).value)] = typeof status === "object" && "result" in status ? status.result : status; }); return results; };
const rowOf = (sheet: ExcelJS.Worksheet, label: string) => { let found = 0; sheet.eachRow((row, number) => { if (!found && row.getCell(1).value === label) found = number; }); return found; };
const monthCell = (period: string) => forecastColumns.firstMonth + periods.indexOf(period);

describe.skipIf(!soffice)("live drivers recalculated in LibreOffice", () => {
  let exported: ExcelJS.Workbook; let edited: ExcelJS.Workbook;
  const plan = simulateForecast(forecast, periods);
  beforeAll(async () => {
    const bytes = await buildStandardWorkbook(input);
    exported = await recalculate(bytes);
    // Edit one input the way a reader would: subscriptions start at 12,000 instead of 10,000.
    const source = new ExcelJS.Workbook(); await source.xlsx.load(bytes.buffer as ArrayBuffer);
    const sheet = source.getWorksheet("Forecast")!;
    sheet.getCell(rowOf(sheet, "Subs"), forecastColumns.initial).value = 12_000;
    edited = await recalculate(await source.xlsx.writeBuffer() as ArrayBuffer);
  }, 240_000);

  it("lands every driver and metric on Balsa's amounts, and every check passes", () => {
    const sheet = exported.getWorksheet("Forecast")!;
    for (const item of [...forecast.drivers.map((driverItem) => ({ key: `driver:${driverItem.id}`, label: driverItem.label })), ...forecast.metrics.map((metric) => ({ key: `metric:${metric.name}`, label: metric.label }))]) {
      const row = rowOf(sheet, item.label);
      for (const period of forecastPeriods) expect(cellNumber(sheet.getCell(row, monthCell(period)).value), `${item.label} ${period}`).toBeCloseTo(plan.values.get(item.key)![periods.indexOf(period)]!, 6);
    }
    expect(checksOf(exported)).toEqual({
      "Net income equals Balsa": "yes", "Total assets equal Balsa": "yes", "Total liabilities and equity equal Balsa": "yes", "Cash end of period equals Balsa": "yes",
      "Balance sheet balances every month": "yes", "Cash flow explains the change in cash": "yes", "Summary net income equals the months it covers": "yes",
      "Every account with an amount is placed on a line": "yes", "Every account's line is confirmed in Balsa": "yes",
      "Driver formulas reproduce Balsa's driver amounts": "yes", "No forecast driver has an exception": "yes",
    });
  });

  it("flows an edited input through the drivers that depend on it and keeps the statements whole", () => {
    const changed = simulateForecast({ ...forecast, drivers: forecast.drivers.map((item) => item.id === "subs" ? { ...item, pattern: { ...item.pattern!, initialValue: 12_000 } } : item) }, periods, { compare: false });
    const sheet = edited.getWorksheet("Forecast")!;
    for (const label of ["Subs", "Hosting", "Commission"]) {
      const key = `driver:${label.toLowerCase()}`;
      for (const period of forecastPeriods) expect(cellNumber(sheet.getCell(rowOf(sheet, label), monthCell(period)).value), `${label} ${period}`).toBeCloseTo(changed.values.get(key)![periods.indexOf(period)]!, 6);
    }
    const checks = checksOf(edited);
    expect(checks).toMatchObject({ "Balance sheet balances every month": "yes", "Cash flow explains the change in cash": "yes", "Driver formulas reproduce Balsa's driver amounts": "no", "Net income equals Balsa": "no", "Cash end of period equals Balsa": "no" });
    // Net income moves by the revenue added less hosting and commission on it, month by month.
    const statements = edited.getWorksheet("Statements")!; const before = exported.getWorksheet("Statements")!;
    const netIncome = rowOf(statements, "Net income (loss)");
    for (const period of forecastPeriods) {
      const index = periods.indexOf(period);
      const delta = (key: string) => changed.values.get(key)![index]! - plan.values.get(key)![index]!;
      expect(cellNumber(statements.getCell(netIncome, 3 + index).value) - cellNumber(before.getCell(netIncome, 3 + index).value), period).toBeCloseTo(delta("driver:subs") - delta("driver:hosting") - delta("driver:commission"), 2);
    }
  });
});
