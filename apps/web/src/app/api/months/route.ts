import { auth } from "@clerk/nextjs/server";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { evidence, getDatabase, reportingPeriods } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";
import { computeFinancials } from "@/lib/financials";

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
  const financials = await computeFinancials(context.company.id);
  const month = financials.output.months.find((entry) => entry.month === body.month);
  const summary = {
    forecastReceipts: month?.expectedReceipts ?? 0,
    forecastSpending: month?.expectedSpending ?? 0,
    actualReceipts: month?.actualReceipts ?? 0,
    actualSpending: month?.actualSpending ?? 0,
    forecastNet: (month?.expectedReceipts ?? 0) - (month?.expectedSpending ?? 0),
    actualNet: month?.actualNet ?? 0,
    variance: month?.variance ?? 0,
    endingCash: month?.endingCash ?? null,
    outstandingReceivables: month?.outstanding.receivables.length ?? 0,
    outstandingPayables: month?.outstanding.payables.length ?? 0,
  };
  return NextResponse.json({ period, summary });
}
