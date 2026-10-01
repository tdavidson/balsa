import "server-only";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { assumptions, cashEvents, decisionEffectApplications, decisions, economicItems, entities, getDatabase, knowledgeDocuments, recordAudit, reviewItems } from "@finance/database";
import { addMonths, categories, isValidMonth } from "@balsa/finance-engine";
import { resolveCounterparty, type KnownEntity } from "@/lib/interpretation";
import { getOrCreateActiveScenario } from "@/lib/scenario-name-lock";
import type { DbExecutor, DbTransaction } from "@/lib/db-executor";
import { dimensionDraftSchema, modelFormulaSchema, variableDraftSchema } from "@/lib/forecast-model-schema";
import { setItemFormulaWith, upsertDimensionByNameWith, upsertVariableByNameWith } from "@/lib/forecast-model-store";
import { enqueueCalculationRefreshWith, processEnqueuedCalculationRefresh } from "@/lib/refresh-calculation-run";

/**
 * Structured effects that a CFO decision can carry. Applying a decision runs
 * its effect against Company State, so an answer such as "assume a finance
 * contractor at $6,000 a month from January" becomes a forecast line rather
 * than a sentence.
 */

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const effectItemSchema = z.object({
  label: z.string().trim().min(1),
  counterparty: z.string().nullable().optional(),
  direction: z.enum(["receipt", "spend"]),
  amount: z.number().positive(),
  amountFormula: modelFormulaSchema.optional(),
  cadence: z.enum(["once", "monthly", "quarterly", "annual"]),
  effectiveFrom: month,
  effectiveTo: month.nullable().optional(),
  category: z.enum(categories),
  accountingTreatment: z.enum(["cash", "accrual", "prepaid"]).default("cash"),
  recognitionStart: month.nullable().optional(),
  recognitionEnd: month.nullable().optional(),
});

export const decisionEffectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("add_item"), item: effectItemSchema, scenario: z.string().trim().min(1).nullable().optional() }),
  z.object({ kind: z.literal("end_item"), itemId: z.string().uuid(), effectiveTo: month }),
  z.object({ kind: z.literal("change_amount"), itemId: z.string().uuid(), amount: z.number().positive(), effectiveFrom: month }),
  z.object({ kind: z.literal("set_category"), entityId: z.string().uuid(), category: z.enum(categories) }),
  z.object({ kind: z.literal("set_variable"), variable: variableDraftSchema }),
  z.object({ kind: z.literal("set_dimension"), dimension: dimensionDraftSchema }),
  z.object({ kind: z.literal("set_item_formula"), itemId: z.string().uuid(), amountFormula: modelFormulaSchema }),
]);
export type DecisionEffect = z.infer<typeof decisionEffectSchema>;

/** The flat, nullable shape the agent returns; strict JSON schemas cannot express a discriminated union cleanly. */
export const flatEffectSchema = z.object({
  kind: z.enum(["add_item", "end_item", "change_amount", "set_category", "set_variable", "set_dimension", "set_item_formula"]).nullable(),
  item: effectItemSchema.extend({ accountingTreatment: z.enum(["cash", "accrual", "prepaid"]).nullable() }).nullable(),
  itemId: z.string().nullable(),
  effectiveTo: z.string().nullable(),
  amount: z.number().nullable(),
  effectiveFrom: z.string().nullable(),
  entityId: z.string().nullable(),
  category: z.enum(categories).nullable(),
  scenario: z.string().nullable(),
  variable: variableDraftSchema.nullable(),
  dimension: dimensionDraftSchema.nullable(),
  amountFormula: modelFormulaSchema.nullable(),
});
export type FlatEffect = z.infer<typeof flatEffectSchema>;

