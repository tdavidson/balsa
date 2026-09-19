/** Pure decimal arithmetic and recursive-descent parsing for forecast formulas. */
import type { ForecastDriver } from "./forecast-projections";
import { addMonths, isValidMonth } from "./periods";
import { stableJson } from "./stable-json";
export const modelScale = 1_000_000n;
export const modelValueCap = 10n ** 21n;
export const modelLimits = { formulaLength: 2_000, variables: 200, dimensions: 12, itemsPerDimension: 500, cellsPerVariable: 250_000, nesting: 200 } as const;
export const defaultModelMonthCount = 25;
export type ModelReducer = "sum" | "avg" | "min" | "max";
const reducers: readonly string[] = ["sum", "avg", "min", "max"];
export const modelFunctionNames = ["sum", "avg", "min", "max", "prev", "round"] as const;
const functionNames: readonly string[] = modelFunctionNames;

export const isModelIdentifier = (value: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
const decimalPattern = /^(-)?(\d+)(?:\.(\d{1,6}))?$/;

export function parseDecimal(text: string): bigint | null {
  const match = decimalPattern.exec(text);
  if (!match) return null;
  const magnitude = BigInt(match[2]!) * modelScale + BigInt((match[3] ?? "").padEnd(6, "0"));
  return match[1] ? -magnitude : magnitude;
}
export type ForecastDimension = { name: string; items: string[] };
/** One step of an input variable: `value` applies to `coords` from `from` until the next entry for the same coords. */
export type ForecastVariableInput = { coords: Record<string, string>; from: string; value: string };
/** A variable holds either a formula or dated inputs; `dims` are dimension names (month is implicit). */
export type ForecastVariable = { name: string; kind: "money" | "number"; dims: string[]; formula?: string; inputs: ForecastVariableInput[] };
export type ForecastModel = { dimensions: ForecastDimension[]; variables: ForecastVariable[] };
/** null is an error cell (division by zero or past the value cap). */
export type CellValue = bigint | null;
/** A variable's value over its dimensions (sorted) and months: coordinate key → one value per month. */
export type Cube = { dims: string[]; months: string[]; cells: Map<string, CellValue[]> };
export type ModelIssue = { message: string; variable?: string; dimension?: string; driverId?: string; position?: number };
export type ModelValidation = { errors: ModelIssue[]; warnings: ModelIssue[] };
export type ForecastModelSummary = { variables: { name: string; kind: "money" | "number"; dims: string[]; driverIds: string[]; monthlyTotals: Record<string, string | null> }[] };
export type FormulaResolution = { drivers: ForecastDriver[]; exceptions: { driverId: string; reason: string }[]; summary: ForecastModelSummary };
export type ModelEvaluation = { ok: true; months: string[]; cubes: Map<string, Cube> } | { ok: false; errors: ModelIssue[] };

const compareText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
export const coordinateKey = (items: string[]) => items.join("|");
const splitKey = (key: string, size: number) => (size === 0 ? [] : key.split("|"));
const describeCoordinate = (dims: string[], items: string[]) => dims.map((dim, index) => `${dim}=${items[index]}`).join(", ");
const naming = "must start with a letter or underscore and use only letters, digits, and underscores";

/** Consecutive months from `first` through `last`, inclusive. */
export function monthRange(first: string, last: string): string[] {
  const months: string[] = [];
  for (let month = first; month <= last; month = addMonths(month, 1)) months.push(month);
  return months;
}

function assertMonths(months: string[]) {
  if (!months.length || months.some((month, index) => !isValidMonth(month) || (index > 0 && addMonths(months[index - 1]!, 1) !== month))) throw new Error("Model months must be consecutive YYYY-MM months");
}

/** Sorted dimensions, variables, dims, inputs, and coordinate keys, so equal models hash equally. */
export function canonicalizeModel(model: ForecastModel): ForecastModel {
  const inputKey = (input: ForecastVariableInput) => `${stableJson(input.coords)}@${input.from}`;
  return {
    dimensions: model.dimensions.map((dimension) => ({ name: dimension.name, items: [...dimension.items] })).sort((left, right) => compareText(left.name, right.name)),
    variables: model.variables.map((variable) => ({
      name: variable.name, kind: variable.kind, dims: [...variable.dims].sort(compareText),
      ...(variable.formula !== undefined ? { formula: variable.formula } : {}),
      inputs: variable.inputs
        .map((input) => ({ coords: Object.fromEntries(Object.entries(input.coords).sort(([left], [right]) => compareText(left, right))), from: input.from, value: input.value }))
        .sort((left, right) => compareText(inputKey(left), inputKey(right))),
    })).sort((left, right) => compareText(left.name, right.name)),
  };
}

type Scope = { variables: Map<string, string[]>; dimensions: Map<string, string[]>; monthCount: number };
type FormulaIssue = { message: string; position: number };

const cellCount = (dims: string[], scope: Scope) => dims.reduce((count, dim) => count * (scope.dimensions.get(dim)?.length ?? 1), scope.monthCount);
const collapseMessage = (dims: string[]) => `The formula still has dimensions ${dims.join(", ")}; use sum(...) to collapse ${dims.join(", ")}`;

/** The dimensions an expression produces, or null after recording why it is invalid. */
function inferDims(node: FormulaNode, scope: Scope, issues: FormulaIssue[], references: Set<string>): string[] | null {
  const dims = ((): string[] | null => {
    switch (node.type) {
      case "number": return [];
      case "negate": return inferDims(node.operand, scope, issues, references);
      case "prev": case "round": return inferDims(node.arg, scope, issues, references);
      case "binary": {
        const left = inferDims(node.left, scope, issues, references);
        const right = inferDims(node.right, scope, issues, references);
        return left && right ? [...new Set([...left, ...right])].sort(compareText) : null;
      }
      case "ref": {
        references.add(node.name);
        const declared = scope.variables.get(node.name);
        if (!declared) { issues.push({ message: `Unknown variable "${node.name}"`, position: node.position }); return null; }
        const selected = new Set<string>();
        let valid = true;
        for (const selector of node.selectors) {
          if (!declared.includes(selector.dim)) { issues.push({ message: `"${node.name}" has no dimension "${selector.dim}"`, position: selector.position }); valid = false; continue; }
          if (selected.has(selector.dim)) { issues.push({ message: `Dimension "${selector.dim}" is selected twice`, position: selector.position }); valid = false; continue; }
          selected.add(selector.dim);
          if (!(scope.dimensions.get(selector.dim) ?? []).includes(selector.item)) { issues.push({ message: `"${selector.item}" is not an item of ${selector.dim}`, position: selector.position }); valid = false; }
        }
        return valid ? declared.filter((dim) => !selected.has(dim)) : null;
      }
      case "reduce": {
        const inner = inferDims(node.arg, scope, issues, references);
        if (!inner) return null;
        const named = new Set<string>();
        let valid = true;
        for (const dim of node.dims) {
          if (!inner.includes(dim.name)) { issues.push({ message: `${node.fn} cannot collapse "${dim.name}": the expression has no such dimension`, position: dim.position }); valid = false; }
          else if (named.has(dim.name)) { issues.push({ message: `Dimension "${dim.name}" is listed twice`, position: dim.position }); valid = false; }
          named.add(dim.name);
        }
        if (!valid) return null;
        return node.dims.length ? inner.filter((dim) => !named.has(dim)) : [];
      }
    }
  })();
  if (dims && cellCount(dims, scope) > modelLimits.cellsPerVariable) {
    issues.push({ message: `This expression spans ${cellCount(dims, scope)} cells; the limit is ${modelLimits.cellsPerVariable}`, position: node.position });
    return null;
  }
  return dims;
}

function checkFormula(formula: string, scope: Scope): { node: FormulaNode | null; dims: string[]; issues: FormulaIssue[]; references: string[] } {
  const parsed = parseFormula(formula);
  if (!parsed.ok) return { node: null, dims: [], issues: [parsed.error], references: [] };
  const issues: FormulaIssue[] = [];
  const references = new Set<string>();
  const dims = inferDims(parsed.node, scope, issues, references);
  return { node: parsed.node, dims: dims ?? [], issues, references: [...references].sort(compareText) };
}

function coordinates(dims: string[], dimensions: Map<string, string[]>): string[][] {
  let result: string[][] = [[]];
  for (const dim of dims) {
    const items = dimensions.get(dim) ?? [];
    result = result.flatMap((prefix) => items.map((item) => [...prefix, item]));
  }
  return result;
}

function validateInputs(variable: ForecastVariable, dims: string[], dimensions: Map<string, string[]>, monthCount: number, errors: ModelIssue[], warnings: ModelIssue[]) {
  const at = { variable: variable.name };
  const seen = new Set<string>();
  const covered = new Set<string>();
  for (const entry of variable.inputs) {
    if (Object.keys(entry.coords).sort(compareText).join(",") !== dims.join(",")) { errors.push({ ...at, message: `An input for "${variable.name}" must name exactly its dimensions [${dims.join(", ")}]` }); continue; }
    const bad = dims.find((dim) => !(dimensions.get(dim) ?? []).includes(entry.coords[dim]!));
    if (bad) { errors.push({ ...at, message: `An input for "${variable.name}" uses ${bad}=${entry.coords[bad]}, which is not an item of ${bad}` }); continue; }
    if (!isValidMonth(entry.from)) { errors.push({ ...at, message: `An input for "${variable.name}" has an invalid month "${entry.from}"` }); continue; }
    const value = parseDecimal(entry.value);
    if (value === null || value > modelValueCap || value < -modelValueCap) { errors.push({ ...at, message: `An input for "${variable.name}" has an invalid value "${entry.value}"` }); continue; }
    const items = dims.map((dim) => entry.coords[dim]!);
    const key = coordinateKey(items);
    if (seen.has(`${key}@${entry.from}`)) { errors.push({ ...at, message: `"${variable.name}" has two inputs for ${describeCoordinate(dims, items)} from ${entry.from}` }); continue; }
    seen.add(`${key}@${entry.from}`);
    covered.add(key);
  }
  if (!variable.inputs.length) { warnings.push({ ...at, message: `"${variable.name}" has no inputs yet; its cells are 0` }); return; }
  if (dims.some((dim) => !dimensions.has(dim))) return;
  const coordinateCount = dims.reduce((total, dim) => total * dimensions.get(dim)!.length, 1);
  // Missing-cell warnings are advisory. Never materialize an already-invalid or otherwise
  // oversized Cartesian space merely to construct one.
  if (coordinateCount * Math.max(monthCount, 1) > modelLimits.cellsPerVariable) return;
  const missing = coordinates(dims, dimensions).filter((items) => !covered.has(coordinateKey(items)));
  if (missing.length) {
    const shown = missing.slice(0, 5).map((items) => describeCoordinate(dims, items)).join("; ");
    warnings.push({ ...at, message: `"${variable.name}" has no inputs for ${shown}${missing.length > 5 ? ` and ${missing.length - 5} more` : ""}; those cells are 0` });
  }
}

type Analysis = { errors: ModelIssue[]; warnings: ModelIssue[]; order: string[]; parsed: Map<string, FormulaNode>; references: Map<string, string[]>; scope: Scope };

/** Every static check on a model, plus the evaluation order (references first). */
function analyzeModel(model: ForecastModel, monthCount: number): Analysis {
  const errors: ModelIssue[] = [];
  const warnings: ModelIssue[] = [];
  if (model.dimensions.length > modelLimits.dimensions) errors.push({ message: `A model has at most ${modelLimits.dimensions} dimensions` });
  if (model.variables.length > modelLimits.variables) errors.push({ message: `A model has at most ${modelLimits.variables} variables` });

  const dimensions = new Map<string, string[]>();
  for (const dimension of model.dimensions) {
    const at = { dimension: dimension.name };
    if (!isModelIdentifier(dimension.name)) errors.push({ ...at, message: `Dimension name "${dimension.name}" ${naming}` });
    else if (dimensions.has(dimension.name)) errors.push({ ...at, message: `Dimension "${dimension.name}" is defined twice` });
    if (!dimension.items.length) errors.push({ ...at, message: `Dimension "${dimension.name}" needs at least one item` });
    if (dimension.items.length > modelLimits.itemsPerDimension) errors.push({ ...at, message: `Dimension "${dimension.name}" has more than ${modelLimits.itemsPerDimension} items` });
    const seen = new Set<string>();
    for (const item of dimension.items) {
      if (!isModelIdentifier(item)) errors.push({ ...at, message: `Item "${item}" in ${dimension.name} ${naming}` });
      else if (seen.has(item)) errors.push({ ...at, message: `Item "${item}" appears twice in ${dimension.name}` });
      seen.add(item);
    }
    if (!dimensions.has(dimension.name)) dimensions.set(dimension.name, dimension.items);
  }

  const scope: Scope = { variables: new Map(), dimensions, monthCount };
  const byName = new Map<string, ForecastVariable>();
  for (const variable of model.variables) {
    const at = { variable: variable.name };
    if (!isModelIdentifier(variable.name)) errors.push({ ...at, message: `Variable name "${variable.name}" ${naming}` });
    else if ((modelFunctionNames as readonly string[]).includes(variable.name)) errors.push({ ...at, message: `"${variable.name}" is a function name and cannot name a variable` });
    else if (byName.has(variable.name)) errors.push({ ...at, message: `Variable "${variable.name}" is defined twice` });
    if (variable.kind !== "money" && variable.kind !== "number") errors.push({ ...at, message: `Variable "${variable.name}" must be money or number` });
    const dims = [...new Set(variable.dims)].sort(compareText);
    if (dims.length !== variable.dims.length) errors.push({ ...at, message: `Variable "${variable.name}" lists a dimension twice` });
    for (const dim of dims) if (!dimensions.has(dim)) errors.push({ ...at, message: `Variable "${variable.name}" uses unknown dimension "${dim}"` });
    if (dims.every((dim) => dimensions.has(dim)) && cellCount(dims, scope) > modelLimits.cellsPerVariable) errors.push({ ...at, message: `Variable "${variable.name}" has ${cellCount(dims, scope)} cells (dimension items × months); the limit is ${modelLimits.cellsPerVariable}` });
    if (!byName.has(variable.name)) { byName.set(variable.name, variable); scope.variables.set(variable.name, dims); }
  }

  const parsed = new Map<string, FormulaNode>();
  const references = new Map<string, string[]>();
  for (const variable of byName.values()) {
    const at = { variable: variable.name };
    const dims = scope.variables.get(variable.name)!;
    if (variable.formula === undefined) { validateInputs(variable, dims, dimensions, monthCount, errors, warnings); continue; }
    if (variable.inputs.length) errors.push({ ...at, message: `Variable "${variable.name}" has both a formula and inputs; keep one` });
    const check = checkFormula(variable.formula, scope);
    errors.push(...check.issues.map((issue) => ({ ...at, position: issue.position, message: issue.message })));
    if (!check.node) continue;
    references.set(variable.name, check.references);
    parsed.set(variable.name, check.node);
    if (!check.issues.length && check.dims.join(",") !== dims.join(",")) errors.push({ ...at, position: 0, message: `The formula for "${variable.name}" produces dimensions [${check.dims.join(", ")}] but the variable declares [${dims.join(", ")}]` });
  }

  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const reported = new Set<string>();
  const visit = (name: string, path: string[]) => {
    const current = state.get(name);
    if (current === "done") return;
    if (current === "visiting") {
      const cycle = [...path.slice(path.indexOf(name)), name];
      const key = [...new Set(cycle)].sort(compareText).join(",");
      if (!reported.has(key)) { reported.add(key); errors.push({ variable: name, message: `Cycle: ${cycle.join(" → ")}` }); }
      return;
    }
    state.set(name, "visiting");
    for (const reference of references.get(name) ?? []) if (byName.has(reference)) visit(reference, [...path, name]);
    state.set(name, "done");
    order.push(name);
  };
  for (const name of [...byName.keys()].sort(compareText)) visit(name, []);
  return { errors, warnings, order, parsed, references, scope };
}

/**
 * The dry run: every error (with its position, when it has one) and warning for a model,
 * plus errors for driver formulas that are invalid or still carry dimensions.
 */
export function validateModel(model: ForecastModel, options: { monthCount?: number; driverFormulas?: { id: string; formula: string }[] } = {}): ModelValidation {
  const analysis = analyzeModel(model, options.monthCount ?? defaultModelMonthCount);
  const errors = [...analysis.errors];
  for (const driver of options.driverFormulas ?? []) {
    const check = checkFormula(driver.formula, analysis.scope);
    if (check.issues.length) errors.push(...check.issues.map((issue) => ({ driverId: driver.id, position: issue.position, message: issue.message })));
    else if (check.dims.length) errors.push({ driverId: driver.id, message: collapseMessage(check.dims) });
  }
  return { errors, warnings: analysis.warnings };
}

type EvalContext = { months: string[]; dimensions: Map<string, string[]>; cubes: Map<string, Cube> };
const capped = (value: bigint): CellValue => (value > modelValueCap || value < -modelValueCap ? null : value);
const mapRows = (cube: Cube, map: (row: CellValue[]) => CellValue[]): Cube => ({ dims: cube.dims, months: cube.months, cells: new Map([...cube.cells].map(([key, row]) => [key, map(row)])) });

function applyOperator(op: "+" | "-" | "*" | "/", left: CellValue, right: CellValue): CellValue {
  if (left === null || right === null) return null;
  if (op === "+") return capped(left + right);
  if (op === "-") return capped(left - right);
  if (op === "*") return capped(multiplyDecimal(left, right));
  const quotient = divideDecimal(left, right);
  return quotient === null ? null : capped(quotient);
}

/** A binary operation broadcast over the sorted union of both operands' dimensions; month always aligns. */
function combine(left: Cube, right: Cube, op: "+" | "-" | "*" | "/", context: EvalContext): Cube {
  const dims = [...new Set([...left.dims, ...right.dims])].sort(compareText);
  const leftAt = left.dims.map((dim) => dims.indexOf(dim));
  const rightAt = right.dims.map((dim) => dims.indexOf(dim));
  const cells = new Map<string, CellValue[]>();
  for (const items of coordinates(dims, context.dimensions)) {
    const leftRow = left.cells.get(coordinateKey(leftAt.map((index) => items[index]!)))!;
    const rightRow = right.cells.get(coordinateKey(rightAt.map((index) => items[index]!)))!;
    cells.set(coordinateKey(items), leftRow.map((value, index) => applyOperator(op, value, rightRow[index]!)));
  }
  return { dims, months: context.months, cells };
}

function select(cube: Cube, selectors: FormulaSelector[]): Cube {
  if (!selectors.length) return cube;
  const fixed = new Map(selectors.map((selector) => [selector.dim, selector.item]));
  const kept = cube.dims.flatMap((dim, index) => (fixed.has(dim) ? [] : [index]));
  const cells = new Map<string, CellValue[]>();
  for (const [key, row] of cube.cells) {
    const items = splitKey(key, cube.dims.length);
    if (cube.dims.every((dim, index) => !fixed.has(dim) || fixed.get(dim) === items[index])) cells.set(coordinateKey(kept.map((index) => items[index]!)), row);
  }
  return { dims: kept.map((index) => cube.dims[index]!), months: cube.months, cells };
}

function aggregate(fn: ModelReducer, values: CellValue[]): CellValue {
  if (values.some((value) => value === null)) return null;
  const numbers = values as bigint[];
  if (fn === "min") return numbers.reduce((left, right) => (right < left ? right : left));
  if (fn === "max") return numbers.reduce((left, right) => (right > left ? right : left));
  const total = numbers.reduce((left, right) => left + right, 0n);
  return capped(fn === "sum" ? total : divideHalfEven(total, BigInt(numbers.length)));
}

/** Collapse the named dimensions, or every dimension when none is named. */
function reduce(cube: Cube, fn: ModelReducer, named: string[]): Cube {
  const removed = new Set(named.length ? named : cube.dims);
  const kept = cube.dims.flatMap((dim, index) => (removed.has(dim) ? [] : [index]));
  const groups = new Map<string, CellValue[][]>();
  for (const [key, row] of cube.cells) {
    const items = splitKey(key, cube.dims.length);
    const target = coordinateKey(kept.map((index) => items[index]!));
    const group = groups.get(target);
    if (group) group.push(row); else groups.set(target, [row]);
  }
  const cells = new Map<string, CellValue[]>();
  for (const [key, rows] of groups) cells.set(key, cube.months.map((_, index) => aggregate(fn, rows.map((row) => row[index]!))));
  return { dims: kept.map((index) => cube.dims[index]!), months: cube.months, cells };
}

function evaluateNode(node: FormulaNode, context: EvalContext): Cube {
  switch (node.type) {
    case "number": return { dims: [], months: context.months, cells: new Map([["", context.months.map(() => capped(node.value))]]) };
    case "negate": return mapRows(evaluateNode(node.operand, context), (row) => row.map((value) => (value === null ? null : -value)));
    case "binary": return combine(evaluateNode(node.left, context), evaluateNode(node.right, context), node.op, context);
    case "ref": return select(context.cubes.get(node.name)!, node.selectors);
    case "reduce": return reduce(evaluateNode(node.arg, context), node.fn, node.dims.map((dim) => dim.name));
    case "prev": return mapRows(evaluateNode(node.arg, context), (row) => row.map((_, index) => row[index === 0 ? 0 : index - 1]!));
    case "round": return mapRows(evaluateNode(node.arg, context), (row) => row.map((value) => (value === null ? null : capped(roundDecimal(value, node.places)))));
  }
}

/** Step functions: each entry applies from its month until the next entry for the same coordinates; no entry is 0. */
function inputCube(variable: ForecastVariable, context: EvalContext): Cube {
  const dims = [...variable.dims].sort(compareText);
  const steps = new Map<string, { from: string; value: bigint }[]>();
  for (const entry of variable.inputs) {
    const key = coordinateKey(dims.map((dim) => entry.coords[dim]!));
    const list = steps.get(key) ?? [];
    list.push({ from: entry.from, value: parseDecimal(entry.value)! });
    steps.set(key, list);
  }
  const cells = new Map<string, CellValue[]>();
  for (const items of coordinates(dims, context.dimensions)) {
    const key = coordinateKey(items);
    const entries = (steps.get(key) ?? []).sort((left, right) => compareText(left.from, right.from));
    cells.set(key, context.months.map((month) => {
      let value = 0n;
      for (const entry of entries) { if (entry.from > month) break; value = entry.value; }
      return value;
    }));
  }
  return { dims, months: context.months, cells };
}

function computeCubes(model: ForecastModel, months: string[], analysis: Analysis): EvalContext {
  const context: EvalContext = { months, dimensions: analysis.scope.dimensions, cubes: new Map() };
  const byName = new Map(model.variables.map((variable) => [variable.name, variable]));
  for (const name of analysis.order) {
    const node = analysis.parsed.get(name);
    context.cubes.set(name, node ? evaluateNode(node, context) : inputCube(byName.get(name)!, context));
  }
  return context;
}

/** Evaluate every variable over `months` (consecutive; the first is the as-of month, the base for `prev`). */
export function evaluateModel(model: ForecastModel, months: string[]): ModelEvaluation {
  assertMonths(months);
  const analysis = analyzeModel(model, months.length);
  if (analysis.errors.length) return { ok: false, errors: analysis.errors };
  return { ok: true, months, cubes: computeCubes(model, months, analysis).cubes };
}

/** Evaluate one formula (for example an item's) against a model; dimensions are kept. */
export function evaluateFormula(formula: string, model: ForecastModel, months: string[]): { ok: true; cube: Cube } | { ok: false; errors: ModelIssue[] } {
  assertMonths(months);
  const analysis = analyzeModel(model, months.length);
  if (analysis.errors.length) return { ok: false, errors: analysis.errors };
  const check = checkFormula(formula, analysis.scope);
  if (!check.node || check.issues.length) return { ok: false, errors: check.issues.map((issue) => ({ position: issue.position, message: issue.message })) };
  return { ok: true, cube: evaluateNode(check.node, computeCubes(model, months, analysis)) };
}

function transitiveReferences(direct: string[], references: Map<string, string[]>): string[] {
  const seen = new Set<string>();
  const queue = [...direct];
  while (queue.length) {
    const name = queue.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    queue.push(...(references.get(name) ?? []));
  }
  return [...seen];
}

/**
 * Give every driver with an `amountFormula` its `amountByMonth`: the formula's value in each month,
 * as minor units (major × 100, half away from zero), "error" for an errored cell, or a negative
 * number that projection rejects. A formula must collapse to month alone. Drivers without a formula
 * are returned as the same array when none has one.
 */
export function resolveFormulaDrivers(drivers: ForecastDriver[], model: ForecastModel | undefined, months: string[]): FormulaResolution {
  assertMonths(months);
  const formulaDrivers = drivers.filter((driver) => driver.amountFormula !== undefined);
  if (!formulaDrivers.length) return { drivers, exceptions: [], summary: { variables: [] } };
  const effective = model ?? { dimensions: [], variables: [] };
  const analysis = analyzeModel(effective, months.length);
  if (analysis.errors.length) {
    const more = analysis.errors.length - 1;
    const reason = `The forecast model is invalid: ${analysis.errors[0]!.message}${more ? ` (and ${more} more)` : ""}`;
    return { drivers, exceptions: formulaDrivers.map((driver) => ({ driverId: driver.id, reason })), summary: { variables: [] } };
  }
  const context = computeCubes(effective, months, analysis);
  const exceptions: { driverId: string; reason: string }[] = [];
  const usedBy = new Map<string, Set<string>>();
  const resolved = drivers.map((driver): ForecastDriver => {
    if (driver.amountFormula === undefined) return driver;
    const check = checkFormula(driver.amountFormula, analysis.scope);
    if (!check.node || check.issues.length) {
      const issue = check.issues[0]!;
      exceptions.push({ driverId: driver.id, reason: `Formula is invalid at character ${issue.position + 1}: ${issue.message}` });
      return driver;
    }
    if (check.dims.length) { exceptions.push({ driverId: driver.id, reason: collapseMessage(check.dims) }); return driver; }
    const row = evaluateNode(check.node, context).cells.get("")!;
    for (const name of transitiveReferences(check.references, analysis.references)) usedBy.set(name, (usedBy.get(name) ?? new Set<string>()).add(driver.id));
    return { ...driver, amountByMonth: Object.fromEntries(months.map((month, index) => { const value = row[index]!; return [month, value === null ? "error" : decimalToMinorUnits(value).toString()]; })) };
  });
  const byName = new Map(effective.variables.map((variable) => [variable.name, variable]));
  const variables = [...usedBy.keys()].sort(compareText).map((name) => {
    const cube = context.cubes.get(name)!;
    const monthlyTotals = Object.fromEntries(months.map((month, index) => {
      let total: bigint | null = 0n;
      for (const row of cube.cells.values()) { const value = row[index]!; total = total === null || value === null ? null : total + value; }
      return [month, total === null ? null : formatDecimal(total)];
    }));
    return { name, kind: byName.get(name)!.kind, dims: [...cube.dims], driverIds: [...usedBy.get(name)!].sort(compareText), monthlyTotals };
  });
  return { drivers: resolved, exceptions, summary: { variables } };
}

export function formatDecimal(value: bigint): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const fraction = (magnitude % modelScale).toString().padStart(6, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${magnitude / modelScale}${fraction ? `.${fraction}` : ""}`;
}

const abs = (value: bigint) => (value < 0n ? -value : value);
const quotientSign = (numerator: bigint, denominator: bigint) => ((numerator < 0n) !== (denominator < 0n) ? -1n : 1n);

export function divideHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("Division by zero");
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return quotient;
  const twice = abs(remainder) * 2n;
  const whole = abs(denominator);
  return twice > whole || (twice === whole && quotient % 2n !== 0n) ? quotient + quotientSign(numerator, denominator) : quotient;
}

export function divideHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("Division by zero");
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return abs(remainder) * 2n >= abs(denominator) && remainder !== 0n ? quotient + quotientSign(numerator, denominator) : quotient;
}

export const multiplyDecimal = (left: bigint, right: bigint) => divideHalfEven(left * right, modelScale);
export const divideDecimal = (left: bigint, right: bigint): bigint | null => (right === 0n ? null : divideHalfEven(left * modelScale, right));
export function roundDecimal(value: bigint, places: number): bigint {
  if (!Number.isInteger(places) || places < 0 || places > 6) {
    throw new RangeError("Decimal places must be a whole number from 0 to 6");
  }
  const factor = 10n ** BigInt(6 - places);
  return divideHalfAwayFromZero(value, factor) * factor;
}
export const decimalToMinorUnits = (value: bigint) => divideHalfAwayFromZero(value, 10_000n);

export class FormulaSyntaxError extends Error {
  readonly position: number;
  constructor(message: string, position: number) {
    super(message);
    this.name = "FormulaSyntaxError";
    this.position = position;
  }
}

export type FormulaToken = { type: "number" | "ident" | "op" | "end"; text: string; position: number };
const numberToken = /\d+(?:\.\d+)?/y;
const identToken = /[A-Za-z_][A-Za-z0-9_]*/y;
const operators = "+-*/()[],=";

export function tokenizeFormula(formula: string): FormulaToken[] {
  const tokens: FormulaToken[] = [];
  let index = 0;
  while (index < formula.length) {
    const char = formula[index]!;
    if (/\s/.test(char)) { index += 1; continue; }
    numberToken.lastIndex = index;
    const number = numberToken.exec(formula);
    if (number) { tokens.push({ type: "number", text: number[0], position: index }); index += number[0].length; continue; }
    identToken.lastIndex = index;
    const ident = identToken.exec(formula);
    if (ident) { tokens.push({ type: "ident", text: ident[0], position: index }); index += ident[0].length; continue; }
    if (operators.includes(char)) { tokens.push({ type: "op", text: char, position: index }); index += 1; continue; }
    throw new FormulaSyntaxError(`Unexpected character "${char}"`, index);
  }
  tokens.push({ type: "end", text: "", position: formula.length });
  return tokens;
}

export type FormulaSelector = { dim: string; item: string; position: number };
export type FormulaNode =
  | { type: "number"; value: bigint; position: number }
  | { type: "negate"; operand: FormulaNode; position: number }
  | { type: "binary"; op: "+" | "-" | "*" | "/"; left: FormulaNode; right: FormulaNode; position: number }
  | { type: "ref"; name: string; selectors: FormulaSelector[]; position: number }
  | { type: "reduce"; fn: ModelReducer; arg: FormulaNode; dims: { name: string; position: number }[]; position: number }
  | { type: "prev"; arg: FormulaNode; position: number }
  | { type: "round"; arg: FormulaNode; places: number; position: number };
export type FormulaParseResult = { ok: true; node: FormulaNode } | { ok: false; error: { message: string; position: number } };

export function parseFormula(formula: string): FormulaParseResult {
  if (formula.length > modelLimits.formulaLength) return { ok: false, error: { message: `Formula is longer than ${modelLimits.formulaLength} characters`, position: modelLimits.formulaLength } };
  try {
    const tokens = tokenizeFormula(formula);
    let index = 0;
    let depth = 0;
    const peek = (): FormulaToken => tokens[index]!;
    const next = (): FormulaToken => { const token = tokens[index]!; if (token.type !== "end") index += 1; return token; };
    const isOp = (token: FormulaToken, ...texts: string[]) => token.type === "op" && texts.includes(token.text);
    const unexpected = (token: FormulaToken) => new FormulaSyntaxError(token.type === "end" ? "Formula ended early" : `Unexpected "${token.text}"`, token.position);
    const expectOp = (text: string, message: string) => { const token = next(); if (!isOp(token, text)) throw new FormulaSyntaxError(message, token.position); };
    const expectName = (message: string) => { const token = next(); if (token.type !== "ident") throw new FormulaSyntaxError(message, token.position); return token; };

    const expr = (): FormulaNode => {
      let node = term();
      while (isOp(peek(), "+", "-")) { const op = next(); node = { type: "binary", op: op.text as "+" | "-", left: node, right: term(), position: op.position }; }
      return node;
    };
    const term = (): FormulaNode => {
      let node = factor();
      while (isOp(peek(), "*", "/")) { const op = next(); node = { type: "binary", op: op.text as "*" | "/", left: node, right: factor(), position: op.position }; }
      return node;
    };
    const factor = (): FormulaNode => {
      const token = peek();
      depth += 1;
      try {
        const beginsNestedConstruct = isOp(token, "-", "(") || (token.type === "ident" && isOp(tokens[index + 1]!, "("));
        if (depth > modelLimits.nesting && beginsNestedConstruct) throw new FormulaSyntaxError("Formula is nested too deeply", token.position);
        if (token.type === "number") {
          next();
          if ((token.text.split(".")[1] ?? "").length > 6) throw new FormulaSyntaxError("Numbers take at most 6 decimal places", token.position);
          return { type: "number", value: parseDecimal(token.text)!, position: token.position };
        }
        if (isOp(token, "-")) { next(); return { type: "negate", operand: factor(), position: token.position }; }
        if (isOp(token, "(")) { next(); const inner = expr(); expectOp(")", "Expected a closing )"); return inner; }
        if (token.type === "ident") { next(); return isOp(peek(), "(") ? call(token) : reference(token); }
        throw unexpected(token);
      } finally { depth -= 1; }
    };
    const call = (name: FormulaToken): FormulaNode => {
      next();
      if (!functionNames.includes(name.text)) throw new FormulaSyntaxError(`Unknown function "${name.text}"`, name.position);
      if (isOp(peek(), ")")) throw new FormulaSyntaxError(`${name.text} needs an argument`, peek().position);
      const arg = expr();
      if (name.text === "prev") {
        if (isOp(peek(), ",")) throw new FormulaSyntaxError("prev takes one argument", peek().position);
        expectOp(")", "Expected a closing )");
        return { type: "prev", arg, position: name.position };
      }
      if (name.text === "round") {
        expectOp(",", "round needs decimal places: round(value, places)");
        const places = next();
        if (places.type !== "number" || places.text.includes(".") || Number(places.text) > 6) throw new FormulaSyntaxError("round places must be a whole number from 0 to 6", places.position);
        expectOp(")", "Expected a closing )");
        return { type: "round", arg, places: Number(places.text), position: name.position };
      }
      const dims: { name: string; position: number }[] = [];
      while (isOp(peek(), ",")) { next(); const dim = expectName("Expected a dimension name"); dims.push({ name: dim.text, position: dim.position }); }
      expectOp(")", "Expected a closing )");
      if (!reducers.includes(name.text)) throw new FormulaSyntaxError(`Unknown function "${name.text}"`, name.position);
      return { type: "reduce", fn: name.text as ModelReducer, arg, dims, position: name.position };
    };
    const reference = (name: FormulaToken): FormulaNode => {
      if (functionNames.includes(name.text)) throw new FormulaSyntaxError(`${name.text} needs parentheses`, name.position);
      const selectors: FormulaSelector[] = [];
      if (isOp(peek(), "[")) {
        next();
        for (;;) {
          const dim = expectName("Expected a dimension name");
          expectOp("=", "Expected = after the dimension");
          const item = expectName("Expected an item name");
          selectors.push({ dim: dim.text, item: item.text, position: dim.position });
          if (isOp(peek(), ",")) { next(); continue; }
          expectOp("]", "Expected , or ]");
          break;
        }
      }
      return { type: "ref", name: name.text, selectors, position: name.position };
    };

    const node = expr();
    const rest = peek();
    if (rest.type !== "end") throw new FormulaSyntaxError(isOp(rest, ")") ? "Unmatched )" : `Unexpected "${rest.text}"`, rest.position);
    return { ok: true, node };
  } catch (error) {
    if (error instanceof FormulaSyntaxError) return { ok: false, error: { message: error.message, position: error.position } };
    throw error;
  }
}
