import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/auth";
import { loadJournalCloseChecklist, postRetainedEarningsClose } from "@/lib/journal-period-close";

/** A read-only, line-linked close preview. Posting remains intentionally unavailable until its lineage table is durable. */
export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const period = new URL(request.url).searchParams.get("period");
  if (!period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return NextResponse.json({ error: "period must be YYYY-MM" }, { status: 400 });
  const state = await loadJournalCloseChecklist(context.company.id, period);
  return NextResponse.json({ period, preview: state.closeEntryPreview, eligibleToClose: state.eligible, closeBlockers: state.blockers });
}

export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const body = await request.json().catch(() => null) as { period?: unknown } | null;
  if (!body || typeof body.period !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.period)) return NextResponse.json({ error: "period must be YYYY-MM" }, { status: 400 });
  const result = await postRetainedEarningsClose({ companyId: context.company.id, userId: context.user.id, period: body.period });
  if (!result.ok) return NextResponse.json({ error: "Retained-earnings close cannot be posted", blockers: result.blockers }, { status: 409 });
  return NextResponse.json(result, { status: result.idempotent ? 200 : 201 });
}
