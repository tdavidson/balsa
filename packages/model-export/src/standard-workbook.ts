import ExcelJS from "exceljs";
import { standardLines, type StandardLineDefinition, type StandardPeriodColumn, type StandardRow } from "@balsa/finance-engine";
import { writeManifest, type ExportManifest } from "./round-trip";
import { modelHeader, planModel, writeModelSheet, type ModelInput } from "./model-sheet";
import { activeScenarioIndex, driverKey, getStartedInputs, forecastColumns, planForecastLayout, simulateForecast, writeForecastInputs, writeForecastSheet, writeScenarioSelector, type ForecastInput } from "./forecast-sheet";

export type { ExportBasis, ExportDriver, ExportEscalation, ExportLeg, ExportMetric, ExportPattern, ExportRef, ExportSeasonality, ForecastInput } from "./forecast-sheet";

/**
 * A Standard Financial Model-shaped workbook of a Balsa outlook. Every line
 * item is a value Balsa calculated; every subtotal, total, rollup and check
 * is a formula, so the file reads and recalculates like a model while its
 * numbers stay Balsa's. Formulas use only functions that behave the same in
 * Excel, Google Sheets and LibreOffice.
 */
import { exportFormatVersion } from "./manifest-schema";
export { exportFormatVersion } from "./manifest-schema";

export type ExportScenario = { id: string; name: string; description: string | null; months: StandardPeriodColumn[]; runway: { runwayMonths: number | null; cashOutMonth: string | null } };
export type ExportAccount = { id: string; code: string; name: string; section: string | null; lineLabel: string | null; categoryName: string | null; status: string; reason: string };

export type StandardWorkbookInput = {
  /** `id` goes in the round-trip manifest, so a returned file is matched to its company. */
  company: { id?: string; name: string; currency: string };
  generatedAt: string;
  versions: { layout: string; forecast: string | null };
  timeline: { firstPeriod: string; lastPeriod: string; asOfPeriod: string; fiscalYearEndMonth: number; isDefault: boolean };
  minimumCashMinor: string;
  base: StandardPeriodColumn[];
  baseRunway: { runwayMonths: number | null; cashOutMonth: string | null } | null;
  /** Statements of the pinned plan over the same months; null when no plan has been pinned. */
  plan: StandardPeriodColumn[] | null;
  scenarios: ExportScenario[];
  accounts: ExportAccount[];
  mapping: { confirmed: number; total: number; complete: boolean };
  /** Forecast drivers, operating metrics and their inputs; the Forecast sheet is omitted when there are no drivers or metrics. */
  forecast?: ForecastInput;
  /** Balsa's forecast model over the months the run evaluates it (as-of month to horizon); the Model sheet and live formula drivers come from it. */
  model?: ModelInput | null;
};

/** Functions every formula may use: identical in Excel, Google Sheets and LibreOffice. */
export const allowedFunctions = new Set(["SUM", "SUMIFS", "SUMPRODUCT", "ABS", "IF", "IFERROR", "COUNT", "COUNTIF", "EOMONTH", "AND", "OR", "MIN", "MAX", "INDEX", "MATCH", "ROUND", "YEAR", "MONTH", "MOD", "INT"]);
export function formulaFunctions(formula: string) {
  const unquoted = formula.replace(/"[^"]*"/g, "").replace(/'[^']*'!/g, "");
  return [...unquoted.matchAll(/([A-Z][A-Z0-9.]*)\(/g)].map((match) => match[1]!);
}

const firstMonthColumn = 3; // C, after the label column and a narrow spacer
const header = { date: 4, fiscalYear: 5, basis: 6, yearEnd: 7 } as const;
const firstBodyRow = 9;
const colors = { input: "FF0000FF", link: "FF008000", formula: "FF000000", muted: "FF6B6B6B", inputFill: "FFFFF8DC", rule: "FFBFBFBF" };
const moneyFormat = '#,##0;(#,##0);"–"';
const dateFormat = "mmm yy";

export const columnLetter = (index: number) => { let letter = ""; for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) letter = String.fromCharCode(65 + ((n - 1) % 26)) + letter; return letter; };
const monthEnd = (period: string) => { const [year, month] = period.split("-").map(Number) as [number, number]; return new Date(Date.UTC(year, month, 0)); };
const major = (minor: string) => Number(BigInt(minor)) / 100;
const fiscalYearOf = (period: string, endMonth: number) => { const [year, month] = period.split("-").map(Number) as [number, number]; return month > endMonth ? year + 1 : year; };

const ref = (sheet: string, address: string) => `'${sheet}'!${address}`;
/** Balsa's figure for a row and month in whichever scenario is active on Get Started: a constant when every scenario agrees. */
function activeFigure(key: string, period: string, base: StandardPeriodColumn[], scenarios: StandardPeriodColumn[][], pick: (statement: StandardPeriodColumn["statement"]) => StandardRow[]): string {
  const value = (columns: StandardPeriodColumn[]) => { const month = columns.find((candidate) => candidate.period === period); return major(month ? pick(month.statement).find((row) => row.key === key)?.amountMinor ?? "0" : "0"); };
  const own = value(base); const others = scenarios.map(value);
  if (others.every((figure) => figure === own)) return String(own);
  return others.reduceRight((otherwise, figure, index) => `IF(${activeScenarioIndex}=${index + 1},${figure},${otherwise})`, String(own));
}
const isNumber = (text: string) => /^-?\d+(\.\d+)?(e-?\d+)?$/i.test(text);

