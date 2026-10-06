import type ExcelJS from "exceljs";
import { standardLineDefinition, standardLines, type StandardLineId } from "@balsa/finance-engine";

/**
 * The live Forecast sheet: each driver row is a spreadsheet formula
 * implementing the Standard model's driver logic, and the statements move
 * when a driver input is edited. Balsa's own amounts stay in the file beside
 * the formulas, and a row is only written live when a spreadsheet evaluation
 * of its formula (`simulateForecast`) reproduces Balsa's amounts exactly;
 * anything else is written as Balsa's values with the reason.
 */

export type ExportBasis = "" | "% change" | "# change" | "log change" | "% of" | "# per";
/** What a `% of` or `# per` row multiplies: another driver, an operating metric (or model variable), or the drivers posting to a Standard line. */
export type ExportRef = { kind: "driver"; id: string } | { kind: "metric"; name: string } | { kind: "line"; line: string };
export type ExportEscalation = { rate: number; everyMonths: number; anchorMonth: number | null };
export type ExportPattern = {
  /** Money for drivers; the rate (0.04) for `% of`; the amount per unit for `# per`. */
  initialValue: number;
  startsIn: string; endsIn: string | null;
  repeatsEvery: number; basis: ExportBasis; changesEvery: number | null; changingBy: number | null;
  using: ExportRef | null; maxMonths: number | null; maxValue: number | null;
  /** A seasonality profile's name, or null. */
  seasonality: string | null;
  escalation: ExportEscalation | "company" | null;
};
/** A side of a driver's entry: the Standard line (and category) its account is placed on. */
export type ExportLeg = { line: StandardLineId; categoryId: string | null };
export type ExportDriver = {
  id: string; label: string; direction: "receipt" | "spend"; lineLabel: string | null;
  /** Null for a base driver; a scenario's id for a driver the scenario adds or changes (its row replaces the base row while that scenario is active). */
  scenarioId: string | null;
  /** For a base driver: the scenarios in which it is replaced or removed. */
  excludedIn: string[];
  /** The line other drivers mean when they refer to this driver's line (the engine's own membership rule). */
  referenceLine: string | null;
  /** Null for a driver Balsa computes another way (a formula, dated amounts); `note` says how. */
  pattern: ExportPattern | null; note: string | null;
  /** A formula driver: Balsa's formula over the forecast model, emitted on its cadence. Live against the Model sheet. */
  formula?: { text: string; startsIn: string; endsIn: string | null; repeatsEvery: number } | null;
  /** The account the amount posts to (income or expense, or a balance for capex and financing) and the account that settles it. */
  posting: ExportLeg | null; settlement: ExportLeg | null;
  /** Minor units by period, as Balsa resolved them. */
  amountsByPeriod: Record<string, string>;
  exception: string | null;
  /** Treatment requires the accounting engine; neither inputs nor statement deltas are live. */
  valuesOnlyReason?: string | null;
};
/** An operating metric, or a model variable a driver uses (pattern null, values only). */
export type ExportMetric = { name: string; label: string; unit: string | null; pattern: ExportPattern | null; note?: string | null; /** A forecast model variable a driver uses: its total across coordinates, read from the Model sheet. */ variable?: boolean; actuals: Record<string, string>; valuesByPeriod: Record<string, string> };
export type ExportSeasonality = { name: string; deviations: number[] };
export type ForecastInput = {
  /** Months Balsa forecast: after the as-of month, within the run's horizon. */
  forecastPeriods: string[];
  drivers: ExportDriver[]; metrics: ExportMetric[];
  seasonality: ExportSeasonality[]; escalation: ExportEscalation | null;
  /** Scenarios in the order of the active-scenario selector (1, 2, …); 0 is the base outlook. */
  scenarios: { id: string; name: string }[];
};

/** A driver row's key: one per driver, plus one per scenario that changes it. */
export const driverKey = (driver: Pick<ExportDriver, "id" | "scenarioId">) => `driver:${driver.id}${driver.scenarioId ? `@${driver.scenarioId}` : ""}`;
/** Whether a row counts while scenario `index` is active (0 = base). */
export function driverInUse(driver: Pick<ExportDriver, "scenarioId" | "excludedIn">, input: Pick<ForecastInput, "scenarios">, index: number) {
  if (index === 0) return driver.scenarioId === null;
  const scenario = input.scenarios[index - 1]!.id;
  return driver.scenarioId === scenario || (driver.scenarioId === null && !driver.excludedIn.includes(scenario));
}

const monthNumber = (period: string) => { const [year, month] = period.split("-").map(Number) as [number, number]; return year * 12 + month; };
/** ROUND as Excel, LibreOffice and Sheets compute it: on the value's 15 significant digits, half away from zero. */
export function spreadsheetRound(value: number, places: number) {
  const approx = Number(value.toPrecision(15)); const factor = 10 ** places;
  return Math.sign(approx) * Math.round(Number((Math.abs(approx) * factor).toPrecision(15))) / factor;
}
const linked = (basis: ExportBasis) => basis === "% of" || basis === "# per";

type Row = { key: string; money: boolean; pattern: ExportPattern | null; balsa: number[]; actuals: (number | null)[]; ref: string | null; members: string[]; inUse: boolean[]; formula?: ExportDriver["formula"]; variable?: string };
/** What the Forecast sheet needs from the Model sheet. */
export type ModelLink = { months: string[]; evaluateFormula(text: string): (number | null)[] | null; compileFormula(text: string, monthIndex: number, sheetPrefix: string): string | null; totalCells(name: string, monthIndex: number, sheetPrefix: string): string[]; values: Map<string, Map<string, (number | null)[]>> };
/** `values` are the base outlook's; `byScenario[i]` the values while scenario i is active (0 = base). */
export type ForecastPlan = { live: Map<string, boolean>; reasons: Map<string, string>; values: Map<string, number[]>; byScenario: Map<string, number[]>[] };
/** What a reference resolves to: a metric's row, the drivers on a line, or every row of a driver (only one is in use at a time). */
export const refKey = (ref: ExportRef | null) => !ref ? null : ref.kind === "driver" ? `all:${ref.id}` : ref.kind === "metric" ? `metric:${ref.name}` : `line:${ref.line}`;

/**
 * Evaluate every row the way the sheet's formulas will, decide which rows can
 * be live, and return the values the sheet will show. Rows that reference a
 * row written as values see Balsa's values, exactly as the sheet does.
 */
