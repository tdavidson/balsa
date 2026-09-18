import { auth } from "@/lib/auth";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { decisions, getDatabase, policies, sourceRowMappings, sourceRows } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";
import { refreshCurrentCalculationRun } from "@/lib/refresh-calculation-run";

const body = z.object({ decisionId: z.string().uuid().optional(), policyId: z.string().uuid().optional() }).refine((value) => value.decisionId || value.policyId, "An applied decision or active policy is required");

/** Approval is the only transition that makes a company mapping active. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect(); const context = await requireCompanyAccess(); const parsed = body.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "An applied decision or active policy is required" }, { status: 400 });
  const { id } = await params; const db = getDatabase();
  const [mapping] = await db.select().from(sourceRowMappings).where(and(eq(sourceRowMappings.id, id), eq(sourceRowMappings.companyId, context.company.id), eq(sourceRowMappings.status, "draft"))).limit(1);
  if (!mapping) return NextResponse.json({ error: "Draft mapping not found" }, { status: 404 });
  if (parsed.data.decisionId && !(await db.select({ id: decisions.id }).from(decisions).where(and(eq(decisions.id, parsed.data.decisionId), eq(decisions.companyId, context.company.id), eq(decisions.status, "applied"))).limit(1))[0]) return NextResponse.json({ error: "Mapping decision must be applied" }, { status: 409 });
  if (parsed.data.policyId && !(await db.select({ id: policies.id }).from(policies).where(and(eq(policies.id, parsed.data.policyId), eq(policies.companyId, context.company.id), eq(policies.active, "Y"))).limit(1))[0]) return NextResponse.json({ error: "Mapping policy must be active" }, { status: 409 });
  const [approved] = await db.update(sourceRowMappings).set({ status: "approved", decisionId: parsed.data.decisionId, policyId: parsed.data.policyId, approvedByUserId: context.user.id, approvedAt: new Date(), updatedAt: new Date() }).where(and(eq(sourceRowMappings.id, mapping.id), eq(sourceRowMappings.companyId, context.company.id))).returning();
  if (mapping.supersedesId) await db.update(sourceRowMappings).set({ status: "superseded", updatedAt: new Date() }).where(and(eq(sourceRowMappings.id, mapping.supersedesId), eq(sourceRowMappings.companyId, context.company.id)));
  const periods = mapping.sourceRowId ? await db.select({ period: sourceRows.period }).from(sourceRows).where(and(eq(sourceRows.id, mapping.sourceRowId), eq(sourceRows.companyId, context.company.id))) : mapping.factId ? await db.select({ period: sourceRows.period }).from(sourceRows).where(and(eq(sourceRows.companyId, context.company.id), eq(sourceRows.factId, mapping.factId))) : [];
  const journalPeriods = periods.map((row) => row.period).filter((period): period is string => Boolean(period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period)));
  const calculationRun = await refreshCurrentCalculationRun(context.company.id, { journalPeriods, cause: { kind: "mapping_approved", subjectType: "source_row_mapping", subjectId: mapping.id, actorUserId: context.user.id, via: "ui" } });
  return NextResponse.json({ mapping: approved, calculationRun });
}