const nullableString = { type: ["string", "null"] };
export const flatEffectJsonSchema = {
  type: ["object", "null"], additionalProperties: false,
  properties: {
    kind: { type: ["string", "null"], enum: ["add_item", "end_item", "change_amount", "set_category", "set_variable", "set_dimension", "set_item_formula", null] },
    item: { type: ["object", "null"], additionalProperties: false, properties: { label: { type: "string" }, counterparty: nullableString, direction: { type: "string", enum: ["receipt", "spend"] }, amount: { type: "number" }, cadence: { type: "string", enum: ["once", "monthly", "quarterly", "annual"] }, effectiveFrom: { type: "string" }, effectiveTo: nullableString, category: { type: "string", enum: [...categories] }, accountingTreatment: { type: ["string", "null"], enum: ["cash", "accrual", "prepaid", null] }, recognitionStart: nullableString, recognitionEnd: nullableString }, required: ["label", "counterparty", "direction", "amount", "cadence", "effectiveFrom", "effectiveTo", "category", "accountingTreatment", "recognitionStart", "recognitionEnd"] },
    itemId: nullableString, effectiveTo: nullableString, amount: { type: ["number", "null"] }, effectiveFrom: nullableString, entityId: nullableString, category: { type: ["string", "null"], enum: [...categories, null] }, scenario: nullableString,
    variable: {
      type: ["object", "null"], additionalProperties: false,
      properties: {
        name: { type: "string" }, kind: { type: "string", enum: ["money", "number"] }, dims: { type: "array", items: { type: "string" } }, formula: nullableString,
        inputs: { type: "array", items: { type: "object", additionalProperties: false, properties: { coords: { type: "object", additionalProperties: { type: "string" } }, from: { type: "string" }, value: { type: "string" } }, required: ["coords", "from", "value"] } },
      },
      required: ["name", "kind", "dims", "formula", "inputs"],
    },
    dimension: { type: ["object", "null"], additionalProperties: false, properties: { name: { type: "string" }, items: { type: "array", items: { type: "string" } } }, required: ["name", "items"] },
    amountFormula: nullableString,
  },
  required: ["kind", "item", "itemId", "effectiveTo", "amount", "effectiveFrom", "entityId", "category", "scenario", "variable", "dimension", "amountFormula"],
};

