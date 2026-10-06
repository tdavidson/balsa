import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { chartAccounts, getDatabase, recordAudit } from "@finance/database";
import { auth, requireCompanyAccess } from "@/lib/auth";
import { chartRowIsCash, loadBankLinkedAccountIds } from "@/lib/cash-accounts";
import { refreshCurrentCalculationRun } from "@/lib/refresh-calculation-run";

const body = z.object({ cashTreatment: z.enum(["cash", "not_cash"]).nullable() });

/**
 * Override whether an account counts as cash. By default a bank-linked asset,
 * or an asset named as cash, counts. The choice changes which entries are cash
 * flows and the cash balance, never a journal, so it applies to posted
 * accounts too; it is audited and recalculates the books and forecast.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await auth.protect();
  const context = await requireCompanyAccess();
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "cashTreatment must be cash, not_cash, or null for the default." }, { status: 400 });
  const db = getDatabase();
  const [existing] = await db.select().from(chartAccounts).where(and(eq(chartAccounts.companyId, context.company.id), eq(chartAccounts.id, (await params).id))).limit(1);
  if (!existing) return NextResponse.json({ error: "Chart account not found" }, { status: 404 });
  const section = existing.accountType === "contra" ? existing.statementSection : existing.accountType;
  if (parsed.data.cashTreatment === "cash" && section !== "asset") return NextResponse.json({ error: "Only an asset account can count as cash." }, { status: 400 });
  const linkedIds = await loadBankLinkedAccountIds(context.company.id);
  if (existing.cashTreatment === parsed.data.cashTreatment) return NextResponse.json({ account: { ...existing, isCash: chartRowIsCash(existing, linkedIds) }, calculationRun: null });
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(chartAccounts).set({ cashTreatment: parsed.data.cashTreatment, updatedAt: new Date() }).where(and(eq(chartAccounts.companyId, context.company.id), eq(chartAccounts.id, existing.id))).returning();
    const label = parsed.data.cashTreatment === "cash" ? "counts as cash" : parsed.data.cashTreatment === "not_cash" ? "does not count as cash" : "uses the default cash rule";
    await recordAudit(tx, { companyId: context.company.id, actorUserId: context.user.id, via: "ui", action: "chart_account.cash_treatment_changed", entityType: "chart_account", entityId: existing.id, summary: `${existing.code} ${existing.name} now ${label}`, before: { cashTreatment: existing.cashTreatment, isCash: chartRowIsCash(existing, linkedIds) }, after: { cashTreatment: row!.cashTreatment, isCash: chartRowIsCash(row!, linkedIds) } });
    return row!;
  });
  const calculationRun = await refreshCurrentCalculationRun(context.company.id, { cause: { kind: "settings_changed", subjectType: "chart_account", subjectId: existing.id, actorUserId: context.user.id, via: "ui" } });
  return NextResponse.json({ account: { ...updated, isCash: chartRowIsCash(updated, linkedIds) }, calculationRun });
}
