import { auth } from "@/lib/auth";
import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { calculationNodes, calculationRuns, getDatabase } from "@finance/database";
import { buildJournalCalculationGraph, journalCalculationFormulaVersion } from "@nevermodel/finance-engine";
import { requireCompanyAccess } from "@/lib/auth";
import { persistJournalCalculationGraph } from "@/lib/journal-calculation-graph";
import { loadJournalReport } from "@/lib/journal-ledger";
import { loadJournalReconciliation } from "@/lib/journal-reconciliation";
import { loadJournalAllocationAnalysis } from "@/lib/journal-allocation-analysis";
import { effectiveAsOfPeriod, loadLatestForecast } from "@/lib/forecast-read";

const validPeriod = (value: string | null): value is string => Boolean(value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value));
const parse = <T,>(value: string, fallback: T): T => { try { return JSON.parse(value) as T; } catch { return fallback; } };

/** Persist (or reuse) a journal-native calculation graph for one reporting period. */
export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const period = new URL(request.url).searchParams.get("period");
  const url = new URL(request.url);
  const view = url.searchParams.get("view") ?? "actual";
  const requestedAsOfPeriod = url.searchParams.get("asOfPeriod") ?? undefined;
  const scenarioId = url.searchParams.get("scenarioId") ?? undefined;
  if (!validPeriod(period)) return NextResponse.json({ error: "period must be YYYY-MM" }, { status: 400 });
  if (!(["actual", "projected", "scenario"] as string[]).includes(view)) return NextResponse.json({ error: "view must be actual, projected, or scenario" }, { status: 400 });
  if (requestedAsOfPeriod && !validPeriod(requestedAsOfPeriod)) return NextResponse.json({ error: "asOfPeriod must be a month on or before period" }, { status: 400 });
  if (view === "scenario" && !scenarioId) return NextResponse.json({ error: "scenario view requires scenarioId" }, { status: 400 });
  // Projected/scenario graphs are anchored at the latest forecast's as-of month (see
  // withDerivedForecast in journal-ledger.ts); a forecast as-of after `period` is clamped
  // instead of rejecting the request. A caller-supplied asOfPeriod with no forecast
  // anchoring still 400s on an out-of-range value, as before.
  // Load the forecast once per request and reuse it for both the as-of resolution and
  // the report below.
  const forecast = view === "projected" || view === "scenario" ? await loadLatestForecast(context.company.id) : undefined;
  const { asOfPeriod: forecastAsOf, forecastAnchored } = await effectiveAsOfPeriod(context.company.id, view, requestedAsOfPeriod, forecast);
  if (!forecastAnchored && forecastAsOf && forecastAsOf > period) return NextResponse.json({ error: "asOfPeriod must be a month on or before period" }, { status: 400 });
  const asOfPeriod = forecastAnchored && forecastAsOf! > period ? period : forecastAsOf;
  const selection = view === "actual" ? { view: "actual" as const } : { view: view as "projected" | "scenario", ...(asOfPeriod ? { asOfPeriod } : {}), ...(scenarioId ? { scenarioId } : {}) };
  const actual = view === "actual" ? await loadJournalReconciliation(context.company.id, period) : null;
  const report = actual ?? await loadJournalReport(context.company.id, period, undefined, selection, { ...(forecast !== undefined ? { forecast } : {}) });
  const allocationAnalysis = await loadJournalAllocationAnalysis(context.company.id, period);
  const graph = buildJournalCalculationGraph(actual ? { period, trialBalance: actual.trialBalance, statements: actual.statements, ledgerReconciliation: actual.report, accountBalances: actual.accountBalances, allocationAnalysis } : { period, trialBalance: report.trialBalance, statements: report.statements, view: view as "projected" | "scenario", ...(asOfPeriod ? { asOfPeriod } : {}), allocationAnalysis });
  const run = await persistJournalCalculationGraph({
    companyId: context.company.id,
    financialStateRevision: context.company.financialStateRevision,
    graph,
    input: actual ? { view, trialBalance: actual.trialBalance, statements: actual.statements, ledgerReconciliation: actual.report, accountBalances: actual.accountBalances, allocationAnalysis } : { view, asOfPeriod, scenarioId, trialBalance: report.trialBalance, statements: report.statements, allocationAnalysis },
  });
  return NextResponse.json({ run, graph, view, ...(asOfPeriod ? { asOfPeriod } : {}), ...(scenarioId ? { scenarioId } : {}), authority: actual?.authority ?? { eligible: false, blockers: ["Projected and scenario graphs are not eligible for actual-period promotion."] } });
}

/** Return the latest persisted journal graph for a period without recalculating it. */
export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const url = new URL(request.url);
  const period = url.searchParams.get("period");
  const view = url.searchParams.get("view") ?? "actual";
  const requestedAsOfPeriod = url.searchParams.get("asOfPeriod") ?? undefined;
  const scenarioId = url.searchParams.get("scenarioId") ?? undefined;
  if (!validPeriod(period)) return NextResponse.json({ error: "period must be YYYY-MM" }, { status: 400 });
  if (!(["actual", "projected", "scenario"] as string[]).includes(view)) return NextResponse.json({ error: "view must be actual, projected, or scenario" }, { status: 400 });
  // Resolve to the same effective as-of the matching POST would have stored (clamped to
  // `period` when a forecast anchors it), so the lookup below finds the persisted run.
  const { asOfPeriod: forecastAsOf, forecastAnchored } = await effectiveAsOfPeriod(context.company.id, view, requestedAsOfPeriod);
  const asOfPeriod = forecastAnchored && forecastAsOf && forecastAsOf > period ? period : forecastAsOf;
  const candidates = await getDatabase().select().from(calculationRuns).where(and(
    eq(calculationRuns.companyId, context.company.id),
    eq(calculationRuns.engineVersion, journalCalculationFormulaVersion),
    eq(calculationRuns.asOfMonth, period),
  )).orderBy(desc(calculationRuns.createdAt)).limit(30);
  const run = candidates.find((candidate) => {
    const input = parse<{ view?: string; asOfPeriod?: string; scenarioId?: string }>(candidate.inputJson, {});
    return (input.view ?? "actual") === view && (input.asOfPeriod ?? undefined) === asOfPeriod && (input.scenarioId ?? undefined) === scenarioId;
  });
  if (!run) return NextResponse.json({ run: null, nodes: [] });
  const nodes = await getDatabase().select().from(calculationNodes).where(eq(calculationNodes.calculationRunId, run.id)).orderBy(calculationNodes.nodeKey);
  return NextResponse.json({
    formulaVersion: journalCalculationFormulaVersion, view, ...(asOfPeriod ? { asOfPeriod } : {}), ...(scenarioId ? { scenarioId } : {}),
    run: { ...run, isCurrentFormula: run.engineVersion === journalCalculationFormulaVersion, isCurrentState: run.financialStateRevision === context.company.financialStateRevision },
    nodes: nodes.map((node) => ({ ...node, value: parse(node.valueJson, null), inputNodeIds: parse<string[]>(node.inputNodeIds, []), lineIds: parse<string[]>(node.lineIds, []), provenance: parse(node.provenance, []), verificationReasons: parse<string[]>(node.verificationReasons, []) })),
  });
}
