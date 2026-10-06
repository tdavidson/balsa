import type ExcelJS from "exceljs";
import { coordinateKey, evaluateModel, parseFormula, type FormulaNode, type ForecastModel } from "@balsa/finance-engine";
import { spreadsheetRound } from "./forecast-sheet";

/**
 * The Model sheet: Balsa's forecast model (dimensions, input variables and
 * formula variables) as spreadsheet rows, one per variable and coordinate,
 * one column per month. Inputs are editable monthly values; formula
 * variables are cell formulas compiled from Balsa's formula language. As on
 * Forecast, a variable is written as formulas only when a spreadsheet
 * evaluation of them reproduces the engine's values; otherwise it is written
 * as the engine's values, which its dependents then read.
 */

export type ModelInput = { definition: ForecastModel; months: string[] };
type Coord = Map<string, string>;
type Row = { variable: string; key: string; items: string[]; row: number };
type VariablePlan = { name: string; kind: "money" | "number"; dims: string[]; formula: string | null; node: FormulaNode | null; rows: Row[] };
export type ModelPlan = {
  months: string[];
  variables: VariablePlan[];
  live: Map<string, boolean>; reasons: Map<string, string>;
  /** Engine values (major units) by variable and coordinate key; null is an errored cell. */
  engine: Map<string, Map<string, (number | null)[]>>;
  /** The values the sheet will show, by variable and coordinate key. */
  values: Map<string, Map<string, (number | null)[]>>;
  firstRow: number; lastRow: number;
  /** A driver formula's value per model month, as the sheet computes it; null where it errors. */
  evaluateFormula(text: string): (number | null)[] | null;
  /** A driver formula as a spreadsheet expression over the Model sheet for one model month; null when it cannot be compiled. */
  compileFormula(text: string, monthIndex: number, sheetPrefix: string): string | null;
  /** A variable's own formula for one coordinate and model month, as cell text. */
  compileNode(node: FormulaNode, coord: Map<string, string>, monthIndex: number, sheetPrefix: string): string;
  /** The cells to sum for a variable's total in one model month (a model variable a pattern driver uses). */
  totalCells(name: string, monthIndex: number, sheetPrefix: string): string[];
};

