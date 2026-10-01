import { auth } from "@/lib/auth";
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";
import { calculationNodes, calculationRuns, economicItems, getDatabase, journalEntries } from "@finance/database";
import { NextResponse } from "next/server";
import { buildJournalCalculationGraph, forecastFormulaVersion, journalCalculationFormulaVersion } from "@balsa/finance-engine";
import { requireCompanyAccess } from "@/lib/auth";
import { persistJournalCalculationGraph } from "@/lib/journal-calculation-graph";
import { loadJournalReconciliation } from "@/lib/journal-reconciliation";
import { driverIdsFromProvenance, normalizeCalculationProvenance } from "@/lib/calculation-provenance";

const validPeriod = (value: string | null | undefined): value is string => Boolean(value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value));
const parse = <T,>(value: string, fallback: T): T => { try { return JSON.parse(value) as T; } catch { return fallback; } };
const forecastEngines = "forecast-run-%";

async function latestJournalPeriod(companyId: string) {
  const [entry] = await getDatabase().select({ period: journalEntries.period }).from(journalEntries).where(and(eq(journalEntries.companyId, companyId), eq(journalEntries.status, "posted"))).orderBy(desc(journalEntries.period)).limit(1);
  return entry?.period ?? null;
}

/** Compatibility surface for the trace dialog; it runs only the entry graph. */
export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const requested = new URL(request.url).searchParams.get("period");
  const period = validPeriod(requested) ? requested : await latestJournalPeriod(context.company.id);
  if (!period) return NextResponse.json({ error: "No posted journal period is available to calculate." }, { status: 409 });
  const reconciliation = await loadJournalReconciliation(context.company.id, period);
  const graph = buildJournalCalculationGraph({ period, trialBalance: reconciliation.trialBalance, statements: reconciliation.statements, ledgerReconciliation: reconciliation.report, accountBalances: reconciliation.accountBalances });
  const run = await persistJournalCalculationGraph({ companyId: context.company.id, financialStateRevision: context.company.financialStateRevision, graph, input: { view: "actual", trialBalance: reconciliation.trialBalance, statements: reconciliation.statements, ledgerReconciliation: reconciliation.report, accountBalances: reconciliation.accountBalances } });
  return NextResponse.json({ run, graph, period });
}

/**
 * Read persisted journal graph history for one period without recalculating it.
 * `?engine=forecast` instead returns the latest persisted forecast run's nodes (or a
 * specific `runId` among them): the forecast run isn't scoped to one reporting period,
 * so `period` doesn't apply there.
 */
export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const url = new URL(request.url); const requestedRunId = url.searchParams.get("runId");
  if (url.searchParams.get("engine") === "forecast") return forecastTrace(context.company.id, context.company.financialStateRevision, requestedRunId);
  const requestedRun = requestedRunId ? (await getDatabase().select().from(calculationRuns).where(and(eq(calculationRuns.id, requestedRunId), eq(calculationRuns.companyId, context.company.id), eq(calculationRuns.engineVersion, journalCalculationFormulaVersion))).limit(1))[0] : null;
  const requestedPeriod = url.searchParams.get("period");
  const period = requestedRun?.asOfMonth ?? (validPeriod(requestedPeriod) ? requestedPeriod : await latestJournalPeriod(context.company.id));
  if (!period) return NextResponse.json({ formulaVersion: journalCalculationFormulaVersion, run: null, runs: [], nodes: [] });
  const runs = await getDatabase().select().from(calculationRuns).where(and(eq(calculationRuns.companyId, context.company.id), eq(calculationRuns.engineVersion, journalCalculationFormulaVersion), eq(calculationRuns.asOfMonth, period))).orderBy(desc(calculationRuns.createdAt)).limit(20);
  const run = requestedRun ?? runs[0];
  if (!run) return NextResponse.json({ formulaVersion: journalCalculationFormulaVersion, period, run: null, runs: [], nodes: [] });
  const nodes = await getDatabase().select().from(calculationNodes).where(eq(calculationNodes.calculationRunId, run.id)).orderBy(calculationNodes.month, calculationNodes.nodeKey);
  const view = (entry: typeof run) => ({ ...entry, isCurrentFormula: entry.engineVersion === journalCalculationFormulaVersion, isCurrentState: entry.financialStateRevision === context.company.financialStateRevision });
  return NextResponse.json({ formulaVersion: journalCalculationFormulaVersion, period, run: view(run), runs: runs.map(view), nodes: nodes.map((node) => ({ ...node, value: parse(node.valueJson, null), inputNodeIds: parse<string[]>(node.inputNodeIds, []), lineIds: parse<string[]>(node.lineIds, []), provenance: normalizeCalculationProvenance(parse(node.provenance, [])), verificationReasons: parse<string[]>(node.verificationReasons, []) })) });
}

/** The latest persisted forecast run's nodes, company-scoped, with driver ids resolved to economic item labels. */
async function forecastTrace(companyId: string, financialStateRevision: string, requestedRunId: string | null) {
  const db = getDatabase();
  const requestedRun = requestedRunId ? (await db.select().from(calculationRuns).where(and(eq(calculationRuns.id, requestedRunId), eq(calculationRuns.companyId, companyId), like(calculationRuns.engineVersion, forecastEngines))).limit(1))[0] : null;
  const runs = await db.select().from(calculationRuns).where(and(eq(calculationRuns.companyId, companyId), like(calculationRuns.engineVersion, forecastEngines))).orderBy(desc(sql`${calculationRuns.financialStateRevision}::bigint`), desc(calculationRuns.createdAt)).limit(20);
  const run = requestedRun ?? runs[0];
  if (!run) return NextResponse.json({ formulaVersion: forecastFormulaVersion, engine: "forecast", period: null, run: null, runs: [], nodes: [] });
  const nodes = await db.select().from(calculationNodes).where(eq(calculationNodes.calculationRunId, run.id)).orderBy(calculationNodes.month, calculationNodes.nodeKey);
  const driverIds = [...new Set(nodes.flatMap((node) => driverIdsFromProvenance(parse<unknown>(node.provenance, []))))];
  const labelRows = driverIds.length ? await db.select({ id: economicItems.id, label: economicItems.label }).from(economicItems).where(and(eq(economicItems.companyId, companyId), inArray(economicItems.id, driverIds))) : [];
  const driverLabels = new Map(labelRows.map((row) => [row.id, row.label]));
  const view = (entry: typeof run) => ({ ...entry, isCurrentFormula: entry.engineVersion === forecastFormulaVersion, isCurrentState: entry.financialStateRevision === financialStateRevision });
  return NextResponse.json({
    formulaVersion: forecastFormulaVersion, engine: "forecast", period: run.asOfMonth, run: view(run), runs: runs.map(view),
    nodes: nodes.map((node) => ({ ...node, value: parse(node.valueJson, null), inputNodeIds: parse<string[]>(node.inputNodeIds, []), lineIds: parse<string[]>(node.lineIds, []), provenance: normalizeCalculationProvenance(parse<unknown>(node.provenance, []), driverLabels), verificationReasons: parse<string[]>(node.verificationReasons, []) })),
  });
}
