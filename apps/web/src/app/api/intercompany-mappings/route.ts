import { auth } from "@/lib/auth";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { chartAccounts, entities, getDatabase, intercompanyAccountMappings } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";
import { refreshCurrentCalculationRun } from "@/lib/refresh-calculation-run";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const mapping = z.object({ fromEntityId: z.string().uuid(), toEntityId: z.string().uuid(), receivableAccountId: z.string().uuid(), payableAccountId: z.string().uuid(), effectiveFrom: month, effectiveTo: month.optional() }).refine((value) => value.fromEntityId !== value.toEntityId, "Intercompany entities must differ").refine((value) => !value.effectiveTo || value.effectiveTo >= value.effectiveFrom, "Effective range is invalid");

/** CFO-approved reciprocal account maps; no counterparty is inferred from account names. */
export async function GET() {
  await auth.protect(); const context = await requireCompanyAccess(); const db = getDatabase();
  const rows = await db.select({ id: intercompanyAccountMappings.id, fromEntityId: intercompanyAccountMappings.fromEntityId, toEntityId: intercompanyAccountMappings.toEntityId, receivableAccountId: intercompanyAccountMappings.receivableAccountId, payableAccountId: intercompanyAccountMappings.payableAccountId, effectiveFrom: intercompanyAccountMappings.effectiveFrom, effectiveTo: intercompanyAccountMappings.effectiveTo, active: intercompanyAccountMappings.active, fromName: entities.name, receivableCode: chartAccounts.code, receivableName: chartAccounts.name }).from(intercompanyAccountMappings).innerJoin(entities, eq(intercompanyAccountMappings.fromEntityId, entities.id)).innerJoin(chartAccounts, eq(intercompanyAccountMappings.receivableAccountId, chartAccounts.id)).where(eq(intercompanyAccountMappings.companyId, context.company.id));
  return NextResponse.json({ mappings: rows });
}

export async function POST(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess(); const parsed = mapping.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "A complete reciprocal account mapping is required.", details: parsed.error.flatten() }, { status: 400 });
  const db = getDatabase(); const ids = [parsed.data.fromEntityId, parsed.data.toEntityId]; const accountIds = [parsed.data.receivableAccountId, parsed.data.payableAccountId];
  const [entityRows, accountRows] = await Promise.all([db.select({ id: entities.id, type: entities.type }).from(entities).where(eq(entities.companyId, context.company.id)), db.select({ id: chartAccounts.id }).from(chartAccounts).where(eq(chartAccounts.companyId, context.company.id))]);
  if (!ids.every((id) => entityRows.some((entity) => entity.id === id && entity.type === "legal_entity")) || !accountIds.every((id) => accountRows.some((account) => account.id === id))) return NextResponse.json({ error: "Entities and chart accounts must belong to this company." }, { status: 404 });
  const [created] = await db.insert(intercompanyAccountMappings).values({ companyId: context.company.id, ...parsed.data }).returning();
  const calculationRun = await refreshCurrentCalculationRun(context.company.id);
  return NextResponse.json({ mapping: created, calculationRun }, { status: 201 });
}
