import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { decisions, economicItems, getDatabase, recordAudit, scenarios } from "@finance/database";
import { isCategory, validateModel, type ForecastModel, type ForecastVariable } from "@balsa/finance-engine";
import { decisionEffectSchema, describeEffect, parseStoredEffect, type DecisionEffect } from "@/lib/decision-effects";
import { applyScenarioChanges, describeScenarioChange, effectToScenarioChange, parseStoredChanges, ScenarioChangeInvalid, scenarioChangeToEffect, type ScenarioChange, type ScenarioDetail, type ScenarioSummary } from "@/lib/scenario-changes";
import type { DbExecutor, DbTransaction } from "@/lib/db-executor";
import { findActiveScenarioByName, lockScenarioName } from "@/lib/scenario-name-lock";
import { loadForecastBaseWith } from "@/lib/forecast-base";
import { emptyModel, withVariable } from "@/lib/forecast-model-rows";
import { assertOperatingScenarioCurrent } from "./operating-connection-state";

export class ScenarioNotFound extends Error {}
export class ScenarioConflict extends Error {}
export class ScenarioInvalid extends Error {}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type ScenarioRow = typeof scenarios.$inferSelect;
type ItemRow = typeof economicItems.$inferSelect;
const toDetail = (row: ScenarioRow, itemCount: number): ScenarioDetail => ({ id: row.id, name: row.name, description: row.description, changes: parseStoredChanges(row.changes), itemCount });
const cleanDescription = (value: string | null | undefined) => value?.trim() || null;

async function itemCounts(companyId: string, scenarioIds: string[], db: DbExecutor = getDatabase()): Promise<Map<string, number>> {
  if (!scenarioIds.length) return new Map();
  const rows = await db.select({ scenarioId: economicItems.scenarioId, count: sql<number>`count(*)::int` }).from(economicItems)
    .where(and(eq(economicItems.companyId, companyId), eq(economicItems.status, "confirmed"), inArray(economicItems.scenarioId, scenarioIds))).groupBy(economicItems.scenarioId);
  return new Map(rows.flatMap((row) => row.scenarioId ? [[row.scenarioId, Number(row.count)] as const] : []));
}

export async function loadActiveScenarioWith(db: DbExecutor, companyId: string, scenarioId: string): Promise<ScenarioDetail> {
  if (!uuidPattern.test(scenarioId)) throw new ScenarioNotFound("Scenario not found");
  const [row] = await db.select().from(scenarios).where(and(eq(scenarios.id, scenarioId), eq(scenarios.companyId, companyId), eq(scenarios.active, "Y"))).limit(1);
  if (!row) throw new ScenarioNotFound("Scenario not found");
  return toDetail(row, (await itemCounts(companyId, [row.id], db)).get(row.id) ?? 0);
}

/** Scenario mutations take name locks before the row lock, matching named decision effects. */
async function loadActiveScenarioForMutation(tx: DbTransaction, companyId: string, scenarioId: string, additionalNames: string[] = []): Promise<ScenarioDetail> {
  if (!uuidPattern.test(scenarioId)) throw new ScenarioNotFound("Scenario not found");
  const [peek] = await tx.select({ name: scenarios.name }).from(scenarios).where(and(eq(scenarios.id, scenarioId), eq(scenarios.companyId, companyId), eq(scenarios.active, "Y"))).limit(1);
  if (!peek) throw new ScenarioNotFound("Scenario not found");
  for (const name of [...new Set([peek.name, ...additionalNames])].sort()) await lockScenarioName(tx, companyId, name);
  const [row] = await tx.select().from(scenarios).where(and(eq(scenarios.id, scenarioId), eq(scenarios.companyId, companyId), eq(scenarios.active, "Y"))).limit(1).for("update");
  if (!row) throw new ScenarioNotFound("Scenario not found");
  if (row.name !== peek.name) throw new ScenarioConflict("Scenario changed concurrently; retry the request");
  return toDetail(row, (await itemCounts(companyId, [row.id], tx)).get(row.id) ?? 0);
}

export async function loadActiveScenario(companyId: string, scenarioId: string): Promise<ScenarioDetail> {
  return loadActiveScenarioWith(getDatabase(), companyId, scenarioId);
}

export async function listScenarios(companyId: string): Promise<ScenarioSummary[]> {
  const rows = await getDatabase().select().from(scenarios).where(and(eq(scenarios.companyId, companyId), eq(scenarios.active, "Y"))).orderBy(asc(scenarios.name), asc(scenarios.createdAt));
  const counts = await itemCounts(companyId, rows.map((row) => row.id));
  return rows.map((row) => ({ id: row.id, name: row.name, description: row.description, changeCount: parseStoredChanges(row.changes).length, itemCount: counts.get(row.id) ?? 0 }));
}

