import { and, asc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDatabase, recordAudit, reportCategories } from "@finance/database";
import { isStandardLineId, standardLineDefinition } from "@balsa/finance-engine";
import { auth, requireCompanyAccess } from "@/lib/auth";

export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const categories = await getDatabase().select().from(reportCategories).where(eq(reportCategories.companyId, context.company.id)).orderBy(asc(reportCategories.line), asc(reportCategories.sortOrder), asc(reportCategories.name));
  return NextResponse.json({ categories });
}

const body = z.object({ line: z.string(), name: z.string().trim().min(1).max(80) });

/** A new category goes at the end of its line. */
export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || !isStandardLineId(parsed.data.line)) return NextResponse.json({ error: "A category needs a statement line and a name of up to 80 characters." }, { status: 400 });
  const { line, name } = parsed.data;
  const db = getDatabase();
  try {
    const category = await db.transaction(async (tx) => {
      const [{ next } = { next: 0 }] = await tx.select({ next: sql<number>`coalesce(max(${reportCategories.sortOrder}), 0) + 1` }).from(reportCategories).where(and(eq(reportCategories.companyId, context.company.id), eq(reportCategories.line, line)));
      const [created] = await tx.insert(reportCategories).values({ companyId: context.company.id, line, name, sortOrder: Number(next) }).returning();
      await recordAudit(tx, { companyId: context.company.id, actorUserId: context.user.id, via: "ui", action: "report_category.created", entityType: "report_category", entityId: created!.id, summary: `Added the ${name} category under ${standardLineDefinition(line).label}`, after: { line, name } });
      return created!;
    });
    return NextResponse.json({ category }, { status: 201 });
  } catch {
    return NextResponse.json({ error: `${standardLineDefinition(line).label} already has a category named ${name}.` }, { status: 409 });
  }
}
