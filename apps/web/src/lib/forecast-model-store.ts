import "server-only";
import { sameVariable } from "./workbook-model-inputs";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { companies, decisions, economicItems, forecastDimensions, forecastVariables, getDatabase } from "@finance/database";
import { addMonths, evaluateFormula, evaluateModel, formatDecimal, monthRange, validateModel, type ForecastModel, type ModelIssue } from "@balsa/finance-engine";
import type { DbExecutor, DbTransaction } from "@/lib/db-executor";
import { forecastAsOfMonth } from "@/lib/forecast-inputs";
import { emptyModel, mergeModelDraft, rowsToModel, variableFromDraft, withDimension, withoutDimension, withVariable, withoutVariable, type DimensionDraft, type ModelDraft, type VariableDraft } from "@/lib/forecast-model-rows";

export class ModelWriteError extends Error {
  constructor(message: string, readonly status: 404 | 409 | 422, readonly issues: ModelIssue[] = []) { super(message); this.name = "ModelWriteError"; }
}

export type ModelDryRun = { errors: ModelIssue[]; warnings: ModelIssue[]; sample: Record<string, { dims: string[]; rows: { coords: Record<string, string>; values: Record<string, string | null> }[] }>; itemSample: Record<string, string | null> | null };

const notFound = (label: string) => new ModelWriteError(`${label} not found`, 404);
const invalid = (issues: ModelIssue[]) => new ModelWriteError("The resulting forecast model is invalid", 422, issues);

async function lockCompany(db: DbExecutor, companyId: string) {
  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).limit(1).for("update");
  if (!company) throw notFound("Company");
}

async function assertDecisionLineage(db: DbExecutor, companyId: string, decisionId: string | undefined) {
  if (!decisionId) return;
  const [decision] = await db.select({ id: decisions.id }).from(decisions).where(and(eq(decisions.id, decisionId), eq(decisions.companyId, companyId))).limit(1);
  if (!decision) throw notFound("Decision");
}

async function state(db: DbExecutor, companyId: string) {
  const [dimensions, variables, formulaRows] = await Promise.all([
    db.select({ name: forecastDimensions.name, items: forecastDimensions.items }).from(forecastDimensions).where(and(eq(forecastDimensions.companyId, companyId), eq(forecastDimensions.active, "Y"))),
    db.select({ name: forecastVariables.name, kind: forecastVariables.kind, dims: forecastVariables.dims, formula: forecastVariables.formula, inputs: forecastVariables.inputs }).from(forecastVariables).where(and(eq(forecastVariables.companyId, companyId), eq(forecastVariables.active, "Y"))),
    db.select({ id: economicItems.id, formula: economicItems.amountFormula }).from(economicItems).where(and(eq(economicItems.companyId, companyId), eq(economicItems.status, "confirmed"), isNotNull(economicItems.amountFormula))),
  ]);
  return { model: rowsToModel(dimensions, variables) ?? emptyModel(), driverFormulas: formulaRows.flatMap((row) => row.formula ? [{ id: row.id, formula: row.formula }] : []) };
}

function assertValid(model: ForecastModel, driverFormulas: { id: string; formula: string }[]) {
  const result = validateModel(model, { driverFormulas });
  if (result.errors.length) throw invalid(result.errors);
}

async function duplicate(db: DbExecutor, table: typeof forecastDimensions | typeof forecastVariables, companyId: string, name: string, exceptId?: string) {
  const rows = await db.select({ id: table.id }).from(table).where(and(eq(table.companyId, companyId), eq(table.name, name), eq(table.active, "Y")));
  return rows.some((row) => row.id !== exceptId);
}

export async function createDimensionWith(db: DbTransaction, companyId: string, draft: DimensionDraft) {
  await lockCompany(db, companyId);
  if (await duplicate(db, forecastDimensions, companyId, draft.name)) throw new ModelWriteError(`Dimension "${draft.name}" already exists`, 409);
  const current = await state(db, companyId); assertValid(withDimension(current.model, draft), current.driverFormulas);
  const [row] = await db.insert(forecastDimensions).values({ companyId, name: draft.name, items: draft.items }).returning();
  return row!;
}
export const createDimension = (companyId: string, draft: DimensionDraft) => getDatabase().transaction((tx) => createDimensionWith(tx, companyId, draft));

