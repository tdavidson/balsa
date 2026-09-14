import { auth } from "@/lib/auth";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { evidence, getDatabase, sourceRows, sources } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";

/** Immutable normalized import rows for reconciliation and journal trace. */
export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const url = new URL(request.url);
  const sourceId = url.searchParams.get("sourceId");
  const evidenceId = url.searchParams.get("evidenceId");
  const period = url.searchParams.get("period");
  const rows = await getDatabase().select({ row: sourceRows, sourceName: sources.filename, evidenceName: evidence.sourceName }).from(sourceRows).leftJoin(sources, eq(sourceRows.sourceId, sources.id)).leftJoin(evidence, eq(sourceRows.evidenceId, evidence.id)).where(and(eq(sourceRows.companyId, context.company.id), ...(sourceId ? [eq(sourceRows.sourceId, sourceId)] : []), ...(evidenceId ? [eq(sourceRows.evidenceId, evidenceId)] : []), ...(period ? [eq(sourceRows.period, period)] : []))).orderBy(desc(sourceRows.transactionDate), desc(sourceRows.createdAt)).limit(500);
  return NextResponse.json({ rows: rows.map(({ row, sourceName, evidenceName }) => ({ ...row, sourceName, evidenceName, rawJson: undefined })) });
}
