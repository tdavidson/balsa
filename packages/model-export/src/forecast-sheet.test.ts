import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import { buildStandardStatements, driverAmountsByMonth, evaluateModel, monthRange, resolveFormulaDrivers, resolvePatternDrivers, type ForecastModel, standardLayoutVersion, type ForecastDriver, type ForecastEntryTemplate, type OperatingMetric, type PatternContext, type PostedJournalLine, type StandardLineId, type StandardMappingAccount, type StandardPeriodColumn } from "@balsa/finance-engine";
import { driverExportPattern, metricExportPattern } from "./export-patterns";
import { forecastColumns, simulateForecast, type ExportDriver, type ForecastInput } from "./forecast-sheet";
import { buildStandardWorkbook, type StandardWorkbookInput } from "./standard-workbook";
import { modelHeader, planModel, type ModelPlan } from "./model-sheet";
import { patternFromExport, readWorkbookEdits, stepInputs, type WorkbookEdit } from "./round-trip";

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
  { id: "contract", type: "expense", name: "Contractors", line: "sga_rd" },
  { id: "software", type: "expense", name: "Software", line: "sga_misc" },
  { id: "legacy", type: "expense", name: "Legacy contract", line: "sga_misc" },
  { id: "modelled", type: "expense", name: "Modelled cost", line: "sga_misc" },
  { id: "seat-licences", type: "expense", name: "Seat licences", line: "sga_misc" },
];
const accountById = new Map(accounts.map((account) => [account.id, account]));
const chart: StandardMappingAccount[] = accounts.map((account) => ({ accountId: account.id, accountCode: account.id, accountName: account.name, accountType: account.type, normalBalance: account.type === "asset" || account.type === "expense" ? "debit" : "credit", reportLine: account.line, ...(account.category ? { reportCategoryId: account.category } : {}), ...(account.timing ? { balanceTiming: account.timing } : {}), ...(account.id === "cash" ? { isCash: true } : {}) }));
const categories = [{ id: "subs", line: "revenue" as const, name: "Subscriptions", sortOrder: 1 }];

// One template per driver: receipts debit cash, spends credit cash, except the loan and the equipment purchase.
const posting: Record<string, string> = { subs: "rev-subs", services: "rev-services", hosting: "cogs", commission: "sales", events: "events", rent: "rent", payroll: "payroll", software: "software", contractor: "contract", equipment: "ppe", loan: "debt", legacy: "legacy", modelled: "modelled", seats: "seat-licences" };
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
  driver("modelled", { amountFormula: "sum(payroll) / 10 + avg(headcount) * 3.5 + ramp" }),
  driver("seats", { pattern: { initialValue: "45", repeatsEveryMonths: 1, change: { basis: "per_unit", ref: { kind: "metric", name: "headcount" } } } }),
];
const metrics: OperatingMetric[] = [{ name: "customers", label: "Customers", effectiveFrom: "2026-07", pattern: { initialValue: "100", repeatsEveryMonths: 1, change: { basis: "pct_change", everyMonths: 1, by: "0.05" } }, actuals: { "2026-07": "100", "2026-08": "104", "2026-09": "110" } }];
const retail = { id: "retail", name: "Retail", deviations: ["-0.2", "-0.2", "-0.1", "-0.1", "0", "0", "0", "0", "0", "0", "0.2", "0.4"] };
const context: PatternContext = { metrics, seasonality: [retail], escalation: { rate: "0.025", everyMonths: 12, anchor: { calendarMonth: 1 } } };
const accountLines = new Map(accounts.map((account) => [account.id, account.line as string]));
// A forecast model: step inputs by team, a reduction, a product, prev() and round().
const model: ForecastModel = {
  dimensions: [{ name: "team", items: ["eng", "sales"] }],
  variables: [
    { name: "headcount", kind: "number", dims: ["team"], inputs: [{ coords: { team: "eng" }, from: "2026-09", value: "2" }, { coords: { team: "eng" }, from: "2027-01", value: "3" }, { coords: { team: "sales" }, from: "2026-12", value: "1" }] },
    { name: "salary", kind: "money", dims: ["team"], inputs: [{ coords: { team: "eng" }, from: "2026-01", value: "9000.5" }, { coords: { team: "sales" }, from: "2026-01", value: "6500" }] },
    { name: "payroll", kind: "money", dims: ["team"], formula: "headcount * salary * 1.0725", inputs: [] },
    { name: "ramp", kind: "money", dims: [], formula: "round(prev(sum(headcount)) * 33.333333, 2)", inputs: [] },
  ],
};
const modelMonths = monthRange(asOf, periods.at(-1)!);
const withFormulas = (set: ForecastDriver[]) => resolveFormulaDrivers(set, model, modelMonths).drivers;
const resolved = resolvePatternDrivers(withFormulas(drivers), { months: forecastPeriods, templates, accountLines, model, context, allMetrics: true });
if (resolved.exceptions.length) throw new Error(`fixture exceptions: ${JSON.stringify(resolved.exceptions)}`);
const amounts = (item: ForecastDriver) => driverAmountsByMonth(resolved.drivers.find((candidate) => candidate.id === item.id)!, periods);
const profileName = (id: string) => (id === retail.id ? retail.name : null);