export async function updateDimensionWith(db: DbTransaction, companyId: string, id: string, patch: Partial<DimensionDraft>) {
  await lockCompany(db, companyId);
  const [row] = await db.select().from(forecastDimensions).where(and(eq(forecastDimensions.id, id), eq(forecastDimensions.companyId, companyId), eq(forecastDimensions.active, "Y"))).limit(1);
  if (!row) throw notFound("Dimension");
  const draft = { name: patch.name ?? row.name, items: patch.items ?? row.items };
  if (await duplicate(db, forecastDimensions, companyId, draft.name, id)) throw new ModelWriteError(`Dimension "${draft.name}" already exists`, 409);
  const current = await state(db, companyId); assertValid(withDimension(current.model, draft, row.name), current.driverFormulas);
  const [updated] = await db.update(forecastDimensions).set({ ...draft, updatedAt: new Date() }).where(and(eq(forecastDimensions.id, id), eq(forecastDimensions.companyId, companyId))).returning();
  return updated!;
}
export const updateDimension = (companyId: string, id: string, patch: Partial<DimensionDraft>) => getDatabase().transaction((tx) => updateDimensionWith(tx, companyId, id, patch));

export async function deactivateDimensionWith(db: DbTransaction, companyId: string, id: string) {
  await lockCompany(db, companyId);
  const [row] = await db.select().from(forecastDimensions).where(and(eq(forecastDimensions.id, id), eq(forecastDimensions.companyId, companyId), eq(forecastDimensions.active, "Y"))).limit(1);
  if (!row) throw notFound("Dimension");
  const current = await state(db, companyId); assertValid(withoutDimension(current.model, row.name), current.driverFormulas);
  const [updated] = await db.update(forecastDimensions).set({ active: "N", updatedAt: new Date() }).where(and(eq(forecastDimensions.id, id), eq(forecastDimensions.companyId, companyId))).returning();
  return updated!;
}
export const deactivateDimension = (companyId: string, id: string) => getDatabase().transaction((tx) => deactivateDimensionWith(tx, companyId, id));

export async function upsertDimensionByNameWith(db: DbTransaction, companyId: string, draft: DimensionDraft) {
  await lockCompany(db, companyId);
  const [row] = await db.select({ id: forecastDimensions.id }).from(forecastDimensions).where(and(eq(forecastDimensions.companyId, companyId), eq(forecastDimensions.name, draft.name), eq(forecastDimensions.active, "Y"))).limit(1);
  return row ? updateDimensionWith(db, companyId, row.id, draft) : createDimensionWith(db, companyId, draft);
}
export const upsertDimensionByName = (companyId: string, draft: DimensionDraft) => getDatabase().transaction((tx) => upsertDimensionByNameWith(tx, companyId, draft));

export async function createVariableWith(db: DbTransaction, companyId: string, draft: VariableDraft, options: { decisionId?: string } = {}) {
  await lockCompany(db, companyId);
  await assertDecisionLineage(db, companyId, options.decisionId);
  if (await duplicate(db, forecastVariables, companyId, draft.name)) throw new ModelWriteError(`Variable "${draft.name}" already exists`, 409);
  const current = await state(db, companyId); assertValid(withVariable(current.model, draft), current.driverFormulas);
  const [row] = await db.insert(forecastVariables).values({ companyId, ...variableFromDraft(draft), formula: draft.formula, ...(options.decisionId ? { decisionId: options.decisionId } : {}) }).returning();
  return row!;
}
export const createVariable = (companyId: string, draft: VariableDraft, options: { decisionId?: string } = {}) => getDatabase().transaction((tx) => createVariableWith(tx, companyId, draft, options));

