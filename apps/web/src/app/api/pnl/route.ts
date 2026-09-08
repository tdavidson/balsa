import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { cashEvents, getDatabase } from "@finance/database";
import { buildMonthlyProfitAndLoss, type FinancialLine } from "@nevermodel/finance-engine";
import { requireCompanyAccess } from "@/lib/auth";
import { classifyCashActivity, financialEventKey, inferFinancialDirection, isDetailedFinancialEvent } from "@/lib/financial-events";

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

export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const rows = await getDatabase().select({ id: cashEvents.id, month: cashEvents.month, transactionDate: cashEvents.transactionDate, description: cashEvents.description, amount: cashEvents.amount, direction: cashEvents.direction, category: cashEvents.category, evidenceId: cashEvents.evidenceId, accountingTreatment: cashEvents.accountingTreatment, recognitionStart: cashEvents.recognitionStart, recognitionEnd: cashEvents.recognitionEnd }).from(cashEvents).where(eq(cashEvents.companyId, context.company.id));
  const seen = new Set<string>();
  const lines: FinancialLine[] = rows.filter((row) => isDetailedFinancialEvent(row.description) && !["transfer", "investment"].includes(cashActivityCategory(row.category, row.description, row.direction))).flatMap((row) => {
    const key = financialEventKey(row);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ id: row.id, month: row.month, category: categoryFor(row.description), amount: Number(row.amount), direction: inferFinancialDirection(row.direction, row.description), description: row.description, accountingTreatment: (row.accountingTreatment === "prepaid" || row.accountingTreatment === "accrual" ? row.accountingTreatment : "cash"), ...(row.recognitionStart ? { recognitionStart: row.recognitionStart } : {}), ...(row.recognitionEnd ? { recognitionEnd: row.recognitionEnd } : {}), ...(row.evidenceId ? { sourceId: row.evidenceId } : {}) }];
  });
  return NextResponse.json({ months: buildMonthlyProfitAndLoss(lines) });
}