// A scenario: faster subscription growth (so hosting and commission move with it), no events, and a contractor.
const scenarioDrivers = [
  ...drivers.filter((item) => item.id !== "events").map((item) => item.id === "subs" ? { ...item, pattern: { ...item.pattern!, change: { basis: "pct_change" as const, everyMonths: 1, by: "0.06" } } } : item),
  driver("contractor", { amountMinor: "200000", effectiveFrom: "2026-12" }),
];
const resolvedScenario = resolvePatternDrivers(withFormulas(scenarioDrivers), { months: forecastPeriods, templates, accountLines, model, context });
const scenarioAmounts = (item: ForecastDriver) => driverAmountsByMonth(resolvedScenario.drivers.find((candidate) => candidate.id === item.id)!, periods);

const exportDriver = (item: ForecastDriver, amountsByPeriod: Record<string, string>, scenarioId: string | null): ExportDriver => {
  const account = accountById.get(posting[item.id]!)!;
  return {
    id: item.id, label: item.label, direction: item.direction, lineLabel: account.line, referenceLine: account.line, scenarioId, excludedIn: [],
    pattern: driverExportPattern(item, profileName), note: null,
    formula: item.amountFormula ? { text: item.amountFormula, startsIn: item.effectiveFrom, endsIn: item.effectiveTo ?? null, repeatsEvery: 1 } : null,
    posting: { line: account.line, categoryId: account.category ?? null }, settlement: { line: "cash", categoryId: null },
    amountsByPeriod, exception: null,
  };
};
const exportDrivers: ExportDriver[] = drivers.map((item) => exportDriver(item, amounts(item), null));
// The same rule the web export uses: a driver the scenario adds, or whose pattern or amounts it changes, gets its own row.
for (const item of scenarioDrivers) {
  const original = exportDrivers.find((candidate) => candidate.id === item.id && candidate.scenarioId === null);
  const own = exportDriver(item, scenarioAmounts(item), "growth");
  if (original && JSON.stringify(original.pattern) === JSON.stringify(own.pattern) && JSON.stringify(original.amountsByPeriod) === JSON.stringify(own.amountsByPeriod)) continue;
  original?.excludedIn.push("growth"); exportDrivers.push(own);
}
for (const item of exportDrivers) if (item.scenarioId === null && !scenarioDrivers.some((candidate) => candidate.id === item.id)) item.excludedIn.push("growth");
const forecast: ForecastInput = {
  forecastPeriods, drivers: exportDrivers, scenarios: [{ id: "growth", name: "Faster growth" }],
  metrics: [
    ...metrics.map((metric) => ({ name: metric.name, label: metric.label!, unit: "customers", pattern: metricExportPattern(metric, profileName), actuals: metric.actuals!, valuesByPeriod: resolved.metrics[metric.name]! })),
    { name: "headcount", label: "headcount (model variable)", unit: null, pattern: null, variable: true, actuals: {}, valuesByPeriod: resolved.metrics.headcount! },
  ],
  seasonality: [{ name: retail.name, deviations: retail.deviations.map(Number) }], escalation: { rate: 0.025, everyMonths: 12, anchorMonth: 1 },
};