async function assertNameFree(db: DbExecutor, companyId: string, name: string, exceptId?: string) {
  const taken = await findActiveScenarioByName(db, companyId, name, exceptId);
  if (taken) throw new ScenarioConflict(`A scenario named "${name}" already exists`);
}

async function assertChangeTargets(db: DbExecutor, companyId: string, changes: ScenarioChange[]) {
  const ids = [...new Set(changes.flatMap((change) => change.kind === "change_amount" || change.kind === "end_item" ? [change.itemId] : []))];
  if (!ids.length) return;
  const rows = await db.select({ id: economicItems.id }).from(economicItems).where(and(eq(economicItems.companyId, companyId), eq(economicItems.status, "confirmed"), isNull(economicItems.scenarioId), inArray(economicItems.id, ids)));
  if (rows.length !== ids.length) throw new ScenarioInvalid("A change targets an item that is not a confirmed base-forecast item of this company");
}

export type ScenarioInput = { name: string; description?: string | null; changes?: ScenarioChange[] };
async function validateScenarioChangesWith(db: DbExecutor, companyId: string, changes: ScenarioChange[], now = new Date()) {
  try { applyScenarioChanges(await loadForecastBaseWith(db, companyId, now), changes, "validation"); }
  catch (error) { if (error instanceof ScenarioChangeInvalid) throw new ScenarioInvalid(error.message); throw error; }
}

export async function createScenarioWith(tx: DbTransaction, companyId: string, input: ScenarioInput, actorUserId: string | null, now = new Date()): Promise<ScenarioDetail> {
  const name = input.name.trim(); const changes = input.changes ?? [];
  await assertNameFree(tx, companyId, name); await assertChangeTargets(tx, companyId, changes); await validateScenarioChangesWith(tx, companyId, changes, now);
  const [row] = await tx.insert(scenarios).values({ companyId, name, description: cleanDescription(input.description), changes }).returning();
  if (!row) throw new Error("Scenario insert returned no row");
  await recordAudit(tx, { companyId, actorUserId, via: "ui", action: "scenario.created", entityType: "scenario", entityId: row.id, summary: `Created scenario ${name}`, after: { name, description: row.description, changes } });
  return toDetail(row, 0);
}

export async function createScenario(companyId: string, input: ScenarioInput, actorUserId: string | null): Promise<ScenarioDetail> {
  const name = input.name.trim();
  return getDatabase().transaction(async (tx) => {
    await lockScenarioName(tx, companyId, name);
    return createScenarioWith(tx, companyId, { ...input, name }, actorUserId);
  });
}

export type ScenarioPatch = { name?: string; description?: string | null; changes?: ScenarioChange[] };
export async function updateScenario(companyId: string, scenarioId: string, patch: ScenarioPatch, actorUserId: string | null): Promise<ScenarioDetail> {
  const name = patch.name?.trim();
  return getDatabase().transaction(async (tx) => {
    const current = await loadActiveScenarioForMutation(tx, companyId, scenarioId, name ? [name] : []);
    if (name && name !== current.name) await assertNameFree(tx, companyId, name, scenarioId);
    if (patch.changes) { await assertChangeTargets(tx, companyId, patch.changes); await validateScenarioChangesWith(tx, companyId, patch.changes); }
    const [row] = await tx.update(scenarios).set({ ...(name ? { name } : {}), ...(patch.description !== undefined ? { description: cleanDescription(patch.description) } : {}), ...(patch.changes ? { changes: patch.changes } : {}), updatedAt: new Date() }).where(and(eq(scenarios.id, scenarioId), eq(scenarios.companyId, companyId), eq(scenarios.active, "Y"))).returning();
    if (!row) throw new ScenarioNotFound("Scenario not found");
    await recordAudit(tx, { companyId, actorUserId, via: "ui", action: "scenario.updated", entityType: "scenario", entityId: row.id, summary: `Updated scenario ${row.name}`, before: { name: current.name, description: current.description, changes: current.changes }, after: { name: row.name, description: row.description, changes: parseStoredChanges(row.changes) } });
    return toDetail(row, current.itemCount);
  });
}