export function effectFromFlat(flat: FlatEffect | null | undefined): DecisionEffect | undefined {
  if (!flat?.kind) return undefined;
  const candidate =
    flat.kind === "add_item" ? { kind: "add_item", item: flat.item ? { ...flat.item, accountingTreatment: flat.item.accountingTreatment ?? "cash" } : undefined, scenario: flat.scenario }
    : flat.kind === "end_item" ? { kind: "end_item", itemId: flat.itemId, effectiveTo: flat.effectiveTo }
    : flat.kind === "change_amount" ? { kind: "change_amount", itemId: flat.itemId, amount: flat.amount, effectiveFrom: flat.effectiveFrom }
    : flat.kind === "set_category" ? { kind: "set_category", entityId: flat.entityId, category: flat.category }
    : flat.kind === "set_variable" ? { kind: "set_variable", variable: flat.variable }
    : flat.kind === "set_dimension" ? { kind: "set_dimension", dimension: flat.dimension }
    : { kind: "set_item_formula", itemId: flat.itemId, amountFormula: flat.amountFormula };
  const parsed = decisionEffectSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

export function parseStoredEffect(value: string | null | undefined): DecisionEffect | undefined {
  if (!value) return undefined;
  try { const parsed = decisionEffectSchema.safeParse(JSON.parse(value)); return parsed.success ? parsed.data : undefined; } catch { return undefined; }
}

export function describeEffect(effect: DecisionEffect | undefined): string | null {
  if (!effect) return null;
  const dollars = (amount: number) => `$${amount.toLocaleString("en-US")}`;
  if (effect.kind === "add_item") return `${effect.item.direction === "spend" ? "Adds an expense" : "Adds a receipt"}: ${effect.item.label} ${dollars(effect.item.amount)} ${effect.item.cadence} from ${effect.item.effectiveFrom}${effect.item.effectiveTo ? ` to ${effect.item.effectiveTo}` : ""}${effect.scenario ? ` (scenario: ${effect.scenario})` : ""}`;
  if (effect.kind === "end_item") return `Ends an item after ${effect.effectiveTo}`;
  if (effect.kind === "change_amount") return `Changes an item to ${dollars(effect.amount)} from ${effect.effectiveFrom}`;
  if (effect.kind === "set_variable") return `Sets model variable ${effect.variable.name}`;
  if (effect.kind === "set_dimension") return `Sets model dimension ${effect.dimension.name}`;
  if (effect.kind === "set_item_formula") return "Sets a formula on an item";
  return `Categorizes a counterparty as ${effect.category.replace(/_/g, " ")}`;
}

async function appendAssumption(db: DbExecutor, companyId: string, line: string) {
  const [doc] = await db.select({ content: knowledgeDocuments.content }).from(knowledgeDocuments).where(and(eq(knowledgeDocuments.companyId, companyId), eq(knowledgeDocuments.slug, "forecast")));
  const base = doc?.content.trim() ?? "# Forecast\n\nForecast assumptions and scenarios.";
  const content = base.includes("## Assumptions") ? `${base}\n${line}\n` : `${base}\n\n## Assumptions\n${line}\n`;
  if (doc) await db.update(knowledgeDocuments).set({ content, updatedAt: new Date() }).where(and(eq(knowledgeDocuments.companyId, companyId), eq(knowledgeDocuments.slug, "forecast")));
  else await db.insert(knowledgeDocuments).values({ companyId, slug: "forecast", title: "Forecast", content });
}

/**
 * Apply a decision's effect to Company State. Returns a short description of
 * what changed. `actorUserId` is stamped on the rows the effect creates, so an
 * item answers "who put this in the forecast" without reading the audit log; a
 * worker-run application has no actor and stores none.
 */
export async function applyDecisionEffectWith(db: DbTransaction, companyId: string, decisionId: string, effect: DecisionEffect, actorUserId: string | null): Promise<{ applied: string; itemId?: string | undefined }> {
  if (effect.kind === "set_variable") {
    await upsertVariableByNameWith(db, companyId, effect.variable, decisionId);
    return { applied: describeEffect(effect)! };
  }
  if (effect.kind === "set_dimension") {
    await upsertDimensionByNameWith(db, companyId, effect.dimension);
    return { applied: describeEffect(effect)! };
  }
  if (effect.kind === "set_item_formula") {
    const item = await setItemFormulaWith(db, companyId, effect.itemId, effect.amountFormula, { decisionId });
    return { applied: describeEffect(effect)!, itemId: item.id };
  }
  if (effect.kind === "add_item") {
      const scenarioId = effect.scenario ? await getOrCreateActiveScenario(db, companyId, effect.scenario) : undefined;
      const candidates: KnownEntity[] = await db.select({ id: entities.id, name: entities.name, type: entities.type, attributes: entities.attributes }).from(entities).where(eq(entities.companyId, companyId));
      const entity = effect.item.counterparty ? await resolveCounterparty(db, companyId, { name: effect.item.counterparty, category: effect.item.category, direction: effect.item.direction, candidates }) : undefined;
      const [row] = await db.insert(economicItems).values({
        companyId, createdByUserId: actorUserId, type: effect.item.direction === "spend" ? "obligation" : "agreement", direction: effect.item.direction, label: effect.item.label, counterparty: effect.item.counterparty ?? undefined, counterpartyEntityId: entity?.id,
        amount: String(effect.item.amount), cadence: effect.item.cadence, effectiveFrom: effect.item.effectiveFrom, effectiveTo: effect.item.effectiveTo ?? undefined, category: effect.item.category, basis: "assumed",
        accountingTreatment: effect.item.accountingTreatment, recognitionStart: effect.item.recognitionStart ?? undefined, recognitionEnd: effect.item.recognitionEnd ?? undefined, decisionId, scenarioId, status: "confirmed",
      }).returning({ id: economicItems.id });
      if (effect.item.amountFormula && row) await setItemFormulaWith(db, companyId, row.id, effect.item.amountFormula, { decisionId });
      await appendAssumption(db, companyId, `- [decision:${decisionId}] ${effect.item.label}: ${effect.item.direction === "receipt" ? "+" : "−"}$${effect.item.amount.toLocaleString("en-US")} ${effect.item.cadence} from ${effect.item.effectiveFrom}${effect.item.effectiveTo ? ` to ${effect.item.effectiveTo}` : ""}${effect.scenario ? ` (scenario ${effect.scenario})` : ""}`);
      return { applied: describeEffect(effect)!, itemId: row?.id };
  }
  if (effect.kind === "end_item") {
    const [row] = await db.update(economicItems).set({ effectiveTo: effect.effectiveTo, decisionId, updatedAt: new Date() }).where(and(eq(economicItems.id, effect.itemId), eq(economicItems.companyId, companyId))).returning({ id: economicItems.id, label: economicItems.label });
    if (!row) throw new Error("Item not found");
    await appendAssumption(db, companyId, `- [decision:${decisionId}] ${row.label} ends after ${effect.effectiveTo}`);
    return { applied: `${row.label} ends after ${effect.effectiveTo}`, itemId: row.id };
  }
  if (effect.kind === "change_amount") {
    const [original] = await db.select().from(economicItems).where(and(eq(economicItems.id, effect.itemId), eq(economicItems.companyId, companyId)));
    if (!original) throw new Error("Item not found");
    const lastMonth = isValidMonth(effect.effectiveFrom) ? addMonths(effect.effectiveFrom, -1) : undefined;
    await db.update(economicItems).set({ effectiveTo: lastMonth, updatedAt: new Date() }).where(eq(economicItems.id, original.id));
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...copy } = original;
    void _id; void _createdAt; void _updatedAt;
    // The replacement row is written by whoever applied this decision, not by
    // the author of the row it supersedes, so the copied attribution is dropped.
    const [row] = await db.insert(economicItems).values({ ...copy, forecastOrigin: null, createdByUserId: actorUserId, amount: String(effect.amount), effectiveFrom: effect.effectiveFrom, effectiveTo: null, basis: "assumed", decisionId, status: "confirmed" }).returning({ id: economicItems.id });
    await appendAssumption(db, companyId, `- [decision:${decisionId}] ${original.label} changes to $${effect.amount.toLocaleString("en-US")} from ${effect.effectiveFrom}`);
    return { applied: `${original.label} changes to $${effect.amount.toLocaleString("en-US")} from ${effect.effectiveFrom}`, itemId: row?.id };
  }
  const [entity] = await db.select({ id: entities.id, name: entities.name, attributes: entities.attributes }).from(entities).where(and(eq(entities.id, effect.entityId), eq(entities.companyId, companyId)));
  if (!entity) throw new Error("Entity not found");
  let attributes: Record<string, unknown> = {};
  try { attributes = JSON.parse(entity.attributes) as Record<string, unknown>; } catch { /* ignore */ }
  await db.update(entities).set({ attributes: JSON.stringify({ ...attributes, category: effect.category }), updatedAt: new Date() }).where(eq(entities.id, entity.id));
  await db.update(cashEvents).set({ financialCategory: effect.category, updatedAt: new Date() }).where(and(eq(cashEvents.companyId, companyId), eq(cashEvents.counterpartyEntityId, entity.id)));
  await db.update(economicItems).set({ category: effect.category, updatedAt: new Date() }).where(and(eq(economicItems.companyId, companyId), eq(economicItems.counterpartyEntityId, entity.id)));
  return { applied: `${entity.name} is now ${effect.category.replace(/_/g, " ")}` };
}

