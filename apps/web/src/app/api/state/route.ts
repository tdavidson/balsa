import { auth } from "@/lib/auth";
import { and, eq, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { allocations, assumptions, cashEvents, decisions, economicItems, entities, evidence, factRecords, getDatabase, observations, policies, relationships, reviewItems, scenarios, sources } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";

const json = (value: string | null | undefined, fallback: unknown) => { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } };
const itemView = (row: typeof economicItems.$inferSelect) => ({ id: row.id, companyId: row.companyId, sourceId: row.evidenceId ?? undefined, counterparty: row.counterparty ?? undefined, counterpartyEntityId: row.counterpartyEntityId ?? undefined, label: row.label, amount: row.amount ?? undefined, currency: "USD", cadence: row.cadence ?? undefined, category: row.category ?? undefined, basis: row.basis, effectiveFrom: row.effectiveFrom ?? undefined, effectiveTo: row.effectiveTo ?? undefined, scenarioId: row.scenarioId ?? undefined, decisionId: row.decisionId ?? undefined, accountingTreatment: row.accountingTreatment as "cash" | "accrual" | "prepaid", recognitionStart: row.recognitionStart ?? undefined, recognitionEnd: row.recognitionEnd ?? undefined, confidence: row.confidence ? Number(row.confidence) : undefined, rationale: row.rationale ?? undefined, status: row.status === "confirmed" ? "confirmed" : row.status === "rejected" ? "rejected" : "proposed" });

export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const db = getDatabase();
  const [sourceRows, observationRows, entityRows, relationshipRows, itemRows, eventRows, factRows, decisionRows, policyRows, assumptionRows, scenarioRows, reviewRows, allocationRows] = await Promise.all([
    db.select().from(sources).where(eq(sources.companyId, context.company.id)),
    db.select().from(observations).where(eq(observations.companyId, context.company.id)),
    db.select().from(entities).where(eq(entities.companyId, context.company.id)),
    db.select().from(relationships).where(eq(relationships.companyId, context.company.id)),
    db.select().from(economicItems).where(eq(economicItems.companyId, context.company.id)),
    db.select().from(cashEvents).leftJoin(evidence, eq(cashEvents.evidenceId, evidence.id)).where(and(eq(cashEvents.companyId, context.company.id), eq(cashEvents.isActual, "Y"), or(isNull(cashEvents.currency), eq(cashEvents.currency, context.company.baseCurrency)), or(eq(evidence.status, "approved"), isNull(cashEvents.evidenceId)))).then((rows) => rows.map((row) => row.cash_events)),
    db.select().from(factRecords).where(eq(factRecords.companyId, context.company.id)),
    db.select().from(decisions).where(eq(decisions.companyId, context.company.id)),
    db.select().from(policies).where(eq(policies.companyId, context.company.id)),
    db.select().from(assumptions).where(eq(assumptions.companyId, context.company.id)),
    db.select().from(scenarios).where(eq(scenarios.companyId, context.company.id)),
    db.select().from(reviewItems).where(eq(reviewItems.companyId, context.company.id)),
    db.select().from(allocations).where(eq(allocations.companyId, context.company.id)),
  ]);
  return NextResponse.json({
    companyId: context.company.id,
    sources: sourceRows.map((row) => ({ ...row, metadata: json(row.metadata, {}) })),
    observations: observationRows.map((row) => ({ ...row, attributes: json(row.attributes, {}) })),
    entities: entityRows.map((row) => ({ ...row, attributes: json(row.attributes, {}) })),
    relationships: relationshipRows.map((row) => ({ ...row, attributes: json(row.attributes, {}) })),
    agreements: itemRows.filter((row) => row.type === "agreement").map(itemView),
    facts: factRows.map((row) => ({ id: row.id, companyId: row.companyId, sourceId: row.evidenceId, label: row.label, value: row.value, confidence: Number(row.confidence), status: row.status })),
    events: eventRows.map((row) => ({ id: row.id, companyId: row.companyId, sourceId: row.evidenceId ?? undefined, effectiveDate: row.transactionDate ?? `${row.month}-01`, amount: row.amount, currency: "USD", direction: row.direction, description: row.description, category: row.category, financialCategory: row.financialCategory ?? undefined, counterpartyEntityId: row.counterpartyEntityId ?? undefined, settlesItemId: row.settlesItemId ?? undefined, accountingTreatment: row.accountingTreatment as "cash" | "accrual" | "prepaid", actual: row.isActual === "Y" })),
    obligations: itemRows.filter((row) => row.type === "obligation").map(itemView),
    decisions: decisionRows,
    policies: policyRows.map((row) => ({ ...row, active: row.active === "Y" })),
    assumptions: assumptionRows.map((row) => ({ ...row, active: row.active === "Y" })),
    scenarios: scenarioRows.map((row) => ({ ...row, assumptions: json(row.assumptionIds, []), active: row.active === "Y" })),
    reviewItems: reviewRows.map((row) => ({ id: row.id, companyId: row.companyId, sourceId: row.evidenceId ?? undefined, question: row.question, status: row.status === "open" ? "pending" : row.status })),
    allocations: allocationRows,
  });
}
