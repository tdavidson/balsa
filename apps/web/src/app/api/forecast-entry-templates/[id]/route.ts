import { auth } from "@/lib/auth";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { forecastEntryTemplates, getDatabase } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";

/**
 * Forecast templates are accounting mappings, not mutable presentation data.
 * Create a successor for a changed mapping; deactivation preserves the exact
 * template used by historical projected entries.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const { id } = await params;
  const [template] = await getDatabase().update(forecastEntryTemplates).set({ active: "N", updatedAt: new Date() }).where(and(eq(forecastEntryTemplates.id, id), eq(forecastEntryTemplates.companyId, context.company.id))).returning();
  if (!template) return NextResponse.json({ error: "Forecast-entry template not found." }, { status: 404 });
  return NextResponse.json({ template, deactivated: true });
}
