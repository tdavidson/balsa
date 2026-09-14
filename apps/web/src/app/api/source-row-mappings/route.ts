import { auth } from "@/lib/auth";
import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { chartAccounts, factRecords, getDatabase, sourceRowMappings, sourceRows } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";

const body = z.object({ sourceRowId: z.string().uuid().optional(), factId: z.string().uuid().optional(), chartAccountId: z.string().uuid().optional(), offsetAccountId: z.string().uuid().optional(), mappingType: z.enum(["account_balance", "journal_template", "counterparty", "recognition"]), template: z.record(z.string(), z.unknown()), decisionId: z.string().uuid().optional(), policyId: z.string().uuid().optional(), effectiveFrom: z.string().regex(/^\d{4}-\d{2}$/).optional(), effectiveTo: z.string().regex(/^\d{4}-\d{2}$/).optional(), supersedesId: z.string().uuid().optional() }).refine((value) => value.sourceRowId || value.factId, "A source row or fact is required");

export async function GET() {
  await auth.protect(); const context = await requireCompanyAccess();
  const mappings = await getDatabase().select().from(sourceRowMappings).where(eq(sourceRowMappings.companyId, context.company.id)).orderBy(desc(sourceRowMappings.createdAt)).limit(200);
  return NextResponse.json({ mappings });
}

export async function POST(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess();
  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid source-row mapping", details: parsed.error.flatten() }, { status: 400 });
  const value = parsed.data; const db = getDatabase();
  const sourceRow = value.sourceRowId ? (await db.select({ id: sourceRows.id, period: sourceRows.period }).from(sourceRows).where(and(eq(sourceRows.id, value.sourceRowId), eq(sourceRows.companyId, context.company.id))).limit(1))[0] : undefined;
  if (value.sourceRowId && !sourceRow) return NextResponse.json({ error: "Source row not found" }, { status: 404 });
  if (value.factId && !(await db.select({ id: factRecords.id }).from(factRecords).where(and(eq(factRecords.id, value.factId), eq(factRecords.companyId, context.company.id))).limit(1))[0]) return NextResponse.json({ error: "Fact not found" }, { status: 404 });
  const accountIds = [value.chartAccountId, value.offsetAccountId].filter((id): id is string => Boolean(id));
  if (accountIds.length && (await db.select({ id: chartAccounts.id }).from(chartAccounts).where(and(eq(chartAccounts.companyId, context.company.id), inArray(chartAccounts.id, accountIds)))).length !== accountIds.length) return NextResponse.json({ error: "Mapping account not found" }, { status: 404 });
  if (value.supersedesId && !(await db.select({ id: sourceRowMappings.id }).from(sourceRowMappings).where(and(eq(sourceRowMappings.id, value.supersedesId), eq(sourceRowMappings.companyId, context.company.id), eq(sourceRowMappings.status, "approved"))).limit(1))[0]) return NextResponse.json({ error: "Superseded mapping must be an approved company mapping" }, { status: 409 });
  const prior = await db.select({ version: sourceRowMappings.version }).from(sourceRowMappings).where(and(eq(sourceRowMappings.companyId, context.company.id), eq(sourceRowMappings.mappingType, value.mappingType), value.sourceRowId ? eq(sourceRowMappings.sourceRowId, value.sourceRowId) : eq(sourceRowMappings.factId, value.factId!)));
  const version = String(Math.max(0, ...prior.map((row) => Number(row.version) || 0)) + 1);
  const [mapping] = await db.insert(sourceRowMappings).values(JSON.parse(JSON.stringify({ companyId: context.company.id, ...value, supersedesId: value.supersedesId, templateJson: JSON.stringify(value.template), version, status: "draft" }))).returning();
  return NextResponse.json({ mapping }, { status: 201 });
}
