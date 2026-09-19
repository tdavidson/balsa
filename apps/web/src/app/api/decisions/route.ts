import { auth } from "@/lib/auth";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { decisions, getDatabase, recordAudit, policies } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";
import { z } from "zod";
import { applyDecisionAndEnqueue, createAppliedDecisionAndEnqueue, decisionEffectSchema, describeEffect, parseStoredEffect } from "@/lib/decision-effects";

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
  try {
    const result = await createAppliedDecisionAndEnqueue(context.company.id, { question: body.data.question, answer: body.data.answer, ...(body.data.appliesTo !== undefined ? { appliesTo: body.data.appliesTo } : {}), ...(body.data.effect !== undefined ? { effect: body.data.effect } : {}) }, context.user.id);
    return NextResponse.json({ decision: result.decision, resolvedReviewCount: result.resolvedReviewCount, applied: result.mutation, calculationRun: result.calculationRun });
  } catch (error) {
    const message = (error instanceof Error ? error.message : "unknown error").slice(0, 500);
    return NextResponse.json({ error: `Decision effect failed: ${message}` }, { status: 502 });
  }
}

export async function PATCH(request: Request) {
  await auth.protect();
  const body = decisionUpdate.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: "Invalid decision update" }, { status: 400 });
  const context = await requireCompanyAccess();
  if (body.data.status === "applied") {
    try {
      const result = await applyDecisionAndEnqueue(context.company.id, body.data.id, context.user.id);
      return NextResponse.json(result);
    } catch (error) {
      const message = (error instanceof Error ? error.message : "unknown error").slice(0, 500);
      if (message === "Decision not found") return NextResponse.json({ error: message }, { status: 404 });
      return NextResponse.json({ error: `Decision effect failed: ${message}` }, { status: 502 });
    }
  }
  const result = await getDatabase().transaction(async (tx) => {
    const [decision] = await tx.update(decisions).set({ status: body.data.status, updatedAt: new Date() }).where(and(eq(decisions.id, body.data.id), eq(decisions.companyId, context.company.id))).returning();
    if (decision && body.data.status === "rejected") await recordAudit(tx, { companyId: context.company.id, actorUserId: context.user.id, via: "ui", action: "decision.rejected", entityType: "decision", entityId: decision.id, summary: `Rejected decision: ${decision.question.slice(0, 120)}`, after: { status: "rejected" } });
    return decision;
  });
  if (!result) return NextResponse.json({ error: "Decision not found" }, { status: 404 });
  return NextResponse.json({ decision: result, mutation: null, calculationRun: null });
}