/** `compare: false` evaluates the rows as written without checking them against Balsa, as the sheet would after an edit. */
export function simulateForecast(input: ForecastInput, periods: string[], options: { compare?: boolean; model?: ModelLink | null } = {}): ForecastPlan {
  const model = options.model ?? null;
  const modelIndex = (period: string) => model ? model.months.indexOf(period) : -1;
  const flags = periods.map((period) => input.forecastPeriods.includes(period));
  const profiles = new Map(input.seasonality.map((profile) => [profile.name, profile.deviations]));
  const rows = new Map<string, Row>();
  const series = (values: Record<string, string>, scale: number) => periods.map((period, index) => flags[index] && values[period] !== undefined ? Number(values[period]) / scale : 0);
  const scenarioIndexes = [0, ...input.scenarios.map((_, index) => index + 1)];
  const always = scenarioIndexes.map(() => true);
  const aggregate = (key: string, members: string[]) => rows.set(key, { key, money: true, pattern: null, balsa: periods.map(() => 0), actuals: periods.map(() => null), ref: null, members, inUse: always });
  for (const metric of input.metrics) rows.set(`metric:${metric.name}`, { key: `metric:${metric.name}`, money: false, pattern: metric.pattern, balsa: series(metric.valuesByPeriod, 1), actuals: periods.map((period) => metric.actuals[period] !== undefined ? Number(metric.actuals[period]) : null), ref: refKey(metric.pattern?.using ?? null), members: [], inUse: always, ...(metric.variable ? { variable: metric.name } : {}) });
  for (const driver of input.drivers) rows.set(driverKey(driver), { key: driverKey(driver), money: true, pattern: driver.pattern, balsa: series(driver.amountsByPeriod, 100), actuals: periods.map(() => null), ref: refKey(driver.pattern?.using ?? null), members: [], inUse: scenarioIndexes.map((index) => driverInUse(driver, input, index)), formula: driver.formula ?? null });
  for (const line of new Set(input.drivers.map((driver) => driver.referenceLine).filter((line): line is string => Boolean(line)))) aggregate(`line:${line}`, input.drivers.filter((driver) => driver.referenceLine === line).map(driverKey));
  for (const id of new Set(input.drivers.map((driver) => driver.id))) aggregate(`all:${id}`, input.drivers.filter((driver) => driver.id === id).map(driverKey));

  const live = new Map<string, boolean>(); const reasons = new Map<string, string>();
  const frozen = new Map(input.drivers.filter((driver) => driver.valuesOnlyReason).map((driver) => [driverKey(driver), driver.valuesOnlyReason!]));
  const exceptions = new Set(input.drivers.filter((driver) => driver.exception).map(driverKey));
  for (const row of rows.values()) {
    if (row.key.startsWith("line:") || row.key.startsWith("all:")) continue;
    if (frozen.has(row.key)) { live.set(row.key, false); reasons.set(row.key, frozen.get(row.key)!); continue; }
    if (row.formula || row.variable) {
      const reason = exceptions.has(row.key) ? "Balsa reports an exception for this driver"
        : !model ? "The forecast model is not in this file"
        : row.formula && (!model.evaluateFormula(row.formula.text) || model.months.some((_, index) => model.compileFormula(row.formula!.text, index, "") === null)) ? "Its formula could not be written for a spreadsheet"
        : row.variable && !model.values.has(row.variable) ? "The model variable is not in this file"
        : null;
      live.set(row.key, !reason); if (reason) reasons.set(row.key, reason);
      continue;
    }
    const pattern = row.pattern;
    const reason = !pattern ? null
      : exceptions.has(row.key) ? "Balsa reports an exception for this driver"
      : pattern.startsIn < periods[0]! && !linked(pattern.basis) && pattern.basis !== "log change" && pattern.repeatsEvery > 0 ? "It starts before the first month in this file"
      : pattern.escalation === "company" && !input.escalation ? "It uses the company escalation, which is not set"
      : pattern.seasonality && !profiles.has(pattern.seasonality) ? "Its seasonality profile is missing"
      : linked(pattern.basis) && (!row.ref || !rows.has(row.ref)) ? "What it multiplies is not in this file"
      : null;
    live.set(row.key, Boolean(pattern) && !reason);
    if (reason) reasons.set(row.key, reason);
  }

  const evaluate = (scenario: number) => {
    const values = new Map<string, number[]>(); const visiting = new Set<string>();
    const resolve = (key: string): number[] => {
      const known = values.get(key); if (known) return known;
      const row = rows.get(key)!;
      if (visiting.has(key)) throw new Error(`cycle:${key}`);
      visiting.add(key);
      let out: number[];
      if (!row.inUse[scenario]) out = periods.map(() => 0);
      else if (row.members.length || row.key.startsWith("line:") || row.key.startsWith("all:")) { const parts = row.members.map(resolve); out = periods.map((_, index) => parts.reduce((sum, part) => sum + part[index]!, 0)); }
      else if (!live.get(key)) out = row.balsa.map((value, index) => row.actuals[index] ?? value);
      else if (row.formula) out = evaluateFormulaRow(row);
      else if (row.variable) out = periods.map((period, index) => { const at = modelIndex(period); if (!flags[index] || at < 0) return 0; let total: number | null = 0; for (const cells of model!.values.get(row.variable!)!.values()) { const value = cells[at]!; total = total === null || value === null ? null : total + value; } return total ?? Number.NaN; });
      else out = evaluateRow(row, row.ref ? resolve(row.ref) : null);
      visiting.delete(key); values.set(key, out); return out;
    };
    /** A formula driver: the model's value for the month, in cents, on its cadence and never below zero. */
    const evaluateFormulaRow = (row: Row) => {
      const formula = row.formula!; const start = monthNumber(formula.startsIn); const series = model!.evaluateFormula(formula.text)!;
      return periods.map((period, index) => {
        const offset = monthNumber(period) - start; const at = modelIndex(period);
        if (!flags[index] || offset < 0 || (formula.endsIn && period > formula.endsIn) || (formula.repeatsEvery > 0 ? offset % formula.repeatsEvery !== 0 : offset !== 0) || at < 0) return 0;
        const value = series[at]!;
        return value === null ? Number.NaN : Math.max(0, spreadsheetRound(value, 2));
      });
    };
    const evaluateRow = (row: Row, reference: number[] | null) => {
      const pattern = row.pattern!; const start = monthNumber(pattern.startsIn);
      const base: number[] = []; const out: number[] = [];
      const escalation = pattern.escalation === "company" ? input.escalation : pattern.escalation;
      const deviations = pattern.seasonality ? profiles.get(pattern.seasonality)! : null;
      periods.forEach((period, index) => {
        const offset = monthNumber(period) - start; const M = pattern.repeatsEvery; const E = pattern.changesEvery ?? 0; const K = pattern.initialValue; const by = pattern.changingBy ?? 0;
        let inner = 0;
        if (offset < 0) inner = 0;
        else if (linked(pattern.basis)) inner = offset === 0 || (M > 0 && offset % M === 0) ? K * (reference?.[index] ?? 0) : 0;
        else if (offset === 0) inner = K;
        else if (pattern.basis === "log change") inner = K * spreadsheetRound((offset < E ? 1 : spreadsheetRound((offset + E) / E, 0)) ** by, 6);
        else if (M > 0 && offset % M === 0) {
          const previous = base[index - M];
          if (previous === undefined) throw new Error("before the timeline");
          inner = pattern.basis === "% change" && offset % E === 0 ? previous * (1 + by) : pattern.basis === "# change" && offset % E === 0 ? previous + by : previous;
        }
        const value = row.money ? spreadsheetRound(spreadsheetRound(inner, 6), 2) : spreadsheetRound(inner, 6);
        base.push(value);
        const actual = row.actuals[index];
        if (actual !== null && actual !== undefined) { out.push(actual); return; }
        if (!flags[index] || offset < 0 || (pattern.endsIn && period > pattern.endsIn) || ((pattern.maxMonths ?? 0) > 0 && offset >= pattern.maxMonths!)) { out.push(0); return; }
        const deviation = deviations ? deviations[Number(period.slice(5, 7)) - 1]! : 0;
        const steps = !escalation || escalation.rate === 0 ? 0 : escalationSteps(escalation, pattern.startsIn, period);
        let shaped = spreadsheetRound(spreadsheetRound(value * (1 + deviation), 6) * spreadsheetRound((1 + (escalation?.rate ?? 0)) ** steps, 6), 6);
        if (row.money) shaped = spreadsheetRound(shaped, 2);
        out.push(pattern.maxValue !== null && shaped > pattern.maxValue ? pattern.maxValue : shaped);
      });
      return out;
    };
    for (const key of rows.keys()) resolve(key);
    return values;
  };

  // Demote any live row the evaluation cannot reproduce in any scenario that uses it, until nothing changes.
  for (let round = 0; round <= rows.size; round += 1) {
    let byScenario: Map<string, number[]>[];
    try { byScenario = scenarioIndexes.map(evaluate); }
    catch (error) {
      const key = String((error as Error).message).replace(/^cycle:/, "");
      const culprit = rows.has(key) && live.get(key) ? key : [...live.entries()].find(([, isLive]) => isLive)?.[0];
      if (!culprit) throw error;
      live.set(culprit, false); reasons.set(culprit, "Its references could not be ordered in a spreadsheet"); continue;
    }
    if (options.compare === false) return { live, reasons, values: byScenario[0]!, byScenario };
    let changed = false;
    for (const [key, isLive] of live) {
      if (!isLive) continue;
      const row = rows.get(key)!;
      const tolerance = row.money ? 0.005 : 0.0000005;
      const differs = scenarioIndexes.some((scenario) => row.inUse[scenario] && byScenario[scenario]!.get(key)!.some((value, index) => flags[index] && !(Math.abs(value - (row.actuals[index] ?? row.balsa[index]!)) < tolerance)));
      if (differs) { live.set(key, false); reasons.set(key, "Its formula would not reproduce Balsa's amounts exactly"); changed = true; }
    }
    if (!changed) return { live, reasons, values: byScenario[0]!, byScenario };
  }
  throw new Error("The forecast rows did not settle");
}