export async function updateVariableWith(db: DbTransaction, companyId: string, id: string, patch: Partial<VariableDraft>) {
  await lockCompany(db, companyId);
  const [row] = await db.select().from(forecastVariables).where(and(eq(forecastVariables.id, id), eq(forecastVariables.companyId, companyId), eq(forecastVariables.active, "Y"))).limit(1);
  if (!row) throw notFound("Variable");
  const draft: VariableDraft = { name: patch.name ?? row.name, kind: patch.kind ?? row.kind, dims: patch.dims ?? row.dims, formula: patch.formula !== undefined ? patch.formula : row.formula, inputs: patch.inputs ?? row.inputs };
  if (await duplicate(db, forecastVariables, companyId, draft.name, id)) throw new ModelWriteError(`Variable "${draft.name}" already exists`, 409);
  const current = await state(db, companyId); assertValid(withVariable(current.model, draft, row.name), current.driverFormulas);
  const [updated] = await db.update(forecastVariables).set({ name: draft.name, kind: draft.kind, dims: draft.dims, formula: draft.formula, inputs: draft.inputs, updatedAt: new Date() }).where(and(eq(forecastVariables.id, id), eq(forecastVariables.companyId, companyId))).returning();
  return updated!;
}
export const updateVariable = (companyId: string, id: string, patch: Partial<VariableDraft>) => getDatabase().transaction((tx) => updateVariableWith(tx, companyId, id, patch));

export async function deactivateVariableWith(db: DbTransaction, companyId: string, id: string) {
  await lockCompany(db, companyId);
  const [row] = await db.select().from(forecastVariables).where(and(eq(forecastVariables.id, id), eq(forecastVariables.companyId, companyId), eq(forecastVariables.active, "Y"))).limit(1);
  if (!row) throw notFound("Variable");
  const current = await state(db, companyId); assertValid(withoutVariable(current.model, row.name), current.driverFormulas);
  const [updated] = await db.update(forecastVariables).set({ active: "N", updatedAt: new Date() }).where(and(eq(forecastVariables.id, id), eq(forecastVariables.companyId, companyId))).returning();
  return updated!;
}
export const deactivateVariable = (companyId: string, id: string) => getDatabase().transaction((tx) => deactivateVariableWith(tx, companyId, id));

export async function upsertVariableByNameWith(db: DbTransaction, companyId: string, draft: VariableDraft, decisionId: string, expected?: VariableDraft) {
  await lockCompany(db, companyId);
  await assertDecisionLineage(db, companyId, decisionId);
  const [row] = await db.select().from(forecastVariables).where(and(eq(forecastVariables.companyId, companyId), eq(forecastVariables.name, draft.name), eq(forecastVariables.active, "Y"))).limit(1);
  if (expected && (!row || !sameVariable(row, expected))) throw new ModelWriteError("The model input changed since this workbook proposal was created. Export a fresh workbook and review its changes.", 409);
  if (!row) return createVariableWith(db, companyId, draft, { decisionId });
  const updated = await updateVariableWith(db, companyId, row.id, draft);
  const [lineage] = await db.update(forecastVariables).set({ decisionId, updatedAt: new Date() }).where(and(eq(forecastVariables.id, row.id), eq(forecastVariables.companyId, companyId))).returning();
  return lineage ?? updated;
}
export const upsertVariableByName = (companyId: string, draft: VariableDraft, decisionId: string) => getDatabase().transaction((tx) => upsertVariableByNameWith(tx, companyId, draft, decisionId));

export async function setItemFormulaWith(db: DbTransaction, companyId: string, itemId: string, formula: string | null, options: { decisionId?: string } = {}) {
  await lockCompany(db, companyId);
  await assertDecisionLineage(db, companyId, options.decisionId);
  const [item] = await db.select().from(economicItems).where(and(eq(economicItems.id, itemId), eq(economicItems.companyId, companyId))).limit(1);
  if (!item) throw notFound("Economic item");
  const current = await state(db, companyId);
  const driverFormulas = current.driverFormulas.filter((entry) => entry.id !== itemId);
  if (formula) driverFormulas.push({ id: itemId, formula });
  assertValid(current.model, driverFormulas);
  const [updated] = await db.update(economicItems).set({ amountFormula: formula, ...(options.decisionId ? { decisionId: options.decisionId } : {}), updatedAt: new Date() }).where(and(eq(economicItems.id, itemId), eq(economicItems.companyId, companyId))).returning();
  return updated!;
}
export const setItemFormula = (companyId: string, itemId: string, formula: string | null, options: { decisionId?: string } = {}) => getDatabase().transaction((tx) => setItemFormulaWith(tx, companyId, itemId, formula, options));

