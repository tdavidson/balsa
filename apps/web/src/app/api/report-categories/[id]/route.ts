import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { chartAccounts, getDatabase, recordAudit, reportCategories } from "@finance/database";
import { auth, requireCompanyAccess } from "@/lib/auth";

async function findCategory(companyId: string, id: string) {
  return (await getDatabase().select().from(reportCategories).where(and(eq(reportCategories.companyId, companyId), eq(reportCategories.id, id))).limit(1))[0] ?? null;
}

const body = z.object({ name: z.string().trim().min(1).max(80).optional(), sortOrder: z.number().int().min(0).max(10_000).optional() }).refine((value) => value.name !== undefined || value.sortOrder !== undefined);

/** Rename or reorder a category. Its line never changes, so the accounts in it stay valid. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Provide a new name or position." }, { status: 400 });
  const existing = await findCategory(context.company.id, (await params).id);
  if (!existing) return NextResponse.json({ error: "Category not found" }, { status: 404 });
  try {
    const category = await getDatabase().transaction(async (tx) => {
      const [updated] = await tx.update(reportCategories).set({ ...parsed.data, updatedAt: new Date() }).where(and(eq(reportCategories.companyId, context.company.id), eq(reportCategories.id, existing.id))).returning();
      await recordAudit(tx, { companyId: context.company.id, actorUserId: context.user.id, via: "ui", action: "report_category.changed", entityType: "report_category", entityId: existing.id, summary: parsed.data.name && parsed.data.name !== existing.name ? `Renamed the ${existing.name} category to ${parsed.data.name}` : `Moved the ${existing.name} category`, before: { name: existing.name, sortOrder: existing.sortOrder }, after: { name: updated!.name, sortOrder: updated!.sortOrder } });
      return updated!;
    });
    return NextResponse.json({ category });
  } catch {
    return NextResponse.json({ error: `This line already has a category named ${parsed.data.name}.` }, { status: 409 });
  }
}

/** Remove a category. Its accounts keep their line and become uncategorized. */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const existing = await findCategory(context.company.id, (await params).id);
  if (!existing) return NextResponse.json({ error: "Category not found" }, { status: 404 });
  const released = await getDatabase().transaction(async (tx) => {
    const accounts = await tx.update(chartAccounts).set({ reportCategoryId: null, updatedAt: new Date() }).where(and(eq(chartAccounts.companyId, context.company.id), eq(chartAccounts.reportCategoryId, existing.id))).returning({ id: chartAccounts.id });
    await tx.delete(reportCategories).where(and(eq(reportCategories.companyId, context.company.id), eq(reportCategories.id, existing.id)));
    await recordAudit(tx, { companyId: context.company.id, actorUserId: context.user.id, via: "ui", action: "report_category.deleted", entityType: "report_category", entityId: existing.id, summary: `Removed the ${existing.name} category${accounts.length ? `; ${accounts.length} account${accounts.length === 1 ? "" : "s"} now uncategorized` : ""}`, before: { line: existing.line, name: existing.name, accountIds: accounts.map((account) => account.id) } });
    return accounts.length;
  });
  return NextResponse.json({ deleted: true, uncategorizedAccounts: released });
}
