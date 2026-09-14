import { auth } from "@/lib/auth";
import { and, desc, eq } from "drizzle-orm";
import { calculationNodes, calculationRuns, getDatabase, journalEntries } from "@finance/database";
import { NextResponse } from "next/server";
import { buildJournalCalculationGraph, journalCalculationFormulaVersion } from "@nevermodel/finance-engine";
import { requireCompanyAccess } from "@/lib/auth";
import { persistJournalCalculationGraph } from "@/lib/journal-calculation-graph";
import { loadJournalReconciliation } from "@/lib/journal-reconciliation";

const validPeriod = (value: string | null | undefined): value is string => Boolean(value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value));
const parse = <T,>(value: string, fallback: T): T => { try { return JSON.parse(value) as T; } catch { return fallback; } };

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

/** Read persisted journal graph history for one period without recalculating it. */
export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const url = new URL(request.url); const requestedRunId = url.searchParams.get("runId");
  const requestedRun = requestedRunId ? (await getDatabase().select().from(calculationRuns).where(and(eq(calculationRuns.id, requestedRunId), eq(calculationRuns.companyId, context.company.id), eq(calculationRuns.engineVersion, journalCalculationFormulaVersion))).limit(1))[0] : null;
  const requestedPeriod = url.searchParams.get("period");
  const period = requestedRun?.asOfMonth ?? (validPeriod(requestedPeriod) ? requestedPeriod : await latestJournalPeriod(context.company.id));
  if (!period) return NextResponse.json({ formulaVersion: journalCalculationFormulaVersion, run: null, runs: [], nodes: [] });
  const runs = await getDatabase().select().from(calculationRuns).where(and(eq(calculationRuns.companyId, context.company.id), eq(calculationRuns.engineVersion, journalCalculationFormulaVersion), eq(calculationRuns.asOfMonth, period))).orderBy(desc(calculationRuns.createdAt)).limit(20);
  const run = requestedRun ?? runs[0];
  if (!run) return NextResponse.json({ formulaVersion: journalCalculationFormulaVersion, period, run: null, runs: [], nodes: [] });
  const nodes = await getDatabase().select().from(calculationNodes).where(eq(calculationNodes.calculationRunId, run.id)).orderBy(calculationNodes.month, calculationNodes.nodeKey);
  const view = (entry: typeof run) => ({ ...entry, isCurrentFormula: entry.engineVersion === journalCalculationFormulaVersion, isCurrentState: entry.financialStateRevision === context.company.financialStateRevision });
  return NextResponse.json({ formulaVersion: journalCalculationFormulaVersion, period, run: view(run), runs: runs.map(view), nodes: nodes.map((node) => ({ ...node, value: parse(node.valueJson, null), inputNodeIds: parse<string[]>(node.inputNodeIds, []), lineIds: parse<string[]>(node.lineIds, []), provenance: parse(node.provenance, []), verificationReasons: parse<string[]>(node.verificationReasons, []) })) });
}
