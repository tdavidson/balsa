import { auth } from "@/lib/auth";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { decisions, getDatabase, recordAudit, policies, reviewItems, assumptions, economicItems } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";
import { z } from "zod";
import { applyDecisionIfEffective, decisionEffectSchema, describeEffect, parseStoredEffect } from "@/lib/decision-effects";
import { refreshCurrentCalculationRun } from "@/lib/refresh-calculation-run";

const decisionUpdate = z.object({ id: z.string().uuid(), status: z.enum(["proposed", "applied", "rejected"]) });
const decisionCreate = z.object({ question: z.string().trim().min(1).max(20_000), answer: z.string().trim().min(1).max(20_000), appliesTo: z.string().trim().max(500).optional(), effect: decisionEffectSchema.optional() });

export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const rows = await getDatabase().select().from(decisions).where(eq(decisions.companyId, context.company.id)).orderBy(desc(decisions.createdAt));
  const policyRows = await getDatabase().select().from(policies).where(and(eq(policies.companyId, context.company.id), eq(policies.active, "Y")));
  return NextResponse.json({ decisions: rows.map((row) => ({ ...row, effectSummary: describeEffect(parseStoredEffect(row.effect)) })), policies: policyRows });
}

export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const body = decisionCreate.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: "question and answer are required" }, { status: 400 });
  const data = body.data;
  const [decision] = await getDatabase().insert(decisions).values({ companyId: context.company.id, question: data.question, answer: data.answer, appliesTo: data.appliesTo || undefined, effect: data.effect ? JSON.stringify(data.effect) : undefined, createdByUserId: context.user.id }).returning();
  const resolvedReviews = await getDatabase().update(reviewItems).set({ answer: data.answer, status: "resolved", updatedAt: new Date() }).where(and(eq(reviewItems.companyId, context.company.id), eq(reviewItems.question, data.question), eq(reviewItems.status, "open"))).returning({ id: reviewItems.id });
  // A decision typed by the CFO is applied on creation; run its effect now.
  const applied = decision && data.effect ? await applyDecisionIfEffective(context.company.id, decision.id, context.user.id).catch((error: unknown) => ({ applied: `failed: ${error instanceof Error ? error.message : "unknown error"}` })) : null;
  const calculationRun = data.effect ? await refreshCurrentCalculationRun(context.company.id) : null;
  return NextResponse.json({ decision, resolvedReviewCount: resolvedReviews.length, applied, calculationRun });
}

export async function PATCH(request: Request) {
  await auth.protect();
  const body = decisionUpdate.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: "Invalid decision update" }, { status: 400 });
  const context = await requireCompanyAccess();
  const [decision] = await getDatabase().update(decisions).set({ status: body.data.status, updatedAt: new Date() }).where(and(eq(decisions.id, body.data.id), eq(decisions.companyId, context.company.id))).returning();
  if (!decision) return NextResponse.json({ error: "Decision not found" }, { status: 404 });
  // The status change is the primary write; the effect below may still fail, so
  // the log records what the CFO decided, not whether the effect landed.
  if (body.data.status !== "proposed") await recordAudit(getDatabase(), { companyId: context.company.id, actorUserId: context.user.id, via: "ui", action: `decision.${body.data.status}`, entityType: "decision", entityId: decision.id, summary: `${body.data.status === "applied" ? "Applied" : "Rejected"} decision: ${decision.question.slice(0, 120)}`, after: { status: body.data.status } });
  let mutation = null;
  if (body.data.status === "applied" && decision.effect) {
    try { mutation = await applyDecisionIfEffective(context.company.id, decision.id, context.user.id); } catch (error) { return NextResponse.json({ error: `Decision recorded, but its effect failed: ${error instanceof Error ? error.message : "unknown error"}`, decision }, { status: 502 }); }
  }
  if (body.data.status === "applied" && decision.appliesTo) {
    const target = decision.appliesTo.match(/^(assumption|economic_item):([0-9a-f-]{36})=(.+)$/i);
    if (target?.[1] === "assumption") {
      const row = (await getDatabase().update(assumptions).set({ value: target[3]!, updatedAt: new Date() }).where(and(eq(assumptions.id, target[2]!), eq(assumptions.companyId, context.company.id))).returning())[0];
      mutation = row ? { kind: "assumption", id: row.id } : null;
    } else if (target?.[1] === "economic_item") {
      const row = (await getDatabase().update(economicItems).set({ cadence: target[3]!, updatedAt: new Date() }).where(and(eq(economicItems.id, target[2]!), eq(economicItems.companyId, context.company.id))).returning())[0];
      mutation = row ? { kind: "economic_item", id: row.id } : null;
    }
  }
  const calculationRun = mutation ? await refreshCurrentCalculationRun(context.company.id) : null;
  return NextResponse.json({ decision, mutation, calculationRun });
}
