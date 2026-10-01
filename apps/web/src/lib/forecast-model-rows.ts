import { canonicalizeModel, type ForecastModel, type ForecastVariable, type ForecastVariableInput } from "@balsa/finance-engine";

export type ModelDimensionRow = { name: string; items: string[] };
export type ModelVariableRow = { name: string; kind: "money" | "number"; dims: string[]; formula: string | null; inputs: ForecastVariableInput[] };
export type DimensionDraft = ModelDimensionRow;
export type VariableDraft = ModelVariableRow;
/** A dry-run or write draft: each entry replaces the saved one named `replaces` (or its own name), so renames work. */
export type ModelDraft = { dimensions?: (DimensionDraft & { replaces?: string })[]; variables?: (VariableDraft & { replaces?: string })[] };

export const emptyModel = (): ForecastModel => ({ dimensions: [], variables: [] });

export function variableFromDraft(draft: VariableDraft): ForecastVariable {
  return { name: draft.name, kind: draft.kind, dims: [...draft.dims], ...(draft.formula !== null ? { formula: draft.formula } : {}), inputs: draft.inputs.map((input) => ({ coords: { ...input.coords }, from: input.from, value: input.value })) };
}

/** Active rows as the engine's canonical model, or undefined when there are none (the input then omits `model`). */
export function rowsToModel(dimensions: ModelDimensionRow[], variables: ModelVariableRow[]): ForecastModel | undefined {
  if (!dimensions.length && !variables.length) return undefined;
  return canonicalizeModel({ dimensions: dimensions.map((row) => ({ name: row.name, items: [...row.items] })), variables: variables.map(variableFromDraft) });
}

export const withDimension = (model: ForecastModel, draft: DimensionDraft, replaces?: string): ForecastModel =>
  canonicalizeModel({ dimensions: [...model.dimensions.filter((dimension) => dimension.name !== (replaces ?? draft.name)), { name: draft.name, items: [...draft.items] }], variables: model.variables });
export const withoutDimension = (model: ForecastModel, name: string): ForecastModel => canonicalizeModel({ dimensions: model.dimensions.filter((dimension) => dimension.name !== name), variables: model.variables });
export const withVariable = (model: ForecastModel, draft: VariableDraft, replaces?: string): ForecastModel =>
  canonicalizeModel({ dimensions: model.dimensions, variables: [...model.variables.filter((variable) => variable.name !== (replaces ?? draft.name)), variableFromDraft(draft)] });
export const withoutVariable = (model: ForecastModel, name: string): ForecastModel => canonicalizeModel({ dimensions: model.dimensions, variables: model.variables.filter((variable) => variable.name !== name) });

export function mergeModelDraft(model: ForecastModel, draft: ModelDraft): ForecastModel {
  let next = model;
  for (const { replaces, ...dimension } of draft.dimensions ?? []) next = withDimension(next, dimension, replaces);
  for (const { replaces, ...variable } of draft.variables ?? []) next = withVariable(next, variable, replaces);
  return next;
}