export async function applyDecisionEffect(companyId: string, decisionId: string, effect: DecisionEffect, actorUserId: string | null): Promise<{ applied: string; itemId?: string | undefined }> {
  return getDatabase().transaction((tx) => applyDecisionEffectWith(tx, companyId, decisionId, effect, actorUserId));
}

type EffectResult = { applied: string; itemId?: string | undefined };
const boundedResult = (value: unknown): EffectResult => {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { applied: typeof row.applied === "string" ? row.applied.slice(0, 500) : "already applied", ...(typeof row.itemId === "string" ? { itemId: row.itemId.slice(0, 100) } : {}) };
};

async function applyLegacyTargetWith(db: DbTransaction, companyId: string, appliesTo: string) {
  const target = appliesTo.match(/^(assumption|economic_item):([0-9a-f-]{36})=(.+)$/i);
  if (target?.[1] === "assumption") {
    const [row] = await db.update(assumptions).set({ value: target[3]!, updatedAt: new Date() }).where(and(eq(assumptions.id, target[2]!), eq(assumptions.companyId, companyId))).returning({ id: assumptions.id });
    if (!row) throw new Error("Assumption not found");
    return { applied: "Updates an assumption", itemId: row.id };
  }
  if (target?.[1] === "economic_item") {
    const [row] = await db.update(economicItems).set({ cadence: target[3]!, updatedAt: new Date() }).where(and(eq(economicItems.id, target[2]!), eq(economicItems.companyId, companyId))).returning({ id: economicItems.id });
    if (!row) throw new Error("Item not found");
    return { applied: "Updates an economic item", itemId: row.id };
  }
  throw new Error("Invalid decision target");
}