function escalationSteps(rule: ExportEscalation, start: string, period: string) {
  const offset = monthNumber(period) - monthNumber(start);
  if (!rule.anchorMonth) return Math.floor(offset / rule.everyMonths);
  const anchor = Number(start.slice(0, 4)) * 12 + rule.anchorMonth;
  return Math.max(0, Math.floor((monthNumber(period) - anchor) / rule.everyMonths) - Math.floor((Number(start.slice(5, 7)) - rule.anchorMonth) / rule.everyMonths));
}

// ---------------------------------------------------------------------------
// Layout and formulas

export const forecastColumns = { label: 1, unit: 2, line: 3, initial: 4, starts: 5, ends: 6, repeats: 7, basis: 8, changesEvery: 9, by: 10, using: 11, maxMonths: 12, maxValue: 13, seasonality: 14, escalationRate: 15, escalationEvery: 16, escalationFrom: 17, scenario: 18, inUse: 19, source: 20, firstMonth: 21 } as const;
export const forecastHeader = { period: 3, flag: 4, labels: 5 } as const;
/** Fixed addresses on Get Started that the driver formulas read. */
export const getStartedInputs = { profileHeaderRow: 4, profileFirstRow: 5, profileNameColumn: 4, escalationRate: "$S$5", escalationEvery: "$S$6", escalationFrom: "$S$7", activeScenario: "$S$10", scenarioIndex: "$S$11", scenarioListFirstRow: 13 } as const;
/** The active scenario's number (0 = base), for any sheet's formulas. */
export const activeScenarioIndex = `'Get Started'!${getStartedInputs.scenarioIndex}`;
export const spareProfileRows = 3;

const L = (column: number) => { let letter = ""; for (let n = column; n > 0; n = Math.floor((n - 1) / 26)) letter = String.fromCharCode(65 + ((n - 1) % 26)) + letter; return letter; };
const C = forecastColumns;
const col = (column: number, row: number) => `$${L(column)}${row}`;