export async function deactivateScenario(companyId: string, scenarioId: string, actorUserId: string | null): Promise<void> {
  if (!uuidPattern.test(scenarioId)) throw new ScenarioNotFound("Scenario not found");
  await getDatabase().transaction(async (tx) => {
    await loadActiveScenarioForMutation(tx, companyId, scenarioId);
    const [row] = await tx.update(scenarios).set({ active: "N", updatedAt: new Date() }).where(and(eq(scenarios.id, scenarioId), eq(scenarios.companyId, companyId), eq(scenarios.active, "Y"))).returning({ id: scenarios.id, name: scenarios.name });
    if (!row) throw new ScenarioNotFound("Scenario not found");
    await recordAudit(tx, { companyId, actorUserId, via: "ui", action: "scenario.deactivated", entityType: "scenario", entityId: row.id, summary: `Deleted scenario ${row.name}` });
  });
}

export function scenarioItemToEffect(item: ItemRow): DecisionEffect | null {
  const parsed = decisionEffectSchema.safeParse({ kind: "add_item", item: { label: item.label, counterparty: item.counterparty, direction: item.direction, amount: Number(item.amount ?? (item.amountFormula ? "1" : "")), ...(item.amountFormula ? { amountFormula: item.amountFormula } : {}), cadence: item.cadence, effectiveFrom: item.effectiveFrom, effectiveTo: item.effectiveTo, category: isCategory(item.category) ? item.category : "other", accountingTreatment: item.accountingTreatment, recognitionStart: item.recognitionStart, recognitionEnd: item.recognitionEnd } });
  return parsed.success ? parsed.data : null;
}

export async function promoteScenario(companyId: string, scenarioId: string, actorUserId: string | null): Promise<{ decisionIds: string[]; skippedItems: number }> {
  return getDatabase().transaction((tx) => promoteScenarioWith(tx, companyId, scenarioId, actorUserId));
}

export async function promoteScenarioWith(tx: DbTransaction, companyId: string, scenarioId: string, actorUserId: string | null, now = new Date(), reviewedOperating = false): Promise<{ decisionIds: string[]; skippedItems: number }> {
    const scenario = await loadActiveScenarioForMutation(tx, companyId, scenarioId);
    const base = await loadForecastBaseWith(tx, companyId, now);
    await assertOperatingScenarioCurrent(tx, companyId, scenarioId, { reviewed: reviewedOperating, lock: true, now });
    let projected;
    try { projected = applyScenarioChanges(base, scenario.changes, scenario.id); }
    catch (error) { if (error instanceof ScenarioChangeInvalid) throw new ScenarioInvalid(error.message); throw error; }
    const items = await tx.select().from(economicItems).where(and(eq(economicItems.companyId, companyId), eq(economicItems.scenarioId, scenarioId), eq(economicItems.status, "confirmed"))).orderBy(asc(economicItems.createdAt), asc(economicItems.id));
    const targetIds = [...new Set(scenario.changes.flatMap((change) => change.kind === "change_amount" || change.kind === "end_item" ? [change.itemId] : []))];
    const labels = new Map(targetIds.length ? (await tx.select({ id: economicItems.id, label: economicItems.label }).from(economicItems).where(and(eq(economicItems.companyId, companyId), inArray(economicItems.id, targetIds)))).map((row) => [row.id, row.label]) : []);
    const itemEffects = items.map(scenarioItemToEffect);
    const firstTouches = new Map<string, number>();
    scenario.changes.forEach((change, index) => { if ((change.kind === "set_input" || change.kind === "set_formula") && !firstTouches.has(change.variable)) firstTouches.set(change.variable, index); });
    const finalVariables = new Map((projected.model?.variables ?? []).map((variable) => [variable.name, variable]));
    type Candidate = { firstTouch: number; variable: ForecastVariable; effect: DecisionEffect; summary: string };
    const pending: Candidate[] = [...firstTouches].map(([name, firstTouch]) => {
      const variable = finalVariables.get(name);
      if (!variable) throw new ScenarioInvalid(`Scenario variable ${name} no longer exists`);
      const effect: DecisionEffect = { kind: "set_variable", variable: { name, kind: variable.kind, dims: [...variable.dims], formula: variable.formula ?? null, inputs: variable.inputs.map((input) => ({ coords: { ...input.coords }, from: input.from, value: input.value })) } };
      return { firstTouch, variable, effect, summary: describeEffect(effect) ?? "" };
    }).sort((left, right) => left.firstTouch - right.firstTouch || left.variable.name.localeCompare(right.variable.name));
    let promotionModel: ForecastModel = base.model ?? emptyModel();
    const serialized: Candidate[] = [];
    const driverFormulas = base.drivers.flatMap((driver) => driver.amountFormula ? [{ id: driver.id, formula: driver.amountFormula }] : []);
    while (pending.length) {
      const candidateIndex = pending.findIndex(({ variable }) => !validateModel(withVariable(promotionModel, { name: variable.name, kind: variable.kind, dims: [...variable.dims], formula: variable.formula ?? null, inputs: variable.inputs }), { monthCount: base.horizonMonths + 1, driverFormulas }).errors.length);
      if (candidateIndex < 0) throw new ScenarioInvalid("This scenario is valid as a whole but its model changes cannot be promoted as separate decisions");
      const candidate = pending.splice(candidateIndex, 1)[0]!;
      promotionModel = withVariable(promotionModel, { name: candidate.variable.name, kind: candidate.variable.kind, dims: [...candidate.variable.dims], formula: candidate.variable.formula ?? null, inputs: candidate.variable.inputs });
      serialized.push(candidate);
    }
    const driverChanges = scenario.changes.filter((change) => change.kind !== "set_input" && change.kind !== "set_formula");
    const proposals = [
      ...serialized.map(({ effect, summary }) => ({ effect, summary })),
      ...itemEffects.flatMap((effect) => effect ? [{ effect, summary: describeEffect(effect) ?? "" }] : []),
      ...driverChanges.map((change) => ({ effect: scenarioChangeToEffect(change), summary: describeScenarioChange(change, change.kind === "change_amount" || change.kind === "end_item" ? labels.get(change.itemId) : undefined) })),
    ];
    const skippedItems = itemEffects.filter((effect) => effect === null).length;
    if (!proposals.length) return { decisionIds: [], skippedItems };
    const rows = await tx.insert(decisions).values(proposals.map(({ effect, summary }) => ({ companyId, question: `Apply from scenario ${scenario.name}: ${summary}`, answer: `Promoted from scenario ${scenario.name}.`, status: "proposed", effect: JSON.stringify(effect), createdByUserId: actorUserId }))).returning({ id: decisions.id });
    await recordAudit(tx, { companyId, actorUserId, via: "ui", action: "scenario.promoted", entityType: "scenario", entityId: scenario.id, summary: `Promoted scenario ${scenario.name} to ${rows.length} proposed decision${rows.length === 1 ? "" : "s"}`, after: { decisionIds: rows.map((row) => row.id), skippedItems } });
    return { decisionIds: rows.map((row) => row.id), skippedItems };
}