/** Executor-only, durable exactly-once application of a stored structured or legacy effect. */
export async function applyDecisionIfEffectiveWith(db: DbTransaction, companyId: string, decisionId: string, actorUserId: string | null) {
  const [decision] = await db.select({ effect: decisions.effect, appliesTo: decisions.appliesTo }).from(decisions).where(and(eq(decisions.id, decisionId), eq(decisions.companyId, companyId))).limit(1).for("update");
  if (!decision) throw new Error("Decision not found");
  const [marker] = await db.select({ result: decisionEffectApplications.result }).from(decisionEffectApplications).where(and(eq(decisionEffectApplications.companyId, companyId), eq(decisionEffectApplications.decisionId, decisionId))).limit(1);
  if (marker) return { result: boundedResult(marker.result), newlyApplied: false };
  const effect = parseStoredEffect(decision.effect);
  if (!effect && !decision.appliesTo) return { result: null, newlyApplied: false };
  const result = effect ? await applyDecisionEffectWith(db, companyId, decisionId, effect, actorUserId) : await applyLegacyTargetWith(db, companyId, decision.appliesTo!);
  const stored = boundedResult(result);
  await db.insert(decisionEffectApplications).values({ companyId, decisionId, effectKind: effect?.kind ?? "legacy_applies_to", result: stored });
  return { result: stored, newlyApplied: true };
}

/** Compatibility entry point for non-route callers; new applied routes use applyDecisionAndEnqueue. */
export async function applyDecisionIfEffective(companyId: string, decisionId: string, actorUserId: string | null) {
  return getDatabase().transaction(async (tx) => {
    const application = await applyDecisionIfEffectiveWith(tx, companyId, decisionId, actorUserId);
    return application.newlyApplied ? application.result : application.result ? { applied: "already applied" } : null;
  });
}

type Processor = typeof processEnqueuedCalculationRefresh;
type DecisionDeps = { database?: Pick<ReturnType<typeof getDatabase>, "transaction">; enqueue?: typeof enqueueCalculationRefreshWith; process?: Processor };

