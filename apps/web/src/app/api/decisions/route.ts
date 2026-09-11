import { auth } from "@clerk/nextjs/server";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { decisions, getDatabase, knowledgeDocuments, policies, reviewItems, assumptions, economicItems } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";
import { z } from "zod";
import { applyDecisionIfEffective, decisionEffectSchema, describeEffect, parseStoredEffect } from "@/lib/decision-effects";

const decisionUpdate = z.object({ id: z.string().uuid(), status: z.enum(["proposed", "applied", "rejected"]) });

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
  const body = (await request.json()) as { question?: string; answer?: string; appliesTo?: string; policyName?: string; policyRule?: string; effect?: unknown };
  if (!body.question?.trim() || !body.answer?.trim()) return NextResponse.json({ error: "question and answer are required" }, { status: 400 });
  const effect = body.effect ? decisionEffectSchema.safeParse(body.effect) : undefined;
  if (effect && !effect.success) return NextResponse.json({ error: "Invalid decision effect", details: effect.error.flatten() }, { status: 400 });
  const [decision] = await getDatabase().insert(decisions).values({ companyId: context.company.id, question: body.question.trim(), answer: body.answer.trim(), appliesTo: body.appliesTo?.trim() || undefined, effect: effect?.success ? JSON.stringify(effect.data) : undefined }).returning();
  const applied = decision && effect?.success ? await applyDecisionIfEffective(context.company.id, decision.id).catch((error: unknown) => ({ applied: `failed: ${error instanceof Error ? error.message : "unknown error"}` })) : null;
  const resolvedReviews = await getDatabase().update(reviewItems).set({ answer: body.answer.trim(), status: "resolved", updatedAt: new Date() }).where(and(eq(reviewItems.companyId, context.company.id), eq(reviewItems.question, body.question.trim()), eq(reviewItems.status, "open"))).returning({ id: reviewItems.id });
  let policy;
  if (decision && body.policyName?.trim() && body.policyRule?.trim()) {
    [policy] = await getDatabase().insert(policies).values({ companyId: context.company.id, decisionId: decision.id, name: body.policyName.trim(), rule: body.policyRule.trim() }).returning();
    const [doc] = await getDatabase().select({ content: knowledgeDocuments.content }).from(knowledgeDocuments).where(and(eq(knowledgeDocuments.companyId, context.company.id), eq(knowledgeDocuments.slug, "policies")));
    const addition = `- [decision:${decision.id}] ${body.policyName.trim()}: ${body.policyRule.trim()}`;
    if (doc && !doc.content.includes(`decision:${decision.id}`)) await getDatabase().update(knowledgeDocuments).set({ content: `${doc.content.trim()}\n\n## Active policies\n${addition}\n`, updatedAt: new Date() }).where(and(eq(knowledgeDocuments.companyId, context.company.id), eq(knowledgeDocuments.slug, "policies")));
  }
  return NextResponse.json({ decision, policy, resolvedReviewCount: resolvedReviews.length, applied });
}

export async function PATCH(request: Request) {
  await auth.protect();
  const body = decisionUpdate.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: "Invalid decision update" }, { status: 400 });
  const context = await requireCompanyAccess();
  const [decision] = await getDatabase().update(decisions).set({ status: body.data.status, updatedAt: new Date() }).where(and(eq(decisions.id, body.data.id), eq(decisions.companyId, context.company.id))).returning();
  if (!decision) return NextResponse.json({ error: "Decision not found" }, { status: 404 });
  let mutation = null;
  if (body.data.status === "applied" && decision.effect) {
    try { mutation = await applyDecisionIfEffective(context.company.id, decision.id); } catch (error) { return NextResponse.json({ error: `Decision recorded, but its effect failed: ${error instanceof Error ? error.message : "unknown error"}`, decision }, { status: 502 }); }
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
  return NextResponse.json({ decision, mutation });
}
