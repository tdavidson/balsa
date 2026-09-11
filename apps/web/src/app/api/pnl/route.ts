import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/auth";
import { computeFinancials, pnlMonthView } from "@/lib/financials";

export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const url = new URL(request.url);
  const scenarioId = url.searchParams.get("scenario") ?? undefined;
  const entity = url.searchParams.get("entity") ?? undefined;
  const financials = await computeFinancials(context.company.id, { ...(scenarioId ? { scenarioId } : {}), ...(entity ? { entity } : {}) });
  return NextResponse.json({ months: financials.output.months.map(pnlMonthView) });
}
