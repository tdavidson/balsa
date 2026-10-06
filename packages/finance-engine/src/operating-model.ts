import { addMonths, isValidMonth } from "./periods";
import { decimalToMinorUnits, divideDecimal, formatDecimal, modelScale, multiplyDecimal, parseDecimal } from "./forecast-model";

export const operatingModelVersion = "operating-model-2026-10-05.1";
export const operatingOps = ["input", "add", "subtract", "multiply", "divide", "min", "max", "gt", "gte", "eq", "if", "lag"] as const;
export type OperatingOp = typeof operatingOps[number];
export type OperatingStep = { month: string; value: string };
export type OperatingNode = { basis?: "user_assumption" | "ai_suggestion" | undefined; id: string; label: string; unit: string; op: OperatingOp; args: string[]; values: OperatingStep[]; initial: string | null; rationale: string; evidenceIds: string[] };
export type OperatingDecision = { question: string; deadline: string | null; constraints: string[]; caseId: string; compareCaseId: string; metric: "ending_cash" | "minimum_cash"; cashFloorMinor: string; ranges: { nodeId: string; from: string; low: string; high: string }[] };
export type OperatingModel = { decision?: OperatingDecision | undefined; name: string; description: string; startMonth: string; months: number; nodes: OperatingNode[]; outputs: { nodeId: string; label: string; direction: "receipt" | "spend"; category: "other" | "salary" | "contractor" }[]; cases: { id: string; name: string; rationale: string; overrides: { nodeId: string; values: OperatingStep[] }[] }[]; limitations: string[] };
export type OperatingRun = { formulaVersion: string; caseId: string; months: string[]; values: Record<string, string[]>; cash: { nodeId: string; label: string; month: string; direction: "receipt" | "spend"; category: "other" | "salary" | "contractor"; amountMinor: string }[] };
const cap = 10n ** 18n;
const identifier = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const fail = (text: string): never => { throw new Error(text); };
const decimal = (text: string) => { const n = typeof text === "string" ? parseDecimal(text) : null; if (n === null || n > cap || n < -cap) return fail("Invalid or out-of-range operating value."); return n; };
const boundedText = (text: string, max: number) => typeof text === "string" && text.trim().length > 0 && text.length <= max;

/** The AI supplies data, never executable code. Lag edges cross months; all other edges must form a DAG. */
export function validateOperatingModel(model: OperatingModel): void {
  if (!model || !boundedText(model.name, 120) || !boundedText(model.description, 2000) || !isValidMonth(model.startMonth) || !Number.isInteger(model.months) || model.months < 1 || model.months > 24) fail("Use a named operating model with a valid start month and 1–24 months.");
  if (!Array.isArray(model.nodes) || !model.nodes.length || model.nodes.length > 80 || !Array.isArray(model.outputs) || !model.outputs.length || model.outputs.length > 4 || !Array.isArray(model.cases) || model.cases.length > 5 || !Array.isArray(model.limitations) || model.limitations.length > 20 || model.limitations.some((item) => !boundedText(item, 1000))) fail("Operating model exceeds supported size limits.");
  const nodes = new Map(model.nodes.map((node) => [node.id, node]));
  if (nodes.size !== model.nodes.length) fail("Operating variable names must be unique.");
  const steps = (values: OperatingStep[]) => {
    if (!Array.isArray(values) || !values.length || values.length > 25 || new Set(values.map((v) => v.month)).size !== values.length) fail("Inputs need 1–25 distinct dated values.");
    for (const value of values) { if (!isValidMonth(value.month)) fail("Invalid input month."); decimal(value.value); }
    if (!values.some((v) => v.month <= model.startMonth)) fail("Each input needs an explicit starting value.");
  };
  for (const node of model.nodes) {
    if (!identifier.test(node.id) || !boundedText(node.label, 160) || !boundedText(node.unit, 60) || !boundedText(node.rationale, 2000) || !Array.isArray(node.evidenceIds) || node.evidenceIds.length > 10 || node.evidenceIds.some((id) => typeof id !== "string" || id.length > 64) || !operatingOps.includes(node.op) || !Array.isArray(node.args) || !Array.isArray(node.values)) fail("Invalid operating variable definition.");
    const arity = node.op === "input" ? 0 : node.op === "lag" ? 1 : node.op === "if" ? 3 : 2;
    if (node.args.length !== arity || node.args.some((id) => !nodes.has(id))) fail(`Invalid references for ${node.id}.`);
    if (node.op === "input") steps(node.values); else if (node.values.length) fail("Only inputs may have dated values.");
    if (node.op === "lag") { if (node.initial === null) fail("Lag variables require an explicit initial value."); decimal(node.initial!); }
    else if (node.initial !== null) fail("Only lag variables may have an initial value.");
  }
  const visiting = new Set<string>(); const done = new Set<string>();
  const visit = (id: string) => { if (visiting.has(id)) fail("Same-month circular dependency. Use an explicit lag for feedback over time."); if (done.has(id)) return; visiting.add(id); const node = nodes.get(id)!; if (node.op !== "lag") node.args.forEach(visit); visiting.delete(id); done.add(id); };
  model.nodes.forEach((node) => visit(node.id));
  if (new Set(model.outputs.map((o) => o.nodeId)).size !== model.outputs.length) fail("A cash variable can be mapped only once.");
  for (const output of model.outputs) if (!nodes.has(output.nodeId) || !boundedText(output.label, 160) || !["receipt", "spend"].includes(output.direction) || !["other", "salary", "contractor"].includes(output.category)) fail("Invalid cash output mapping.");
  if (new Set(model.cases.map((c) => c.id)).size !== model.cases.length) fail("Case names must be unique.");
  for (const c of model.cases) {
    if (!identifier.test(c.id) || (c.id === "base" || c.id === "__unchanged__") || !boundedText(c.name, 120) || !boundedText(c.rationale, 2000) || !Array.isArray(c.overrides) || c.overrides.length > 40 || new Set(c.overrides.map((o) => o.nodeId)).size !== c.overrides.length) fail("Invalid case definition.");
    for (const override of c.overrides) { if (nodes.get(override.nodeId)?.op !== "input") fail("Cases may override input variables only."); steps(override.values); }
  }
}

