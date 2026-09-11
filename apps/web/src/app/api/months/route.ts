import { auth } from "@clerk/nextjs/server";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { cashEvents, evidence, getDatabase, reportingPeriods } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";

export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const months = await getDatabase().select().from(reportingPeriods).where(eq(reportingPeriods.companyId, context.company.id)).orderBy(asc(reportingPeriods.month));
  return NextResponse.json({ months });
}

export async function POST(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const body = (await request.json()) as { month?: string; openingCash?: string };
  if (!body.month || !/^\d{4}-\d{2}$/.test(body.month)) return NextResponse.json({ error: "Month must use YYYY-MM" }, { status: 400 });
  const [period] = await getDatabase().insert(reportingPeriods).values({ companyId: context.company.id, month: body.month, openingCash: body.openingCash ?? "0" }).onConflictDoUpdate({ target: [reportingPeriods.companyId, reportingPeriods.month], set: { openingCash: body.openingCash ?? "0", updatedAt: new Date() } }).returning();
  return NextResponse.json({ period });
}

export async function PATCH(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const body = (await request.json()) as { month?: string; status?: "open" | "closed" };
  if (!body.month || !body.status) return NextResponse.json({ error: "Month and status are required" }, { status: 400 });
  if (body.status === "closed") {
    const pending = await getDatabase().select({ id: evidence.id }).from(evidence).where(and(eq(evidence.companyId, context.company.id), eq(evidence.status, "pending"), or(eq(evidence.reportingMonth, body.month), isNull(evidence.reportingMonth))));
    if (pending.length) return NextResponse.json({ error: `Resolve ${pending.length} pending evidence item${pending.length === 1 ? "" : "s"} before closing this month`, pendingEvidence: pending.length }, { status: 409 });
  }
  let [period] = await getDatabase().update(reportingPeriods).set({ status: body.status, updatedAt: new Date() }).where(and(eq(reportingPeriods.companyId, context.company.id), eq(reportingPeriods.month, body.month))).returning();
  if (!period) {
    [period] = await getDatabase().insert(reportingPeriods).values({ companyId: context.company.id, month: body.month, status: body.status }).onConflictDoNothing().returning();
  }
  if (!period) return NextResponse.json({ error: "Reporting period not found" }, { status: 404 });
  const events = await getDatabase().select({ amount: cashEvents.amount, direction: cashEvents.direction, isActual: cashEvents.isActual }).from(cashEvents).leftJoin(evidence, eq(cashEvents.evidenceId, evidence.id)).where(and(eq(cashEvents.companyId, context.company.id), eq(cashEvents.isActual, "Y"), or(isNull(cashEvents.currency), eq(cashEvents.currency, context.company.baseCurrency)), eq(cashEvents.month, body.month), or(eq(evidence.status, "approved"), isNull(cashEvents.evidenceId))));
  const summary = events.reduce((result, event) => {
    const amount = Number(event.amount);
    const key = event.isActual === "Y" ? (event.direction === "receipt" ? "actualReceipts" : "actualSpending") : (event.direction === "receipt" ? "forecastReceipts" : "forecastSpending");
    result[key] += Number.isFinite(amount) ? amount : 0;
    return result;
  }, { forecastReceipts: 0, forecastSpending: 0, actualReceipts: 0, actualSpending: 0 });
  return NextResponse.json({ period, summary: { ...summary, forecastNet: summary.forecastReceipts - summary.forecastSpending, actualNet: summary.actualReceipts - summary.actualSpending, variance: (summary.actualReceipts - summary.actualSpending) - (summary.forecastReceipts - summary.forecastSpending) } });
}
