import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/auth";
import { loadJournalFinancialMonths } from "@/lib/journal-financial-views";
import { loadLatestForecast } from "@/lib/forecast-read";

const validMonth = (value: string | null): value is string => Boolean(value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value));
const addMonths = (month: string, increment: number) => { const [year, number] = month.split("-").map(Number); const date = new Date(Date.UTC(year!, number! - 1 + increment, 1)); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; };

/** Dashboard-ready output from the authoritative entry model; no legacy event calculation fallback. */
export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const url = new URL(request.url); const current = new Date().toISOString().slice(0, 7);
  const start = url.searchParams.get("start") ?? `${current.slice(0, 4)}-01`;
  const end = url.searchParams.get("end") ?? addMonths(current, 11);
  const forecast = await loadLatestForecast(context.company.id);
  const asOfPeriod = url.searchParams.get("asOfPeriod") ?? forecast?.run.asOfMonth ?? current;
  const scenarioId = url.searchParams.get("scenarioId") ?? undefined;
  const entityId = url.searchParams.get("entity") ?? undefined;
  const view = scenarioId ? "scenario" : "projected";
  if (!validMonth(start) || !validMonth(end) || start > end || !validMonth(asOfPeriod) || asOfPeriod > end) return NextResponse.json({ error: "start, end, and asOfPeriod must be ordered YYYY-MM values" }, { status: 400 });
  const months = await loadJournalFinancialMonths({ companyId: context.company.id, start, end, currency: context.company.baseCurrency, ...(entityId ? { entityId } : {}), selection: { view, asOfPeriod, ...(scenarioId ? { scenarioId } : {}) }, asOfPeriod, view });
  const runway = forecast ? { ...forecast.run.runway, revision: forecast.revision, horizonEnd: forecast.run.horizon.end, stale: forecast.stale, exceptions: forecast.run.exceptions.length } : null;
  return NextResponse.json({ mode: "entry_graph", view, asOfPeriod, months, runway });
}
