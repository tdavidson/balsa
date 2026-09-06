import { auth } from "@clerk/nextjs/server";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { allocations, assumptions, entities, getDatabase, relationships, scenarios, sources, observations, economicItems, factRecords, cashEvents, evidence } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";

const input = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("entity"), type: z.string().min(1), name: z.string().min(1), attributes: z.record(z.string(), z.unknown()).optional() }),
  z.object({ kind: z.literal("relationship"), fromEntityId: z.string().uuid(), toEntityId: z.string().uuid(), type: z.string().min(1), attributes: z.record(z.string(), z.unknown()).optional() }),
  z.object({ kind: z.literal("assumption"), name: z.string().min(1), value: z.string().min(1), unit: z.string().optional(), sourceId: z.string().uuid().optional() }),
  z.object({ kind: z.literal("scenario"), name: z.string().min(1), assumptionIds: z.array(z.string().uuid()).default([]) }),
  z.object({ kind: z.literal("observation"), sourceId: z.string().uuid(), type: z.string().min(1), effectiveDate: z.string().optional(), amount: z.string().optional(), currency: z.string().length(3).optional(), counterpartyText: z.string().optional(), attributes: z.record(z.string(), z.unknown()).optional(), confidence: z.string().default("medium") }),
  z.object({ kind: z.enum(["agreement", "obligation"]), label: z.string().min(1), direction: z.enum(["receipt", "spend"]), amount: z.string().optional(), counterparty: z.string().optional(), cadence: z.string().optional(), evidenceId: z.string().uuid().optional(), accountingTreatment: z.enum(["cash", "accrual", "prepaid"]).default("cash"), recognitionStart: z.string().optional(), recognitionEnd: z.string().optional() }),
  z.object({ kind: z.literal("fact"), evidenceId: z.string().uuid(), label: z.string().min(1), value: z.string().min(1), confidence: z.string().default("medium") }),
  z.object({ kind: z.literal("event"), month: z.string().regex(/^20\d{2}-\d{2}$/), description: z.string().min(1), amount: z.string(), direction: z.enum(["receipt", "spend"]), evidenceId: z.string().uuid().optional(), sourceId: z.string().uuid().optional(), category: z.string().optional(), accountingTreatment: z.enum(["cash", "accrual", "prepaid"]).default("cash") }),
  z.object({ kind: z.literal("allocation"), eventId: z.string().uuid().optional(), payerEntityId: z.string().uuid().optional(), bearerEntityId: z.string().uuid().optional(), percentage: z.string().optional(), amount: z.string().optional(), sourceId: z.string().uuid().optional(), status: z.enum(["proposed", "approved", "rejected"]).default("proposed") }),
]);