/** The formula for a live row's helper cell: the value before seasonality, escalation and caps. */
export function baseFormula(options: { row: number; baseRow: number; column: number; firstColumn: number; money: boolean; refRows: number[] }) {
  const { row, baseRow, column, firstColumn, money, refRows } = options;
  const at = (input: number) => col(input, row); const X = L(column);
  const offset = `((YEAR(${X}$${forecastHeader.labels})*12+MONTH(${X}$${forecastHeader.labels}))-(YEAR(${at(C.starts)})*12+MONTH(${at(C.starts)})))`;
  const previous = column === firstColumn ? "0" : `INDEX($${L(firstColumn)}${baseRow}:${L(column - 1)}${baseRow},1,${X}$${forecastHeader.period}-${at(C.repeats)})`;
  const reference = refRows.length ? `(${refRows.map((refRow) => `${X}${refRow}`).join("+")})` : "0";
  const occurs = `IF(${at(C.repeats)}>0,MOD(${offset},${at(C.repeats)})=0,0)`;
  const changeOn = `MOD(${offset},${at(C.changesEvery)})=0`;
  const carried = `IF(${at(C.basis)}="% change",IF(${changeOn},${previous}*(1+${at(C.by)}),${previous}),IF(${at(C.basis)}="# change",IF(${changeOn},${previous}+${at(C.by)},${previous}),${previous}))`;
  const inner = `IF(${offset}<0,0,IF(OR(${at(C.basis)}="% of",${at(C.basis)}="# per"),IF(OR(${offset}=0,${occurs}),${at(C.initial)}*${reference},0),IF(${offset}=0,${at(C.initial)},IF(${at(C.basis)}="log change",${at(C.initial)}*ROUND(IF(${offset}<${at(C.changesEvery)},1,ROUND((${offset}+${at(C.changesEvery)})/${at(C.changesEvery)},0))^${at(C.by)},6),IF(${at(C.repeats)}>0,IF(MOD(${offset},${at(C.repeats)})=0,${carried},0),0)))))`;
  return money ? `ROUND(ROUND(${inner},6),2)` : `ROUND(${inner},6)`;
}

/** The formula for a live row's monthly cell: the helper value shaped by seasonality and escalation, then the end, maximum months and cap. */
export function outputFormula(options: { row: number; baseRow: number; column: number; money: boolean; profileRange: { names: string; values: string }; scaled: boolean }) {
  const { row, baseRow, column, money, profileRange, scaled } = options;
  const at = (input: number) => col(input, row); const X = L(column);
  const date = `${X}$${forecastHeader.labels}`;
  const offset = `((YEAR(${date})*12+MONTH(${date}))-(YEAR(${at(C.starts)})*12+MONTH(${at(C.starts)})))`;
  const anchor = `(YEAR(${at(C.starts)})*12+${at(C.escalationFrom)})`;
  const steps = `IF(${at(C.escalationFrom)}=0,INT(${offset}/${at(C.escalationEvery)}),MAX(0,INT(((YEAR(${date})*12+MONTH(${date}))-${anchor})/${at(C.escalationEvery)})-INT((MONTH(${at(C.starts)})-${at(C.escalationFrom)})/${at(C.escalationEvery)})))`;
  const escalation = `IF(${at(C.escalationRate)}=0,1,ROUND((1+${at(C.escalationRate)})^${steps},6))`;
  const seasonality = `IF(${at(C.seasonality)}="",0,INDEX(${profileRange.values},MATCH(${at(C.seasonality)},${profileRange.names},0),MONTH(${date})))`;
  const shaped = `ROUND(ROUND(${X}${baseRow}*(1+${seasonality}),6)*${escalation},6)`;
  const rounded = money ? `ROUND(${shaped},2)` : shaped;
  return `${scaled ? `${at(C.inUse)}*` : ""}IF(OR(${X}$${forecastHeader.flag}=0,${offset}<0),0,IF(OR(AND(${at(C.ends)}<>"",${date}>${at(C.ends)}),AND(${at(C.maxMonths)}>0,${offset}>=${at(C.maxMonths)})),0,MIN(${rounded},IF(${at(C.maxValue)}="",1E+300,${at(C.maxValue)}))))`;
}

const isIncome = (line: StandardLineId) => { const section = standardLineDefinition(line).section; return section === "revenue" || section === "expense"; };
const debitNatural = (line: StandardLineId) => { const section = standardLineDefinition(line).section; return section === "asset" || section === "expense"; };
/** Where a cash movement against this line belongs in the cash flow statement. */
const cashClass = (line: StandardLineId): "operating" | "investing" | "financing" => {
  const definition = standardLineDefinition(line);
  if (definition.section === "revenue" || definition.section === "expense") return "operating";
  if ("timing" in definition && definition.timing === "current") return "operating";
  return definition.section === "asset" ? "investing" : "financing";
};
/** Each statement row a driver moves, with the sign its amount carries there. */
export function driverEffects(driver: ExportDriver, statementKeys: Set<string>) {
  if (driver.valuesOnlyReason || !driver.posting || !driver.settlement) return null;
  const debit = driver.direction === "spend" ? driver.posting : driver.settlement;
  const legs = [driver.posting, driver.settlement].map((leg) => ({ leg, sign: (leg === debit) === debitNatural(leg.line) ? 1 : -1 }));
  const rows: { key: string; sign: number; stock: boolean }[] = [];
  for (const { leg, sign } of legs) {
    rows.push({ key: `line:${leg.line}`, sign, stock: !isIncome(leg.line) });
    if (leg.categoryId && statementKeys.has(`category:${leg.categoryId}`)) rows.push({ key: `category:${leg.categoryId}`, sign, stock: !isIncome(leg.line) });
  }
  const netIncome = legs.filter(({ leg }) => isIncome(leg.line)).reduce((total, { leg, sign }) => total + (standardLineDefinition(leg.line).section === "revenue" ? sign : -sign), 0);
  const cash = legs.filter(({ leg }) => leg.line === "cash");
  const other = legs.filter(({ leg }) => leg.line !== "cash");
  const cashFlow = cash.length === 1 && other.length === 1 ? { key: `cf_${cashClass(other[0]!.leg.line)}`, sign: cash[0]!.sign } : null;
  return { rows, netIncome, cashFlow };
}

export const lineOrder = new Map<string, number>(standardLines.map((line, index) => [line.id, index]));

export type ForecastLayout = {
  periods: string[];
  metricRows: Map<string, number>; driverRows: Map<string, number>; lineRows: Map<string, number>;
  balsaRows: Map<string, number>; baseRows: Map<string, number>;
  /** Statement row key → the Forecast row holding its change from Balsa (cumulative for balances). */
  changeRows: Map<string, number>;
  driverBlock: { first: number; last: number }; balsaBlock: { first: number; last: number };
  groupHeaders: { row: number; label: string; block: "metrics" | "drivers" | "balsa" | "lines" | "changes" | "base" }[];
  driverGroups: { row: number; label: string; balsaRow: number }[];
  lastRow: number;
};