type SheetRow = { key: string; row: number; source: StandardRow; stock: boolean };
type Section = { title: string; pick: (statement: StandardPeriodColumn["statement"]) => StandardRow[]; stock: boolean };
const sections: Section[] = [
  { title: "Income statement", pick: (statement) => statement.incomeStatement, stock: false },
  { title: "Balance sheet", pick: (statement) => statement.balanceSheet, stock: true },
  { title: "Cash flow", pick: (statement) => statement.cashFlow, stock: false },
];
const lineIds = (predicate: (line: StandardLineDefinition) => boolean) => standardLines.filter(predicate).map((line) => line.id as string);

/** Spreadsheet formula for a subtotal row, from the rows of the same column; null means the row is a Balsa value. */
function subtotalFormula(key: string, at: (key: string) => string, rows: Map<string, SheetRow>): string | null {
  const plus = (keys: string[]) => keys.map(at).join("+");
  const lines = (predicate: (line: StandardLineDefinition) => boolean) => lineIds(predicate).map((id) => `line:${id}`);
  const below = standardLines.filter((line) => "group" in line && line.group === "below_ebitda");
  switch (key) {
    case "gross_margin": return `${at("line:revenue")}-${at("line:cogs")}`;
    case "sga": return plus(lines((line) => line.group === "sga"));
    case "ebitda": return `${at("gross_margin")}-${at("sga")}`;
    case "ebt": return `${at("ebitda")}${below.map((line) => `${line.section === "revenue" ? "+" : "-"}${at(`line:${line.id}`)}`).join("")}`;
    case "net_income": return `${at("ebt")}-${at("line:taxes")}`;
    case "current_assets": return plus(lines((line) => line.section === "asset" && line.timing === "current"));
    case "total_assets": return `${at("current_assets")}+${plus(lines((line) => line.section === "asset" && line.timing === "noncurrent"))}`;
    case "current_liabilities": return plus(lines((line) => line.section === "liability" && line.timing === "current"));
    case "noncurrent_liabilities": return plus(lines((line) => line.section === "liability" && line.timing === "noncurrent"));
    case "total_equity": return `${plus(lines((line) => line.section === "equity"))}+${at("current_earnings")}`;
    case "total_liabilities_equity": return `${at("current_liabilities")}+${at("noncurrent_liabilities")}+${at("total_equity")}`;
    case "balance_check": return `${at("total_assets")}-${at("total_liabilities_equity")}`;
    case "cf_net": return plus(["cf_operating", "cf_investing", "cf_financing"]);
    case "cf_cash_end": return at("line:cash");
    default: {
      if (key.startsWith("uncategorized:")) {
        const line = key.slice("uncategorized:".length);
        const categories = [...rows.values()].filter((row) => row.source.kind === "category" && row.source.line === line).map((row) => row.key);
        return `${at(`line:${line}`)}-(${plus(categories)})`;
      }
      return null;
    }
  }
}

function styleHeaderRows(sheet: ExcelJS.Worksheet, months: StandardPeriodColumn[], fiscalYearEndMonth: number, asOfPeriod: string) {
  const labels: [number, string][] = [[header.date, "Period ending"], [header.fiscalYear, "Fiscal year"], [header.basis, "Actual or forecast"], [header.yearEnd, "Fiscal year end flag"]];
  for (const [row, label] of labels) Object.assign(sheet.getCell(row, 1), { value: label, font: { color: { argb: colors.muted }, size: 9 } });
  months.forEach((month, index) => {
    const column = firstMonthColumn + index;
    const next = months[index + 1];
    Object.assign(sheet.getCell(header.date, column), { value: monthEnd(month.period), numFmt: dateFormat, font: { bold: true }, alignment: { horizontal: "right" } });
    Object.assign(sheet.getCell(header.fiscalYear, column), { value: fiscalYearOf(month.period, fiscalYearEndMonth), font: { color: { argb: colors.muted }, size: 9 } });
    Object.assign(sheet.getCell(header.basis, column), { value: month.period <= asOfPeriod ? "Actual" : month.basis === "scenario" ? "Scenario" : "Forecast", font: { color: { argb: colors.muted }, size: 9 }, alignment: { horizontal: "right" } });
    Object.assign(sheet.getCell(header.yearEnd, column), { value: !next || fiscalYearOf(next.period, fiscalYearEndMonth) !== fiscalYearOf(month.period, fiscalYearEndMonth) ? 1 : 0, font: { color: { argb: colors.muted }, size: 9 } });
  });
}

function title(sheet: ExcelJS.Worksheet, heading: string, description: string) {
  Object.assign(sheet.getCell("A1"), { value: heading, font: { bold: true, size: 14 } });
  Object.assign(sheet.getCell("A2"), { value: description, font: { color: { argb: colors.muted }, italic: true } });
}

/**
 * Lay out Standard rows as a monthly sheet. Rows come from the first month
 * (every month has the same rows by construction); line and category rows
 * are Balsa values, subtotals are formulas.
 */