// Statements: three months of actuals, then the drivers' amounts posted as the forecast.
let sequence = 0;
const entry = (period: string, legs: [string, number][], basis: NonNullable<PostedJournalLine["basis"]>, scenarioId?: string): PostedJournalLine[] => {
  const entryId = `e${++sequence}`;
  return legs.map(([accountId, amount], index) => { const item = chart.find((candidate) => candidate.accountId === accountId)!; return { id: `${entryId}-${index}`, entryId, accountId, accountCode: item.accountCode, accountName: item.accountName, accountType: item.accountType, normalBalance: item.normalBalance, ...(item.balanceTiming ? { balanceTiming: item.balanceTiming } : {}), ...(item.isCash ? { isCash: true } : {}), basis, ...(scenarioId ? { scenarioId } : {}), currency: "USD", debitMinor: String(Math.max(amount, 0)), creditMinor: String(Math.max(-amount, 0)), period, postingDate: `${period}-15` }; });
};
const lines: PostedJournalLine[] = [...entry("2026-07", [["cash", 20_000_000], ["equity", -20_000_000]], "actual")];
for (const period of periods.filter((candidate) => candidate <= asOf)) lines.push(...entry(period, [["cash", 900_000], ["rev-subs", -900_000]], "actual"), ...entry(period, [["rent", 300_000], ["cash", -300_000]], "actual"));
const post = (item: ExportDriver, period: string, minor: number, basis: "forecast" | "scenario") => {
  if (!minor) return;
  const account = posting[item.id]!;
  lines.push(...entry(period, item.direction === "receipt" ? [["cash", minor], [account, -minor]] : [[account, minor], ["cash", -minor]], basis, basis === "scenario" ? "growth" : undefined));
};
for (const item of exportDrivers.filter((candidate) => candidate.scenarioId === null)) for (const period of forecastPeriods) post(item, period, Number(item.amountsByPeriod[period] ?? "0"), "forecast");
// The scenario's lines are its differences from the base forecast, as Balsa posts them.
for (const id of new Set(exportDrivers.map((item) => item.id))) {
  const baseRow = exportDrivers.find((item) => item.id === id && item.scenarioId === null);
  const scenarioRow = exportDrivers.find((item) => item.id === id && item.scenarioId === "growth") ?? (baseRow && !baseRow.excludedIn.includes("growth") ? baseRow : undefined);
  for (const period of forecastPeriods) post((scenarioRow ?? baseRow)!, period, Number(scenarioRow?.amountsByPeriod[period] ?? "0") - Number(baseRow?.amountsByPeriod[period] ?? "0"), "scenario");
}
const statementsFor = (selection: Parameters<typeof buildStandardStatements>[2]["selection"], basis: StandardPeriodColumn["basis"]): StandardPeriodColumn[] => periods.map((period) => ({ period, basis: period <= asOf ? "actual" : basis, statement: buildStandardStatements(lines, period, { accounts: chart, categories, currency: "USD", ...(selection ? { selection } : {}) }).byCurrency.find((item) => item.currency === "USD")! }));
const base = statementsFor({ view: "projected", asOfPeriod: asOf }, "forecast");
const scenario = statementsFor({ view: "scenario", scenarioId: "growth", asOfPeriod: asOf }, "scenario");

const input: StandardWorkbookInput = {
  company: { name: "Driver Co", currency: "USD" }, generatedAt: "2026-10-07T00:00:00.000Z", versions: { layout: standardLayoutVersion, forecast: "test" },
  timeline: { firstPeriod: periods[0]!, lastPeriod: periods.at(-1)!, asOfPeriod: asOf, fiscalYearEndMonth: 12, isDefault: false }, minimumCashMinor: "0",
  base, baseRunway: null, plan: null, scenarios: [{ id: "growth", name: "Faster growth", description: null, months: scenario, runway: { runwayMonths: null, cashOutMonth: null } }],
  accounts: chart.map((item) => ({ id: item.accountId, code: item.accountCode, name: item.accountName, section: item.accountType, lineLabel: null, categoryName: null, status: "confirmed", reason: "" })),
  mapping: { confirmed: chart.length, total: chart.length, complete: true }, forecast, model: { definition: model, months: modelMonths },
};

const modelLink = planModel({ definition: model, months: modelMonths }, modelHeader.labels + 2) as ModelPlan;

