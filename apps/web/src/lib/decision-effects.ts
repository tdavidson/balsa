import "server-only";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { cashEvents, decisions, economicItems, entities, getDatabase, knowledgeDocuments, scenarios, type Database } from "@finance/database";
import { addMonths, categories, isValidMonth, type ScheduleItem } from "@nevermodel/finance-engine";
import { resolveCounterparty, type KnownEntity } from "@/lib/interpretation";
import type { FinancialOptions } from "@/lib/financials";

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
]);
export type DecisionEffect = z.infer<typeof decisionEffectSchema>;

/** The flat, nullable shape the agent returns; strict JSON schemas cannot express a discriminated union cleanly. */
export const flatEffectSchema = z.object({
  kind: z.enum(["add_item", "end_item", "change_amount", "set_category"]).nullable(),
  item: effectItemSchema.extend({ accountingTreatment: z.enum(["cash", "accrual", "prepaid"]).nullable() }).nullable(),
  itemId: z.string().nullable(),
  effectiveTo: z.string().nullable(),
  amount: z.number().nullable(),
  effectiveFrom: z.string().nullable(),
  entityId: z.string().nullable(),
  category: z.enum(categories).nullable(),
  scenario: z.string().nullable(),
});
export type FlatEffect = z.infer<typeof flatEffectSchema>;

const nullableString = { type: ["string", "null"] };
export const flatEffectJsonSchema = {
  type: ["object", "null"], additionalProperties: false,
  properties: {
    kind: { type: ["string", "null"], enum: ["add_item", "end_item", "change_amount", "set_category", null] },
    item: { type: ["object", "null"], additionalProperties: false, properties: { label: { type: "string" }, counterparty: nullableString, direction: { type: "string", enum: ["receipt", "spend"] }, amount: { type: "number" }, cadence: { type: "string", enum: ["once", "monthly", "quarterly", "annual"] }, effectiveFrom: { type: "string" }, effectiveTo: nullableString, category: { type: "string", enum: [...categories] }, accountingTreatment: { type: ["string", "null"], enum: ["cash", "accrual", "prepaid", null] }, recognitionStart: nullableString, recognitionEnd: nullableString }, required: ["label", "counterparty", "direction", "amount", "cadence", "effectiveFrom", "effectiveTo", "category", "accountingTreatment", "recognitionStart", "recognitionEnd"] },
    itemId: nullableString, effectiveTo: nullableString, amount: { type: ["number", "null"] }, effectiveFrom: nullableString, entityId: nullableString, category: { type: ["string", "null"], enum: [...categories, null] }, scenario: nullableString,
  },
  required: ["kind", "item", "itemId", "effectiveTo", "amount", "effectiveFrom", "entityId", "category", "scenario"],
};

export function effectFromFlat(flat: FlatEffect | null | undefined): DecisionEffect | undefined {
  if (!flat?.kind) return undefined;
  const candidate =
    flat.kind === "add_item" ? { kind: "add_item", item: flat.item ? { ...flat.item, accountingTreatment: flat.item.accountingTreatment ?? "cash" } : undefined, scenario: flat.scenario }
    : flat.kind === "end_item" ? { kind: "end_item", itemId: flat.itemId, effectiveTo: flat.effectiveTo }
    : flat.kind === "change_amount" ? { kind: "change_amount", itemId: flat.itemId, amount: flat.amount, effectiveFrom: flat.effectiveFrom }
    : { kind: "set_category", entityId: flat.entityId, category: flat.category };
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
  return `Categorizes a counterparty as ${effect.category.replace(/_/g, " ")}`;
}

/** Translate effects into engine overrides for an in-memory simulation; nothing is persisted. */
export function simulationOptions(effects: DecisionEffect[], scenarioId = "simulation"): Pick<FinancialOptions, "extraItems" | "itemOverrides"> {
  const extraItems: ScheduleItem[] = [];
  const itemOverrides: NonNullable<FinancialOptions["itemOverrides"]> = [];
  effects.forEach((effect, index) => {
    if (effect.kind === "add_item") extraItems.push({ id: `${scenarioId}:${index}`, label: effect.item.label, ...(effect.item.counterparty ? { counterparty: effect.item.counterparty } : {}), direction: effect.item.direction, amount: effect.item.amount, category: effect.item.category, cadence: effect.item.cadence, effectiveFrom: effect.item.effectiveFrom, ...(effect.item.effectiveTo ? { effectiveTo: effect.item.effectiveTo } : {}), accountingTreatment: effect.item.accountingTreatment, ...(effect.item.recognitionStart ? { recognitionStart: effect.item.recognitionStart } : {}), ...(effect.item.recognitionEnd ? { recognitionEnd: effect.item.recognitionEnd } : {}), basis: "assumed", provenance: {} });
    else if (effect.kind === "end_item") itemOverrides.push({ itemId: effect.itemId, effectiveTo: effect.effectiveTo });
    else if (effect.kind === "change_amount") itemOverrides.push({ itemId: effect.itemId, amount: effect.amount, amountFrom: effect.effectiveFrom });
  });
  return { extraItems, itemOverrides };
}