/** Every row's position, decided before any sheet is written so Statements can link to the changes. */
export function planForecastLayout(input: ForecastInput, plan: ForecastPlan, periods: string[], statementKeys: Set<string>): ForecastLayout {
  let row = forecastHeader.labels + 2;
  const groupHeaders: ForecastLayout["groupHeaders"] = [];
  const metricRows = new Map<string, number>(); const driverRows = new Map<string, number>(); const lineRows = new Map<string, number>();
  const balsaRows = new Map<string, number>(); const baseRows = new Map<string, number>(); const changeRows = new Map<string, number>();
  if (input.metrics.length) { groupHeaders.push({ row, label: "OPERATING METRICS", block: "metrics" }); row += 1; for (const metric of input.metrics) { metricRows.set(`metric:${metric.name}`, row); row += 1; } row += 1; }
  // Each scenario's version of a driver sits right below the base row it replaces.
  const groups = new Map<string, ExportDriver[]>();
  const sequenced = input.drivers.filter((driver) => driver.scenarioId === null).flatMap((driver) => [driver, ...input.drivers.filter((other) => other.id === driver.id && other.scenarioId !== null)]);
  sequenced.push(...input.drivers.filter((driver) => !sequenced.includes(driver)));
  for (const driver of sequenced) { const key = driver.posting?.line ?? ""; groups.set(key, [...(groups.get(key) ?? []), driver]); }
  const ordered = [...groups.entries()].sort(([left], [right]) => (lineOrder.get(left) ?? 999) - (lineOrder.get(right) ?? 999));
  groupHeaders.push({ row, label: "DRIVERS", block: "drivers" }); row += 1;
  const driverBlockFirst = row;
  const driverGroups: { row: number; label: string; offset: number }[] = [];
  const offsets = new Map<string, number>();
  for (const [line, drivers] of ordered) {
    driverGroups.push({ row, label: line ? standardLineDefinition(line as StandardLineId).label : "Not placed on a line", offset: row - driverBlockFirst }); row += 1;
    for (const driver of drivers) { driverRows.set(driverKey(driver), row); offsets.set(driverKey(driver), row - driverBlockFirst); row += 1; }
  }
  const driverBlock = { first: driverBlockFirst, last: row - 1 };
  row += 1;
  const lines = [...new Set(input.drivers.map((driver) => driver.referenceLine).filter((line): line is string => Boolean(line)))].sort((left, right) => (lineOrder.get(left) ?? 999) - (lineOrder.get(right) ?? 999));
  if (lines.length) { groupHeaders.push({ row, label: "DRIVERS BY LINE", block: "lines" }); row += 1; for (const line of lines) { lineRows.set(`line:${line}`, row); row += 1; } row += 1; }
  const keys = new Set(changeTerms(input, statementKeys).keys());
  const statementOrder = [...statementKeys];
  const changeKeys = [...keys].sort((left, right) => statementOrder.indexOf(left) - statementOrder.indexOf(right));
  if (changeKeys.length) { groupHeaders.push({ row, label: "CHANGES FROM BALSA", block: "changes" }); row += 1; for (const key of changeKeys) { changeRows.set(key, row); row += 1; } row += 1; }
  groupHeaders.push({ row, label: "BALSA'S DRIVER AMOUNTS", block: "balsa" }); row += 1;
  const balsaFirst = row;
  for (const [key, offset] of offsets) balsaRows.set(key, balsaFirst + offset);
  const balsaBlock = { first: balsaFirst, last: balsaFirst + (driverBlock.last - driverBlock.first) };
  row = balsaBlock.last + 2;
  const liveKeys = [...plan.live.entries()].filter(([, isLive]) => isLive).map(([key]) => key);
  if (liveKeys.length) { groupHeaders.push({ row, label: "BEFORE SEASONALITY, ESCALATION AND CAPS", block: "base" }); row += 1; for (const key of liveKeys) { baseRows.set(key, row); row += 1; } }
  return { periods, metricRows, driverRows, lineRows, balsaRows, baseRows, changeRows, driverBlock, balsaBlock, groupHeaders, driverGroups: driverGroups.map((group) => ({ row: group.row, label: group.label, balsaRow: balsaFirst + group.offset })), lastRow: row };
}

/** For each statement row the drivers move: the terms Σ sign × (live − Balsa), and whether the row is a balance (cumulative). */
export function changeTerms(input: ForecastInput, statementKeys: Set<string>) {
  const terms = new Map<string, { stock: boolean; parts: { sign: number; driverKey: string }[] }>();
  const add = (key: string, stock: boolean, sign: number, driver: ExportDriver) => { const entry = terms.get(key) ?? { stock, parts: [] }; entry.parts.push({ sign, driverKey: driverKey(driver) }); terms.set(key, entry); };
  for (const driver of input.drivers) {
    const effects = driverEffects(driver, statementKeys); if (!effects) continue;
    for (const effect of effects.rows) add(effect.key, effect.stock, effect.sign, driver);
    if (effects.cashFlow) add(effects.cashFlow.key, false, effects.cashFlow.sign, driver);
    if (effects.netIncome !== 0) add("current_earnings", true, effects.netIncome, driver);
  }
  return terms;
}


// ---------------------------------------------------------------------------
// Writing

export type ForecastStyles = { input: string; link: string; formula: string; muted: string; inputFill: string; money: string; date: string };
const monthEnd = (period: string) => { const [year, month] = period.split("-").map(Number) as [number, number]; return new Date(Date.UTC(year, month, 0)); };
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const basisOptions: ExportBasis[] = ["% change", "# change", "log change", "% of", "# per"];

