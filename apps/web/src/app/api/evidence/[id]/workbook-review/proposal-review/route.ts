import { auth } from "@/lib/auth";
import { requireCompanyAccess } from "@/lib/auth";
import { approvalEvents, evidence, getDatabase, sources } from "@finance/database";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

const body = z.object({ proposalId: z.string().regex(/^(account|history|driver|question)-\d+$/), status: z.enum(["approved", "rejected"]) });
type Metadata = { sourceRole?: string; classification?: { kind?: string }; workbookProposal?: { chartAccountMappings?: unknown[]; historicalCoverage?: unknown[]; forecastDrivers?: unknown[]; questions?: unknown[] }; workbookProposalReview?: Record<string, "approved" | "rejected">; [key: string]: unknown };

/** Records a CFO disposition for one advisory workbook proposal. It never applies the suggestion. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid proposal review", details: parsed.error.flatten() }, { status: 400 });
  const { id } = await params;
  const db = getDatabase();
  const [document] = await db.select({ sourceId: evidence.sourceId, metadata: sources.metadata }).from(evidence).innerJoin(sources, eq(evidence.sourceId, sources.id)).where(and(eq(evidence.id, id), eq(evidence.companyId, context.company.id))).limit(1);
  if (!document?.sourceId) return NextResponse.json({ error: "Document source not found" }, { status: 404 });
  let metadata: Metadata;
  try { metadata = JSON.parse(document.metadata ?? "{}") as Metadata; } catch { metadata = {}; }
  if (metadata.sourceRole !== "reference_model" && metadata.classification?.kind !== "financial_model") return NextResponse.json({ error: "Proposal review is available only for financial models" }, { status: 409 });
  const [, type, number] = parsed.data.proposalId.match(/^(account|history|driver|question)-(\d+)$/) ?? [];
  const index = Number(number) - 1;
  const collection = type === "account" ? metadata.workbookProposal?.chartAccountMappings : type === "history" ? metadata.workbookProposal?.historicalCoverage : type === "driver" ? metadata.workbookProposal?.forecastDrivers : metadata.workbookProposal?.questions;
  if (!Number.isInteger(index) || index < 0 || !collection?.[index]) return NextResponse.json({ error: "Workbook proposal not found" }, { status: 404 });
  const workbookProposalReview = { ...(metadata.workbookProposalReview ?? {}), [parsed.data.proposalId]: parsed.data.status };
  await db.update(sources).set({ metadata: JSON.stringify({ ...metadata, workbookProposalReview }), updatedAt: new Date() }).where(and(eq(sources.id, document.sourceId), eq(sources.companyId, context.company.id)));
  await db.insert(approvalEvents).values({ companyId: context.company.id, evidenceId: id, userId: context.user.id, layer: "workbook_proposal", action: parsed.data.status, nextValue: parsed.data.proposalId, metadata: JSON.stringify({ proposalType: type }) });
  return NextResponse.json({ workbookProposalReview });
}
