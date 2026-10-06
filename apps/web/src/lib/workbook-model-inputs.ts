import { addMonths } from "@balsa/finance-engine";
import type { WorkbookEdit } from "@balsa/model-export";
import type { VariableDraft } from "./forecast-model-rows";

type Input = VariableDraft["inputs"][number];
const sameCoords = (a: Record<string, string>, b: Record<string, string>) => Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([key, value]) => b[key] === value);
const valueAt = (inputs: Input[], coords: Record<string, string>, month: string) => inputs.filter((input) => sameCoords(input.coords, coords) && input.from <= month).sort((a, b) => a.from.localeCompare(b.from)).at(-1)?.value ?? "0";

/** Apply only changed cells, restoring the current schedule immediately after each edit.
 * Compare against the exported baseline before making any changes to this coordinate. */
export function mergeWorkbookInput(inputs: Input[], edit: Extract<WorkbookEdit, { kind: "model_input" }>): Input[] {
  const changed = edit.months.flatMap((month, index) => edit.after[index] === edit.before[index] ? [] : [{ month, before: edit.before[index], after: edit.after[index]! }]);
  for (const cell of changed) {
    if (cell.before === null || Number(valueAt(inputs, edit.coords, cell.month)) !== cell.before) throw new Error("This input changed in Balsa after export. Export a fresh workbook before proposing this change.");
  }
  const result = inputs.map((input) => ({ ...input }));
  const put = (month: string, value: string) => {
    const index = result.findIndex((input) => sameCoords(input.coords, edit.coords) && input.from === month);
    const input = { coords: edit.coords, from: month, value };
    if (index < 0) result.push(input); else result[index] = input;
  };
  for (const cell of changed) put(addMonths(cell.month, 1), valueAt(inputs, edit.coords, addMonths(cell.month, 1)));
  for (const cell of changed) put(cell.month, String(cell.after));
  // Remove redundant steps only for the edited coordinate; retain all other inputs.
  const own = result.filter((input) => sameCoords(input.coords, edit.coords)).sort((a, b) => a.from.localeCompare(b.from));
  return [...result.filter((input) => !sameCoords(input.coords, edit.coords)), ...own.filter((input, index) => index === 0 || Number(input.value) !== Number(own[index - 1]!.value))];
}

export function sameVariable(left: VariableDraft, right: VariableDraft): boolean {
  const canonical = (value: VariableDraft) => JSON.stringify({ name: value.name, kind: value.kind, dims: value.dims, formula: value.formula ?? null, inputs: value.inputs.map((input) => ({ from: input.from, value: input.value, coords: Object.fromEntries(Object.entries(input.coords).sort(([a], [b]) => a.localeCompare(b))) })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) });
  return canonical(left) === canonical(right);
}