/** The Get Started inputs the driver formulas read: seasonality profiles and the company escalation. Returns the profile ranges. */
export function writeForecastInputs(sheet: ExcelJS.Worksheet, input: ForecastInput, styles: ForecastStyles) {
  const { profileHeaderRow, profileFirstRow, profileNameColumn } = getStartedInputs;
  const inputCell = (cell: ExcelJS.Cell, value: ExcelJS.CellValue, numFmt?: string) => Object.assign(cell, { value, font: { color: { argb: styles.input } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: styles.inputFill } }, ...(numFmt ? { numFmt } : {}) });
  Object.assign(sheet.getCell(profileHeaderRow - 1, profileNameColumn), { value: "SEASONALITY PROFILES (deviation from an average month; each row sums to zero)", font: { bold: true, color: { argb: styles.muted }, size: 9 } });
  Object.assign(sheet.getCell(profileHeaderRow, profileNameColumn), { value: "Profile", font: { bold: true } });
  sheet.getColumn(profileNameColumn).width = 18;
  monthNames.forEach((name, index) => { Object.assign(sheet.getCell(profileHeaderRow, profileNameColumn + 1 + index), { value: name, font: { bold: true }, alignment: { horizontal: "right" } }); sheet.getColumn(profileNameColumn + 1 + index).width = 7; });
  const rows = input.seasonality.length + spareProfileRows;
  for (let index = 0; index < rows; index += 1) {
    const profile = input.seasonality[index];
    inputCell(sheet.getCell(profileFirstRow + index, profileNameColumn), profile?.name ?? null);
    for (let month = 0; month < 12; month += 1) inputCell(sheet.getCell(profileFirstRow + index, profileNameColumn + 1 + month), profile ? profile.deviations[month]! : null, "0%");
  }
  const lastRow = profileFirstRow + rows - 1;
  Object.assign(sheet.getCell("R4"), { value: "COMPANY ESCALATION", font: { bold: true, color: { argb: styles.muted }, size: 9 } });
  sheet.getColumn(18).width = 40; sheet.getColumn(19).width = 10;
  const escalation = input.escalation;
  ([["Rate", escalation?.rate ?? null, "0.00%"], ["Every N months", escalation?.everyMonths ?? null, "0"], ["From calendar month (blank: each driver's start)", escalation?.anchorMonth ?? null, "0"]] as const).forEach(([label, value, format], index) => { sheet.getCell(5 + index, 18).value = label; inputCell(sheet.getCell(5 + index, 19), value, format); });
  const names = `'Get Started'!$${L(profileNameColumn)}$${profileFirstRow}:$${L(profileNameColumn)}$${lastRow}`;
  const values = `'Get Started'!$${L(profileNameColumn + 1)}$${profileFirstRow}:$${L(profileNameColumn + 12)}$${lastRow}`;
  return { names, values };
}

/** The active-scenario dropdown on Get Started, and the number every scenario-aware formula reads (0 = base). */
export function writeScenarioSelector(sheet: ExcelJS.Worksheet, scenarios: { name: string }[], styles: Pick<ForecastStyles, "input" | "inputFill" | "muted" | "link">) {
  const first = getStartedInputs.scenarioListFirstRow; const names = ["Base", ...scenarios.map((scenario) => scenario.name)];
  Object.assign(sheet.getCell("R9"), { value: "ACTIVE SCENARIO", font: { bold: true, color: { argb: styles.muted }, size: 9 } });
  sheet.getCell("R10").value = "Show the model for";
  Object.assign(sheet.getCell(getStartedInputs.activeScenario.replaceAll("$", "")), { value: "Base", font: { color: { argb: styles.input } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: styles.inputFill } }, dataValidation: { type: "list", allowBlank: false, formulae: [`$S$${first}:$S$${first + names.length - 1}`] } });
  sheet.getCell("R11").value = "Scenario number (0 = base)";
  Object.assign(sheet.getCell(getStartedInputs.scenarioIndex.replaceAll("$", "")), { value: { formula: `MATCH(${getStartedInputs.activeScenario},$S$${first}:$S$${first + names.length - 1},0)-1` }, font: { color: { argb: styles.link } } });
  sheet.getCell(`R${first - 1}`).value = "Scenarios in this file";
  names.forEach((name, index) => { sheet.getCell(`S${first + index}`).value = name; });
  sheet.getColumn(18).width = 40; sheet.getColumn(19).width = 24;
}

