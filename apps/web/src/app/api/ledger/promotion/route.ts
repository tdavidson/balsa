import { auth } from "@/lib/auth";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { calculationRuns, getDatabase, journalPeriodPromotions } from "@finance/database";
import { buildJournalCalculationGraph, journalCalculationFormulaVersion } from "@balsa/finance-engine";
import { requireCompanyAccess } from "@/lib/auth";
import { persistJournalCalculationGraph } from "@/lib/journal-calculation-graph";
import { loadJournalReconciliation } from "@/lib/journal-reconciliation";

const body = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), note: z.string().max(2_000).optional() });

/** A promoted period is a pinned, auditable journal calculation—not a UI flag. */
export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "period must be YYYY-MM" }, { status: 400 });
  const reconciliation = await loadJournalReconciliation(context.company.id, parsed.data.period);
  if (!reconciliation.authority.eligible) return NextResponse.json({ error: "Journal period is not eligible for promotion", blockers: reconciliation.authority.blockers }, { status: 409 });
  const graph = buildJournalCalculationGraph({ period: parsed.data.period, trialBalance: reconciliation.trialBalance, statements: reconciliation.statements, ledgerReconciliation: reconciliation.report, accountBalances: reconciliation.accountBalances });
  const run = await persistJournalCalculationGraph({ companyId: context.company.id, financialStateRevision: context.company.financialStateRevision, graph, input: { trialBalance: reconciliation.trialBalance, statements: reconciliation.statements, ledgerReconciliation: reconciliation.report, accountBalances: reconciliation.accountBalances } });
  const db = getDatabase();
  const [promotion] = await db.insert(journalPeriodPromotions).values({ companyId: context.company.id, period: parsed.data.period, calculationRunId: run.id, promotedByUserId: context.user.id, note: parsed.data.note }).onConflictDoNothing().returning();
  const stored = promotion ?? (await db.select().from(journalPeriodPromotions).where(and(eq(journalPeriodPromotions.companyId, context.company.id), eq(journalPeriodPromotions.period, parsed.data.period))).limit(1))[0];
  if (!stored) return NextResponse.json({ error: "Unable to create or retrieve journal promotion" }, { status: 500 });
  return NextResponse.json({ promotion: stored, run, authority: reconciliation.authority }, { status: promotion ? 201 : 200 });
}

export async function GET(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const period = new URL(request.url).searchParams.get("period");
  if (!period || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return NextResponse.json({ error: "period must be YYYY-MM" }, { status: 400 });
  const [promotion] = await getDatabase().select({ id: journalPeriodPromotions.id, period: journalPeriodPromotions.period, note: journalPeriodPromotions.note, createdAt: journalPeriodPromotions.createdAt, calculationRunId: journalPeriodPromotions.calculationRunId, engineVersion: calculationRuns.engineVersion, financialStateRevision: calculationRuns.financialStateRevision }).from(journalPeriodPromotions).innerJoin(calculationRuns, eq(journalPeriodPromotions.calculationRunId, calculationRuns.id)).where(and(eq(journalPeriodPromotions.companyId, context.company.id), eq(journalPeriodPromotions.period, period), eq(calculationRuns.engineVersion, journalCalculationFormulaVersion))).limit(1);
  return NextResponse.json({ promotion: promotion ?? null });
}