async function appendAssumption(db: Database, companyId: string, line: string) {
  const [doc] = await db.select({ content: knowledgeDocuments.content }).from(knowledgeDocuments).where(and(eq(knowledgeDocuments.companyId, companyId), eq(knowledgeDocuments.slug, "forecast")));
  const base = doc?.content.trim() ?? "# Forecast\n\nForecast assumptions and scenarios.";
  const content = base.includes("## Assumptions") ? `${base}\n${line}\n` : `${base}\n\n## Assumptions\n${line}\n`;
  if (doc) await db.update(knowledgeDocuments).set({ content, updatedAt: new Date() }).where(and(eq(knowledgeDocuments.companyId, companyId), eq(knowledgeDocuments.slug, "forecast")));
  else await db.insert(knowledgeDocuments).values({ companyId, slug: "forecast", title: "Forecast", content });
}

/** Apply a decision's effect to Company State. Returns a short description of what changed. */
export async function applyDecisionEffect(companyId: string, decisionId: string, effect: DecisionEffect): Promise<{ applied: string; itemId?: string | undefined }> {
  const db = getDatabase();
  if (effect.kind === "add_item") {
    let scenarioId: string | undefined;
    if (effect.scenario) {
      const [existing] = await db.select({ id: scenarios.id }).from(scenarios).where(and(eq(scenarios.companyId, companyId), eq(scenarios.name, effect.scenario)));
      scenarioId = existing?.id ?? (await db.insert(scenarios).values({ companyId, name: effect.scenario }).returning({ id: scenarios.id }))[0]?.id;
    }
    const candidates: KnownEntity[] = await db.select({ id: entities.id, name: entities.name, type: entities.type, attributes: entities.attributes }).from(entities).where(eq(entities.companyId, companyId));
    const entity = effect.item.counterparty ? await resolveCounterparty(db, companyId, { name: effect.item.counterparty, category: effect.item.category, direction: effect.item.direction, candidates }) : undefined;
    const [row] = await db.insert(economicItems).values({
      companyId, type: effect.item.direction === "spend" ? "obligation" : "agreement", direction: effect.item.direction, label: effect.item.label, counterparty: effect.item.counterparty ?? undefined, counterpartyEntityId: entity?.id,
      amount: String(effect.item.amount), cadence: effect.item.cadence, effectiveFrom: effect.item.effectiveFrom, effectiveTo: effect.item.effectiveTo ?? undefined, category: effect.item.category, basis: "assumed",
      accountingTreatment: effect.item.accountingTreatment, recognitionStart: effect.item.recognitionStart ?? undefined, recognitionEnd: effect.item.recognitionEnd ?? undefined, decisionId, scenarioId, status: "confirmed",
    }).returning({ id: economicItems.id });
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
    const [row] = await db.insert(economicItems).values({ ...copy, amount: String(effect.amount), effectiveFrom: effect.effectiveFrom, effectiveTo: null, basis: "assumed", decisionId, status: "confirmed" }).returning({ id: economicItems.id });
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

/** Apply a stored decision's effect once, when the decision moves to applied. */
export async function applyDecisionIfEffective(companyId: string, decisionId: string) {
  const db = getDatabase();
  const [decision] = await db.select({ effect: decisions.effect, status: decisions.status }).from(decisions).where(and(eq(decisions.id, decisionId), eq(decisions.companyId, companyId)));
  const effect = parseStoredEffect(decision?.effect);
  if (!effect || decision?.status !== "applied") return null;
  const alreadyApplied = effect.kind === "add_item" || effect.kind === "change_amount" ? await db.select({ id: economicItems.id }).from(economicItems).where(and(eq(economicItems.companyId, companyId), eq(economicItems.decisionId, decisionId))).limit(1) : [];
  if (alreadyApplied.length) return { applied: "already applied" };
  return applyDecisionEffect(companyId, decisionId, effect);
}
