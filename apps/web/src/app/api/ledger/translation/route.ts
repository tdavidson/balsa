import { auth } from "@/lib/auth";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { chartAccounts, fxRates, fxRateSets, fxTranslationPolicies, getDatabase } from "@finance/database";
import { buildJournalCalculationGraph, buildJournalStatements, buildTrialBalance, translateJournalLines } from "@balsa/finance-engine";
import { requireCompanyAccess } from "@/lib/auth";
import { loadConsolidatedJournalReport } from "@/lib/consolidated-journal-report";
import { persistJournalCalculationGraph } from "@/lib/journal-calculation-graph";

const validPeriod = (value: string | null): value is string => Boolean(value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value));

async function buildTranslation(companyId: string, period: string) {
  const db = getDatabase(); const [policy] = await db.select().from(fxTranslationPolicies).where(and(eq(fxTranslationPolicies.companyId, companyId), eq(fxTranslationPolicies.status, "approved"))).limit(1);
  if (!policy) return { error: "No approved FX translation policy is available." as const };
  const [cta, report, rows] = await Promise.all([
    db.select({ id: chartAccounts.id, code: chartAccounts.code, name: chartAccounts.name }).from(chartAccounts).where(and(eq(chartAccounts.id, policy.ctaAccountId), eq(chartAccounts.companyId, companyId), eq(chartAccounts.active, "Y"))).limit(1),
    loadConsolidatedJournalReport(companyId, period),
    db.select({ id: fxRates.id, rateSetId: fxRates.rateSetId, fromCurrency: fxRates.fromCurrency, toCurrency: fxRates.toCurrency, rateType: fxRates.rateType, effectiveDate: fxRates.effectiveDate, numerator: fxRates.numerator, denominator: fxRates.denominator, sourceId: fxRates.sourceId, evidenceId: fxRates.evidenceId, factId: fxRates.factId, sourceLocation: fxRates.sourceLocation, rateSetStatus: fxRateSets.status }).from(fxRates).innerJoin(fxRateSets, eq(fxRates.rateSetId, fxRateSets.id)).where(and(eq(fxRates.companyId, companyId), eq(fxRateSets.companyId, companyId))),
  ]);
  if (!cta[0]) return { error: "The approved FX policy CTA account is unavailable." as const };
  const rates = rows.map((rate) => ({ id: rate.id, rateSetId: rate.rateSetId, rateSetStatus: rate.rateSetStatus as "draft" | "approved" | "superseded" | "rejected", fromCurrency: rate.fromCurrency, toCurrency: rate.toCurrency, rateType: rate.rateType as "spot" | "average" | "closing" | "historical", effectiveDate: rate.effectiveDate, numerator: rate.numerator, denominator: rate.denominator, ...(rate.sourceId ? { sourceId: rate.sourceId } : {}), ...(rate.evidenceId ? { evidenceId: rate.evidenceId } : {}), ...(rate.factId ? { factId: rate.factId } : {}), ...(rate.sourceLocation ? { sourceLocation: rate.sourceLocation } : {}) }));
  const result = translateJournalLines({ lines: report.includedLines, period, rates, policy: { presentationCurrency: policy.presentationCurrency, incomeRateType: policy.incomeRateType as "spot" | "average", monetaryRateType: policy.monetaryRateType as "spot" | "closing", equityRateType: policy.equityRateType as "spot" | "historical", ctaAccount: cta[0] } });
  const graph = result.status === "ready"
    ? buildJournalCalculationGraph({ period, trialBalance: buildTrialBalance(result.lines, period), statements: buildJournalStatements(result.lines, period, undefined, { basis: "all" }), fxTranslation: { presentationCurrency: policy.presentationCurrency, status: "ready", reasons: [], ctaMinor: result.ctaMinor, selections: result.selections } })
    : buildJournalCalculationGraph({ period, trialBalance: buildTrialBalance([], period), statements: buildJournalStatements([], period), fxTranslation: { presentationCurrency: policy.presentationCurrency, status: "blocked", reasons: result.reasons, selections: result.selections } });
  return { policy: { id: policy.id, name: policy.name, presentationCurrency: policy.presentationCurrency }, result, graph };
}

/** Read-only presentation translation. Functional-currency books are never modified. */
export async function GET(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess(); const period = new URL(request.url).searchParams.get("period");
  if (!validPeriod(period)) return NextResponse.json({ error: "period must be YYYY-MM" }, { status: 400 });
  const translation = await buildTranslation(context.company.id, period);
  if ("error" in translation) return NextResponse.json({ status: "blocked", reasons: [translation.error], statements: null }, { status: 409 });
  return NextResponse.json({ period, policy: translation.policy, ...translation.result, graph: translation.graph });
}

/** Persist a reproducible presentation-translation graph without changing functional books. */
export async function POST(request: Request) {
  await auth.protect(); const context = await requireCompanyAccess(); const period = new URL(request.url).searchParams.get("period");
  if (!validPeriod(period)) return NextResponse.json({ error: "period must be YYYY-MM" }, { status: 400 });
  const translation = await buildTranslation(context.company.id, period);
  if ("error" in translation) return NextResponse.json({ error: translation.error }, { status: 409 });
  const run = await persistJournalCalculationGraph({ companyId: context.company.id, financialStateRevision: context.company.financialStateRevision, graph: translation.graph, input: { view: "presentation_translation", policyId: translation.policy.id, presentationCurrency: translation.policy.presentationCurrency, status: translation.result.status, selections: translation.result.selections, ...(translation.result.status === "ready" ? { ctaMinor: translation.result.ctaMinor } : {}) } });
  return NextResponse.json({ run, period, policy: translation.policy, ...translation.result, graph: translation.graph });
}