function statementSheet(workbook: ExcelJS.Workbook, name: string, description: string, months: StandardPeriodColumn[], input: StandardWorkbookInput, only?: Section["title"][], links?: { rows: Map<string, number>; periods: Set<string> }, variants: StandardPeriodColumn[][] = []) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", xSplit: 2, ySplit: header.yearEnd }] });
  title(sheet, name, description);
  styleHeaderRows(sheet, months, input.timeline.fiscalYearEndMonth, input.timeline.asOfPeriod);
  sheet.getColumn(1).width = 40; sheet.getColumn(2).width = 2;
  months.forEach((_, index) => { sheet.getColumn(firstMonthColumn + index).width = 12; });
  const rows = new Map<string, SheetRow>();
  let rowNumber = firstBodyRow;
  const placed: { section: Section; rows: SheetRow[] }[] = [];
  const sectionHeaders: { title: string; row: number }[] = [];
  for (const section of sections.filter((candidate) => !only || only.includes(candidate.title))) {
    Object.assign(sheet.getCell(rowNumber, 1), { value: section.title.toUpperCase(), font: { bold: true, color: { argb: colors.muted }, size: 9 } });
    sectionHeaders.push({ title: section.title, row: rowNumber });
    rowNumber += 1;
    const sectionRows: SheetRow[] = [];
    for (const source of section.pick(months[0]!.statement)) {
      const entry = { key: source.key, row: rowNumber, source, stock: section.stock || source.key === "cf_cash_end" };
      rows.set(source.key, entry); sectionRows.push(entry); rowNumber += 1;
    }
    placed.push({ section, rows: sectionRows });
    rowNumber += 1;
  }
  for (const { section, rows: sectionRows } of placed) {
    for (const entry of sectionRows) {
      const label = sheet.getCell(entry.row, 1);
      label.value = entry.source.label;
      label.alignment = { indent: entry.source.depth };
      const emphasis = entry.source.kind === "subtotal" || entry.source.kind === "total";
      if (emphasis) label.font = { bold: entry.source.kind === "total" };
      months.forEach((month, index) => {
        const column = firstMonthColumn + index; const letter = columnLetter(column);
        const cell = sheet.getCell(entry.row, column);
        const at = (key: string) => { const target = rows.get(key); if (!target) throw new Error(`Row ${key} is missing from ${name}`); return `${letter}${target.row}`; };
        const formula = subtotalFormula(entry.key, at, rows);
        // A row a forecast driver moves is Balsa's figure plus the driver's change on Forecast, zero as exported.
        const change = !formula && links?.periods.has(month.period) ? links.rows.get(entry.key) : undefined;
        const figure = activeFigure(entry.key, month.period, months, variants, section.pick);
        if (formula) cell.value = { formula };
        else if (change) cell.value = { formula: `${figure}+${ref("Forecast", `${columnLetter(forecastColumns.firstMonth + index)}${change}`)}` };
        else cell.value = isNumber(figure) ? Number(figure) : { formula: figure };
        cell.numFmt = moneyFormat;
        cell.font = { color: { argb: formula ? colors.formula : change ? colors.link : colors.input }, bold: entry.source.kind === "total" };
        if (emphasis) cell.border = { top: { style: "thin", color: { argb: colors.rule } } };
      });
      if (emphasis) label.border = { top: { style: "thin", color: { argb: colors.rule } } };
    }
  }
  return { sheet, rows, sectionHeaders, lastColumn: columnLetter(firstMonthColumn + months.length - 1) };
}

type Placed = ReturnType<typeof statementSheet>;
const range = (placed: Placed, row: number) => `$${columnLetter(firstMonthColumn)}${row}:$${placed.lastColumn}${row}`;

