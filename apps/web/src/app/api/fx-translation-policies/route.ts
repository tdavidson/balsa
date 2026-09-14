import { auth } from "@/lib/auth";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { approvalEvents, chartAccounts, evidence, factRecords, fxTranslationPolicies, getDatabase, sources } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";
import { refreshCurrentCalculationRun } from "@/lib/refresh-calculation-run";

const currency = z.string().regex(/^[A-Z]{3}$/);
const rateType = z.enum(["spot", "average", "closing", "historical"]);
const create = z.object({ name: z.string().trim().min(1).max(160), presentationCurrency: currency, incomeRateType: z.enum(["spot", "average"]), monetaryRateType: z.enum(["spot", "closing"]), equityRateType: z.enum(["spot", "historical"]), ctaAccountId: z.string().uuid(), fxGainLossAccountId: z.string().uuid(), sourceId: z.string().uuid().optional(), evidenceId: z.string().uuid().optional(), factId: z.string().uuid().optional() }).refine((value) => value.sourceId || value.evidenceId || value.factId, { message: "An FX policy requires source, evidence, or fact lineage." });
const update = z.object({ id: z.string().uuid(), status: z.enum(["approved", "rejected"]), approvalEventId: z.string().uuid().optional() });

export async function GET() {
  await auth.protect(); const context = await requireCompanyAccess();
  const policies = await getDatabase().select().from(fxTranslationPolicies).where(eq(fxTranslationPolicies.companyId, context.company.id));
  return NextResponse.json({ policies });
}

export async function POST(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess(); const body = create.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: "Invalid FX translation policy", details: body.error.flatten() }, { status: 400 });
  const db = getDatabase(); const ids = [body.data.ctaAccountId, body.data.fxGainLossAccountId];
  const accounts = await db.select({ id: chartAccounts.id }).from(chartAccounts).where(and(eq(chartAccounts.companyId, context.company.id), inArray(chartAccounts.id, ids)));
  if (accounts.length !== ids.length) return NextResponse.json({ error: "FX policy accounts must belong to this company." }, { status: 400 });
  if (body.data.sourceId && !(await db.select({ id: sources.id }).from(sources).where(and(eq(sources.id, body.data.sourceId), eq(sources.companyId, context.company.id))).limit(1))[0]) return NextResponse.json({ error: "FX policy source does not belong to this company." }, { status: 400 });
  if (body.data.evidenceId && !(await db.select({ id: evidence.id }).from(evidence).where(and(eq(evidence.id, body.data.evidenceId), eq(evidence.companyId, context.company.id))).limit(1))[0]) return NextResponse.json({ error: "FX policy evidence does not belong to this company." }, { status: 400 });
  if (body.data.factId && !(await db.select({ id: factRecords.id }).from(factRecords).where(and(eq(factRecords.id, body.data.factId), eq(factRecords.companyId, context.company.id))).limit(1))[0]) return NextResponse.json({ error: "FX policy fact does not belong to this company." }, { status: 400 });
  const [policy] = await db.insert(fxTranslationPolicies).values({ companyId: context.company.id, ...body.data }).returning();
  return NextResponse.json({ policy }, { status: 201 });
}

export async function PATCH(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess(); const body = update.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ error: "Invalid FX translation-policy update" }, { status: 400 });
  const db = getDatabase(); const [policy] = await db.select().from(fxTranslationPolicies).where(and(eq(fxTranslationPolicies.id, body.data.id), eq(fxTranslationPolicies.companyId, context.company.id))).limit(1);
  if (!policy) return NextResponse.json({ error: "FX translation policy not found" }, { status: 404 });
  if (body.data.status === "approved") {
    if (!body.data.approvalEventId) return NextResponse.json({ error: "Approving an FX policy requires a CFO approval event." }, { status: 400 });
    const [approval] = await db.select({ id: approvalEvents.id, evidenceId: approvalEvents.evidenceId, factId: approvalEvents.factId, action: approvalEvents.action }).from(approvalEvents).where(and(eq(approvalEvents.id, body.data.approvalEventId), eq(approvalEvents.companyId, context.company.id))).limit(1);
    if (!policy.evidenceId && !policy.factId) return NextResponse.json({ error: "An FX policy must have approved evidence or a fact before it can affect reporting." }, { status: 409 });
    if (!approval || approval.action !== "approved" || (policy.evidenceId && approval.evidenceId !== policy.evidenceId) || (policy.factId && approval.factId !== policy.factId)) return NextResponse.json({ error: "Approval must be a recorded approval for this company and match the policy evidence." }, { status: 409 });
  }
  const [updated] = await db.update(fxTranslationPolicies).set({ status: body.data.status, approvalEventId: body.data.approvalEventId, updatedAt: new Date() }).where(eq(fxTranslationPolicies.id, policy.id)).returning();
  const calculationRun = await refreshCurrentCalculationRun(context.company.id);
  return NextResponse.json({ policy: updated, calculationRun });
}
