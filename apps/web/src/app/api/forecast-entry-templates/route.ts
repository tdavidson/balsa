import { auth } from "@/lib/auth";
import { and, asc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { chartAccounts, decisions, forecastEntryTemplates, getDatabase, policies } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";

const body = z.object({ name: z.string().trim().min(1).max(160), itemType: z.enum(["agreement", "obligation"]), direction: z.enum(["receipt", "spend"]), category: z.string().trim().max(80).optional(), debitAccountId: z.string().uuid(), creditAccountId: z.string().uuid(), decisionId: z.string().uuid().optional(), policyId: z.string().uuid().optional() }).refine((value) => value.debitAccountId !== value.creditAccountId, { message: "Debit and credit accounts must differ." }).refine((value) => Boolean(value.decisionId || value.policyId), { message: "An applied decision or active policy is required." });

/** Approved mappings for turning confirmed forecast drivers into balanced projected entries. */
export async function GET() {
  await auth.protect(); const context = await requireCompanyAccess();
  const templates = await getDatabase().select().from(forecastEntryTemplates).where(eq(forecastEntryTemplates.companyId, context.company.id)).orderBy(asc(forecastEntryTemplates.name));
  return NextResponse.json({ templates });
}

export async function POST(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess(); const parsed = body.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid forecast-entry template", details: parsed.error.flatten() }, { status: 400 });
  const value = parsed.data; const db = getDatabase();
  const accounts = await db.select({ id: chartAccounts.id }).from(chartAccounts).where(and(eq(chartAccounts.companyId, context.company.id), eq(chartAccounts.active, "Y"), inArray(chartAccounts.id, [value.debitAccountId, value.creditAccountId])));
  if (accounts.length !== 2) return NextResponse.json({ error: "Debit and credit accounts must be active company accounts." }, { status: 409 });
  if (value.decisionId && !(await db.select({ id: decisions.id }).from(decisions).where(and(eq(decisions.id, value.decisionId), eq(decisions.companyId, context.company.id), eq(decisions.status, "applied"))).limit(1))[0]) return NextResponse.json({ error: "Decision must be applied and belong to the company." }, { status: 409 });
  if (value.policyId && !(await db.select({ id: policies.id }).from(policies).where(and(eq(policies.id, value.policyId), eq(policies.companyId, context.company.id), eq(policies.active, "Y"))).limit(1))[0]) return NextResponse.json({ error: "Policy must be active and belong to the company." }, { status: 409 });
  const [template] = await db.insert(forecastEntryTemplates).values({ companyId: context.company.id, ...value }).returning();
  return NextResponse.json({ template }, { status: 201 });
}
