import { auth } from "@clerk/nextjs/server";
import { and, eq, or, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { cashEvents, evidence, getDatabase, sources } from "@finance/database";
import { buildMonthlyProfitAndLoss, type FinancialLine } from "@nevermodel/finance-engine";
import { requireCompanyAccess } from "@/lib/auth";
import { classifyCashActivity, inferFinancialDirection, isDetailedFinancialEvent } from "@/lib/financial-events";
import { canonicalFinancialEvents } from "@/lib/canonical-financial-events";

function categoryFor(description: string): FinancialLine["category"] {
  if (/management|fee/i.test(description)) return "management_fee";
  if (/salary|payroll|employee/i.test(description)) return "salary";
  if (/contractor|freelance/i.test(description)) return "contractor";
  if (/legal|accounting|professional|consult/i.test(description)) return "professional_services";
  if (/allocation|shared/i.test(description)) return "allocation";
  if (/prepaid|prepayment/i.test(description)) return "prepaid";
  return "other";
}

function cashActivityCategory(category: string | null, description: string, direction: "receipt" | "spend") {
  return category === "transfer" || category === "investment" ? category : classifyCashActivity(description, direction);
}

function sourceKind(metadata: string | null) {
  try { return (JSON.parse(metadata ?? "{}") as { classification?: { kind?: string } }).classification?.kind; } catch { return undefined; }
}

export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const rows = await getDatabase().select({ id: cashEvents.id, month: cashEvents.month, transactionDate: cashEvents.transactionDate, description: cashEvents.description, amount: cashEvents.amount, direction: cashEvents.direction, category: cashEvents.category, evidenceId: cashEvents.evidenceId, accountingTreatment: cashEvents.accountingTreatment, recognitionStart: cashEvents.recognitionStart, recognitionEnd: cashEvents.recognitionEnd, sourceName: evidence.sourceName, sourceMetadata: sources.metadata }).from(cashEvents).leftJoin(evidence, eq(cashEvents.evidenceId, evidence.id)).leftJoin(sources, eq(cashEvents.sourceId, sources.id)).where(and(eq(cashEvents.companyId, context.company.id), eq(cashEvents.isActual, "Y"), or(isNull(cashEvents.currency), eq(cashEvents.currency, context.company.baseCurrency)), or(eq(evidence.status, "approved"), isNull(cashEvents.evidenceId))));
  const canonical = canonicalFinancialEvents(rows.map((row) => ({ ...row, date: row.transactionDate, sourceKind: sourceKind(row.sourceMetadata) ?? null })), "books");
  const lines: FinancialLine[] = canonical.filter((row) => isDetailedFinancialEvent(row.description) && ["revenue", "expense"].includes(cashActivityCategory(row.category, row.description, row.direction))).map((row) => ({ id: row.id, month: row.month, category: categoryFor(row.description), amount: Number(row.amount), direction: inferFinancialDirection(row.direction, row.description), description: row.description, accountingTreatment: (row.accountingTreatment === "prepaid" || row.accountingTreatment === "accrual" ? row.accountingTreatment : "cash"), ...(row.recognitionStart ? { recognitionStart: row.recognitionStart } : {}), ...(row.recognitionEnd ? { recognitionEnd: row.recognitionEnd } : {}), ...(row.evidenceId ? { sourceId: row.evidenceId } : {}) }));
  return NextResponse.json({ months: buildMonthlyProfitAndLoss(lines) });
}