export function evaluateOperatingModel(model: OperatingModel, caseId = "base"): OperatingRun {
  validateOperatingModel(model);
  const selected = model.cases.find((c) => c.id === caseId);
  if (caseId !== "base" && !selected) fail("Unknown operating case.");
  const nodes = new Map(model.nodes.map((node) => [node.id, node]));
  const months = Array.from({ length: model.months }, (_, i) => addMonths(model.startMonth, i));
  const memo = new Map<string, bigint>();
  const value = (id: string, index: number): bigint => {
    const key = `${id}:${index}`; if (memo.has(key)) return memo.get(key)!;
    const node = nodes.get(id)!;
    let result: bigint;
    if (node.op === "input") {
      const steps = selected?.overrides.find((o) => o.nodeId === id)?.values ?? node.values;
      result = decimal([...steps].sort((a, b) => a.month.localeCompare(b.month)).filter((s) => s.month <= months[index]!).at(-1)!.value);
    } else if (node.op === "lag") result = index === 0 ? decimal(node.initial!) : value(node.args[0]!, index - 1);
    else if (node.op === "if") result = value(node.args[0]!, index) !== 0n ? value(node.args[1]!, index) : value(node.args[2]!, index);
    else {
      const a = value(node.args[0]!, index); const b = value(node.args[1]!, index);
      switch (node.op) {
        case "add": result = a + b; break; case "subtract": result = a - b; break;
        case "multiply": result = multiplyDecimal(a, b); break;
        case "divide": { const quotient = divideDecimal(a, b); if (quotient === null) fail(`Division by zero in ${id} for ${months[index]}.`); result = quotient!; break; }
        case "min": result = a < b ? a : b; break; case "max": result = a > b ? a : b; break;
        case "gt": result = a > b ? modelScale : 0n; break; case "gte": result = a >= b ? modelScale : 0n; break;
        case "eq": result = a === b ? modelScale : 0n; break;
        default: return fail("Unsupported operating rule.");
      }
    }
    if (result > cap || result < -cap) fail(`Operating value exceeds the supported range in ${id}.`);
    memo.set(key, result); return result;
  };
  const values = Object.fromEntries(model.nodes.map((node) => [node.id, months.map((_, i) => formatDecimal(value(node.id, i)))]));
  const cash = model.outputs.flatMap((output) => months.flatMap((month, i) => {
    const raw = value(output.nodeId, i); if (raw < 0n) return fail(`Cash output ${output.nodeId} is negative in ${month}; use a separate receipt or spending mapping.`);
    const amount = decimalToMinorUnits(raw); return amount === 0n ? [] : [{ ...output, month, amountMinor: String(amount) }];
  }));
  return { formulaVersion: operatingModelVersion, caseId, months, values, cash };
}
