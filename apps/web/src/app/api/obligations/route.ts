import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { cashEvents, economicItems, evidence, getDatabase } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";
import { isDetailedFinancialEvent } from "@/lib/financial-events";

export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const db = getDatabase();
  const obligations = await db.select({ id: economicItems.id, label: economicItems.label, counterparty: economicItems.counterparty, amount: economicItems.amount, cadence: economicItems.cadence, evidenceId: economicItems.evidenceId, accountingTreatment: economicItems.accountingTreatment, recognitionStart: economicItems.recognitionStart, recognitionEnd: economicItems.recognitionEnd }).from(economicItems).where(and(eq(economicItems.companyId, context.company.id), eq(economicItems.type, "obligation"), eq(economicItems.status, "confirmed")));
  const payments = await db.select({ description: cashEvents.description, amount: cashEvents.amount, direction: cashEvents.direction, evidenceId: cashEvents.evidenceId, isActual: cashEvents.isActual, evidenceStatus: evidence.status }).from(cashEvents).leftJoin(evidence, eq(cashEvents.evidenceId, evidence.id)).where(eq(cashEvents.companyId, context.company.id));
  return NextResponse.json({ obligations: obligations.map((obligation) => {
    const gross = Number(obligation.amount ?? 0);
    const settled = payments.filter((payment) => isDetailedFinancialEvent(payment.description) && (payment.isActual === "Y" || payment.evidenceStatus === "approved") && (payment.description.toLowerCase().includes(obligation.label.toLowerCase()) || (obligation.counterparty && payment.description.toLowerCase().includes(obligation.counterparty.toLowerCase())) || (payment.evidenceId === obligation.evidenceId && Number(payment.amount) === gross))).reduce((sum, payment) => sum + Number(payment.amount), 0);
    return { ...obligation, amount: gross, settledAmount: settled, unpaidAmount: Math.max(0, gross - settled), status: settled >= gross && gross > 0 ? "settled" : "open" };
  }) });
}