describe("simulateForecast", () => {
  it("reproduces the engine's amounts for every basis, and says why the rest are values", () => {
    const plan = simulateForecast(forecast, periods, { model: modelLink });
    const valueRows = [...plan.live.entries()].filter(([, live]) => !live).map(([key]) => [key, plan.reasons.get(key) ?? null]);
    expect(valueRows).toEqual([["driver:legacy", "It starts before the first month in this file"]]);
    expect(plan.live.get("driver:modelled")).toBe(true); expect(plan.live.get("metric:headcount")).toBe(true); expect(plan.live.get("driver:seats")).toBe(true);
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

  it("reproduces each scenario's amounts with only that scenario's rows in use", () => {
    const plan = simulateForecast(forecast, periods, { model: modelLink });
    expect(plan.live.get("driver:subs@growth")).toBe(true);
    expect(plan.live.get("driver:hosting@growth")).toBe(true);
    const inScenario = plan.byScenario[1]!;
    const at = (key: string, period: string) => inScenario.get(key)![periods.indexOf(period)]!;
    expect(at("driver:subs@growth", "2026-11")).toBe(10_600);
    expect(at("driver:subs", "2026-11")).toBe(0);
    expect(at("driver:events", "2027-02")).toBe(0);
    expect(at("driver:hosting@growth", "2026-12")).toBe(Number(scenarioAmounts(scenarioDrivers.find((item) => item.id === "hosting")!)["2026-12"]) / 100);
  });

  it("demotes a row whose formula would not reproduce Balsa", () => {
    const tampered = { ...forecast, drivers: forecast.drivers.map((item) => item.id === "rent" ? { ...item, amountsByPeriod: { ...item.amountsByPeriod, "2027-05": "300001" } } : item) };
    const plan = simulateForecast(tampered, periods, { model: modelLink });
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
  const plan = simulateForecast(forecast, periods, { model: modelLink });
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
    for (const item of [...forecast.drivers.filter((driverItem) => driverItem.scenarioId === null).map((driverItem) => ({ key: `driver:${driverItem.id}`, label: driverItem.label })), ...forecast.metrics.map((metric) => ({ key: `metric:${metric.name}`, label: metric.label }))]) {
      const row = rowOf(sheet, item.label);
      for (const period of forecastPeriods) expect(cellNumber(sheet.getCell(row, monthCell(period)).value), `${item.label} ${period}`).toBeCloseTo(plan.values.get(item.key)![periods.indexOf(period)]!, 6);
    }
    expect(checksOf(exported)).toEqual({
      "Net income equals Balsa": "yes", "Total assets equal Balsa": "yes", "Total liabilities and equity equal Balsa": "yes", "Cash end of period equals Balsa": "yes",
      "Balance sheet balances every month": "yes", "Cash flow explains the change in cash": "yes", "Summary net income equals the months it covers": "yes",
      "Every account with an amount is placed on a line": "yes", "Every account's line is confirmed in Balsa": "yes",
      "Driver formulas reproduce Balsa's driver amounts": "yes", "No forecast driver has an exception, in any scenario": "yes",
    });
  });

  it("switches the whole model to a scenario from Get Started", async () => {
    const source = new ExcelJS.Workbook(); await source.xlsx.load((await buildStandardWorkbook(input)).buffer as ArrayBuffer);
    source.getWorksheet("Get Started")!.getCell("S10").value = "Faster growth";
    const switched = await recalculate(await source.xlsx.writeBuffer() as ArrayBuffer);
    expect(checksOf(switched)).toMatchObject({ "Net income equals Balsa": "yes", "Total assets equal Balsa": "yes", "Cash end of period equals Balsa": "yes", "Balance sheet balances every month": "yes", "Cash flow explains the change in cash": "yes", "Driver formulas reproduce Balsa's driver amounts": "yes" });
    const statements = switched.getWorksheet("Statements")!;
    const netIncome = rowOf(statements, "Net income (loss)"); const cash = rowOf(statements, "Cash");
    const figure = (columns: StandardPeriodColumn[], index: number, key: string) => Number(BigInt([...columns[index]!.statement.incomeStatement, ...columns[index]!.statement.balanceSheet].find((row) => row.key === key)!.amountMinor)) / 100;
    for (const period of forecastPeriods) {
      const index = periods.indexOf(period);
      expect(cellNumber(statements.getCell(netIncome, 3 + index).value), period).toBeCloseTo(figure(scenario, index, "net_income"), 2);
      expect(cellNumber(statements.getCell(cash, 3 + index).value), period).toBeCloseTo(figure(scenario, index, "line:cash"), 2);
    }
    expect(figure(scenario, periods.length - 1, "net_income")).not.toBeCloseTo(figure(base, periods.length - 1, "net_income"), 0);
  });

  it("writes the forecast model as rows that recalculate to the engine's values", () => {
    const sheet = exported.getWorksheet("Model")!;
    let checked = 0;
    for (const variable of modelLink.variables) for (const candidate of variable.rows) for (const [index] of modelMonths.entries()) {
      const expected = modelLink.engine.get(variable.name)!.get(candidate.key)![index]!;
      expect(cellNumber(sheet.getCell(candidate.row, 5 + index).value), `${variable.name}[${candidate.key}] ${modelMonths[index]}`).toBeCloseTo(expected, 6); checked += 1;
    }
    expect(checked).toBeGreaterThan(50);
    expect(modelLink.live.get("payroll")).toBe(true); expect(modelLink.live.get("ramp")).toBe(true);
  });

  it("matches Balsa's own engine after an input on the Model sheet is edited", async () => {
    // Engineering grows to 5 from March: edit the file, and make the same change in the engine.
    const source = new ExcelJS.Workbook(); await source.xlsx.load((await buildStandardWorkbook(input)).buffer as ArrayBuffer);
    const engRow = modelLink.variables.find((variable) => variable.name === "headcount")!.rows.find((candidate) => candidate.key === "eng")!.row;
    modelMonths.forEach((month, index) => { if (month >= "2027-03") source.getWorksheet("Model")!.getCell(engRow, 5 + index).value = 5; });
    const edited = await recalculate(await source.xlsx.writeBuffer() as ArrayBuffer);
    const changedModel: ForecastModel = { ...model, variables: model.variables.map((variable) => variable.name === "headcount" ? { ...variable, inputs: [...variable.inputs, { coords: { team: "eng" }, from: "2027-03", value: "5" }] } : variable) };
    const engineAfter = resolvePatternDrivers(resolveFormulaDrivers(drivers, changedModel, modelMonths).drivers, { months: forecastPeriods, templates, accountLines, model: changedModel, context });
    const sheet = edited.getWorksheet("Forecast")!;
    for (const id of ["modelled", "seats"]) {
      const after = driverAmountsByMonth(engineAfter.drivers.find((item) => item.id === id)!, periods);
      expect(after["2027-06"], `${id} moves with the edit`).not.toBe(amounts(drivers.find((item) => item.id === id)!)["2027-06"]);
      const row = rowOf(sheet, id[0]!.toUpperCase() + id.slice(1));
      for (const period of forecastPeriods) expect(cellNumber(sheet.getCell(row, monthCell(period)).value), `${id} ${period}`).toBeCloseTo(Number(after[period] ?? "0") / 100, 2);
    }
    expect(checksOf(edited)).toMatchObject({ "Balance sheet balances every month": "yes", "Cash flow explains the change in cash": "yes", "Driver formulas reproduce Balsa's driver amounts": "no" });
  });

  it("flows an edited input through the drivers that depend on it and keeps the statements whole", () => {
    const changed = simulateForecast({ ...forecast, drivers: forecast.drivers.map((item) => item.id === "subs" ? { ...item, pattern: { ...item.pattern!, initialValue: 12_000 } } : item) }, periods, { compare: false, model: modelLink });
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

describe("round trip", () => {
  const load = async (bytes: Uint8Array | ArrayBuffer) => { const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load((bytes instanceof Uint8Array ? bytes.buffer : bytes) as ArrayBuffer); return workbook; };
  const rowWith = (sheet: ExcelJS.Worksheet, label: string, scenario: string | null = null) => { let found = 0; sheet.eachRow((row, number) => { if (!found && row.getCell(1).value === label && (scenario === null || row.getCell(forecastColumns.scenario).value === scenario)) found = number; }); return found; };

  it("finds nothing to propose in an untouched export, and ignores files that are not exports", async () => {
    const result = await readWorkbookEdits(await buildStandardWorkbook(input));
    expect(result?.edits).toEqual([]); expect(result?.notes).toEqual([]);
    expect(result?.manifest.drivers.map((driver) => driver.id)).toContain("modelled");
    const other = new ExcelJS.Workbook(); other.addWorksheet("Sheet1").getCell("A1").value = "hello";
    expect(await readWorkbookEdits(await other.xlsx.writeBuffer() as ArrayBuffer)).toBeNull();
  });

  it("reports each edit a reader makes, and notes what it cannot propose", async () => {
    const workbook = await load(await buildStandardWorkbook(input));
    const forecastSheet = workbook.getWorksheet("Forecast")!;
    forecastSheet.getCell(rowWith(forecastSheet, "Subs", "Base"), forecastColumns.by).value = 0.05;
    forecastSheet.getCell(rowWith(forecastSheet, "Rent"), forecastColumns.ends).value = new Date(Date.UTC(2027, 5, 30));
    forecastSheet.getCell(rowWith(forecastSheet, "Services"), forecastColumns.seasonality).value = null;
    forecastSheet.getCell(rowWith(forecastSheet, "Customers"), forecastColumns.by).value = 0.07;
    forecastSheet.getCell(rowWith(forecastSheet, "Hosting", "Base"), forecastColumns.initial).value = "lots";
    const modelSheet = workbook.getWorksheet("Model")!;
    const eng = modelLink.variables.find((variable) => variable.name === "headcount")!.rows.find((candidate) => candidate.key === "eng")!.row;
    modelMonths.forEach((month, index) => { if (month >= "2027-06") modelSheet.getCell(eng, 5 + index).value = 6; });
    const payroll = modelLink.variables.find((variable) => variable.name === "payroll")!.rows[0]!.row;
    modelSheet.getCell(payroll, 5).value = 12345;
    workbook.getWorksheet("Get Started")!.getCell("S5").value = 0.04;
    const result = (await readWorkbookEdits(await workbook.xlsx.writeBuffer() as ArrayBuffer))!;
    expect(result.edits.map((edit) => `${edit.kind}:${"id" in edit ? edit.id : "name" in edit ? edit.name : `${edit.variable}[${edit.key}]`}`).sort()).toEqual(["driver_pattern:rent", "driver_pattern:services", "driver_pattern:subs", "metric_pattern:customers", "model_input:headcount[eng]"]);
    const subs = result.edits.find((edit) => edit.kind === "driver_pattern" && edit.id === "subs")!;
    expect(subs.kind === "driver_pattern" && subs.after.changingBy).toBe(0.05);
    const proposed = patternFromExport((subs as Extract<WorkbookEdit, { kind: "driver_pattern" }>).after, () => null);
    expect(proposed).toEqual({ pattern: { initialValue: "10000", repeatsEveryMonths: 1, change: { basis: "pct_change", everyMonths: 1, by: "0.05" } } });
    const rent = result.edits.find((edit) => edit.kind === "driver_pattern" && edit.id === "rent")! as Extract<WorkbookEdit, { kind: "driver_pattern" }>;
    expect(rent.after.endsIn).toBe("2027-06"); expect(rent.after.escalation).toEqual({ rate: 0.03, everyMonths: 6, anchorMonth: null });
    expect(result.notes.join(" ")).toMatch(/Hosting: not proposed, because the initial value is not a number/);
    expect(result.notes.join(" ")).toMatch(/payroll .* is a formula variable/);
    expect(result.notes.join(" ")).toMatch(/company escalation on Get Started was changed/);
    const headcount = result.edits.find((edit) => edit.kind === "model_input")! as Extract<WorkbookEdit, { kind: "model_input" }>;
    const inputs = stepInputs(model.variables.find((variable) => variable.name === "headcount")!.inputs, headcount.coords, headcount.months, headcount.after);
    expect(inputs.filter((entry) => entry.coords.team === "eng")).toEqual([{ coords: { team: "eng" }, from: "2026-09", value: "2" }, { coords: { team: "eng" }, from: "2027-01", value: "3" }, { coords: { team: "eng" }, from: "2027-06", value: "6" }]);
    // The rebuilt inputs reproduce the edited months exactly.
    const evaluation = evaluateModel({ ...model, variables: model.variables.map((variable) => variable.name === "headcount" ? { ...variable, inputs } : variable) }, modelMonths);
    expect(evaluation.ok && evaluation.cubes.get("headcount")!.cells.get("eng")!.map((value) => Number(value) / 1e6)).toEqual(headcount.after);
  });
});