export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = input.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid state mutation", details: parsed.error.flatten() }, { status: 400 });
  const db = getDatabase();
  const value = parsed.data;
  if (value.kind === "entity") return NextResponse.json({ entity: (await db.insert(entities).values({ companyId: context.company.id, type: value.type, name: value.name, attributes: JSON.stringify(value.attributes ?? {}) }).returning())[0] });
  if (value.kind === "relationship") {
    const entityRows = await db.select({ id: entities.id }).from(entities).where(and(eq(entities.companyId, context.company.id), eq(entities.id, value.fromEntityId)));
    const toRows = await db.select({ id: entities.id }).from(entities).where(and(eq(entities.companyId, context.company.id), eq(entities.id, value.toEntityId)));
    if (!entityRows.length || !toRows.length) return NextResponse.json({ error: "Both relationship entities must belong to the current company" }, { status: 404 });
    return NextResponse.json({ relationship: (await db.insert(relationships).values({ companyId: context.company.id, fromEntityId: value.fromEntityId, toEntityId: value.toEntityId, type: value.type, attributes: JSON.stringify(value.attributes ?? {}) }).returning())[0] });
  }
  if (value.kind === "assumption") return NextResponse.json({ assumption: (await db.insert(assumptions).values({ companyId: context.company.id, name: value.name, value: value.value, unit: value.unit, sourceId: value.sourceId }).returning())[0] });
  if (value.kind === "scenario") return NextResponse.json({ scenario: (await db.insert(scenarios).values({ companyId: context.company.id, name: value.name, assumptionIds: JSON.stringify(value.assumptionIds) }).returning())[0] });
  if (value.kind === "agreement" || value.kind === "obligation") {
    if (value.evidenceId && !(await db.select({ id: evidence.id }).from(evidence).where(and(eq(evidence.id, value.evidenceId), eq(evidence.companyId, context.company.id)))).length) return NextResponse.json({ error: "Evidence not found" }, { status: 404 });
    return NextResponse.json({ economicItem: (await db.insert(economicItems).values({ companyId: context.company.id, evidenceId: value.evidenceId, type: value.kind, direction: value.direction, label: value.label, counterparty: value.counterparty, amount: value.amount, cadence: value.cadence, accountingTreatment: value.accountingTreatment, recognitionStart: value.recognitionStart, recognitionEnd: value.recognitionEnd, status: "draft" }).returning())[0] });
  }
  if (value.kind === "fact") {
    const row = (await db.select({ id: evidence.id }).from(evidence).where(and(eq(evidence.id, value.evidenceId), eq(evidence.companyId, context.company.id))).limit(1))[0];
    if (!row) return NextResponse.json({ error: "Evidence not found" }, { status: 404 });
    return NextResponse.json({ fact: (await db.insert(factRecords).values({ companyId: context.company.id, evidenceId: value.evidenceId, label: value.label, value: value.value, confidence: value.confidence, status: "pending" }).returning())[0] });
  }
  if (value.kind === "event") {
    if (value.evidenceId && !(await db.select({ id: evidence.id }).from(evidence).where(and(eq(evidence.id, value.evidenceId), eq(evidence.companyId, context.company.id)))).length) return NextResponse.json({ error: "Evidence not found" }, { status: 404 });
    if (value.sourceId && !(await db.select({ id: sources.id }).from(sources).where(and(eq(sources.id, value.sourceId), eq(sources.companyId, context.company.id)))).length) return NextResponse.json({ error: "Source not found" }, { status: 404 });
    return NextResponse.json({ event: (await db.insert(cashEvents).values({ companyId: context.company.id, month: value.month, description: value.description, amount: value.amount, direction: value.direction, evidenceId: value.evidenceId, sourceId: value.sourceId, category: value.category ?? "operating", accountingTreatment: value.accountingTreatment, isActual: "N" }).returning())[0] });
  }
  if (value.kind === "allocation") {
    if (value.eventId && !(await db.select({ id: cashEvents.id }).from(cashEvents).where(and(eq(cashEvents.id, value.eventId), eq(cashEvents.companyId, context.company.id)))).length) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    const entityIds = [value.payerEntityId, value.bearerEntityId].filter((id): id is string => Boolean(id));
    if (entityIds.length && (await db.select({ id: entities.id }).from(entities).where(and(eq(entities.companyId, context.company.id), inArray(entities.id, entityIds)))).length !== entityIds.length) return NextResponse.json({ error: "Allocation entities must belong to the current company" }, { status: 404 });
    if (value.sourceId && !(await db.select({ id: sources.id }).from(sources).where(and(eq(sources.id, value.sourceId), eq(sources.companyId, context.company.id)))).length) return NextResponse.json({ error: "Source not found" }, { status: 404 });
    return NextResponse.json({ allocation: (await db.insert(allocations).values({ companyId: context.company.id, eventId: value.eventId, payerEntityId: value.payerEntityId, bearerEntityId: value.bearerEntityId, percentage: value.percentage, amount: value.amount, sourceId: value.sourceId, status: value.status }).returning())[0] });
  }
  if (value.kind !== "observation") return NextResponse.json({ error: "Unsupported mutation" }, { status: 400 });
  const source = (await db.select({ id: sources.id }).from(sources).where(and(eq(sources.id, value.sourceId), eq(sources.companyId, context.company.id))).limit(1))[0];
  if (!source) return NextResponse.json({ error: "Source not found" }, { status: 404 });
  return NextResponse.json({ observation: (await db.insert(observations).values({ companyId: context.company.id, sourceId: value.sourceId, type: value.type, effectiveDate: value.effectiveDate ? new Date(value.effectiveDate) : undefined, amount: value.amount, currency: value.currency, counterpartyText: value.counterpartyText, attributes: JSON.stringify(value.attributes ?? {}), confidence: value.confidence }).returning())[0] });
}
