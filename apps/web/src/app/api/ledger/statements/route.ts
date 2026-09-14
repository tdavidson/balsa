import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/auth";
import { loadJournalStatements } from "@/lib/journal-ledger";

/**
 * Read-only journal-native statements. These are intentionally separate from
 * the former event-based reports. The entry graph is the sole reporting
 * authority; it is verified through source, account, and cash controls.
 */
export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const url = new URL(request.url);
  const period = url.searchParams.get("period");
  const entity = url.searchParams.get("entity") ?? undefined;
  const basis = url.searchParams.get("basis");
  const scenarioId = url.searchParams.get("scenarioId") ?? undefined;
  const view = url.searchParams.get("view") ?? undefined;
  const asOfPeriod = url.searchParams.get("asOfPeriod") ?? undefined;
  if (!period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return NextResponse.json({ error: "period must be YYYY-MM" }, { status: 400 });
  if (basis && !["actual", "forecast", "scenario", "adjustment", "elimination", "all"].includes(basis)) return NextResponse.json({ error: "Invalid basis" }, { status: 400 });
  if (view && !["actual", "projected", "scenario"].includes(view)) return NextResponse.json({ error: "Invalid view" }, { status: 400 });
  if (asOfPeriod && !/^\d{4}-(0[1-9]|1[0-2])$/.test(asOfPeriod)) return NextResponse.json({ error: "asOfPeriod must be YYYY-MM" }, { status: 400 });
  if (asOfPeriod && asOfPeriod > period) return NextResponse.json({ error: "asOfPeriod cannot be after period" }, { status: 400 });
  if (view === "scenario" && !scenarioId) return NextResponse.json({ error: "scenario view requires scenarioId" }, { status: 400 });
  if (scenarioId && !/^[0-9a-f-]{36}$/i.test(scenarioId)) return NextResponse.json({ error: "scenarioId must be a UUID" }, { status: 400 });
  return NextResponse.json({ mode: "entry_graph", view: view ?? (basis ? "basis" : "actual"), basis: basis ?? null, asOfPeriod: asOfPeriod ?? null, verification: "unverified_until_reconciled", statements: await loadJournalStatements(context.company.id, period, entity, { ...(basis ? { basis: basis as "actual" | "forecast" | "scenario" | "adjustment" | "elimination" | "all" } : {}), ...(view ? { view: view as "actual" | "projected" | "scenario" } : {}), ...(asOfPeriod ? { asOfPeriod } : {}), ...(scenarioId ? { scenarioId } : {}) }) });
}
