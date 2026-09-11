import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/auth";
import { computeFinancials, forecastMonthView } from "@/lib/financials";

export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const url = new URL(request.url);
  const scenarioId = url.searchParams.get("scenario") ?? undefined;
  const asOfMonth = url.searchParams.get("asOf") ?? undefined;
  const financials = await computeFinancials(context.company.id, { ...(scenarioId ? { scenarioId } : {}), ...(asOfMonth ? { asOfMonth } : {}) });
  return NextResponse.json({
    openingCash: financials.input.openingCash?.amount ?? 0,
    openingCashMonth: financials.input.openingCash?.month ?? null,
    asOfMonth: financials.input.asOfMonth,
    horizon: financials.input.horizon,
    scenarioId: scenarioId ?? null,
    months: financials.output.months.map((month) => forecastMonthView(month, financials)),
  });
}
