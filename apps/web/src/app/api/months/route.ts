import { auth } from "@/lib/auth";
import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDatabase, journalPeriodClosures, recordAudit, reportingPeriods } from "@finance/database";
import { requireCompanyAccess } from "@/lib/auth";
import { refreshCurrentCalculationRun } from "@/lib/refresh-calculation-run";
import { closeJournalPeriod } from "@/lib/journal-period-close";

/** Reporting-period status is journal-native; opening balances are posted journals, never event-engine inputs. */
export async function GET() {
  await auth.protect();
  const context = await requireCompanyAccess();
  const months = await getDatabase().select().from(reportingPeriods).where(eq(reportingPeriods.companyId, context.company.id)).orderBy(asc(reportingPeriods.month));
  return NextResponse.json({ months });
}

export async function PATCH(request: Request) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const body = (await request.json()) as { month?: string; status?: "open" | "closed" };
  if (!body.month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.month) || !body.status) return NextResponse.json({ error: "Month and status are required" }, { status: 400 });
  if (body.status === "closed") {
    const result = await closeJournalPeriod({ companyId: context.company.id, userId: context.user.id, period: body.month });
    if (!result.ok) return NextResponse.json({ error: "Period is not eligible for close", blockers: result.blockers }, { status: 409 });
    return NextResponse.json({ period: result.reportingPeriod, calculationRun: result.calculationRun });
  }
  const closure = await getDatabase().select({ id: journalPeriodClosures.id }).from(journalPeriodClosures).where(and(eq(journalPeriodClosures.companyId, context.company.id), eq(journalPeriodClosures.period, body.month))).limit(1);
  if (closure[0]) return NextResponse.json({ error: "A closed period cannot be reopened. Post an explicit adjustment or reversal instead." }, { status: 409 });
  // An open period has no closer; clearing the column keeps the row honest.
  let [period] = await getDatabase().update(reportingPeriods).set({ status: "open", closedByUserId: null, updatedAt: new Date() }).where(and(eq(reportingPeriods.companyId, context.company.id), eq(reportingPeriods.month, body.month))).returning();
  if (!period) [period] = await getDatabase().insert(reportingPeriods).values({ companyId: context.company.id, month: body.month, status: "open" }).onConflictDoNothing().returning();
  if (!period) return NextResponse.json({ error: "Reporting period not found" }, { status: 404 });
  await recordAudit(getDatabase(), { companyId: context.company.id, actorUserId: context.user.id, via: "ui", action: "period.reopened", entityType: "reporting_period", entityId: period.id, summary: `Reopened reporting period ${body.month}`, after: { period: body.month } });
  return NextResponse.json({ period, calculationRun: await refreshCurrentCalculationRun(context.company.id, { cause: { kind: "period_reopened", subjectType: "reporting_period", subjectId: body.month, actorUserId: context.user.id, via: "ui" } }) });
}