export type ConfirmItemChanges = { label?: string; amount?: number; amountFormula?: string | null; cadence?: "once" | "monthly" | "quarterly" | "annual"; effectiveFrom?: string; effectiveTo?: string | null; category?: string; basis?: "contractual" | "assumed"; accountingTreatment?: "cash" | "accrual" | "prepaid" };

/** Validate every final item formula, then confirm and edit the company-scoped rows as one transaction. */
export async function confirmItemsWith(db: DbTransaction, companyId: string, ids: string[], changes: ConfirmItemChanges) {
  await lockCompany(db, companyId);
  const items = await db.select().from(economicItems).where(and(eq(economicItems.companyId, companyId), inArray(economicItems.id, ids)));
  if (items.length !== ids.length) throw notFound("Economic item");
  const current = await state(db, companyId);
  const formulas = current.driverFormulas.filter((entry) => !ids.includes(entry.id));
  for (const item of items) {
    const formula = changes.amountFormula !== undefined ? changes.amountFormula : item.amountFormula;
    if (formula) formulas.push({ id: item.id, formula });
  }
  assertValid(current.model, formulas);
  return db.update(economicItems).set({ status: "confirmed", ...(changes.label ? { label: changes.label } : {}), ...(changes.amount !== undefined ? { amount: String(changes.amount) } : {}), ...(changes.amountFormula !== undefined ? { amountFormula: changes.amountFormula } : {}), ...(changes.cadence ? { cadence: changes.cadence } : {}), ...(changes.effectiveFrom ? { effectiveFrom: changes.effectiveFrom } : {}), ...(changes.effectiveTo !== undefined ? { effectiveTo: changes.effectiveTo } : {}), ...(changes.category ? { category: changes.category } : {}), ...(changes.basis ? { basis: changes.basis } : {}), ...(changes.accountingTreatment ? { accountingTreatment: changes.accountingTreatment } : {}), updatedAt: new Date() }).where(and(eq(economicItems.companyId, companyId), inArray(economicItems.id, ids))).returning();
}

export async function validateModelDraftWith(db: DbExecutor, companyId: string, draft: ModelDraft & { itemFormula?: string }, now = new Date()): Promise<ModelDryRun> {
  const current = await state(db, companyId);
  const model = mergeModelDraft(current.model, draft);
  const driverFormulas = [...current.driverFormulas, ...(draft.itemFormula !== undefined ? [{ id: "draft", formula: draft.itemFormula }] : [])];
  const validation = validateModel(model, { driverFormulas });
  const result: ModelDryRun = { ...validation, sample: {}, itemSample: null };
  if (validation.errors.length) return result;
  const first = addMonths(await forecastAsOfMonth(companyId, now, db), 1);
  const months = monthRange(first, addMonths(first, 2));
  const evaluated = evaluateModel(model, months);
  if (!evaluated.ok) return { ...result, errors: evaluated.errors };
  for (const variable of model.variables) {
    const cube = evaluated.cubes.get(variable.name)!;
    result.sample[variable.name] = { dims: cube.dims, rows: [...cube.cells].map(([key, row]) => ({ coords: Object.fromEntries(cube.dims.map((dim, index) => [dim, key.split("|")[index]!])), values: Object.fromEntries(months.map((month, index) => [month, row[index] === null ? null : formatDecimal(row[index]!)])) })) };
  }
  if (draft.itemFormula !== undefined) {
    const item = evaluateFormula(draft.itemFormula, model, months);
    if (item.ok && !item.cube.dims.length) result.itemSample = Object.fromEntries(months.map((month, index) => { const value = item.cube.cells.get("")![index]!; return [month, value === null ? null : formatDecimal(value)]; }));
  }
  return result;
}
export const validateModelDraft = (companyId: string, draft: ModelDraft & { itemFormula?: string }, now?: Date) => validateModelDraftWith(getDatabase(), companyId, draft, now);
