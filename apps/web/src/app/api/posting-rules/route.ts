import { auth } from "@/lib/auth";
import { and, asc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { chartAccounts, decisions, entities, getDatabase, policies, postingRules } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";

const body = z.object({ name: z.string().min(1), descriptionPattern: z.string().min(2), direction: z.enum(["receipt", "spend"]).optional(), activity: z.enum(["operating", "transfer", "investment", "financing"]).optional(), cashAccountId: z.string().uuid(), offsetAccountId: z.string().uuid(), entityId: z.string().uuid().optional(), policyId: z.string().uuid().optional(), decisionId: z.string().uuid().optional(), priority: z.number().int().min(0).max(10000).default(100), effectiveFrom: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(), effectiveTo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() });

export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  return NextResponse.json({ rules: await getDatabase().select().from(postingRules).where(eq(postingRules.companyId, context.company.id)).orderBy(asc(postingRules.priority), asc(postingRules.name)) });
}

export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid posting rule", details: parsed.error.flatten() }, { status: 400 });
  const value = parsed.data;
  const accountIds = [value.cashAccountId, value.offsetAccountId];
  if ((await getDatabase().select({ id: chartAccounts.id }).from(chartAccounts).where(and(eq(chartAccounts.companyId, context.company.id), eq(chartAccounts.active, "Y"), inArray(chartAccounts.id, accountIds)))).length !== 2) return NextResponse.json({ error: "Both rule accounts must be active company accounts." }, { status: 404 });
  if (value.entityId && !(await getDatabase().select({ id: entities.id }).from(entities).where(and(eq(entities.id, value.entityId), eq(entities.companyId, context.company.id))).limit(1))[0]) return NextResponse.json({ error: "Rule entity not found." }, { status: 404 });
  if (value.policyId && !(await getDatabase().select({ id: policies.id }).from(policies).where(and(eq(policies.id, value.policyId), eq(policies.companyId, context.company.id))).limit(1))[0]) return NextResponse.json({ error: "Rule policy not found." }, { status: 404 });
  if (value.decisionId && !(await getDatabase().select({ id: decisions.id }).from(decisions).where(and(eq(decisions.id, value.decisionId), eq(decisions.companyId, context.company.id))).limit(1))[0]) return NextResponse.json({ error: "Rule decision not found." }, { status: 404 });
  const [rule] = await getDatabase().insert(postingRules).values(JSON.parse(JSON.stringify({ companyId: context.company.id, ...value, priority: String(value.priority) }))).returning();
  return NextResponse.json({ rule }, { status: 201 });
}