export async function buildStandardWorkbook(input: StandardWorkbookInput): Promise<Uint8Array> {
  if (!input.base.length) throw new Error("The export needs at least one month.");
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Balsa"; workbook.created = new Date(input.generatedAt);
  const readme = workbook.addWorksheet("README");
  const getStarted = workbook.addWorksheet("Get Started");
  const summary = workbook.addWorksheet("Summary", { views: [{ state: "frozen", xSplit: 2, ySplit: 5 }] });
  const forecast = input.forecast && (input.forecast.drivers.length || input.forecast.metrics.length) ? input.forecast : null;
  const forecastSheet = forecast ? workbook.addWorksheet("Forecast") : null;
  const modelPlan = input.model?.definition.variables.length ? planModel(input.model, modelHeader.labels + 2) : null;
  const model = modelPlan && !("unsupported" in modelPlan) ? modelPlan : null;
  const modelSheet = model ? workbook.addWorksheet("Model") : null;
  // The forecast is planned before any sheet is written, so Statements can link to its changes.
  const periods = input.base.map((month) => month.period);
  const statementRows = [...input.base[0]!.statement.incomeStatement, ...input.base[0]!.statement.balanceSheet, ...input.base[0]!.statement.cashFlow];
  const statementKeys = new Set(statementRows.map((row) => row.key));
  const forecastPlan = forecast ? simulateForecast(forecast, periods, { model }) : null;
  const forecastLayout = forecast && forecastPlan ? planForecastLayout(forecast, forecastPlan, periods, statementKeys) : null;
  if (forecast && forecast.scenarios.map((scenario) => scenario.id).join() !== input.scenarios.map((scenario) => scenario.id).join()) throw new Error("The forecast's scenarios must match the workbook's, in the same order.");
  const variants = input.scenarios.map((scenario) => scenario.months);
  const statements = statementSheet(workbook, "Statements", `Monthly statements in the Standard layout${input.scenarios.length ? ", for the scenario chosen on Get Started" : ""}. Blue figures are Balsa's; black figures are formulas; green figures are Balsa's plus the change from editing a driver on Forecast.`, input.base, input, undefined, forecastLayout ? { rows: forecastLayout.changeRows, periods: new Set(forecast!.forecastPeriods) } : undefined, variants);
  const plan = input.plan ? statementSheet(workbook, "Plan", "The pinned plan's income statement over the same months.", input.plan, input, ["Income statement"]) : null;

  // Summary: annual columns by fiscal year, summed from Statements; balances take the fiscal year's last month.
  title(summary, "Summary", "Annual rollup of Statements by fiscal year. Every figure is a formula.");
  const years = [...new Set(input.base.map((month) => fiscalYearOf(month.period, input.timeline.fiscalYearEndMonth)))];
  summary.getColumn(1).width = 40; summary.getColumn(2).width = 2;
  Object.assign(summary.getCell(4, 1), { value: "Fiscal year", font: { color: { argb: colors.muted }, size: 9 } });
  Object.assign(summary.getCell(5, 1), { value: "Months in the timeline", font: { color: { argb: colors.muted }, size: 9 } });
  const fyRange = ref("Statements", range(statements, header.fiscalYear)); const flagRange = ref("Statements", range(statements, header.yearEnd));
  years.forEach((year, index) => {
    const column = firstMonthColumn + index; const letter = columnLetter(column);
    summary.getColumn(column).width = 13;
    Object.assign(summary.getCell(4, column), { value: year, numFmt: '"FY"0', font: { bold: true }, alignment: { horizontal: "right" } });
    Object.assign(summary.getCell(5, column), { value: { formula: `COUNTIF(${fyRange},${letter}$4)` }, font: { color: { argb: colors.muted }, size: 9 } });
  });
  for (const entry of statements.rows.values()) {
    const row = entry.row;
    Object.assign(summary.getCell(row, 1), { value: entry.source.label, alignment: { indent: entry.source.depth }, font: { bold: entry.source.kind === "total" } });
    years.forEach((_, index) => {
      const letter = columnLetter(firstMonthColumn + index);
      const values = ref("Statements", range(statements, row));
      const formula = entry.stock ? `SUMIFS(${values},${fyRange},${letter}$4,${flagRange},1)` : `SUMIFS(${values},${fyRange},${letter}$4)`;
      Object.assign(summary.getCell(row, firstMonthColumn + index), { value: { formula }, numFmt: moneyFormat, font: { color: { argb: colors.link }, bold: entry.source.kind === "total" } });
    });
  }
  for (const { title: heading, row } of statements.sectionHeaders) Object.assign(summary.getCell(row, 1), { value: heading.toUpperCase(), font: { bold: true, color: { argb: colors.muted }, size: 9 } });

  // Budget: plan versus actuals over a month range the reader chooses.
  if (plan) {
    const budget = workbook.addWorksheet("Budget");
    title(budget, "Budget", "Plan versus actuals for the months between the start and end below. Change the two blue dates.");
    budget.getColumn(1).width = 40; [2, 3, 4, 5].forEach((column) => { budget.getColumn(column).width = 14; });
    const actualMonths = input.base.filter((month) => month.period <= input.timeline.asOfPeriod);
    const startPeriod = actualMonths[0]?.period ?? input.base[0]!.period; const endPeriod = actualMonths.at(-1)?.period ?? input.base[0]!.period;
    for (const [row, label, period] of [[4, "Start month", startPeriod], [5, "End month", endPeriod]] as const) {
      budget.getCell(row, 1).value = label;
      Object.assign(budget.getCell(row, 2), { value: monthEnd(period), numFmt: dateFormat, font: { color: { argb: colors.input } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: colors.inputFill } } });
    }
    ["Budget", "Actual", "Variance", "Variance %"].forEach((label, index) => Object.assign(budget.getCell(7, 2 + index), { value: label, font: { bold: true }, alignment: { horizontal: "right" } }));
    const window = (sheet: string, placed: Placed) => `${ref(sheet, range(placed, header.date))},">="&$B$4,${ref(sheet, range(placed, header.date))},"<="&EOMONTH($B$5,0)`;
    let row = 8;
    for (const entry of plan.rows.values()) {
      const actualRow = statements.rows.get(entry.key)!;
      Object.assign(budget.getCell(row, 1), { value: entry.source.label, alignment: { indent: entry.source.depth }, font: { bold: entry.source.kind === "total" } });
      budget.getCell(row, 2).value = { formula: `SUMIFS(${ref("Plan", range(plan, entry.row))},${window("Plan", plan)})` };
      budget.getCell(row, 3).value = { formula: `SUMIFS(${ref("Statements", range(statements, actualRow.row))},${window("Statements", statements)},${ref("Statements", range(statements, header.basis))},"Actual")` };
      budget.getCell(row, 4).value = { formula: `C${row}-B${row}` };
      budget.getCell(row, 5).value = { formula: `IFERROR(D${row}/ABS(B${row}),"")` };
      [2, 3, 4].forEach((column) => Object.assign(budget.getCell(row, column), { numFmt: moneyFormat, font: { color: { argb: column === 4 ? colors.formula : colors.link }, bold: entry.source.kind === "total" } }));
      Object.assign(budget.getCell(row, 5), { numFmt: "0.0%" });
      row += 1;
    }
  }

  // Scenarios: Balsa's results for each scenario beside the base, with differences as formulas.
  const scenarioSheet = input.scenarios.length ? workbook.addWorksheet("Scenarios", { views: [{ state: "frozen", xSplit: 2, ySplit: header.date }] }) : null;
  if (scenarioSheet) {
    title(scenarioSheet, "Scenarios", "Each scenario's net income and cash as Balsa calculated them, beside the base outlook. Choose a scenario on Get Started to see the whole model for it.");
    scenarioSheet.getColumn(1).width = 40; scenarioSheet.getColumn(2).width = 2;
    input.base.forEach((month, index) => { const column = firstMonthColumn + index; scenarioSheet.getColumn(column).width = 12; Object.assign(scenarioSheet.getCell(header.date, column), { value: { formula: `${ref("Statements", `${columnLetter(column)}${header.date}`)}` }, numFmt: dateFormat, font: { bold: true, color: { argb: colors.link } }, alignment: { horizontal: "right" } }); });
    let row = header.date + 2;
    const baseRows = { netIncome: row + 1, cash: row + 2 };
    Object.assign(scenarioSheet.getCell(row, 1), { value: "BASE OUTLOOK", font: { bold: true, color: { argb: colors.muted }, size: 9 } });
    scenarioSheet.getCell(baseRows.netIncome, 1).value = "Net income (loss)"; scenarioSheet.getCell(baseRows.cash, 1).value = "Cash end of period";
    // Balsa's base figures, not links: Statements follows the active scenario.
    input.base.forEach((month, index) => {
      const value = (rows: StandardRow[], key: string) => major(rows.find((candidate) => candidate.key === key)?.amountMinor ?? "0");
      Object.assign(scenarioSheet.getCell(baseRows.netIncome, firstMonthColumn + index), { value: value(month.statement.incomeStatement, "net_income"), numFmt: moneyFormat, font: { color: { argb: colors.input } } });
      Object.assign(scenarioSheet.getCell(baseRows.cash, firstMonthColumn + index), { value: value(month.statement.cashFlow, "cf_cash_end"), numFmt: moneyFormat, font: { color: { argb: colors.input } } });
    });
    row = baseRows.cash + 2;
    for (const scenario of input.scenarios) {
      Object.assign(scenarioSheet.getCell(row, 1), { value: scenario.name.toUpperCase(), font: { bold: true, color: { argb: colors.muted }, size: 9 } });
      const runway = scenario.runway.runwayMonths === null ? "no cash-out within the horizon" : `runway ${scenario.runway.runwayMonths} months${scenario.runway.cashOutMonth ? `, cash-out ${scenario.runway.cashOutMonth}` : ""}`;
      Object.assign(scenarioSheet.getCell(row, firstMonthColumn), { value: `${scenario.description ? `${scenario.description} · ` : ""}${runway}`, font: { italic: true, color: { argb: colors.muted } } });
      const rowsFor = { netIncome: row + 1, cash: row + 2, deltaIncome: row + 3, deltaCash: row + 4 };
      scenarioSheet.getCell(rowsFor.netIncome, 1).value = "Net income (loss)"; scenarioSheet.getCell(rowsFor.cash, 1).value = "Cash end of period";
      scenarioSheet.getCell(rowsFor.deltaIncome, 1).value = "Net income change from base"; scenarioSheet.getCell(rowsFor.deltaCash, 1).value = "Cash change from base";
      const byPeriod = new Map(scenario.months.map((month) => [month.period, month.statement]));
      input.base.forEach((month, index) => {
        const column = firstMonthColumn + index; const letter = columnLetter(column); const statement = byPeriod.get(month.period);
        const value = (rows: StandardRow[] | undefined, key: string) => major(rows?.find((candidate) => candidate.key === key)?.amountMinor ?? "0");
        Object.assign(scenarioSheet.getCell(rowsFor.netIncome, column), { value: value(statement?.incomeStatement, "net_income"), numFmt: moneyFormat, font: { color: { argb: colors.input } } });
        Object.assign(scenarioSheet.getCell(rowsFor.cash, column), { value: value(statement?.cashFlow, "cf_cash_end"), numFmt: moneyFormat, font: { color: { argb: colors.input } } });
        Object.assign(scenarioSheet.getCell(rowsFor.deltaIncome, column), { value: { formula: `${letter}${rowsFor.netIncome}-${letter}${baseRows.netIncome}` }, numFmt: moneyFormat });
        Object.assign(scenarioSheet.getCell(rowsFor.deltaCash, column), { value: { formula: `${letter}${rowsFor.cash}-${letter}${baseRows.cash}` }, numFmt: moneyFormat });
      });
      row = rowsFor.deltaCash + 2;
    }
  }

  // Forecast: live driver rows, with Balsa's own amounts beside them.
  if (forecastSheet && forecast && forecastPlan && forecastLayout) {
    title(forecastSheet, "Forecast", "Each forecast driver in the Standard model's driver columns. Blue cells on a pale fill are inputs: change one and the driver, Statements, Summary and Checks recalculate. Rows marked Balsa's values say why they are not formulas.");
    const profileRange = writeForecastInputs(getStarted, forecast, { ...colors, money: moneyFormat, date: dateFormat });
    writeForecastSheet(forecastSheet, forecast, forecastPlan, forecastLayout, new Map(statementRows.map((row) => [row.key, row.label])), statementKeys, profileRange, { ...colors, money: moneyFormat, date: dateFormat }, model);
  }
  if (modelSheet && model) writeModelSheet(modelSheet, input.model!, model, { ...colors, date: dateFormat });

  // Mapping and lineage: where every figure comes from.
  const mappingSheet = workbook.addWorksheet("Mapping");
  title(mappingSheet, "Mapping", "How each chart account is placed in the Standard layout. Set in Balsa under Accounting, Statement mapping.");
  const mappingHeader = ["Code", "Account", "Section", "Line", "Category", "Status", "Basis"];
  mappingHeader.forEach((label, index) => Object.assign(mappingSheet.getCell(4, 1 + index), { value: label, font: { bold: true } }));
  [10, 36, 12, 30, 22, 14, 48].forEach((width, index) => { mappingSheet.getColumn(1 + index).width = width; });
  input.accounts.forEach((account, index) => { mappingSheet.getRow(5 + index).values = [account.code, account.name, account.section ?? "", account.lineLabel ?? "", account.categoryName ?? "", account.status, account.reason]; });

  const lineage = workbook.addWorksheet("Lineage");
  title(lineage, "Lineage", "The accounts behind every line figure in Statements, by month. Balsa holds the journal lines and source evidence behind each account.");
  ["Statement", "Line", "Period", "Code", "Account", "Amount"].forEach((label, index) => Object.assign(lineage.getCell(4, 1 + index), { value: label, font: { bold: true } }));
  [16, 30, 10, 10, 36, 14].forEach((width, index) => { lineage.getColumn(1 + index).width = width; });
  const accountById = new Map(input.accounts.map((account) => [account.id, account]));
  let lineageRow = 5;
  for (const month of input.base) {
    for (const section of sections) {
      for (const row of section.pick(month.statement).filter((candidate) => candidate.kind === "line")) {
        for (const account of row.accounts.filter((item) => item.amountMinor !== "0")) {
          const known = accountById.get(account.accountId);
          lineage.getRow(lineageRow).values = [section.title, row.label, monthEnd(month.period), known?.code ?? "", known?.name ?? account.accountId, major(account.amountMinor)];
          lineage.getCell(lineageRow, 3).numFmt = dateFormat; lineage.getCell(lineageRow, 6).numFmt = moneyFormat;
          lineageRow += 1;
        }
      }
    }
  }

  // Checks: the workbook's own totals against Balsa's, month by month.
  const checks = workbook.addWorksheet("Checks", { views: [{ state: "frozen", xSplit: 2, ySplit: header.date }] });
  title(checks, "Checks", "Each check compares this workbook's formulas with the totals Balsa reported for the active scenario. \"no\" after an edit means the workbook now differs from Balsa's outlook.");
  checks.getColumn(1).width = 52; checks.getColumn(2).width = 8;
  input.base.forEach((_, index) => { const column = firstMonthColumn + index; checks.getColumn(column).width = 12; Object.assign(checks.getCell(header.date, column), { value: { formula: ref("Statements", `${columnLetter(column)}${header.date}`) }, numFmt: dateFormat, font: { bold: true, color: { argb: colors.link } } }); });
  const lastMonthColumn = statements.lastColumn;
  const checkRows: { label: string; row: number }[] = [];
  let checkRow = header.date + 2;
  const tie = (label: string, key: string, balsa: (statement: StandardPeriodColumn["statement"]) => StandardRow[]) => {
    const workbookRow = checkRow + 1; const balsaRow = checkRow + 2;
    Object.assign(checks.getCell(checkRow, 1), { value: label, font: { bold: true } });
    checks.getCell(checkRow, 2).value = { formula: `IF(SUMPRODUCT(ABS($C${workbookRow}:$${lastMonthColumn}${workbookRow}-$C${balsaRow}:$${lastMonthColumn}${balsaRow}))<0.005,"yes","no")` };
    Object.assign(checks.getCell(workbookRow, 1), { value: "  This workbook", font: { color: { argb: colors.muted } } });
    Object.assign(checks.getCell(balsaRow, 1), { value: "  Balsa", font: { color: { argb: colors.muted } } });
    input.base.forEach((month, index) => {
      const column = firstMonthColumn + index; const letter = columnLetter(column);
      Object.assign(checks.getCell(workbookRow, column), { value: { formula: ref("Statements", `${letter}${statements.rows.get(key)!.row}`) }, numFmt: moneyFormat, font: { color: { argb: colors.link } } });
      const figure = activeFigure(key, month.period, input.base, variants, balsa);
      Object.assign(checks.getCell(balsaRow, column), { value: isNumber(figure) ? Number(figure) : { formula: figure }, numFmt: moneyFormat, font: { color: { argb: colors.input } } });
    });
    checkRows.push({ label, row: checkRow }); checkRow += 4;
  };
  tie("Net income equals Balsa", "net_income", (statement) => statement.incomeStatement);
  tie("Total assets equal Balsa", "total_assets", (statement) => statement.balanceSheet);
  tie("Total liabilities and equity equal Balsa", "total_liabilities_equity", (statement) => statement.balanceSheet);
  tie("Cash end of period equals Balsa", "cf_cash_end", (statement) => statement.cashFlow);
  /** A check the workbook computes (formula), or a fact Balsa reports (yes or no). */
  const single = (label: string, result: string) => { Object.assign(checks.getCell(checkRow, 1), { value: label, font: { bold: true } }); checks.getCell(checkRow, 2).value = result === "yes" || result === "no" ? result : { formula: result }; checkRows.push({ label, row: checkRow }); checkRow += 2; };
  single("Balance sheet balances every month", `IF(SUMPRODUCT(ABS(${ref("Statements", range(statements, statements.rows.get("balance_check")!.row))}))<0.005,"yes","no")`);
  single("Summary net income equals the months it covers", `IF(ABS(SUM(${ref("Summary", `$C${statements.rows.get("net_income")!.row}:$${columnLetter(firstMonthColumn + years.length - 1)}${statements.rows.get("net_income")!.row}`)})-SUM(${ref("Statements", range(statements, statements.rows.get("net_income")!.row))}))<0.005,"yes","no")`);
  if (input.base.length > 1) {
    // Net cash flow each month must equal the movement in the Cash line. A gap means the ledger and the mapping disagree about which accounts are cash.
    const netRow = statements.rows.get("cf_net")!.row; const cashRow = statements.rows.get("cf_cash_end")!.row;
    const later = (row: number) => ref("Statements", `$${columnLetter(firstMonthColumn + 1)}${row}:$${statements.lastColumn}${row}`);
    const earlier = (row: number) => ref("Statements", `$${columnLetter(firstMonthColumn)}${row}:$${columnLetter(firstMonthColumn + input.base.length - 2)}${row}`);
    single("Cash flow explains the change in cash", `IF(SUMPRODUCT(ABS(${later(netRow)}-(${later(cashRow)}-${earlier(cashRow)})))<0.005,"yes","no")`);
  }
  const unplaced = input.base.reduce((count, month) => count + (month.statement.unplacedAccountIds?.length ?? 0), 0);
  single("Every account with an amount is placed on a line", unplaced === 0 ? "yes" : "no");
  single("Every account's line is confirmed in Balsa", input.mapping.complete ? "yes" : "no");
  if (forecast && forecastLayout && forecast.drivers.length) {
    const block = (from: number, to: number) => ref("Forecast", `$${columnLetter(forecastColumns.firstMonth)}${from}:$${columnLetter(forecastColumns.firstMonth + periods.length - 1)}${to}`);
    single("Driver formulas reproduce Balsa's driver amounts", `IF(SUMPRODUCT(ABS(${block(forecastLayout.driverBlock.first, forecastLayout.driverBlock.last)}-${block(forecastLayout.balsaBlock.first, forecastLayout.balsaBlock.last)}))<0.005,"yes","no")`);
    single("No forecast driver has an exception, in any scenario", forecast.drivers.some((driver) => driver.exception) ? "no" : "yes");
  }
  for (const { row } of checkRows) checks.getCell(row, 2).alignment = { horizontal: "center" };

  if (input.scenarios.length) writeScenarioSelector(getStarted, input.scenarios, colors);
  // Get Started: the model structure and the check summary.
  title(getStarted, "Get Started", "The structure of this export. Balsa sets these values; change them in Balsa and export again.");
  getStarted.getColumn(1).width = 44; getStarted.getColumn(2).width = 22;
  const structure: [string, ExcelJS.CellValue, string?][] = [
    ["Company name", input.company.name], ["Currency", input.company.currency], ["Base timescale", "monthly"],
    ["Date of first period", monthEnd(input.base[0]!.period), dateFormat], ["Date of last period", monthEnd(input.base.at(-1)!.period), dateFormat],
    ["Number of periods", { formula: `COUNT(${ref("Statements", range(statements, header.date))})` }],
    ["Fiscal year end month", input.timeline.fiscalYearEndMonth], ["Actuals through", monthEnd(input.timeline.asOfPeriod), dateFormat],
    ["Minimum cash for runway", major(input.minimumCashMinor), moneyFormat],
    ["Runway (months)", input.baseRunway?.runwayMonths ?? "No cash-out within the horizon"], ["Cash-out month", input.baseRunway?.cashOutMonth ?? "—"],
    ["Scenarios in this file", input.scenarios.length], ["Plan included", input.plan ? "yes" : "no — pin a plan in Balsa to compare budget with actuals"],
    ["Accounts with a confirmed line", `${input.mapping.confirmed} of ${input.mapping.total}`],
  ];
  Object.assign(getStarted.getCell(4, 1), { value: "MODEL STRUCTURE", font: { bold: true, color: { argb: colors.muted }, size: 9 } });
  structure.forEach(([label, value, format], index) => {
    const row = 5 + index;
    getStarted.getCell(row, 1).value = label;
    const cell = getStarted.getCell(row, 2);
    cell.value = value; if (format) cell.numFmt = format;
    cell.font = { color: { argb: typeof value === "object" && value !== null && "formula" in value ? colors.link : colors.input } };
    cell.alignment = { horizontal: "right" };
  });
  const checkStart = 5 + structure.length + 1;
  Object.assign(getStarted.getCell(checkStart, 1), { value: "MODEL CHECKS", font: { bold: true, color: { argb: colors.muted }, size: 9 } });
  checkRows.forEach(({ label, row }, index) => {
    getStarted.getCell(checkStart + 1 + index, 1).value = label;
    Object.assign(getStarted.getCell(checkStart + 1 + index, 2), { value: { formula: ref("Checks", `$B$${row}`) }, font: { color: { argb: colors.link } }, alignment: { horizontal: "right" } });
  });

  // README last, so it can describe what was built.
  title(readme, `${input.company.name}: financial model`, "Exported from Balsa in the layout of the Standard Financial Model.");
  readme.getColumn(1).width = 110;
  const lines = [
    `Exported ${input.generatedAt.slice(0, 10)}. Actuals through ${input.timeline.asOfPeriod}; forecast to ${input.timeline.lastPeriod}. Figures in ${input.company.currency}.`,
    "Balsa is the system of record. Every blue figure is a number Balsa calculated from its books and forecast; every black or green figure is a formula over them, so totals and annual rollups recalculate when you edit.",
    "Checks compares the workbook's totals with Balsa's. All checks read \"yes\" in the exported file; editing a figure is expected to turn some to \"no\", which marks a difference from Balsa's outlook, not an error.",
    "",
    "Sheets",
    "Get Started: the model's structure and the check summary.",
    "Summary: annual totals by fiscal year.",
    ...(forecast ? ["Forecast: operating metrics and forecast drivers in the Standard model's driver columns (initial value, starts, repeats, changing based on, using, maximums, seasonality, escalation). Each driver is a formula: change a blue input and the driver, Statements, Summary and Checks recalculate. An edited amount settles the way the driver's entry does, in the same month. Balsa's own amounts are kept below for comparison. A driver Balsa computes another way (a formula, dated amounts) is written as Balsa's values with the reason. Seasonality profiles and the company escalation are inputs on Get Started."] : []),
    ...(model ? ["Model: Balsa's forecast model, one row per variable and coordinate. Inputs are blue cells you can change by month; formula variables are formulas compiled from Balsa's formula language, and formula drivers on Forecast read them."] : modelPlan && "unsupported" in modelPlan ? [`Model: not included because ${modelPlan.unsupported}; formula drivers are Balsa's values.`] : []),
    "Statements: monthly income statement, balance sheet and cash flow, with actual and forecast months marked.",
    ...(input.plan ? ["Plan and Budget: the pinned plan, and plan versus actuals over a month range you choose."] : []),
    ...(input.scenarios.length ? ["Scenarios: each scenario's net income and cash beside the base outlook. Choose a scenario under Active scenario on Get Started and Forecast, Statements, Summary and Checks recalculate for it: a scenario's changed and added drivers are their own rows on Forecast, in use only while that scenario is active."] : []),
    "Mapping: how each account is placed on a Standard line. Lineage: the accounts behind each line, by month. Checks: the workbook against Balsa.",
    "",
    `Colour key: blue = Balsa figure, black = formula on this sheet, green = link to another sheet, pale yellow fill = an input you can change.`,
    `Layout based on the Standard Financial Model by Hemrock (Apache 2.0), hemrock.com. Format ${exportFormatVersion}; layout ${input.versions.layout}${input.versions.forecast ? `; forecast ${input.versions.forecast}` : ""}.`,
  ];
  lines.forEach((text, index) => { const cell = readme.getCell(4 + index, 1); cell.value = text; cell.alignment = { wrapText: true, vertical: "top" }; if (text === "Sheets") cell.font = { bold: true }; });

  // The round-trip manifest: every editable cell and the value written there.
  const manifest: ExportManifest = {
    format: "balsa-export-manifest-1", exportFormat: exportFormatVersion, companyId: input.company.id ?? null, exportedAt: input.generatedAt, asOfPeriod: input.timeline.asOfPeriod,
    drivers: forecast && forecastPlan && forecastLayout ? forecast.drivers.filter((driver) => forecastPlan.live.get(driverKey(driver))).map((driver) => ({ key: driverKey(driver), id: driver.id, scenarioId: driver.scenarioId, label: driver.label, row: forecastLayout.driverRows.get(driverKey(driver))!, ...(driver.formula ? { kind: "formula" as const, formula: driver.formula } : { kind: "pattern" as const, pattern: driver.pattern! }) })) : [],
    metrics: forecast && forecastPlan && forecastLayout ? forecast.metrics.filter((metric) => metric.pattern && !metric.variable && forecastPlan.live.get(`metric:${metric.name}`)).map((metric) => ({ name: metric.name, label: metric.label, row: forecastLayout.metricRows.get(`metric:${metric.name}`)!, pattern: metric.pattern! })) : [],
    model: model ? { months: model.months, rows: model.variables.flatMap((variable) => variable.rows.map((candidate) => ({ variable: variable.name, key: candidate.key, coords: Object.fromEntries(variable.dims.map((dim, index) => [dim, candidate.items[index]!])), row: candidate.row, kind: variable.formula ? "formula" as const : "input" as const, values: model.engine.get(variable.name)!.get(candidate.key)! }))) } : null,
    seasonality: forecast ? { firstRow: getStartedInputs.profileFirstRow, profiles: forecast.seasonality } : null,
    escalation: forecast?.escalation ?? null,
  };
  writeManifest(workbook, manifest);

  // Every formula must be portable. A violation is a bug in this builder, so fail loudly.
  workbook.eachSheet((sheet) => sheet.eachRow((row) => row.eachCell((cell) => {
    const value = cell.value;
    if (value && typeof value === "object" && "formula" in value) for (const name of formulaFunctions(String(value.formula))) if (!allowedFunctions.has(name)) throw new Error(`${sheet.name}!${cell.address} uses ${name}, which is not on the portable function list`);
  })));
  return new Uint8Array(await workbook.xlsx.writeBuffer() as ArrayBuffer);
}