async function freeScenarioName(db: DbExecutor, companyId: string, base: string) {
  const rows = await db.select({ name: scenarios.name }).from(scenarios).where(and(eq(scenarios.companyId, companyId), eq(scenarios.active, "Y"))); const taken = new Set(rows.map((row) => row.name));
  if (!taken.has(base)) return base; let suffix = 2; while (taken.has(`${base} (${suffix})`)) suffix += 1; return `${base} (${suffix})`;
}

/** Reserve the first free generated name, including its suffix lock, against direct creates and renames. */
async function reserveFreeScenarioName(tx: DbTransaction, companyId: string, base: string) {
  await lockScenarioName(tx, companyId, base);
  while (true) {
    const name = await freeScenarioName(tx, companyId, base);
    if (name !== base) await lockScenarioName(tx, companyId, name);
    try {
      await assertNameFree(tx, companyId, name);
      return name;
    } catch (error) {
      if (!(error instanceof ScenarioConflict)) throw error;
    }
  }
}

export async function scenarioFromDecision(companyId: string, decisionId: string, actorUserId: string | null): Promise<ScenarioDetail> {
  if (!uuidPattern.test(decisionId)) throw new ScenarioNotFound("Decision not found");
  return getDatabase().transaction(async (tx) => {
    const [decision] = await tx.select({ question: decisions.question, status: decisions.status, effect: decisions.effect }).from(decisions).where(and(eq(decisions.id, decisionId), eq(decisions.companyId, companyId))).limit(1).for("update");
    if (!decision) throw new ScenarioNotFound("Decision not found");
    if (decision.status !== "proposed") throw new ScenarioConflict("Only a proposed decision can be tried as a scenario");
    const change = effectToScenarioChange(parseStoredEffect(decision.effect)); if (!change) throw new ScenarioInvalid("This decision has no forecast change a scenario can hold");
    const question = decision.question.trim(); const base = question.slice(0, 80).trim() || "Proposed decision";
    const name = await reserveFreeScenarioName(tx, companyId, base);
    return createScenarioWith(tx, companyId, { name, description: `From proposed decision: ${question}`, changes: [change] }, actorUserId);
  });
}
