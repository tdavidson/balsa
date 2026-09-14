import { auth } from "@/lib/auth";
import { and, asc, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDatabase, postingRuleApplications, postingRules, sourceRows } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";
import { previewSourceRowReprocessing } from "@/lib/source-row-reprocess";

export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const sourceId = new URL(request.url).searchParams.get("sourceId");
  if (!sourceId) return NextResponse.json({ error: "sourceId is required" }, { status: 400 });
  const db = getDatabase();
  const [rows, rules, applications] = await Promise.all([
    db.select({ id: sourceRows.id, period: sourceRows.period, description: sourceRows.description, direction: sourceRows.direction, rawJson: sourceRows.rawJson }).from(sourceRows).where(and(eq(sourceRows.companyId, context.company.id), eq(sourceRows.sourceId, sourceId))).orderBy(desc(sourceRows.transactionDate)),
    db.select().from(postingRules).where(and(eq(postingRules.companyId, context.company.id), eq(postingRules.active, "Y"))).orderBy(asc(postingRules.priority)),
    db.select({ sourceRowId: postingRuleApplications.sourceRowId, postingRuleId: postingRuleApplications.postingRuleId, ruleSnapshot: postingRuleApplications.ruleSnapshot, createdAt: postingRuleApplications.createdAt }).from(postingRuleApplications).where(eq(postingRuleApplications.companyId, context.company.id)),
  ]);
  const preview = previewSourceRowReprocessing(rows.map((row) => {
    let category: string | undefined;
    try { category = (JSON.parse(row.rawJson) as { category?: string }).category; } catch { /* unsupported raw row remains visible */ }
    return { id: row.id, period: row.period, description: row.description, direction: row.direction, ...(category ? { category } : {}) };
  }), rules, applications);
  const summary = Object.fromEntries(["unchanged", "newly_matched", "changed", "no_longer_matched", "unmatched", "ambiguous", "unsupported"].map((outcome) => [outcome, preview.filter((row) => row.outcome === outcome).length]));
  return NextResponse.json({ sourceId, summary, rows: preview });
}
