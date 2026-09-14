import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/auth";
import { loadIntercompanyEliminationPreview } from "@/lib/intercompany-eliminations";
import { postIntercompanyElimination } from "@/lib/post-intercompany-elimination";
import { loadConsolidatedJournalReport } from "@/lib/consolidated-journal-report";

export async function GET(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess(); const period = new URL(request.url).searchParams.get("period");
  if (!period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return NextResponse.json({ error: "period must be YYYY-MM" }, { status: 400 });
  const [preview, report] = await Promise.all([loadIntercompanyEliminationPreview(context.company.id, period), loadConsolidatedJournalReport(context.company.id, period)]);
  return NextResponse.json({ ...preview, report });
}

export async function POST(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess(); const body = await request.json().catch(() => null) as { period?: unknown; mappingId?: unknown } | null;
  if (!body || typeof body.period !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.period) || typeof body.mappingId !== "string") return NextResponse.json({ error: "period and mappingId are required." }, { status: 400 });
  const result = await postIntercompanyElimination({ companyId: context.company.id, userId: context.user.id, period: body.period, mappingId: body.mappingId });
  if (!result.ok) return NextResponse.json({ error: "Intercompany elimination cannot be posted.", blockers: result.blockers }, { status: 409 });
  return NextResponse.json(result, { status: result.idempotent ? 200 : 201 });
}
