import { auth } from "@/lib/auth";
import { requireCompanyAccess } from "@/lib/auth";
import { evidence, getDatabase, sources } from "@finance/database";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { recordReferenceWorkbookKnowledge } from "@/lib/company-knowledge";

const worksheetRole = z.enum(["historical_statement", "chart_of_accounts", "forecast_drivers", "schedule", "presentation", "reference_only", "exclude"]);
const body = z.object({ worksheetRoles: z.record(z.string().min(1).max(255), worksheetRole) });

type SourceMetadata = {
  sourceRole?: string;
  classification?: { kind?: string };
  workbook?: { worksheets?: { name: string }[] };
  workbookReview?: Record<string, z.infer<typeof worksheetRole>>;
  [key: string]: unknown;
};

/**
 * A workbook review is a CFO-approved map of what each worksheet is for.
 * It is intentionally metadata only: no role can post a spreadsheet figure.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid worksheet review", details: parsed.error.flatten() }, { status: 400 });

  const { id } = await params;
  const db = getDatabase();
  const [document] = await db.select({ sourceId: evidence.sourceId, metadata: sources.metadata }).from(evidence).innerJoin(sources, eq(evidence.sourceId, sources.id)).where(and(eq(evidence.id, id), eq(evidence.companyId, context.company.id))).limit(1);
  if (!document?.sourceId) return NextResponse.json({ error: "Document source not found" }, { status: 404 });

  let metadata: SourceMetadata;
  try { metadata = JSON.parse(document.metadata ?? "{}") as SourceMetadata; } catch { metadata = {}; }
  if (metadata.sourceRole !== "reference_model" && metadata.classification?.kind !== "financial_model") return NextResponse.json({ error: "Worksheet review is available only for financial models" }, { status: 409 });

  const worksheetNames = new Set((metadata.workbook?.worksheets ?? []).map((sheet) => sheet.name));
  if (!worksheetNames.size) return NextResponse.json({ error: "Workbook structure is not available yet" }, { status: 409 });
  const invalidNames = Object.keys(parsed.data.worksheetRoles).filter((name) => !worksheetNames.has(name));
  if (invalidNames.length) return NextResponse.json({ error: "Worksheet review contains unknown worksheets" }, { status: 400 });

  const workbookReview = { ...(metadata.workbookReview ?? {}), ...parsed.data.worksheetRoles };
  await db.update(sources).set({ metadata: JSON.stringify({ ...metadata, workbookReview }), updatedAt: new Date() }).where(and(eq(sources.id, document.sourceId), eq(sources.companyId, context.company.id)));
  await recordReferenceWorkbookKnowledge(db, context.company.id, { evidenceId: id, worksheetRoles: workbookReview });
  return NextResponse.json({ workbookReview });
}