/** Apply a proposed decision, its audit/revision, and its outbox entry as one transaction. */
export async function applyDecisionAndEnqueue(companyId: string, decisionId: string, actorUserId: string | null, deps: DecisionDeps = {}) {
  const committed = await (deps.database ?? getDatabase()).transaction(async (tx) => {
    const [decision] = await tx.select().from(decisions).where(and(eq(decisions.id, decisionId), eq(decisions.companyId, companyId))).limit(1).for("update");
    if (!decision) throw new Error("Decision not found");
    const application = await applyDecisionIfEffectiveWith(tx, companyId, decisionId, actorUserId);
    const needsTransition = decision.status !== "applied";
    const [updated] = needsTransition ? await tx.update(decisions).set({ status: "applied", updatedAt: new Date() }).where(and(eq(decisions.id, decisionId), eq(decisions.companyId, companyId))).returning() : [decision];
    if (needsTransition) await recordAudit(tx, { companyId, actorUserId, via: "ui", action: "decision.applied", entityType: "decision", entityId: decisionId, summary: `Applied decision: ${decision.question.slice(0, 120)}`, after: { status: "applied" } });
    if (!application.newlyApplied && (decision.effect || decision.appliesTo)) return { decision: updated!, mutation: application.result, receipt: null };
    if (!application.newlyApplied) return { decision: updated!, mutation: null, receipt: null };
    if (!needsTransition) await recordAudit(tx, { companyId, actorUserId, via: "ui", action: "decision.applied", entityType: "decision", entityId: decisionId, summary: `Applied decision: ${decision.question.slice(0, 120)}`, after: { status: "applied" } });
    const receipt = await (deps.enqueue ?? enqueueCalculationRefreshWith)(tx, companyId, { cause: { kind: "decision_applied", subjectType: "decision", subjectId: decisionId, actorUserId, via: "ui" }, rebuildJournalGraphs: false });
    return { decision: updated!, mutation: application.result, receipt };
  });
  return { decision: committed.decision, mutation: committed.mutation, calculationRun: committed.receipt ? await (deps.process ?? processEnqueuedCalculationRefresh)(committed.receipt) : null };
}

export async function createAppliedDecisionAndEnqueue(companyId: string, draft: { question: string; answer: string; appliesTo?: string; effect?: DecisionEffect }, actorUserId: string | null, deps: DecisionDeps = {}) {
  const committed = await (deps.database ?? getDatabase()).transaction(async (tx) => {
    const [decision] = await tx.insert(decisions).values({ companyId, question: draft.question, answer: draft.answer, status: "applied", createdByUserId: actorUserId, ...(draft.appliesTo ? { appliesTo: draft.appliesTo } : {}), ...(draft.effect ? { effect: JSON.stringify(draft.effect) } : {}) }).returning();
    const resolved = await tx.update(reviewItems).set({ answer: draft.answer, status: "resolved", updatedAt: new Date() }).where(and(eq(reviewItems.companyId, companyId), eq(reviewItems.question, draft.question), eq(reviewItems.status, "open"))).returning({ id: reviewItems.id });
    const application = await applyDecisionIfEffectiveWith(tx, companyId, decision!.id, actorUserId);
    await recordAudit(tx, { companyId, actorUserId, via: "ui", action: "decision.applied", entityType: "decision", entityId: decision!.id, summary: `Applied decision: ${draft.question.slice(0, 120)}`, after: { status: "applied" } });
    if (!application.newlyApplied) return { decision: decision!, resolvedReviewCount: resolved.length, mutation: application.result, receipt: null };
    const receipt = await (deps.enqueue ?? enqueueCalculationRefreshWith)(tx, companyId, { cause: { kind: "decision_applied", subjectType: "decision", subjectId: decision!.id, actorUserId, via: "ui" }, rebuildJournalGraphs: false });
    return { decision: decision!, resolvedReviewCount: resolved.length, mutation: application.result, receipt };
  });
  return { decision: committed.decision, resolvedReviewCount: committed.resolvedReviewCount, mutation: committed.mutation, calculationRun: committed.receipt ? await (deps.process ?? processEnqueuedCalculationRefresh)(committed.receipt) : null };
}
