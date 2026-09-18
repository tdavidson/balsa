import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/auth";
import { loadJournalReport } from "@/lib/journal-ledger";
import { loadJournalReconciliation } from "@/lib/journal-reconciliation";
import { effectiveAsOfPeriod, loadLatestForecast } from "@/lib/forecast-read";

const validMonth = (value: string | null): value is string => Boolean(value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value));
const nextMonth = (month: string) => { const [year, number] = month.split("-").map(Number); const date = new Date(Date.UTC(year!, number!, 1)); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; };
const monthsInRange = (start: string, end: string) => { const months: string[] = []; for (let month = start; month <= end; month = nextMonth(month)) months.push(month); return months; };

/**
 * Range reporting from the single entry-backed calculation model. Values stay
 * in minor units and retain the full statement payload for a shared inspector.
 */
export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const url = new URL(request.url);
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  const view = url.searchParams.get("view") ?? "actual";
  const requestedAsOfPeriod = url.searchParams.get("asOfPeriod") ?? undefined;
  const scenarioId = url.searchParams.get("scenarioId") ?? undefined;
  const entityId = url.searchParams.get("entityId") ?? undefined;
  if (!validMonth(start) || !validMonth(end) || start > end) return NextResponse.json({ error: "start and end must be ordered YYYY-MM values" }, { status: 400 });
  if (!(["actual", "projected", "scenario"] as string[]).includes(view)) return NextResponse.json({ error: "view must be actual, projected, or scenario" }, { status: 400 });
  if (requestedAsOfPeriod && !validMonth(requestedAsOfPeriod)) return NextResponse.json({ error: "asOfPeriod must be a month on or before end" }, { status: 400 });
  if (view === "scenario" && !scenarioId) return NextResponse.json({ error: "scenario view requires scenarioId" }, { status: 400 });
  // Projected/scenario views are anchored at the latest forecast's as-of month, matching
  // withDerivedForecast's override in journal-ledger.ts, so the reported/labeled as-of
  // always matches what the engine actually used. If that as-of falls after `end`, the
  // label is clamped to `end` rather than rejecting the request; a caller-supplied
  // asOfPeriod with no forecast anchoring still 400s on an out-of-range value, as before.
  // Load the forecast once per request and reuse it for both the as-of resolution and
  // every month's report below.
  const forecast = view === "projected" || view === "scenario" ? await loadLatestForecast(context.company.id) : undefined;
  const { asOfPeriod: forecastAsOf, forecastAnchored } = await effectiveAsOfPeriod(context.company.id, view, requestedAsOfPeriod, forecast);
  if (!forecastAnchored && forecastAsOf && forecastAsOf > end) return NextResponse.json({ error: "asOfPeriod must be a month on or before end" }, { status: 400 });
  const asOfPeriod = forecastAnchored && forecastAsOf! > end ? end : forecastAsOf;
  const selection = view === "actual" ? { view: "actual" as const } : { view: view as "projected" | "scenario", ...(asOfPeriod ? { asOfPeriod } : {}), ...(scenarioId ? { scenarioId } : {}) };
  const months = await Promise.all(monthsInRange(start, end).map(async (period) => {
    const report = await loadJournalReport(context.company.id, period, entityId, selection, { ...(forecast !== undefined ? { forecast } : {}) });
    const actualControls = view === "actual" ? await loadJournalReconciliation(context.company.id, period) : null;
    return { period, basis: period <= (asOfPeriod ?? period) ? "actual" : view === "scenario" ? "scenario" : "forecast", verification: actualControls?.authority.eligible ? "eligible_for_promotion" : actualControls?.report.verificationStatus ?? "unverified_projection", statements: report.statements, trialBalance: report.trialBalance };
  }));
  return NextResponse.json({ mode: "entry_graph", view, start, end, asOfPeriod: asOfPeriod ?? null, scenarioId: scenarioId ?? null, months });
}
