import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { companies, getDatabase } from "@finance/database";
import { isValidMonth } from "@balsa/finance-engine";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { effectiveAsOfPeriod, loadLatestForecast } from "@/lib/forecast-read";
import { forecastAsOfMonth } from "@/lib/forecast-inputs";
import { maxTimelineMonths, monthsBetween, resolveModelTimeline } from "@/lib/model-timeline";
import { loadStandardStatementMonths } from "@/lib/standard-statements";

/**
 * Statements in the Standard Financial Model layout, one column per month,
 * with fiscal-year rollups. The range defaults to the company's model
 * timeline. Built from the same lines and selection as the ledger statements.
 */
export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const url = new URL(request.url);
  const [company] = await getDatabase().select({ modelFirstPeriod: companies.modelFirstPeriod, modelLastPeriod: companies.modelLastPeriod, fiscalYearEnd: companies.fiscalYearEnd }).from(companies).where(eq(companies.id, context.company.id)).limit(1);
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  const timeline = resolveModelTimeline(company, await forecastAsOfMonth(context.company.id, new Date()));
  const start = url.searchParams.get("start") ?? timeline.firstPeriod;
  const end = url.searchParams.get("end") ?? timeline.lastPeriod;
  if (!isValidMonth(start) || !isValidMonth(end) || start > end) return NextResponse.json({ error: "start and end must be ordered YYYY-MM values" }, { status: 400 });
  if (monthsBetween(start, end) + 1 > maxTimelineMonths) return NextResponse.json({ error: `A view can span at most ${maxTimelineMonths} months.` }, { status: 400 });
  const scenarioId = url.searchParams.get("scenarioId") ?? undefined;
  const entityId = url.searchParams.get("entity") ?? undefined;
  const view = url.searchParams.get("view") === "actual" ? "actual" : scenarioId ? "scenario" : "projected";
  const forecast = view === "actual" ? null : await loadLatestForecast(context.company.id);
  const current = new Date().toISOString().slice(0, 7);
  const { asOfPeriod = current } = await effectiveAsOfPeriod(context.company.id, view, url.searchParams.get("asOfPeriod") ?? current, forecast);
  if (!isValidMonth(asOfPeriod)) return NextResponse.json({ error: "asOfPeriod must be a YYYY-MM value" }, { status: 400 });
  const result = await loadStandardStatementMonths({ companyId: context.company.id, start, end, currency: context.company.baseCurrency, ...(entityId ? { entityId } : {}), view, ...(scenarioId ? { scenarioId } : {}), asOfPeriod, forecast, fiscalYearEnd: company.fiscalYearEnd });
  return NextResponse.json({ view, currency: context.company.baseCurrency, start, end, timeline, ...result });
}
