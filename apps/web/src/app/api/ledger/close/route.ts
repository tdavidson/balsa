import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCompanyAccess } from "@/lib/auth";
import { closeJournalPeriod, loadJournalCloseChecklist } from "@/lib/journal-period-close";

const body = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), note: z.string().max(2_000).optional() });
export async function GET(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess(); const period = new URL(request.url).searchParams.get("period");
  if (!period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return NextResponse.json({ error: "period must be YYYY-MM" }, { status: 400 });
  return NextResponse.json(await loadJournalCloseChecklist(context.company.id, period));
}
/** Close is only possible after the exact source-to-ledger controls and CFO promotion pass. */
export async function POST(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess(); const parsed = body.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "period must be YYYY-MM" }, { status: 400 });
  const result = await closeJournalPeriod({ companyId: context.company.id, userId: context.user.id, period: parsed.data.period, ...(parsed.data.note ? { note: parsed.data.note } : {}) });
  if (!result.ok) return NextResponse.json({ error: "Period is not eligible for close", blockers: result.blockers }, { status: 409 });
  return NextResponse.json({ closure: result.closure, period: parsed.data.period, calculationRun: result.calculationRun }, { status: result.closure ? 201 : 200 });
}