export function writeForecastSheet(sheet: ExcelJS.Worksheet, input: ForecastInput, plan: ForecastPlan, layout: ForecastLayout, statementLabels: Map<string, string>, statementKeys: Set<string>, profileRange: { names: string; values: string }, styles: ForecastStyles, model: ModelLink | null = null) {
  const modelPrefix = "'Model'!";
  const { periods } = layout;
  const first = C.firstMonth; const lastColumn = first + periods.length - 1;
  const muted = { color: { argb: styles.muted }, size: 9 };
  Object.assign(sheet.getCell(forecastHeader.period, 1), { value: "Period", font: muted });
  Object.assign(sheet.getCell(forecastHeader.flag, 1), { value: "Forecast month (1 = Balsa forecasts it)", font: muted });
  const headers: [number, string, number][] = [[C.label, "Driver", 34], [C.unit, "Direction", 9], [C.line, "Statement line", 20], [C.initial, "Initial value", 12], [C.starts, "Starts in", 9], [C.ends, "Ends in", 9], [C.repeats, "Repeats every N months", 9], [C.basis, "Changing based on", 12], [C.changesEvery, "Changes every N months", 9], [C.by, "Changing by % or #", 10], [C.using, "Using", 20], [C.maxMonths, "For a max of N months", 9], [C.maxValue, "To a max value of", 11], [C.seasonality, "Seasonality", 13], [C.escalationRate, "Escalation rate", 9], [C.escalationEvery, "Escalates every N months", 9], [C.escalationFrom, "Escalates from month (blank: start)", 10], [C.scenario, "Scenario", 14], [C.inUse, "In use (1 = yes)", 7], [C.source, "Source", 30]];
  for (const [column, label, width] of headers) { sheet.getColumn(column).width = width; Object.assign(sheet.getCell(forecastHeader.labels, column), { value: label, font: { bold: true }, alignment: { wrapText: true, vertical: "bottom" } }); }
  periods.forEach((period, index) => {
    const column = first + index; sheet.getColumn(column).width = 12;
    Object.assign(sheet.getCell(forecastHeader.period, column), { value: index + 1, font: muted, alignment: { horizontal: "right" } });
    Object.assign(sheet.getCell(forecastHeader.flag, column), { value: input.forecastPeriods.includes(period) ? 1 : 0, font: muted, alignment: { horizontal: "right" } });
    Object.assign(sheet.getCell(forecastHeader.labels, column), { value: monthEnd(period), numFmt: styles.date, font: { bold: true }, alignment: { horizontal: "right" } });
  });
  for (const header of layout.groupHeaders) Object.assign(sheet.getCell(header.row, 1), { value: header.label, font: { bold: true, color: { argb: styles.muted }, size: 9 } });
  for (const group of layout.driverGroups) for (const row of [group.row, group.balsaRow]) Object.assign(sheet.getCell(row, 1), { value: group.label, font: { bold: true } });

  const label = new Map<string, string>([
    ...input.metrics.map((metric) => [`metric:${metric.name}`, metric.label] as const),
    ...input.drivers.map((driver) => [driverKey(driver), driver.label] as const),
    ...input.drivers.map((driver) => [`all:${driver.id}`, driver.label] as const),
    ...[...layout.lineRows.keys()].map((key) => [key, `Drivers on ${standardLineDefinition(key.slice(5) as StandardLineId).label}`] as const),
  ]);
  /** The rows a reference sums: a metric's or line's row, or every row of a driver (only the one in use is non-zero). */
  const rowsOf = (key: string) => key.startsWith("all:") ? input.drivers.filter((driver) => driver.id === key.slice(4)).map((driver) => layout.driverRows.get(driverKey(driver))!) : [layout.metricRows.get(key) ?? layout.lineRows.get(key)].filter((row): row is number => row !== undefined);
  const scenarioIndex = activeScenarioIndex;
  const scaled = input.scenarios.length > 0;

  const writePattern = (row: number, pattern: ExportPattern, live: boolean) => {
    const style = (cell: ExcelJS.Cell, numFmt?: string) => Object.assign(cell, live ? { font: { color: { argb: styles.input } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: styles.inputFill } } } : { font: { color: { argb: styles.muted } } }, numFmt ? { numFmt } : {});
    const set = (column: number, value: ExcelJS.CellValue, numFmt?: string) => { const cell = sheet.getCell(row, column); cell.value = value; style(cell, numFmt); };
    set(C.initial, pattern.initialValue, pattern.basis === "% of" ? "0.00%" : "#,##0.00##");
    set(C.starts, monthEnd(pattern.startsIn), styles.date); set(C.ends, pattern.endsIn ? monthEnd(pattern.endsIn) : null, styles.date);
    set(C.repeats, pattern.repeatsEvery); set(C.basis, pattern.basis || null); set(C.changesEvery, pattern.changesEvery);
    set(C.by, pattern.changingBy, pattern.basis === "% change" ? "0.00%" : "#,##0.00####");
    Object.assign(sheet.getCell(row, C.using), { value: pattern.using ? label.get(refKey(pattern.using)!) ?? null : null, font: { italic: true, color: { argb: styles.muted } } });
    set(C.maxMonths, pattern.maxMonths); set(C.maxValue, pattern.maxValue, "#,##0.00"); set(C.seasonality, pattern.seasonality);
    if (pattern.escalation === "company") {
      ([[C.escalationRate, getStartedInputs.escalationRate, "0.00%"], [C.escalationEvery, getStartedInputs.escalationEvery, "0"], [C.escalationFrom, getStartedInputs.escalationFrom, "0"]] as const).forEach(([column, address, numFmt]) => Object.assign(sheet.getCell(row, column), { value: { formula: `'Get Started'!${address}` }, numFmt, font: { color: { argb: styles.link } } }));
    } else {
      set(C.escalationRate, pattern.escalation?.rate ?? null, "0.00%"); set(C.escalationEvery, pattern.escalation?.everyMonths ?? null); set(C.escalationFrom, pattern.escalation?.anchorMonth ?? null);
    }
    if (live) {
      sheet.getCell(row, C.basis).dataValidation = { type: "list", allowBlank: true, formulae: [`"${basisOptions.join(",")}"`] };
      sheet.getCell(row, C.seasonality).dataValidation = { type: "list", allowBlank: true, formulae: [profileRange.names] };
    }
  };
  const writeLiveRow = (key: string, row: number, money: boolean, pattern: ExportPattern, actuals: Record<string, string>, rowScaled: boolean) => {
    const baseRow = layout.baseRows.get(key)!;
    const refRows = pattern.using ? rowsOf(refKey(pattern.using)!) : [];
    Object.assign(sheet.getCell(baseRow, 1), { value: `${label.get(key)}, before seasonality, escalation and caps`, font: { color: { argb: styles.muted } } });
    periods.forEach((period, index) => {
      const column = first + index;
      Object.assign(sheet.getCell(baseRow, column), { value: { formula: baseFormula({ row, baseRow, column, firstColumn: first, money, refRows }) }, numFmt: money ? styles.money : "#,##0.0", font: { color: { argb: styles.muted } } });
      const actual = actuals[period];
      Object.assign(sheet.getCell(row, column), actual !== undefined
        ? { value: Number(actual), numFmt: "#,##0.0", font: { color: { argb: styles.input } } }
        : { value: { formula: outputFormula({ row, baseRow, column, money, profileRange, scaled: rowScaled }) }, numFmt: money ? styles.money : "#,##0.0", font: { color: { argb: styles.formula } } });
    });
  };
  /** Balsa's values; `inUseRow` scales them by that row's in-use flag so a replaced row counts only in its scenarios. */
  const writeValues = (row: number, values: number[], money: boolean, inUseRow: number | null = null) => periods.forEach((_, index) => Object.assign(sheet.getCell(row, first + index), { value: !values[index] ? null : inUseRow ? { formula: `${values[index]}*${col(C.inUse, inUseRow)}` } : values[index], numFmt: money ? styles.money : "#,##0.0", font: { color: { argb: styles.input } } }));
  const sourceText = (key: string, note: string | null, exception: string | null) => [plan.live.get(key) ? "Formula" : plan.reasons.get(key) ? `Balsa's values: ${plan.reasons.get(key)}` : "Balsa's values", note, exception ? `Exception: ${exception}` : null].filter(Boolean).join(". ");

  /** A formula driver's months: Balsa's formula over the Model sheet, emitted on the row's start, end and repeat inputs. */
  const writeFormulaRow = (row: number, formula: NonNullable<ExportDriver["formula"]>, rowScaled: boolean) => {
    const inputStyle = { font: { color: { argb: styles.input } }, fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: styles.inputFill } } };
    Object.assign(sheet.getCell(row, C.starts), { value: monthEnd(formula.startsIn), numFmt: styles.date, ...inputStyle });
    Object.assign(sheet.getCell(row, C.ends), { value: formula.endsIn ? monthEnd(formula.endsIn) : null, numFmt: styles.date, ...inputStyle });
    Object.assign(sheet.getCell(row, C.repeats), { value: formula.repeatsEvery, ...inputStyle });
    Object.assign(sheet.getCell(row, C.basis), { value: "model formula", font: { color: { argb: styles.muted } } });
    Object.assign(sheet.getCell(row, C.using), { value: formula.text, font: { italic: true, color: { argb: styles.muted } } });
    periods.forEach((period, index) => {
      const at = col; const X = L(first + index); const date = `${X}$${forecastHeader.labels}`;
      const offset = `((YEAR(${date})*12+MONTH(${date}))-(YEAR(${at(C.starts, row)})*12+MONTH(${at(C.starts, row)})))`;
      const monthIndex = model!.months.indexOf(period);
      const expression = monthIndex < 0 ? null : model!.compileFormula(formula.text, monthIndex, modelPrefix);
      const body = expression === null ? "0" : `IF(OR(${X}$${forecastHeader.flag}=0,${offset}<0,AND(${at(C.ends, row)}<>"",${date}>${at(C.ends, row)}),IF(${at(C.repeats, row)}>0,MOD(${offset},${at(C.repeats, row)})<>0,${offset}<>0)),0,MAX(0,ROUND(${expression},2)))`;
      Object.assign(sheet.getCell(row, first + index), { value: { formula: rowScaled && body !== "0" ? `${at(C.inUse, row)}*${body}` : body }, numFmt: styles.money, font: { color: { argb: styles.formula } } });
    });
  };

  for (const metric of input.metrics) {
    const key = `metric:${metric.name}`; const row = layout.metricRows.get(key)!;
    sheet.getCell(row, C.label).value = metric.label; sheet.getCell(row, C.unit).value = metric.unit ?? "";
    if (metric.variable && plan.live.get(key)) {
      Object.assign(sheet.getCell(row, C.source), { value: "Formula: the model variable's total on the Model sheet", font: muted });
      periods.forEach((period, index) => { const monthIndex = model!.months.indexOf(period); const cells = monthIndex < 0 || !input.forecastPeriods.includes(period) ? [] : model!.totalCells(metric.name, monthIndex, modelPrefix); Object.assign(sheet.getCell(row, first + index), { value: { formula: cells.length ? `SUM(${cells.join(",")})` : "0" }, numFmt: "#,##0.0", font: { color: { argb: styles.link } } }); });
      continue;
    }
    if (metric.pattern) writePattern(row, metric.pattern, Boolean(plan.live.get(key)));
    Object.assign(sheet.getCell(row, C.source), { value: sourceText(key, metric.note ?? null, null), font: muted });
    if (plan.live.get(key)) writeLiveRow(key, row, false, metric.pattern!, metric.actuals, false);
    else writeValues(row, plan.values.get(key)!, false);
  }
  for (const driver of input.drivers) {
    const key = driverKey(driver); const row = layout.driverRows.get(key)!; const balsaRow = layout.balsaRows.get(key)!;
    if (scaled) {
      sheet.getCell(row, C.scenario).value = driver.scenarioId ? input.scenarios.find((scenario) => scenario.id === driver.scenarioId)?.name ?? driver.scenarioId : "Base";
      const own = input.scenarios.findIndex((scenario) => scenario.id === driver.scenarioId) + 1;
      const excluded = input.scenarios.map((scenario, index) => driver.excludedIn.includes(scenario.id) ? index + 1 : 0).filter(Boolean);
      const inUse = driver.scenarioId ? `IF(${scenarioIndex}=${own},1,0)` : excluded.length ? `IF(OR(${excluded.map((index) => `${scenarioIndex}=${index}`).join(",")}),0,1)` : null;
      Object.assign(sheet.getCell(row, C.inUse), { value: inUse ? { formula: inUse } : 1, font: { color: { argb: inUse ? styles.link : styles.muted } }, alignment: { horizontal: "center" } });
    }
    sheet.getRow(row).getCell(C.label).value = driver.label;
    sheet.getCell(row, C.unit).value = driver.direction === "receipt" ? "Receipt" : "Spend"; sheet.getCell(row, C.line).value = driver.lineLabel ?? "";
    if (driver.pattern) writePattern(row, driver.pattern, Boolean(plan.live.get(key)));
    const unlinked = driver.valuesOnlyReason || driverEffects(driver, statementKeys) ? null : "Not linked to Statements: one side of its entry has no Standard line";
    Object.assign(sheet.getCell(row, C.source), { value: sourceText(key, [driver.note, unlinked].filter(Boolean).join(". ") || null, driver.exception), font: { color: { argb: driver.exception ? "FFB00020" : styles.muted }, size: 9 } });
    const balsa = periods.map((period) => input.forecastPeriods.includes(period) && driver.amountsByPeriod[period] !== undefined ? Number(BigInt(driver.amountsByPeriod[period]!)) / 100 : 0);
    if (plan.live.get(key) && driver.formula) writeFormulaRow(row, driver.formula, scaled);
    else if (plan.live.get(key)) writeLiveRow(key, row, true, driver.pattern!, {}, scaled);
    else writeValues(row, balsa, true, scaled ? row : null);
    sheet.getCell(balsaRow, C.label).value = driver.label;
    writeValues(balsaRow, balsa, true, scaled ? row : null);
  }
  for (const [key, row] of layout.lineRows) {
    sheet.getCell(row, C.label).value = label.get(key)!;
    const members = input.drivers.filter((driver) => `line:${driver.referenceLine}` === key).map((driver) => layout.driverRows.get(driverKey(driver))!);
    periods.forEach((_, index) => { const X = L(first + index); Object.assign(sheet.getCell(row, first + index), { value: { formula: members.length ? members.map((member) => `${X}${member}`).join("+") : "0" }, numFmt: styles.money }); });
  }
  const terms = changeTerms(input, statementKeys);
  for (const [key, row] of layout.changeRows) {
    const entry = terms.get(key)!;
    Object.assign(sheet.getCell(row, C.label), { value: `${statementLabels.get(key) ?? key}${entry.stock ? " (cumulative)" : ""}` });
    periods.forEach((_, index) => {
      const X = L(first + index);
      const sum = entry.parts.map(({ sign, driverKey }) => `${sign < 0 ? "-" : "+"}(${X}${layout.driverRows.get(driverKey)}-${X}${layout.balsaRows.get(driverKey)})`).join("").replace(/^\+/, "");
      const formula = entry.stock && index > 0 ? `${L(first + index - 1)}${row}+(${sum})` : sum;
      Object.assign(sheet.getCell(row, first + index), { value: { formula }, numFmt: styles.money });
    });
  }
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: forecastHeader.labels }];
  return { lastColumn: L(lastColumn) };
}
