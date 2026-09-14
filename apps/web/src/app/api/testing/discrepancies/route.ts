import { auth } from "@/lib/auth";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDatabase, testingDiscrepancies } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";

const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const discrepancy = z.object({ period, statementSection: z.string().trim().min(1).max(80), figureLabel: z.string().trim().min(1).max(160), expectedValue: z.string().trim().min(1).max(160), observedValue: z.string().trim().min(1).max(160), sourceEvidence: z.string().trim().min(1).max(2_000), graphNodeKey: z.string().trim().max(200).optional(), suspectedLayer: z.enum(["adapter", "source_classification", "mapping_policy", "journal_posting", "calculation", "presentation"]), notes: z.string().trim().max(4_000).optional() });

export async function GET(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess(); const selectedPeriod = new URL(request.url).searchParams.get("period");
  const conditions = [eq(testingDiscrepancies.companyId, context.company.id)]; if (selectedPeriod && /^\d{4}-(0[1-9]|1[0-2])$/.test(selectedPeriod)) conditions.push(eq(testingDiscrepancies.period, selectedPeriod));
  const rows = await getDatabase().select().from(testingDiscrepancies).where(and(...conditions)).orderBy(desc(testingDiscrepancies.createdAt)).limit(100);
  return NextResponse.json({ discrepancies: rows });
}

export async function POST(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess(); const parsed = discrepancy.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "A complete discrepancy record is required.", details: parsed.error.flatten() }, { status: 400 });
  const [created] = await getDatabase().insert(testingDiscrepancies).values({ companyId: context.company.id, ...parsed.data }).returning();
  return NextResponse.json({ discrepancy: created }, { status: 201 });
}