export const modelColumns = { label: 1, coordinates: 2, formula: 3, source: 4, firstMonth: 5 } as const;
export const modelHeader = { index: 3, labels: 5 } as const;
/** Excel's formula length limit is 8,192 characters; stay under it with room for wrapping. */
const maxFormulaLength = 7_500;
const maxRows = 5_000;
const L = (column: number) => { let letter = ""; for (let n = column; n > 0; n = Math.floor((n - 1) / 26)) letter = String.fromCharCode(65 + ((n - 1) % 26)) + letter; return letter; };
const decimalText = (value: bigint) => { const negative = value < 0n; const magnitude = negative ? -value : value; const whole = magnitude / 1_000_000n; const fraction = (magnitude % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, ""); return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`; };

/** The dimensions a formula node leaves, in sorted order, as the engine infers them. */
function dimsOf(node: FormulaNode, variables: Map<string, VariablePlan>): string[] {
  switch (node.type) {
    case "number": return [];
    case "negate": return dimsOf(node.operand, variables);
    case "prev": case "round": return dimsOf(node.arg, variables);
    case "binary": return [...new Set([...dimsOf(node.left, variables), ...dimsOf(node.right, variables)])].sort();
    case "ref": { const selected = new Set(node.selectors.map((selector) => selector.dim)); return variables.get(node.name)!.dims.filter((dim) => !selected.has(dim)); }
    case "reduce": { const inner = dimsOf(node.arg, variables); const removed = new Set(node.dims.length ? node.dims.map((dim) => dim.name) : inner); return inner.filter((dim) => !removed.has(dim)); }
  }
}

export function planModel(input: ModelInput, firstRow: number): ModelPlan | { unsupported: string } {
  const { definition, months } = input;
  const evaluation = evaluateModel(definition, months);
  if (!evaluation.ok) return { unsupported: `the forecast model is invalid: ${evaluation.errors[0]?.message ?? "unknown error"}` };
  const dimensionItems = new Map(definition.dimensions.map((dimension) => [dimension.name, dimension.items]));
  const variables = new Map<string, VariablePlan>();
  const engine = new Map<string, Map<string, (number | null)[]>>();
  let row = firstRow;
  for (const variable of definition.variables) {
    const cube = evaluation.cubes.get(variable.name)!;
    const parsed = variable.formula ? parseFormula(variable.formula) : null;
    const rows: Row[] = [];
    row += 1; // the variable's heading row
    for (const key of cube.cells.keys()) { rows.push({ variable: variable.name, key, items: cube.dims.length ? key.split("|") : [], row }); row += 1; }
    row += 1;
    variables.set(variable.name, { name: variable.name, kind: variable.kind, dims: cube.dims, formula: variable.formula ?? null, node: parsed?.ok ? parsed.node : null, rows });
    engine.set(variable.name, new Map([...cube.cells].map(([key, cells]) => [key, cells.map((value) => value === null ? null : Number(value) / 1e6)])));
  }
  if (row - firstRow > maxRows) return { unsupported: `the forecast model has more than ${maxRows} rows` };
  const rowOf = (name: string, coord: Coord) => { const plan = variables.get(name)!; const key = coordinateKey(plan.dims.map((dim) => coord.get(dim)!)); return plan.rows.find((candidate) => candidate.key === key)!; };
  const extend = (coord: Coord, dims: string[]): Coord[] => dims.reduce<Coord[]>((all, dim) => all.flatMap((partial) => (dimensionItems.get(dim) ?? []).map((item) => new Map([...partial, [dim, item]]))), [coord]);

  /** Compile a node for one result coordinate and model month to spreadsheet text. */
  const compile = (node: FormulaNode, coord: Coord, month: number, prefix: string): string => {
    switch (node.type) {
      case "number": return decimalText(node.value);
      case "negate": return `(-${compile(node.operand, coord, month, prefix)})`;
      case "prev": return compile(node.arg, coord, Math.max(0, month - 1), prefix);
      case "round": return `ROUND(${compile(node.arg, coord, month, prefix)},${node.places})`;
      case "binary": {
        const left = compile(node.left, coord, month, prefix); const right = compile(node.right, coord, month, prefix);
        return node.op === "+" || node.op === "-" ? `(${left}${node.op}${right})` : `ROUND(${left}${node.op}${right},6)`;
      }
      case "ref": {
        const target = new Map(coord); node.selectors.forEach((selector) => target.set(selector.dim, selector.item));
        return `${prefix}${L(modelColumns.firstMonth + month)}${rowOf(node.name, target).row}`;
      }
      case "reduce": {
        const inner = dimsOf(node.arg, variables);
        const removed = node.dims.length ? node.dims.map((dim) => dim.name) : inner;
        const parts = extend(coord, removed).map((full) => compile(node.arg, full, month, prefix));
        if (node.fn === "sum") return `SUM(${parts.join(",")})`;
        if (node.fn === "avg") return `ROUND(SUM(${parts.join(",")})/${parts.length},6)`;
        return `${node.fn.toUpperCase()}(${parts.join(",")})`;
      }
    }
  };

  const live = new Map<string, boolean>(); const reasons = new Map<string, string>();
  for (const plan of variables.values()) {
    if (!plan.formula) continue;
    const tooLong = plan.node && plan.rows.some((candidate) => compile(plan.node!, new Map(plan.dims.map((dim, index) => [dim, candidate.items[index]!])), months.length - 1, "").length > maxFormulaLength);
    live.set(plan.name, Boolean(plan.node) && !tooLong);
    if (tooLong) reasons.set(plan.name, "Its formula is too long for a spreadsheet cell");
  }

  /** Evaluate a node the way the compiled cells will, reading values for rows written as values. */
  const evaluate = (values: Map<string, Map<string, (number | null)[]>>) => {
    const visit = (node: FormulaNode, coord: Coord, month: number): number | null => {
      switch (node.type) {
        case "number": return Number(node.value) / 1e6;
        case "negate": { const value = visit(node.operand, coord, month); return value === null ? null : -value; }
        case "prev": return visit(node.arg, coord, Math.max(0, month - 1));
        case "round": { const value = visit(node.arg, coord, month); return value === null ? null : spreadsheetRound(value, node.places); }
        case "binary": {
          const left = visit(node.left, coord, month); const right = visit(node.right, coord, month);
          if (left === null || right === null) return null;
          if (node.op === "+") return left + right; if (node.op === "-") return left - right;
          if (node.op === "*") return spreadsheetRound(left * right, 6);
          return right === 0 ? null : spreadsheetRound(left / right, 6);
        }
        case "ref": { const target = new Map(coord); node.selectors.forEach((selector) => target.set(selector.dim, selector.item)); return cell(node.name, target, month); }
        case "reduce": {
          const inner = dimsOf(node.arg, variables);
          const parts = extend(coord, node.dims.length ? node.dims.map((dim) => dim.name) : inner).map((full) => visit(node.arg, full, month));
          if (parts.some((part) => part === null)) return null;
          const numbers = parts as number[];
          if (node.fn === "sum") return numbers.reduce((sum, value) => sum + value, 0);
          if (node.fn === "avg") return spreadsheetRound(numbers.reduce((sum, value) => sum + value, 0) / numbers.length, 6);
          return node.fn === "min" ? Math.min(...numbers) : Math.max(...numbers);
        }
      }
    };
    const cell = (name: string, coord: Coord, month: number): number | null => {
      const plan = variables.get(name)!; const target = rowOf(name, coord);
      let rowValues = values.get(name)?.get(target.key);
      if (!rowValues) {
        rowValues = live.get(name) ? months.map((_, index) => visit(plan.node!, new Map(plan.dims.map((dim, at) => [dim, target.items[at]!])), index)) : engine.get(name)!.get(target.key)!;
        if (!values.has(name)) values.set(name, new Map());
        values.get(name)!.set(target.key, rowValues);
      }
      return rowValues[month]!;
    };
    for (const plan of variables.values()) for (const candidate of plan.rows) cell(plan.name, new Map(plan.dims.map((dim, index) => [dim, candidate.items[index]!])), 0);
    return { values, visit };
  };

  let result = evaluate(new Map());
  for (let round = 0; round <= variables.size; round += 1) {
    let changed = false;
    for (const [name, isLive] of live) {
      if (!isLive) continue;
      const differs = [...engine.get(name)!].some(([key, expected]) => result.values.get(name)!.get(key)!.some((value, index) => { const want = expected[index]!; return want === null || value === null ? want !== value : Math.abs(value - want) >= 0.0000005; }));
      if (differs) { live.set(name, false); reasons.set(name, "Its formula would not reproduce Balsa's values exactly"); changed = true; }
    }
    if (!changed) break;
    result = evaluate(new Map());
  }
  const scope = new Map<string, VariablePlan>(variables);
  const parseDriver = (text: string) => { const parsed = parseFormula(text); if (!parsed.ok) return null; try { return dimsOf(parsed.node, scope).length ? null : parsed.node; } catch { return null; } };
  return {
    months, variables: [...variables.values()], live, reasons, engine, values: result.values, firstRow, lastRow: row,
    evaluateFormula: (text) => { const node = parseDriver(text); if (!node) return null; try { return months.map((_, index) => result.visit(node, new Map(), index)); } catch { return null; } },
    compileFormula: (text, monthIndex, prefix) => { const node = parseDriver(text); if (!node) return null; try { const compiled = compile(node, new Map(), monthIndex, prefix); return compiled.length > maxFormulaLength ? null : compiled; } catch { return null; } },
    compileNode: compile,
    totalCells: (name, monthIndex, prefix) => (variables.get(name)?.rows ?? []).map((candidate) => `${prefix}${L(modelColumns.firstMonth + monthIndex)}${candidate.row}`),
  };
}

export type ModelStyles = { input: string; formula: string; muted: string; inputFill: string; date: string };
const monthEnd = (period: string) => { const [year, month] = period.split("-").map(Number) as [number, number]; return new Date(Date.UTC(year, month, 0)); };

export function writeModelSheet(sheet: ExcelJS.Worksheet, input: ModelInput, plan: ModelPlan, styles: ModelStyles) {
  const muted = { color: { argb: styles.muted }, size: 9 };
  Object.assign(sheet.getCell(1, 1), { value: "Model", font: { bold: true, size: 14 } });
  Object.assign(sheet.getCell(2, 1), { value: "Balsa's forecast model: each variable by coordinate and month. Blue cells on a pale fill are inputs; black cells are formulas compiled from Balsa's formula, which formula drivers on Forecast read.", font: { color: { argb: styles.muted }, italic: true } });
  Object.assign(sheet.getCell(modelHeader.index, 1), { value: "Model month (the first is the as-of month; prev() there reads itself)", font: muted });
  const headers: [number, string, number][] = [[modelColumns.label, "Variable", 28], [modelColumns.coordinates, "Coordinates", 24], [modelColumns.formula, "Balsa formula", 34], [modelColumns.source, "Source", 26]];
  for (const [column, label, width] of headers) { sheet.getColumn(column).width = width; Object.assign(sheet.getCell(modelHeader.labels, column), { value: label, font: { bold: true } }); }
  plan.months.forEach((month, index) => {
    const column = modelColumns.firstMonth + index; sheet.getColumn(column).width = 12;
    Object.assign(sheet.getCell(modelHeader.index, column), { value: index + 1, font: muted, alignment: { horizontal: "right" } });
    Object.assign(sheet.getCell(modelHeader.labels, column), { value: monthEnd(month), numFmt: styles.date, font: { bold: true }, alignment: { horizontal: "right" } });
  });
  const dimensions = input.definition.dimensions.map((dimension) => `${dimension.name}: ${dimension.items.join(", ")}`).join("   ");
  if (dimensions) Object.assign(sheet.getCell(modelHeader.labels + 1, 1), { value: `Dimensions   ${dimensions}`, font: muted });
  for (const variable of plan.variables) {
    const heading = variable.rows[0] ? variable.rows[0].row - 1 : plan.firstRow;
    Object.assign(sheet.getCell(heading, 1), { value: `${variable.name} (${variable.kind}${variable.dims.length ? `, by ${variable.dims.join(", ")}` : ""})`, font: { bold: true } });
    const isLive = plan.live.get(variable.name) === true;
    for (const candidate of variable.rows) {
      sheet.getCell(candidate.row, modelColumns.label).value = variable.name;
      sheet.getCell(candidate.row, modelColumns.coordinates).value = variable.dims.map((dim, index) => `${dim}=${candidate.items[index]}`).join(", ") || null;
      Object.assign(sheet.getCell(candidate.row, modelColumns.formula), { value: variable.formula ?? "input", font: { italic: true, color: { argb: styles.muted } } });
      Object.assign(sheet.getCell(candidate.row, modelColumns.source), { value: !variable.formula ? "Input" : isLive ? "Formula" : `Balsa's values: ${plan.reasons.get(variable.name) ?? "not compiled"}`, font: muted });
      const coord = new Map(variable.dims.map((dim, index) => [dim, candidate.items[index]!]));
      plan.months.forEach((_, index) => {
        const cell = sheet.getCell(candidate.row, modelColumns.firstMonth + index);
        const numFmt = variable.kind === "money" ? '#,##0.00;(#,##0.00);"–"' : "#,##0.######";
        if (variable.formula && isLive) { Object.assign(cell, { value: { formula: plan.compileNode(variable.node!, coord, index, "") }, numFmt, font: { color: { argb: styles.formula } } }); return; }
        const value = plan.engine.get(variable.name)!.get(candidate.key)![index]!;
        Object.assign(cell, { value: value === null ? "error" : value, numFmt, font: { color: { argb: styles.input } }, ...(variable.formula ? {} : { fill: { type: "pattern", pattern: "solid", fgColor: { argb: styles.inputFill } } }) });
      });
    }
  }
  sheet.views = [{ state: "frozen", xSplit: 2, ySplit: modelHeader.labels }];
}
